import crypto from 'node:crypto';
import { createReadStream, createWriteStream, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const EMPTY_SHA256 = crypto.createHash('sha256').update('').digest('hex');
const DEFAULT_REGION = 'us-east-1';
const DEFAULT_PREFIX = 'print-farm-controller/';
const METADATA_SUFFIX = '.pfcmeta.json';

function s3Error(message, statusCode = 502, code = null) {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (code) error.code = code;
  return error;
}

function cleanString(value) {
  return String(value || '').trim();
}

function normalizePrefix(value) {
  const raw = cleanString(value).replace(/^\/+/, '');
  if (!raw) return DEFAULT_PREFIX;
  const parts = raw.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw s3Error('S3 path prefix is invalid.', 400, 'S3_PREFIX_INVALID');
  }
  const normalized = parts.join('/');
  return normalized ? `${normalized}/` : DEFAULT_PREFIX;
}

function safeBackupFileName(value) {
  const fileName = cleanString(value);
  if (!fileName || fileName.length > 240 || /[\\/\0\r\n]/.test(fileName) || !/\.pfcbackup$/i.test(fileName)) {
    throw s3Error('S3 backup has an invalid file name.', 400, 'S3_BACKUP_INVALID_NAME');
  }
  return fileName;
}

function normalizeEndpoint(value, allowInsecureHttp = false) {
  const raw = cleanString(value);
  if (!raw) throw s3Error('S3 endpoint is required.', 400, 'S3_ENDPOINT_REQUIRED');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw s3Error('S3 endpoint must be a valid URL.', 400, 'S3_ENDPOINT_INVALID');
  }
  if (!['http:','https:'].includes(url.protocol)) {
    throw s3Error('S3 endpoint must use HTTP or HTTPS.', 400, 'S3_ENDPOINT_INVALID');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw s3Error('S3 endpoint must not contain credentials, query parameters or a fragment.', 400, 'S3_ENDPOINT_INVALID');
  }
  if (url.protocol === 'http:' && !allowInsecureHttp) {
    throw s3Error(
      'Plain HTTP S3 endpoints require Allow insecure HTTP to be enabled.',
      400,
      'S3_INSECURE_HTTP_NOT_ALLOWED'
    );
  }
  const pathname = url.pathname.replace(/\/+$/, '');
  if (pathname && pathname !== '/') {
    throw s3Error('S3 endpoint must not include a bucket or path.', 400, 'S3_ENDPOINT_INVALID');
  }
  url.pathname = '/';
  return url.toString().replace(/\/$/, '');
}

function normalizeBucket(value) {
  const bucket = cleanString(value);
  if (!bucket || bucket.length > 255 || /[\/\0\r\n]/.test(bucket)) {
    throw s3Error('S3 bucket name is invalid.', 400, 'S3_BUCKET_INVALID');
  }
  return bucket;
}

function normalizeRegion(value) {
  const region = cleanString(value) || DEFAULT_REGION;
  if (region.length > 128 || !/^[A-Za-z0-9._-]+$/.test(region)) {
    throw s3Error('S3 region is invalid.', 400, 'S3_REGION_INVALID');
  }
  return region;
}

function normalizeAddressingStyle(value) {
  return cleanString(value).toLowerCase() === 'virtual' ? 'virtual' : 'path';
}

function encodeRfc3986(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function encodePath(pathname) {
  return String(pathname || '/')
    .split('/')
    .map((part, index) => index === 0 ? '' : encodeRfc3986(part))
    .join('/') || '/';
}

function canonicalQuery(entries = []) {
  return entries
    .map(([key, value]) => [encodeRfc3986(key), encodeRfc3986(value)])
    .sort(([aKey, aValue], [bKey, bValue]) =>
      aKey.localeCompare(bKey) || aValue.localeCompare(bValue)
    )
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value) {
  return crypto.createHmac('sha256', key).update(value).digest();
}

function amzDate(value = new Date()) {
  const iso = value.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { timestamp:iso, date:iso.slice(0, 8) };
}

function xmlDecode(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_match, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&amp;/g, '&');
}

function xmlTag(block, name) {
  const match = String(block || '').match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? xmlDecode(match[1]) : '';
}

