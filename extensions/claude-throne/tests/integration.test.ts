import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest'

// Mock VS Code API before importing the extension - use virtual: true for Vitest
vi.mock('vscode', () => ({
  // Basic VS Code types
  TreeItem: class {},
  EventEmitter: class {
    event = vi.fn()
    fire = vi.fn()
    dispose = vi.fn()
  },
  Uri: {
    parse: vi.fn((uri) => ({ toString: () => uri })),
    joinPath: vi.fn((...parts) => ({ 
      fsPath: parts.join('/'),
      toString: () => parts.join('/')
    }))
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2,
    WorkspaceFolder: 3
  },
  // Workspace
  workspace: {
    getConfiguration: vi.fn(),
    onDidChangeConfiguration: vi.fn(),
    fs: {
      readFile: vi.fn()
    }
  },
  // Window
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn(() => createMockOutputChannel()),
    createStatusBarItem: vi.fn(() => createMockStatusBarItem()),
    registerTreeDataProvider: vi.fn(),
    registerWebviewViewProvider: vi.fn()
  },
  // Commands
  commands: {
    registerCommand: vi.fn(),
    executeCommand: vi.fn(),
    getCommands: vi.fn()
  },
  // Extensions
  extensions: {
    getExtension: vi.fn(),
    all: []
  },
  // Environment
  env: {
    openExternal: vi.fn(),
    clipboard: {
      writeText: vi.fn()
    }
  },
  // Secret storage
  SecretStorage: class {
    get = vi.fn()
    set = vi.fn()
    delete = vi.fn()
    onDidChange = vi.fn()
  }
}), { virtual: true })

import * as vscode from 'vscode'
import { PanelViewProvider } from '../src/views/PanelViewProvider'
import { SecretsService } from '../src/services/Secrets'
import { ProxyManager } from '../src/services/ProxyManager'

// Helper functions to create mocks
function createMockOutputChannel() {
  return {
    name: 'Test Output',
    append: vi.fn(),
    appendLine: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    replace: vi.fn()
  }
}

function createMockStatusBarItem() {
  return {
    text: '',
    command: '',
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    id: '',
    priority: 0
  }
}

// Mock implementation of SecretsService
class MockSecretsService implements SecretsService {
  private storage = new Map<string, string>()
  
  async getRaw(key: string): Promise<string | undefined> {
    return this.storage.get(key)
  }

  async setRaw(key: string, value: string): Promise<void> {
    this.storage.set(key, value)
  }

  async deleteRaw(key: string): Promise<void> {
    this.storage.delete(key)
  }

  async getProviderKey(provider: string): Promise<string | undefined> {
    return this.getRaw(`provider:${provider}:key`)
  }

  async setProviderKey(provider: string, value: string): Promise<void> {
    await this.setRaw(`provider:${provider}:key`, value)
  }

  async deleteProviderKey(provider: string): Promise<void> {
    await this.deleteRaw(`provider:${provider}:key`)
  }

  async getAnthropicKey(): Promise<string | undefined> {
    return this.getRaw('anthropic:key')
  }

  async setAnthropicKey(value: string): Promise<void> {
    await this.setRaw('anthropic:key', value)
  }

  async deleteAnthropicKey(): Promise<void> {
    await this.deleteRaw('anthropic:key')
  }
}

// Mock ProxyManager with proper state management
class MockProxyManager implements ProxyManager {
  private _running = false
  
  getStatus() {
    return { running: this._running, port: 3000 }
  }
  
  async start(config: any): Promise<void> {
    this._running = true
  }
  
  async stop(): Promise<boolean> {
    this._running = false
    return true
  }
  
  onStatusChanged: any = vi.fn()
  async checkHealth(): Promise<boolean> {
    return this._running
  }
}

