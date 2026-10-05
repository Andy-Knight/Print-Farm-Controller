const DEFAULT_TIMEOUT_MS = 10_000;

function cleanText(value) {
  return String(value ?? '').trim();
}

function httpUrl(value, label) {
  const text = cleanText(value);
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS`);
  }
  return parsed;
}

function responseError(provider, response) {
  return new Error(`${provider} notification failed with HTTP ${response.status}`);
}

function timeoutSignal(timeoutMs = DEFAULT_TIMEOUT_MS) {
  return AbortSignal.timeout(Math.max(1, Number(timeoutMs) || DEFAULT_TIMEOUT_MS));
}

function ntfyPriority(severity) {
  if (severity === 'critical') return '5';
  if (severity === 'warning') return '4';
  return '3';
}

export class NtfyNotificationProvider {
  constructor({ fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (typeof fetchFn !== 'function') throw new Error('fetch is required for ntfy notifications');
    this.fetch = fetchFn;
    this.timeoutMs = timeoutMs;
    this.id = 'ntfy';
    this.label = 'ntfy';
  }

  normalizeConfig(input = {}, previous = {}) {
    const server = cleanText(input.server ?? previous.server ?? 'https://ntfy.sh').replace(/\/+$/, '');
    httpUrl(server, 'ntfy server');
    const topic = cleanText(input.topic ?? previous.topic);
    if (!topic) throw new Error('ntfy topic is required');
    if (topic.length > 128) throw new Error('ntfy topic must be 128 characters or fewer');
    if (/[\s/?#]/.test(topic)) throw new Error('ntfy topic contains invalid characters');

    const username = cleanText(input.username ?? previous.username);
    const password = input.password === undefined ? cleanText(previous.password) : cleanText(input.password);
    const token = input.token === undefined ? cleanText(previous.token) : cleanText(input.token);
    if (token && (username || password)) throw new Error('Use either an ntfy access token or username/password, not both');

    return { server, topic, username, password, token };
  }

  publicConfig(config = {}) {
    return {
      server:config.server || 'https://ntfy.sh',
      topic:config.topic || '',
      username:config.username || '',
      hasPassword:Boolean(config.password),
      hasToken:Boolean(config.token)
    };
  }

  async send(config, alert) {
    const normalized = this.normalizeConfig(config);
    const headers = {
      'content-type':'text/plain; charset=utf-8',
      title:alert.title,
      priority:ntfyPriority(alert.severity),
      tags:alert.severity === 'critical' ? 'rotating_light' : alert.severity === 'warning' ? 'warning' : 'information_source'
    };
    if (normalized.token) {
      headers.authorization = `Bearer ${normalized.token}`;
    } else if (normalized.username || normalized.password) {
      headers.authorization = `Basic ${Buffer.from(`${normalized.username}:${normalized.password}`).toString('base64')}`;
    }

    const response = await this.fetch(
      `${normalized.server}/${encodeURIComponent(normalized.topic)}`,
      {
        method:'POST',
        headers,
        body:alert.message,
        signal:timeoutSignal(this.timeoutMs)
      }
    );
    if (!response.ok) throw responseError('ntfy', response);
    return { ok:true, status:response.status };
  }
}

export class WebhookNotificationProvider {
  constructor({ fetchFn = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    if (typeof fetchFn !== 'function') throw new Error('fetch is required for webhook notifications');
    this.fetch = fetchFn;
    this.timeoutMs = timeoutMs;
    this.id = 'webhook';
    this.label = 'Generic webhook';
  }

  normalizeConfig(input = {}, previous = {}) {
    const url = cleanText(input.url ?? previous.url);
    httpUrl(url, 'Webhook URL');
    const authorization = input.authorization === undefined
      ? cleanText(previous.authorization)
      : cleanText(input.authorization);
    return { url, authorization };
  }

  publicConfig(config = {}) {
    return {
      url:config.url || '',
      hasAuthorization:Boolean(config.authorization)
    };
  }

  async send(config, alert) {
    const normalized = this.normalizeConfig(config);
    const headers = { 'content-type':'application/json; charset=utf-8' };
    if (normalized.authorization) headers.authorization = normalized.authorization;
    const response = await this.fetch(normalized.url, {
      method:'POST',
      headers,
      body:JSON.stringify({
        schemaVersion:1,
        alert:{
          id:alert.id,
          type:alert.type,
          severity:alert.severity,
          title:alert.title,
          message:alert.message,
          createdAt:alert.createdAt,
          source:alert.source || null,
          printer:alert.printer || null,
          metadata:alert.metadata || {}
        }
      }),
      signal:timeoutSignal(this.timeoutMs)
    });
    if (!response.ok) throw responseError('Webhook', response);
    return { ok:true, status:response.status };
  }
}

export function createDefaultNotificationProviders(options = {}) {
  const providers = [
    new NtfyNotificationProvider(options),
    new WebhookNotificationProvider(options)
  ];
  return new Map(providers.map((provider) => [provider.id, provider]));
}