function parseListObjectsV2(xml) {
  const text = String(xml || '');
  const contents = [];
  const regex = /<Contents>([\s\S]*?)<\/Contents>/gi;
  let match;
  while ((match = regex.exec(text))) {
    const keyEncoded = xmlTag(match[1], 'Key');
    let key = keyEncoded;
    try { key = decodeURIComponent(keyEncoded); } catch {}
    contents.push({
      key,
      size:Number(xmlTag(match[1], 'Size') || 0),
      lastModified:xmlTag(match[1], 'LastModified') || null,
      etag:xmlTag(match[1], 'ETag').replace(/^"|"$/g, '') || null
    });
  }
  return {
    objects:contents,
    isTruncated:xmlTag(text, 'IsTruncated').toLowerCase() === 'true',
    nextContinuationToken:xmlTag(text, 'NextContinuationToken') || null
  };
}

async function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const stream = createReadStream(filePath);
  for await (const chunk of stream) hash.update(chunk);
  return hash.digest('hex');
}

async function responseText(response) {
  return response.text().catch(() => '');
}

function s3ResponseMessage(response, body, fallback) {
  const code = xmlTag(body, 'Code');
  const message = xmlTag(body, 'Message');
  const requestId = xmlTag(body, 'RequestId') || response.headers.get('x-amz-request-id');
  const region = response.headers.get('x-amz-bucket-region');
  const parts = [message || code || fallback];
  if (region) parts.push(`bucket region: ${region}`);
  if (requestId) parts.push(`request: ${requestId}`);
  return parts.join(' · ');
}

function nodeReadable(stream) {
  return Readable.fromWeb(stream);
}

export class S3BackupClient {
  constructor({
    dataDir,
    fetchFn = globalThis.fetch,
    nowFn = () => new Date(),
    diagnosticFn = null
  } = {}) {
    if (!dataDir) throw new Error('S3 backup client requires a data directory');
    if (typeof fetchFn !== 'function') throw new Error('S3 backup client requires fetch support');
    this.dataDir = path.resolve(dataDir);
    this.fetchFn = fetchFn;
    this.nowFn = typeof nowFn === 'function' ? nowFn : (() => new Date());
    this.diagnostic = typeof diagnosticFn === 'function' ? diagnosticFn : null;
    this.integrationDir = path.join(this.dataDir, 'integrations');
    this.statePath = path.join(this.integrationDir, 's3.json');
    this.lastError = null;
  }

  async log(level, message, meta = {}) {
    try { await this.diagnostic?.(level, message, meta); } catch {}
  }

  async loadState() {
    try {
      const parsed = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      if (!parsed || parsed.version !== 1) return null;
      return {
        version:1,
        endpoint:cleanString(parsed.endpoint) || null,
        bucket:cleanString(parsed.bucket) || null,
        region:cleanString(parsed.region) || DEFAULT_REGION,
        accessKeyId:cleanString(parsed.accessKeyId) || null,
        secretAccessKey:cleanString(parsed.secretAccessKey) || null,
        prefix:normalizePrefix(parsed.prefix || DEFAULT_PREFIX),
        addressingStyle:normalizeAddressingStyle(parsed.addressingStyle),
        allowInsecureHttp:parsed.allowInsecureHttp === true,
        savedAt:cleanString(parsed.savedAt) || null
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }

  async saveState(state) {
    await fs.mkdir(this.integrationDir, { recursive:true, mode:0o700 });
    const tempPath = `${this.statePath}.${crypto.randomUUID()}.tmp`;
    const value = {
      version:1,
      endpoint:state?.endpoint || null,
      bucket:state?.bucket || null,
      region:state?.region || DEFAULT_REGION,
      accessKeyId:state?.accessKeyId || null,
      secretAccessKey:state?.secretAccessKey || null,
      prefix:state?.prefix || DEFAULT_PREFIX,
      addressingStyle:normalizeAddressingStyle(state?.addressingStyle),
      allowInsecureHttp:state?.allowInsecureHttp === true,
      savedAt:state?.savedAt || new Date().toISOString()
    };
    try {
      await fs.writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode:0o600 });
      await fs.rename(tempPath, this.statePath);
    } finally {
      await fs.rm(tempPath, { force:true }).catch(() => {});
    }
    return value;
  }

