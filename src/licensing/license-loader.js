import { promises as fs } from 'node:fs';
import path from 'node:path';
import { LicenseManager } from './license-manager.js';
import { verifyLicenseDocument } from './signature-verifier.js';
import { resolveControllerRuntimePaths } from '../runtime-paths.js';
import { readRuntimeTextAsset, runtimeAssetKeys } from '../runtime-assets.js';

const TRUSTED_KEYS_PATH = resolveControllerRuntimePaths().trustedPublicKeysPath;

async function readTrustedPublicKeys(trustedKeysPath = TRUSTED_KEYS_PATH) {
  try {
    const raw = await readRuntimeTextAsset({
      key:runtimeAssetKeys.trustedPublicKeys,
      filePath:trustedKeysPath
    });
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw new Error(`Could not read trusted licence public keys: ${error.message}`);
  }
}

function signedDetails(verification, licenseFile) {
  const payload = verification?.payload || {};
  return {
    licenseId:payload.licenseId || null,
    customer:payload.customer || null,
    licenseType:payload.licenseType || null,
    issuedAt:payload.issuedAt || null,
    expiresAt:payload.expiresAt || null,
    updatesUntil:payload.updatesUntil || null,
    updatesExpired:verification?.updatesExpired === true,
    signatureKeyId:verification?.keyId || null,
    licenseFile
  };
}

function communityFallback({ source, status, warning, licenseFile, verification = null } = {}) {
  return new LicenseManager({
    edition:'community',
    source,
    enforcementEnabled:true,
    configurationWarning:warning || null,
    licenseStatus:status,
    licenseDetails:verification ? signedDetails(verification, licenseFile) : { licenseFile }
  });
}

async function resolveLicenseFile({
  appDir,
  dataDir,
  env,
  preferredLicenseFile = null,
  allowDevelopmentOverrides = false
}) {
  const developmentOverride = allowDevelopmentOverrides
    ? String(env.PRINT_CONTROLLER_LICENSE_FILE || '').trim()
    : '';
  if (developmentOverride) {
    const overridePath = path.resolve(developmentOverride);
    return {
      licenseFile:overridePath,
      canonicalLicenseFile:overridePath,
      legacyLocation:false
    };
  }

  const canonicalLicenseFile = preferredLicenseFile
    ? path.resolve(preferredLicenseFile)
    : path.resolve(dataDir || path.join(appDir, 'data'), 'license.json');
  const legacyApplicationLicenseFile = path.resolve(appDir, 'license.json');

  for (const candidate of [...new Set([canonicalLicenseFile, legacyApplicationLicenseFile])]) {
    try {
      await fs.access(candidate);
      return {
        licenseFile:candidate,
        canonicalLicenseFile,
        legacyLocation:candidate !== canonicalLicenseFile
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return {
          licenseFile:candidate,
          canonicalLicenseFile,
          legacyLocation:candidate !== canonicalLicenseFile
        };
      }
    }
  }

  return {
    licenseFile:canonicalLicenseFile,
    canonicalLicenseFile,
    legacyLocation:false
  };
}

async function migrateValidLegacyLicense({ document, licenseFile, canonicalLicenseFile }) {
  const source = path.resolve(licenseFile);
  const target = path.resolve(canonicalLicenseFile);
  if (source === target) {
    return { licenseFile:target, warning:null };
  }

  try {
    await fs.mkdir(path.dirname(target), { recursive:true });
    await fs.writeFile(target, document.endsWith('\n') ? document : `${document}\n`, {
      encoding:'utf8',
      mode:0o600
    });
  } catch (error) {
    return {
      licenseFile:source,
      warning:`Licence is valid but could not be migrated to the application data directory: ${error.message}`
    };
  }

  try {
    await fs.unlink(source);
    return { licenseFile:target, warning:null };
  } catch (error) {
    if (error?.code === 'ENOENT') return { licenseFile:target, warning:null };
    return {
      licenseFile:target,
      warning:`Licence was migrated to the application data directory, but the previous copy could not be removed: ${error.message}`
    };
  }
}

export async function loadLicenseManager({
  appDir,
  dataDir = null,
  env = process.env,
  now = new Date(),
  trustedPublicKeys = null,
  trustedKeysPath = TRUSTED_KEYS_PATH,
  preferredLicenseFile = null,
  allowDevelopmentOverrides = false
} = {}) {
  if (!appDir) throw new Error('appDir is required to load the controller licence');

  const editionOverride = String(env.PRINT_CONTROLLER_EDITION || '').trim();
  if (allowDevelopmentOverrides && editionOverride) {
    return new LicenseManager({
      edition:editionOverride,
      source:'development-config',
      licenseStatus:'development-override'
    });
  }

  const resolvedLicense = await resolveLicenseFile({
    appDir,
    dataDir,
    env,
    preferredLicenseFile,
    allowDevelopmentOverrides
  });
  let { licenseFile } = resolvedLicense;
  const { canonicalLicenseFile, legacyLocation } = resolvedLicense;

  let keys = trustedPublicKeys && typeof trustedPublicKeys === 'object'
    ? { ...trustedPublicKeys }
    : await readTrustedPublicKeys(trustedKeysPath);

  const developmentPublicKeyFile = String(env.PRINT_CONTROLLER_LICENSE_PUBLIC_KEY_FILE || '').trim();
  if (allowDevelopmentOverrides && developmentPublicKeyFile) {
    const keyId = String(env.PRINT_CONTROLLER_LICENSE_KEY_ID || 'development-local').trim();
    const publicKey = await fs.readFile(path.resolve(developmentPublicKeyFile), 'utf8');
    keys = { ...keys, [keyId]:publicKey };
  }

  let document;
  try {
    document = await fs.readFile(licenseFile, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return communityFallback({
        source:'unlicensed',
        status:'not-installed',
        warning:'No signed licence is installed. Community Edition is active.',
        licenseFile
      });
    }
    return communityFallback({
      source:'invalid-license',
      status:'invalid',
      warning:`Could not read the installed licence: ${error.message}`,
      licenseFile
    });
  }

  let verification;
  try {
    verification = verifyLicenseDocument(document, {
      publicKeys:keys,
      now
    });
  } catch (error) {
    return communityFallback({
      source:'invalid-license',
      status:'invalid',
      warning:`Installed licence is invalid: ${error.message}`,
      licenseFile
    });
  }

  if (!verification.valid) {
    return communityFallback({
      source:'expired-license',
      status:'expired',
      warning:'The installed subscription licence has expired. Community Edition is active.',
      licenseFile,
      verification
    });
  }

  const warnings = [];
  if (legacyLocation) {
    const migration = await migrateValidLegacyLicense({
      document,
      licenseFile,
      canonicalLicenseFile
    });
    licenseFile = migration.licenseFile;
    if (migration.warning) warnings.push(migration.warning);
  }

  const payload = verification.payload;
  if (verification.updatesExpired) {
    warnings.push('This licence remains valid, but its feature-update entitlement has expired.');
  }

  return new LicenseManager({
    edition:payload.edition,
    source:'signed-license-file',
    enforcementEnabled:true,
    maxPrinters:payload.maxPrinters,
    additionalFeatures:payload.features,
    configurationWarning:warnings.length ? warnings.join(' ') : null,
    licenseStatus:'valid',
    licenseDetails:signedDetails(verification, licenseFile)
  });
}

export const licenseLoaderPaths = Object.freeze({
  trustedKeysPath:TRUSTED_KEYS_PATH
});

export const licenseLoaderPolicy = Object.freeze({
  developmentOverridesEnabledByDefault:false
});
