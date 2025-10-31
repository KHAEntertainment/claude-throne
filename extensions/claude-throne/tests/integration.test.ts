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

// Mock ProxyManager
class MockProxyManager implements ProxyManager {
  private status = { running: false }
  
  getStatus() {
    return this.status
  }
  
  async start(config: any): Promise<void> {
    this.status.running = true
  }
  
  async stop(): Promise<void> {
    this.status.running = false
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

    // Mock vscode functions
    vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockOutputChannel)
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(),
      update: vi.fn(),
      has: vi.fn(),
      inspect: vi.fn(),
      [Symbol.for('test')]: true
    } as any)

    // Create provider instance
    provider = new PanelViewProvider(mockContext, mockSecrets, mockProxy, mockOutputChannel)
  })

  describe('Start/Stop Proxy with Hydration', () => {
    it('should hydrate global keys before starting proxy', async () => {
      const config = {
        get: vi.fn((section: string, defaultValue?: any) => {
          if (section === 'claudeThrone') {
            return {
              provider: 'openrouter',
              applyScope: 'workspace',
              modelSelectionsByProvider: {
                openrouter: {
                  reasoning: 'claude-3.5-sonnet',
                  completion: 'claude-3.5-haiku',
                  value: 'claude-3-opus'
                }
              },
              proxy: {
                port: 3000,
                debug: false
              },
              twoModelMode: true,
              autoApply: true
            }
          }
          return defaultValue
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
      const config = {
        get: vi.fn((section: string, defaultValue?: any) => {
          if (section === 'claudeThrone') {
            return {
              provider: 'openrouter',
              modelSelectionsByProvider: {
                openrouter: {
                  reasoning: 'claude-3.5-sonnet',
                  completion: 'claude-3.5-haiku',
                  value: 'claude-3-opus'
                }
              },
              proxy: { port: 3000, debug: false },
              twoModelMode: true,
              autoApply: false
            }
          }
          return defaultValue
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
      const config = {
        get: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
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
      const config = {
        get: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined)
      }

      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(config as any)

      // Simulate provider switch
      await provider['handleUpdateProvider']('glm')

      // Verify provider was updated in config
      expect(config.update).toHaveBeenCalledWith('provider', 'glm', vscode.ConfigurationTarget.Workspace)
    })
  })

  describe('Provider Model Loading', () => {
    it('should load models for different providers', async () => {
      const config = {
        get: vi.fn((section: string) => {
          if (section === 'claudeThrone') {
            return {
              provider: 'openrouter',
              customBaseUrl: '',
              customEndpointKind: 'auto'
            }
          }
          return undefined
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
