export class CloudBackupProviderRegistry {
  constructor(providers = []) {
    this.providers = new Map();
    for (const provider of providers) this.register(provider);
  }

  register(provider) {
    const id = String(provider?.id || '').trim();
    if (!id) throw new Error('Cloud backup provider ID is required');
    if (this.providers.has(id)) throw new Error(`Duplicate cloud backup provider: ${id}`);
    if (typeof provider.status !== 'function'
      || typeof provider.listBackups !== 'function'
      || typeof provider.downloadBackup !== 'function') {
      throw new Error(`Cloud backup provider ${id} does not implement the required interface`);
    }
    this.providers.set(id, {
      id,
      label:String(provider.label || id),
      status:provider.status,
      listBackups:provider.listBackups,
      downloadBackup:provider.downloadBackup
    });
  }

  provider(id) {
    const key = String(id || '').trim();
    const provider = this.providers.get(key);
    if (!provider) {
      const error = new Error('Cloud backup provider is not supported');
      error.statusCode = 404;
      error.code = 'CLOUD_BACKUP_PROVIDER_NOT_FOUND';
      throw error;
    }
    return provider;
  }

  async listProviders() {
    const result = [];
    for (const provider of this.providers.values()) {
      let status;
      try {
        status = await provider.status();
      } catch (error) {
        status = { configured:false, connected:false, error:error?.message || String(error) };
      }
      result.push({
        id:provider.id,
        label:provider.label,
        configured:status?.configured === true,
        connected:status?.connected === true,
        reconnectRequired:status?.reconnectRequired === true,
        error:status?.lastError || status?.error || null
      });
    }
    return result;
  }

  async listBackups(providerId) {
    const provider = this.provider(providerId);
    const backups = await provider.listBackups();
    return {
      provider:{ id:provider.id, label:provider.label },
      backups:Array.isArray(backups) ? backups : []
    };
  }

  async downloadBackup(providerId, fileId, options = {}) {
    const provider = this.provider(providerId);
    return provider.downloadBackup(fileId, options);
  }
}
