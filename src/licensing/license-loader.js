import { promises as fs } from 'node:fs';
import path from 'node:path';
import { LicenseManager } from './license-manager.js';
import { verifyLicenseDocument } from './signature-verifier.js';
import { resolveControllerRuntimePaths } from '../runtime-paths.js';

const TRUSTED_KEYS_PATH = resolveControllerRuntimePaths().trustedPublicKeysPath;

async function readTrustedPublicKeys(trustedKeysPath = TRUSTED_KEYS_PATH) {
  try {
    const raw = await fs.readFile(trustedKeysPath, 'utf8');
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

async function resolveLicenseFile({ appDir, dataDir, env }) {
  const override = String(env.PRINT_CONTROLLER_LICENSE_FILE || '').trim();
  if (override) {
    return {
      licenseFile:path.resolve(override),
      legacyLocation:false
    };
  }

  const applicationLicenseFile = path.resolve(appDir, 'license.json');
  try {
    await fs.access(applicationLicenseFile);
    return {
      licenseFile:applicationLicenseFile,
      legacyLocation:false
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return {
        licenseFile:applicationLicenseFile,
        legacyLocation:false
      };
    }
  }

  if (dataDir) {
    const legacyLicenseFile = path.resolve(dataDir, 'license.json');
    try {
      await fs.access(legacyLicenseFile);
      return {
        licenseFile:legacyLicenseFile,
        legacyLocation:true
      };
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        return {
          licenseFile:legacyLicenseFile,
          legacyLocation:true
        };
      }
    }
  }

  return {
    licenseFile:applicationLicenseFile,
    legacyLocation:false
  };
}

export async function loadLicenseManager({
  appDir,
  dataDir = null,
  env = process.env,
  now = new Date(),
  trustedPublicKeys = null,
  trustedKeysPath = TRUSTED_KEYS_PATH,
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

  const { licenseFile, legacyLocation } = await resolveLicenseFile({
    appDir,
    dataDir,
    env
  });

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

  const payload = verification.payload;
  const warnings = [];
  if (verification.updatesExpired) {
    warnings.push('This licence remains valid, but its feature-update entitlement has expired.');
  }
  if (legacyLocation) {
    warnings.push('Licence loaded from the previous data-directory location. Move license.json into the application directory.');
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
