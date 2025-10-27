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
    return this.getRaw(this.providerKey(provider))
  }

  async setProviderKey(provider: string, value: string): Promise<void> {
    await this.setRaw(this.providerKey(provider), value)
  }

  async deleteProviderKey(provider: string): Promise<void> {
    await this.deleteRaw(this.providerKey(provider))
  }

  async getAnthropicKey(): Promise<string | undefined> {
    return this.getRaw('claudeThrone:anthropic:apiKey')
  }

  async setAnthropicKey(value: string): Promise<void> {
    await this.setRaw('claudeThrone:anthropic:apiKey', value)
  }

  async deleteAnthropicKey(): Promise<void> {
    await this.deleteRaw('claudeThrone:anthropic:apiKey')
  }
}

