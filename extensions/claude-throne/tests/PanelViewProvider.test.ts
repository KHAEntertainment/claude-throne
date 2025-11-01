import { describe, it, beforeEach, expect, vi } from 'vitest'

// Mock VS Code API before importing modules
vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(),
    onDidChangeConfiguration: vi.fn(),
    workspaceFolders: []
  },
  window: {
    showInformationMessage: vi.fn(),
    showWarningMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createOutputChannel: vi.fn(() => ({
      name: 'Test',
      append: vi.fn(),
      appendLine: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
      replace: vi.fn()
    }))
  },
  commands: {
    executeCommand: vi.fn()
  },
  Uri: {
    parse: vi.fn((uri) => ({ toString: () => uri })),
    joinPath: vi.fn((...parts) => ({ fsPath: parts.join('/') }))
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2
  },
  ExtensionMode: {
    Production: 1,
    Development: 2,
    Test: 3
  },
  EventEmitter: class {
    event = vi.fn()
    fire = vi.fn()
    dispose = vi.fn()
  }
}), { virtual: true })

import * as vscode from 'vscode'
import { PanelViewProvider } from '../src/views/PanelViewProvider'
import { SecretsService } from '../src/services/Secrets'
import { ProxyManager } from '../src/services/ProxyManager'

// Mock OutputChannel with all required methods
class MockOutputChannel implements vscode.OutputChannel {
  name = 'Test Output'
  
  append(value: string): void {}
  appendLine(value: string): void {}
  clear(): void {}
  show(preserveFocus?: boolean): void {}
  hide(): void {}
  dispose(): void {}
  replace(value: string): void {}
}

// Mock SecretsService with all required methods
class MockSecretsService implements SecretsService {
  constructor(private readonly storage: vscode.SecretStorage) {}
  
  private providerKey(provider: string): string {
    return `claudeThrone:provider:${provider}:apiKey`
  }

  async getRaw(key: string): Promise<string | undefined> {
    return undefined
  }

  async setRaw(key: string, value: string): Promise<void> {}

  async deleteRaw(key: string): Promise<void> {}

  async getProviderKey(provider: string): Promise<string | undefined> {
    return undefined
  }

  async setProviderKey(provider: string, value: string): Promise<void> {}

  async deleteProviderKey(provider: string): Promise<void> {}

  async getAnthropicKey(): Promise<string | undefined> {
    return undefined
  }

  async setAnthropicKey(value: string): Promise<void> {}

  async deleteAnthropicKey(): Promise<void> {}
}

// Mock ProxyManager with correct return types
class MockProxyManager implements ProxyManager {
  onStatusChanged = new vscode.EventEmitter<any>().event
  
  getStatus(): any {
    return { running: false }
  }

  async checkHealth(): Promise<boolean> {
    return false
  }

  async start(opts: any): Promise<void> {}

  async stop(): Promise<boolean> {
    return true
  }
}

// Mock ExtensionContext with required properties
const createMockContext = (): vscode.ExtensionContext => {
  return {
    extensionUri: vscode.Uri.parse('file:///test'),
    subscriptions: [],
    workspaceState: {
      get: () => undefined,
      update: () => Promise.resolve()
    },
    globalState: {
      get: () => undefined,
      update: () => Promise.resolve()
    },
    extensionPath: '/test',
    asAbsolutePath: (relative: string) => `/test/${relative}`,
    storagePath: '/test/storage',
    globalStoragePath: '/test/global-storage',
    logPath: '/test/logs',
    environmentVariableCollection: {} as any,
    extensionMode: vscode.ExtensionMode.Test,
    storageUri: vscode.Uri.parse('file:///test/storage')
  }
}