  isConfigured(state) {
    return Boolean(
      cleanString(state?.endpoint)
      && cleanString(state?.bucket)
      && cleanString(state?.accessKeyId)
      && cleanString(state?.secretAccessKey)
    );
  }

  async status() {
    const state = await this.loadState();
    const configured = this.isConfigured(state);
    return {
      configured,
      connected:configured,
      endpoint:configured ? state.endpoint : null,
      bucket:configured ? state.bucket : null,
      region:configured ? state.region : DEFAULT_REGION,
      prefix:configured ? state.prefix : DEFAULT_PREFIX,
      addressingStyle:configured ? state.addressingStyle : 'path',
      allowInsecureHttp:configured ? state.allowInsecureHttp === true : false,
      accessKeyConfigured:configured,
      accessKeyHint:configured ? `${state.accessKeyId.slice(0, 4)}…${state.accessKeyId.slice(-4)}` : null,
      secretAccessKeyConfigured:configured,
      lastError:this.lastError
    };
  }

  async configure({
    endpoint,
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    prefix,
    addressingStyle,
    allowInsecureHttp
  } = {}) {
    const current = await this.loadState();
    const insecure = allowInsecureHttp === true;
    const nextEndpoint = normalizeEndpoint(endpoint, insecure);
    const nextBucket = normalizeBucket(bucket);
    const nextRegion = normalizeRegion(region);
    const nextAccessKeyId = cleanString(accessKeyId);
    const suppliedSecret = cleanString(secretAccessKey);
    const currentAccessKeyId = cleanString(current?.accessKeyId);
    if (currentAccessKeyId && nextAccessKeyId !== currentAccessKeyId && !suppliedSecret) {
      throw s3Error(
        'Enter the matching S3 secret access key when changing the access key ID.',
        400,
        'S3_SECRET_KEY_REQUIRED'
      );
    }
    const nextSecretAccessKey = suppliedSecret || (nextAccessKeyId === currentAccessKeyId
      ? cleanString(current?.secretAccessKey)
      : '');
    const nextPrefix = normalizePrefix(prefix);
    const nextStyle = normalizeAddressingStyle(addressingStyle);

    if (!nextAccessKeyId) {
      throw s3Error('S3 access key ID is required.', 400, 'S3_ACCESS_KEY_REQUIRED');
    }
    if (!nextSecretAccessKey) {
      throw s3Error('S3 secret access key is required.', 400, 'S3_SECRET_KEY_REQUIRED');
    }
    if (nextAccessKeyId.length > 512 || nextSecretAccessKey.length > 2048) {
      throw s3Error('S3 credentials are too long.', 400, 'S3_CREDENTIALS_INVALID');
    }

    const saved = await this.saveState({
      endpoint:nextEndpoint,
      bucket:nextBucket,
      region:nextRegion,
      accessKeyId:nextAccessKeyId,
      secretAccessKey:nextSecretAccessKey,
      prefix:nextPrefix,
      addressingStyle:nextStyle,
      allowInsecureHttp:insecure,
      savedAt:new Date().toISOString()
    });
    this.lastError = null;
    await this.log('info', 'S3-compatible backup configuration saved', {
      endpoint:saved.endpoint,
      bucket:saved.bucket,
      region:saved.region,
      prefix:saved.prefix,
      addressingStyle:saved.addressingStyle,
      insecureHttp:saved.allowInsecureHttp
    });
    return this.status();
  }

  async clearConfiguration() {
    await fs.rm(this.statePath, { force:true }).catch(() => {});
    this.lastError = null;
    await this.log('info', 'S3-compatible backup configuration cleared');
    return this.status();
  }

  async requireConfigured() {
    const state = await this.loadState();
    if (!this.isConfigured(state)) {
      throw s3Error(
        'S3-compatible storage is not configured.',
        503,
        'S3_NOT_CONFIGURED'
      );
    }
    return state;
  }

