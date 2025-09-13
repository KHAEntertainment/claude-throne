import * as vscode from 'vscode'

export class SecretsService {
  constructor(private readonly storage: vscode.SecretStorage) {}

  private providerKey(provider: string): string {
    return `claudeThrone:provider:${provider}:apiKey`
  }

  async getRaw(key: string): Promise<string | undefined> {
    return this.storage.get(key)
  }

  async setRaw(key: string, value: string): Promise<void> {
    await this.storage.store(key, value)
  }

  async deleteRaw(key: string): Promise<void> {
    await this.storage.delete(key)
  }

  async getProviderKey(provider: string): Promise<string | undefined> {
    // Normal lookup
    const key = await this.getRaw(this.providerKey(provider))
    if (key) return key
    // Legacy fallback: if renamed from 'groq' → 'grok', check old slot
    if (provider === 'grok') {
      const legacy = await this.getRaw(this.providerKey('groq'))
      if (legacy) return legacy
    }
    return undefined
  }

  async setProviderKey(provider: string, value: string): Promise<void> {
    await this.setRaw(this.providerKey(provider), value)
  }

  async deleteProviderKey(provider: string): Promise<void> {
    await this.deleteRaw(this.providerKey(provider))
  }
}