describe('PanelViewProvider Configuration Tests', () => {
  let mockContext: vscode.ExtensionContext
  let mockSecrets: SecretsService
  let mockProxy: ProxyManager
  let mockLog: vscode.OutputChannel
  let panelViewProvider: PanelViewProvider

  beforeEach(() => {
    mockContext = createMockContext()
    mockSecrets = new MockSecretsService({} as vscode.SecretStorage)
    mockProxy = new MockProxyManager()
    mockLog = new MockOutputChannel()
  })

  describe('handleSaveModels', () => {
    it('should write to modelSelectionsByProvider when key is registered', async () => {
      // Mock configuration with registered key
      const mockCfg = {
        inspect: (key: string) => {
          if (key === 'modelSelectionsByProvider') {
            return { defaultValue: {} }
          }
          return null
        },
        update: vi.fn(),
        get: (key: string, defaultValue?: any) => {
          if (key === 'applyScope') return 'workspace'
          return defaultValue
        }
      }

      // Mock vscode.workspace.getConfiguration to return our mock
      const originalGetConfiguration = vscode.workspace.getConfiguration
      ;(vscode.workspace as any).getConfiguration = vi.fn().mockReturnValue(mockCfg)

      try {
        panelViewProvider = new PanelViewProvider(mockContext, mockSecrets, mockProxy, mockLog)
        
        // Mock the postConfig method to avoid webview communication
        panelViewProvider.postConfig = vi.fn()

        // Call handleSaveModels with test data
        await panelViewProvider.handleSaveModels({
          providerId: 'openrouter',
          reasoning: 'test-reasoning',
          completion: 'test-completion', 
          value: 'test-value'
        })

        // Verify modelSelectionsByProvider was updated
        expect(mockCfg.update).toHaveBeenCalledWith(
          'modelSelectionsByProvider',
          {
            openrouter: {
              reasoning: 'test-reasoning',
              completion: 'test-completion',
              value: 'test-value'
            }
          },
          vscode.ConfigurationTarget.Workspace
        )

        // Verify individual model keys were also updated (legacy keys for backward compatibility)
        expect(mockCfg.update).toHaveBeenCalledWith('reasoningModel', 'test-reasoning', vscode.ConfigurationTarget.Workspace)
        expect(mockCfg.update).toHaveBeenCalledWith('completionModel', 'test-completion', vscode.ConfigurationTarget.Workspace)
        expect(mockCfg.update).toHaveBeenCalledWith('valueModel', 'test-value', vscode.ConfigurationTarget.Workspace)
      } finally {
        // Restore original function
        (vscode.workspace as any).getConfiguration = originalGetConfiguration
      }
    })

    it('should fallback to individual keys when modelSelectionsByProvider is not registered', async () => {
      // Mock configuration with unregistered key
      const mockCfg = {
        inspect: (key: string) => {
          // Return null for modelSelectionsByProvider to simulate unregistered key
          if (key === 'modelSelectionsByProvider') {
            return null
          }
          return { defaultValue: 'default' }
        },
        update: vi.fn(),
        get: (key: string, defaultValue?: any) => {
          if (key === 'applyScope') return 'workspace'
          return defaultValue
        }
      }

      // Mock vscode.workspace.getConfiguration to return our mock
      const originalGetConfiguration = vscode.workspace.getConfiguration
      ;(vscode.workspace as any).getConfiguration = vi.fn().mockReturnValue(mockCfg)

      try {
        panelViewProvider = new PanelViewProvider(mockContext, mockSecrets, mockProxy, mockLog)
        
        // Mock the postConfig method to avoid webview communication
        panelViewProvider.postConfig = vi.fn()

        // Call handleSaveModels with test data
        await panelViewProvider.handleSaveModels({
          providerId: 'openrouter',
          reasoning: 'test-reasoning',
          completion: 'test-completion',
          value: 'test-value'
        })

        // Verify modelSelectionsByProvider was NOT updated (key not registered)
        const modelSelectionsCall = mockCfg.update.mock.calls.find(
          (call: any[]) => call[0] === 'modelSelectionsByProvider'
        )
        expect(modelSelectionsCall).toBeUndefined()

        // Verify individual model keys were still updated as fallback (legacy keys for backward compatibility)
        expect(mockCfg.update).toHaveBeenCalledWith('reasoningModel', 'test-reasoning', vscode.ConfigurationTarget.Workspace)
        expect(mockCfg.update).toHaveBeenCalledWith('completionModel', 'test-completion', vscode.ConfigurationTarget.Workspace)
        expect(mockCfg.update).toHaveBeenCalledWith('valueModel', 'test-value', vscode.ConfigurationTarget.Workspace)
      } finally {
        // Restore original function
        (vscode.workspace as any).getConfiguration = originalGetConfiguration
      }
    })

    it('should respect applyScope configuration target', async () => {
      // Test with global scope
      const mockCfg = {
        inspect: (key: string) => {
          if (key === 'modelSelectionsByProvider') {
            return { defaultValue: {} }
          }
          return null
        },
        update: vi.fn(),
        get: (key: string, defaultValue?: any) => {
          if (key === 'applyScope') return 'global'
          return defaultValue
        }
      }

      const originalGetConfiguration = vscode.workspace.getConfiguration
      ;(vscode.workspace as any).getConfiguration = vi.fn().mockReturnValue(mockCfg)

      try {
        panelViewProvider = new PanelViewProvider(mockContext, mockSecrets, mockProxy, mockLog)
        panelViewProvider.postConfig = vi.fn()

        await panelViewProvider.handleSaveModels({
          providerId: 'openrouter',
          reasoning: 'test-reasoning',
          completion: 'test-completion',
          value: 'test-value'
        })

        // Verify updates used Global target instead of Workspace
        expect(mockCfg.update).toHaveBeenCalledWith(
          'modelSelectionsByProvider',
          expect.any(Object),
          vscode.ConfigurationTarget.Global
        )
        expect(mockCfg.update).toHaveBeenCalledWith('reasoningModel', 'test-reasoning', vscode.ConfigurationTarget.Global)
        expect(mockCfg.update).toHaveBeenCalledWith('completionModel', 'test-completion', vscode.ConfigurationTarget.Global)
        expect(mockCfg.update).toHaveBeenCalledWith('valueModel', 'test-value', vscode.ConfigurationTarget.Global)
      } finally {
        (vscode.workspace as any).getConfiguration = originalGetConfiguration
      }
    })
  })

  describe('handleSetModelFromList', () => {
    it('should use applyScope configuration target', async () => {
      // Test with global scope
      const mockCfg = {
        inspect: (key: string) => {
          if (key === 'modelSelectionsByProvider') {
            return { defaultValue: {} }
          }
          return null
        },
        update: vi.fn(),
        get: (key: string, defaultValue?: any) => {
          if (key === 'applyScope') return 'global'
          return defaultValue
        }
      }

      const originalGetConfiguration = vscode.workspace.getConfiguration
      ;(vscode.workspace as any).getConfiguration = vi.fn().mockReturnValue(mockCfg)

      try {
        panelViewProvider = new PanelViewProvider(mockContext, mockSecrets, mockProxy, mockLog)
        panelViewProvider.postConfig = vi.fn()

        await panelViewProvider.handleSetModelFromList({
          model: 'test-model',
          modelType: 'reasoning',
          provider: 'openrouter'
        })

        // Verify update used Global target
        expect(mockCfg.update).toHaveBeenCalledWith(
          'modelSelectionsByProvider',
          expect.any(Object),
          vscode.ConfigurationTarget.Global
        )
      } finally {
        (vscode.workspace as any).getConfiguration = originalGetConfiguration
      }
    })
  })
})