describe('Extension Integration Tests', () => {
  let mockContext: vscode.ExtensionContext
  let mockSecrets: MockSecretsService
  let mockProxy: MockProxyManager
  let mockOutputChannel: ReturnType<typeof createMockOutputChannel>
  let provider: PanelViewProvider

  beforeEach(() => {
    // Setup mocks
    mockSecrets = new MockSecretsService()
    mockProxy = new MockProxyManager()
    mockOutputChannel = createMockOutputChannel()
    
    // Get centralized config backing from setup.ts
    const configBacking = (globalThis as any).__vscodeConfigBacking || new Map<string, any>()
    
    // Mock context
    mockContext = {
      subscriptions: [],
      workspaceState: {
        get: vi.fn(),
        update: vi.fn()
      },
      globalState: {
        get: vi.fn(),
        update: vi.fn()
      },
      extensionUri: vscode.Uri.parse('file:///test-extension'),
      extensionPath: '/test-extension',
      asAbsolutePath: (relativePath: string) => `/test-extension/${relativePath}`,
      logPath: '/test-extension/logs'
    } as any

    // Mock vscode functions with proper backing store
    vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockOutputChannel)
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn((key: string, defaultValue?: any) => {
        return configBacking.has(key) ? configBacking.get(key) : defaultValue
      }),
      update: vi.fn(async (key: string, value: any) => {
        configBacking.set(key, value)
      }),
      has: vi.fn((key: string) => configBacking.has(key)),
      inspect: vi.fn(() => ({ defaultValue: {} })),
      [Symbol.for('test')]: true
    } as any)

    // Create provider instance
    provider = new PanelViewProvider(mockContext, mockSecrets, mockProxy, mockOutputChannel)
  })

  describe('Start/Stop Proxy with Hydration', () => {
    it('should hydrate global keys before starting proxy', async () => {
      // Get centralized config backing
      const configBacking = (globalThis as any).__vscodeConfigBacking || new Map<string, any>()
      
      // Set required config values
      configBacking.set('provider', 'openrouter')
      configBacking.set('applyScope', 'workspace')
      configBacking.set('modelSelectionsByProvider', {
        openrouter: {
          reasoning: 'claude-3.5-sonnet',
          completion: 'claude-3.5-haiku',
          value: 'claude-3-opus'
        }
      })
      configBacking.set('proxy.port', 3000)
      configBacking.set('proxy.debug', false)
      configBacking.set('twoModelMode', true)
      configBacking.set('autoApply', true)
      
      const config = {
        get: vi.fn((key: string, defaultValue?: any) => {
          return configBacking.has(key) ? configBacking.get(key) : defaultValue
        }),
        update: vi.fn()
      }

      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(config as any)

      // Mock applyToClaudeCode command
      vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined)

      // Spy on hydrateGlobalKeysFromProvider to control return value and verify it's called
      const hydrateSpy = vi.spyOn(provider as any, 'hydrateGlobalKeysFromProvider').mockResolvedValue(true)

      // Call the real handleStartProxy method
      await provider['handleStartProxy']()

      // Verify hydration was called with correct parameters
      expect(hydrateSpy).toHaveBeenCalledWith(
        'openrouter',
        'claude-3.5-sonnet',
        'claude-3.5-haiku',
        'claude-3-opus',
        true
      )

      // Verify applyToClaudeCode command was invoked
      expect(vi.mocked(vscode.commands.executeCommand)).toHaveBeenCalledWith('claudeThrone.applyToClaudeCode')
    })

    it('should handle proxy start/stop cycle', async () => {
      // Get centralized config backing
      const configBacking = (globalThis as any).__vscodeConfigBacking || new Map<string, any>()
      
      // Set required config values
      configBacking.set('provider', 'openrouter')
      configBacking.set('modelSelectionsByProvider', {
        openrouter: {
          reasoning: 'claude-3.5-sonnet',
          completion: 'claude-3.5-haiku',
          value: 'claude-3-opus'
        }
      })
      configBacking.set('proxy.port', 3000)
      configBacking.set('proxy.debug', false)
      configBacking.set('twoModelMode', true)
      configBacking.set('autoApply', false)
      
      const config = {
        get: vi.fn((key: string, defaultValue?: any) => {
          return configBacking.has(key) ? configBacking.get(key) : defaultValue
        }),
        update: vi.fn()
      }

      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(config as any)

      await provider['handleStartProxy']()

      expect(mockProxy.getStatus().running).toBe(true)

      await provider['handleStopProxy']()

      expect(mockProxy.getStatus().running).toBe(false)
    })
  })

  describe('Settings.json Reflection', () => {
    it('should persist model selections in settings.json', async () => {
      // Get centralized config backing
      const configBacking = (globalThis as any).__vscodeConfigBacking || new Map<string, any>()
      
      // Ensure modelSelectionsByProvider exists
      if (!configBacking.has('modelSelectionsByProvider')) {
        configBacking.set('modelSelectionsByProvider', {})
      }
      
      const config = {
        get: vi.fn((key: string, defaultValue?: any) => {
          return configBacking.has(key) ? configBacking.get(key) : defaultValue
        }),
        update: vi.fn(async (key: string, value: any) => {
          configBacking.set(key, value)
        }),
        inspect: vi.fn().mockReturnValue({ defaultValue: {} })
      }

      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(config as any)

      // Simulate saving models
      await provider['handleSaveModels']({
        providerId: 'openrouter',
        reasoning: 'claude-3.5-sonnet',
        completion: 'claude-3.5-haiku',
        value: 'claude-3-opus'
      })

      // Verify config.update was called
      expect(config.update).toHaveBeenCalled()
      
      // Check that modelSelectionsByProvider was updated
      const updateCalls = config.update.mock.calls
      const modelSelectionsCall = updateCalls.find(call => 
        call[0] === 'modelSelectionsByProvider'
      )
      
      expect(modelSelectionsCall).toBeDefined()
    })

    it('should reflect provider switch in settings.json', async () => {
      // Get centralized config backing
      const configBacking = (globalThis as any).__vscodeConfigBacking || new Map<string, any>()
      
      // Set applyScope to 'workspace' to get correct ConfigurationTarget
      configBacking.set('applyScope', 'workspace')
      // Set workspace folders to make workspace scope valid
      vi.mocked(vscode.workspace as any).workspaceFolders = [{ uri: { fsPath: '/test' }, name: 'test' }]
      
      const config = {
        get: vi.fn((key: string, defaultValue?: any) => {
          return configBacking.has(key) ? configBacking.get(key) : defaultValue
        }),
        update: vi.fn(async (key: string, value: any) => {
          configBacking.set(key, value)
        })
      }

      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(config as any)

      // Simulate provider switch
      await provider['handleUpdateProvider']('glm')

      // Verify provider was updated in config  - will be called with Global (1) since custom providers are built-in
      const updateCalls = config.update.mock.calls
      const providerCall = updateCalls.find(call => call[0] === 'provider')
      expect(providerCall).toBeDefined()
      expect(providerCall![1]).toBe('glm')
    })
  })

  describe('Provider Model Loading', () => {
    it('should load models for different providers', async () => {
      // Get centralized config backing
      const configBacking = (globalThis as any).__vscodeConfigBacking || new Map<string, any>()
      
      const config = {
        get: vi.fn((key: string, defaultValue?: any) => {
          return configBacking.has(key) ? configBacking.get(key) : defaultValue
        })
      }

      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(config as any)

      // Mock the post method to capture messages
      const originalPost = provider['post'].bind(provider)
      const postMessages: any[] = []
      
      provider['post'] = (message: any) => {
        postMessages.push(message)
        return originalPost(message)
      }

      // Request models
      await provider['handleListModels'](false)

      // Verify models message was posted
      expect(postMessages.length).toBeGreaterThan(0)
      const modelsMessage = postMessages.find(m => m.type === 'models')
      expect(modelsMessage).toBeDefined()
    })
  })
})