  requestTarget(state, key = '', queryEntries = []) {
    const endpoint = new URL(state.endpoint);
    const style = normalizeAddressingStyle(state.addressingStyle);
    const encodedKey = key ? encodePath(`/${key}`).slice(1) : '';
    let pathname;
    let host = endpoint.host;

    if (style === 'virtual') {
      host = `${state.bucket}.${endpoint.host}`;
      pathname = encodedKey ? `/${encodedKey}` : '/';
    } else {
      const encodedBucket = encodeRfc3986(state.bucket);
      pathname = encodedKey ? `/${encodedBucket}/${encodedKey}` : `/${encodedBucket}/`;
    }

    const query = canonicalQuery(queryEntries);
    const url = `${endpoint.protocol}//${host}${pathname}${query ? `?${query}` : ''}`;
    return { url, host, pathname, query };
  }

  signedHeaders({
    state,
    method,
    target,
    payloadHash = EMPTY_SHA256,
    extraHeaders = {}
  }) {
    const nowValue = this.nowFn();
    const now = nowValue instanceof Date ? nowValue : new Date(nowValue);
    const { timestamp, date } = amzDate(now);
    const headerEntries = new Map();
    headerEntries.set('host', target.host);
    headerEntries.set('x-amz-content-sha256', payloadHash);
    headerEntries.set('x-amz-date', timestamp);

    for (const [name, value] of Object.entries(extraHeaders || {})) {
      const normalizedName = String(name).trim().toLowerCase();
      if (!normalizedName || value === undefined || value === null) continue;
      headerEntries.set(normalizedName, String(value).trim().replace(/\s+/g, ' '));
    }

    const sorted = [...headerEntries.entries()].sort(([a], [b]) => a.localeCompare(b));
    const canonicalHeaders = sorted.map(([name, value]) => `${name}:${value}\n`).join('');
    const signedHeaderNames = sorted.map(([name]) => name).join(';');
    const canonicalRequest = [
      method.toUpperCase(),
      target.pathname,
      target.query,
      canonicalHeaders,
      signedHeaderNames,
      payloadHash
    ].join('\n');

    const credentialScope = `${date}/${state.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      timestamp,
      credentialScope,
      sha256Hex(canonicalRequest)
    ].join('\n');

    const dateKey = hmac(Buffer.from(`AWS4${state.secretAccessKey}`, 'utf8'), date);
    const regionKey = hmac(dateKey, state.region);
    const serviceKey = hmac(regionKey, 's3');
    const signingKey = hmac(serviceKey, 'aws4_request');
    const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    const headers = new Headers();
    for (const [name, value] of sorted) {
      if (name !== 'host') headers.set(name, value);
    }
    headers.set(
      'authorization',
      `AWS4-HMAC-SHA256 Credential=${state.accessKeyId}/${credentialScope},SignedHeaders=${signedHeaderNames},Signature=${signature}`
    );
    return headers;
  }

  async request({
    method = 'GET',
    key = '',
    query = [],
    payloadHash = EMPTY_SHA256,
    body = undefined,
    contentLength = null,
    contentType = null,
    state = null
  } = {}) {
    const activeState = state || await this.requireConfigured();
    const target = this.requestTarget(activeState, key, query);
    const extraHeaders = {};
    if (contentType) extraHeaders['content-type'] = contentType;
    if (contentLength !== null && contentLength !== undefined) extraHeaders['content-length'] = String(contentLength);
    const headers = this.signedHeaders({
      state:activeState,
      method,
      target,
      payloadHash,
      extraHeaders
    });

    const options = { method, headers };
    if (body !== undefined) {
      options.body = body;
      if (body && typeof body.pipe === 'function') options.duplex = 'half';
    }
    return this.fetchFn(target.url, options);
  }

  async testConnection() {
    const state = await this.requireConfigured();
    const response = await this.request({ method:'HEAD', state });
    if (!response.ok) {
      const body = await responseText(response);
      const message = s3ResponseMessage(response, body, `HTTP ${response.status}`);
      this.lastError = `S3 bucket connection failed: ${message}`;
      throw s3Error(this.lastError, response.status === 403 ? 403 : 502, 'S3_CONNECTION_FAILED');
    }
    this.lastError = null;
    return {
      connected:true,
      endpoint:state.endpoint,
      bucket:state.bucket,
      region:state.region,
      prefix:state.prefix,
      addressingStyle:state.addressingStyle
    };
  }

  objectKey(fileName, prefix = DEFAULT_PREFIX) {
    return `${normalizePrefix(prefix)}${safeBackupFileName(fileName)}`;
  }

  metadataKey(fileName, prefix = DEFAULT_PREFIX) {
    return `${this.objectKey(fileName, prefix)}${METADATA_SUFFIX}`;
  }

  async uploadBuffer(key, buffer, contentType = 'application/octet-stream', state = null) {
    const payload = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer);
    const payloadHash = sha256Hex(payload);
    const response = await this.request({
      method:'PUT',
      key,
      payloadHash,
      body:payload,
      contentLength:payload.length,
      contentType,
      state
    });
    if (!response.ok) {
      const body = await responseText(response);
      throw s3Error(
        `S3 object upload failed: ${s3ResponseMessage(response, body, `HTTP ${response.status}`)}`,
        502,
        'S3_UPLOAD_FAILED'
      );
    }
    return {
      key,
      etag:(response.headers.get('etag') || '').replace(/^"|"$/g, '') || null
    };
  }

  async uploadBackup({ filePath, fileName, manifest } = {}) {
    if (!filePath || !fileName) throw new Error('S3 backup upload requires a file path and name');
    const safeName = safeBackupFileName(fileName);
    const state = await this.requireConfigured();
    await this.testConnection();

    const stat = await fs.stat(filePath);
    if (!stat.isFile()) throw new Error('S3 backup upload source is not a file');
    const payloadHash = await hashFile(filePath);
    const key = this.objectKey(safeName, state.prefix);
    const metadataKey = this.metadataKey(safeName, state.prefix);
    let backupUploaded = false;
    let metadataUploaded = false;

    try {
      const response = await this.request({
        method:'PUT',
        key,
        payloadHash,
        body:createReadStream(filePath),
        contentLength:stat.size,
        contentType:'application/vnd.print-farm-controller.backup+zip',
        state
      });
      if (!response.ok) {
        const body = await responseText(response);
        throw s3Error(
          `S3 backup upload failed: ${s3ResponseMessage(response, body, `HTTP ${response.status}`)}`,
          502,
          'S3_UPLOAD_FAILED'
        );
      }
      backupUploaded = true;

      const metadata = Buffer.from(`${JSON.stringify({
        version:1,
        pfcBackup:true,
        backupObjectKey:key,
        backupFileName:safeName,
        backupId:cleanString(manifest?.backupId),
        installationId:cleanString(manifest?.installationId),
        backupSource:cleanString(manifest?.backupSource),
        createdAt:cleanString(manifest?.createdAt),
        formatVersion:Number(manifest?.formatVersion) || null,
        controllerVersion:cleanString(manifest?.sourceControllerVersion),
        size:stat.size
      }, null, 2)}\n`, 'utf8');

      await this.uploadBuffer(metadataKey, metadata, 'application/json; charset=utf-8', state);
      metadataUploaded = true;
      this.lastError = null;
      await this.log('info', 'Backup uploaded to S3-compatible storage', {
        bucket:state.bucket,
        key,
        size:stat.size
      });
      return {
        id:key,
        key,
        name:safeName,
        size:stat.size,
        metadataKey,
        bucket:state.bucket,
        endpoint:state.endpoint,
        prefix:state.prefix
      };
    } catch (error) {
      if (backupUploaded) await this.deleteObject(key, state).catch(() => {});
      if (metadataUploaded) await this.deleteObject(metadataKey, state).catch(() => {});
      throw error;
    }
  }

  async listObjects(state = null) {
    const activeState = state || await this.requireConfigured();
    const all = [];
    let continuationToken = null;
    do {
      const query = [
        ['encoding-type','url'],
        ['list-type','2'],
        ['prefix',activeState.prefix]
      ];
      if (continuationToken) query.push(['continuation-token', continuationToken]);
      const response = await this.request({ method:'GET', query, state:activeState });
      const body = await responseText(response);
      if (!response.ok) {
        throw s3Error(
          `S3 backup list failed: ${s3ResponseMessage(response, body, `HTTP ${response.status}`)}`,
          502,
          'S3_LIST_FAILED'
        );
      }
      const parsed = parseListObjectsV2(body);
      all.push(...parsed.objects);
      continuationToken = parsed.isTruncated ? parsed.nextContinuationToken : null;
      if (parsed.isTruncated && !continuationToken) {
        throw s3Error('S3 backup list was truncated without a continuation token.', 502, 'S3_LIST_INVALID');
      }
    } while (continuationToken);
    return all;
  }

  async getObjectBuffer(key, { maxBytes = 1024 * 1024 } = {}, state = null) {
    const response = await this.request({ method:'GET', key, state });
    if (!response.ok) {
      const body = await responseText(response);
      throw s3Error(
        `S3 object download failed: ${s3ResponseMessage(response, body, `HTTP ${response.status}`)}`,
        response.status === 404 ? 404 : 502,
        'S3_DOWNLOAD_FAILED'
      );
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength && contentLength > maxBytes) {
      throw s3Error('S3 metadata object is too large.', 413, 'S3_METADATA_TOO_LARGE');
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw s3Error('S3 metadata object is too large.', 413, 'S3_METADATA_TOO_LARGE');
    return buffer;
  }

  async readMetadataObject(object, state) {
    try {
      const buffer = await this.getObjectBuffer(object.key, { maxBytes:1024 * 1024 }, state);
      const parsed = JSON.parse(buffer.toString('utf8'));
      if (!parsed || parsed.version !== 1 || parsed.pfcBackup !== true) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async listBackups() {
    const state = await this.requireConfigured();
    const objects = await this.listObjects(state);
    const backups = new Map(
      objects
        .filter((item) => item.key.startsWith(state.prefix) && /\.pfcbackup$/i.test(item.key))
        .map((item) => [item.key, item])
    );
    const sidecars = objects.filter((item) =>
      item.key.startsWith(state.prefix) && item.key.endsWith(`.pfcbackup${METADATA_SUFFIX}`)
    );
    const result = [];

    for (const sidecar of sidecars) {
      const metadata = await this.readMetadataObject(sidecar, state);
      if (!metadata) continue;
      const backupKey = cleanString(metadata.backupObjectKey);
      const backup = backups.get(backupKey);
      if (!backup) continue;
      const fileName = path.posix.basename(backup.key);
      try { safeBackupFileName(fileName); } catch { continue; }
      result.push({
        id:backup.key,
        key:backup.key,
        name:fileName,
        size:Number(backup.size || metadata.size || 0),
        createdTime:metadata.createdAt || backup.lastModified || null,
        modifiedTime:backup.lastModified || null,
        etag:backup.etag || null,
        metadataKey:sidecar.key,
        appProperties:{
          pfcBackup:'1',
          backupId:cleanString(metadata.backupId),
          installationId:cleanString(metadata.installationId),
          backupSource:cleanString(metadata.backupSource),
          createdAt:cleanString(metadata.createdAt),
          formatVersion:String(metadata.formatVersion ?? ''),
          controllerVersion:cleanString(metadata.controllerVersion)
        }
      });
    }

    result.sort((left, right) => {
      const leftTime = new Date(left.appProperties?.createdAt || left.createdTime || 0).getTime();
      const rightTime = new Date(right.appProperties?.createdAt || right.createdTime || 0).getTime();
      return rightTime - leftTime || right.name.localeCompare(left.name);
    });
    return result;
  }

  async getBackup(objectKey) {
    const key = cleanString(objectKey);
    if (!key) throw s3Error('S3 backup object key is required.', 400, 'S3_OBJECT_KEY_REQUIRED');
    const backups = await this.listBackups();
    const backup = backups.find((item) => item.id === key);
    if (!backup) {
      throw s3Error(
        'The selected S3 backup is no longer available.',
        404,
        'S3_BACKUP_NOT_FOUND'
      );
    }
    return backup;
  }

  async downloadBackup(objectKey, { maxBytes = (4 * 1024 * 1024 * 1024) - 1 } = {}) {
    const backup = await this.getBackup(objectKey);
    if (backup.size && backup.size > maxBytes) {
      throw s3Error('S3 backup exceeds the supported restore size limit.', 413, 'S3_BACKUP_TOO_LARGE');
    }

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'pfc-s3-restore-'));
    const filePath = path.join(directory, safeBackupFileName(backup.name));
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, callback) {
        bytes += chunk.length;
        if (bytes > maxBytes) callback(new Error('S3 backup exceeds the supported restore size limit.'));
        else callback(null, chunk);
      }
    });

    try {
      const state = await this.requireConfigured();
      const response = await this.request({ method:'GET', key:backup.key, state });
      if (!response.ok) {
        const body = await responseText(response);
        throw s3Error(
          `S3 backup download failed: ${s3ResponseMessage(response, body, `HTTP ${response.status}`)}`,
          502,
          'S3_DOWNLOAD_FAILED'
        );
      }
      if (!response.body) throw s3Error('S3 backup download returned no data.', 502, 'S3_DOWNLOAD_FAILED');
      await pipeline(
        nodeReadable(response.body),
        limiter,
        createWriteStream(filePath, { flags:'wx', mode:0o600 })
      );
      if (!bytes) throw s3Error('S3 backup is empty.', 400, 'S3_BACKUP_EMPTY');
      if (backup.size && bytes !== backup.size) {
        throw s3Error('S3 backup download size did not match object metadata.', 502, 'S3_DOWNLOAD_SIZE_MISMATCH');
      }
      await this.log('info', 'S3 backup downloaded for restore', {
        key:backup.key,
        fileName:backup.name,
        size:bytes
      });
      return {
        provider:'s3',
        fileId:backup.id,
        fileName:backup.name,
        filePath,
        size:bytes,
        metadata:backup,
        async cleanup() {
          await fs.rm(directory, { recursive:true, force:true });
        }
      };
    } catch (error) {
      await fs.rm(directory, { recursive:true, force:true }).catch(() => {});
      throw error;
    }
  }

  async deleteObject(key, state = null) {
    const response = await this.request({ method:'DELETE', key, state });
    if (!response.ok && response.status !== 404) {
      const body = await responseText(response);
      throw s3Error(
        `S3 object deletion failed: ${s3ResponseMessage(response, body, `HTTP ${response.status}`)}`,
        502,
        'S3_DELETE_FAILED'
      );
    }
    return true;
  }

  async deleteBackup(objectKey) {
    const backup = await this.getBackup(objectKey);
    const state = await this.requireConfigured();
    await this.deleteObject(backup.key, state);
    if (backup.metadataKey) await this.deleteObject(backup.metadataKey, state).catch(() => {});
    return true;
  }

  async pruneScheduledBackups({ installationId, retentionCount, newestFileId = null } = {}) {
    const keep = Math.max(1, Math.min(365, Number(retentionCount) || 14));
    const installation = cleanString(installationId).toLowerCase();
    if (!installation) return { deleted:[], failed:[], eligible:0, kept:0 };

    const all = await this.listBackups();
    const candidates = all.filter((item) => {
      const props = item.appProperties || {};
      return cleanString(props.installationId).toLowerCase() === installation
        && cleanString(props.backupSource) === 'scheduled';
    }).sort((left, right) => {
      const leftTime = new Date(left.appProperties?.createdAt || left.createdTime || 0).getTime();
      const rightTime = new Date(right.appProperties?.createdAt || right.createdTime || 0).getTime();
      return rightTime - leftTime || right.name.localeCompare(left.name);
    });

    const keepIds = new Set(candidates.slice(0, keep).map((item) => item.id));
    if (newestFileId) keepIds.add(String(newestFileId));
    const deleted = [];
    const failed = [];
    const state = await this.requireConfigured();

    for (const candidate of candidates) {
      if (keepIds.has(candidate.id)) continue;
      try {
        await this.deleteObject(candidate.key, state);
        if (candidate.metadataKey) await this.deleteObject(candidate.metadataKey, state).catch(() => {});
        deleted.push(candidate.name);
      } catch (error) {
        failed.push({ fileName:candidate.name, error:error?.message || String(error) });
      }
    }

    return {
      deleted,
      failed,
      eligible:candidates.length,
      kept:Math.max(0, candidates.length - deleted.length)
    };
  }
}

export {
  DEFAULT_PREFIX,
  DEFAULT_REGION,
  EMPTY_SHA256,
  METADATA_SUFFIX,
  canonicalQuery,
  encodePath,
  parseListObjectsV2
};
