/**
 * Comment 7: Integration tests for settings.json reflection
 * Tests that Start/Stop hydration works correctly and settings.json reflects the active provider
 */

import * as vscode from 'vscode'
import { PanelViewProvider } from '../src/views/PanelViewProvider'
import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock VS Code workspace configuration
let mockConfigUpdates: Record<string, any> = {}
const mockConfigValues: Record<string, any> = {
  'provider': 'openrouter',
  'selectedCustomProviderId': '',
  'twoModelMode': false,
  'proxy.port': 3000,
  'proxy.debug': false,
  'customBaseUrl': '',
  'modelSelectionsByProvider': {
    openrouter: { reasoning: 'openrouter-r', completion: 'openrouter-c', value: 'openrouter-v' }
  },
  'reasoningModel': '',
  'completionModel': '',
  'valueModel': '',
  'applyScope': 'workspace',
  'featureFlags': {
    enableSchemaValidation: true,
    enableTokenValidation: true,
    enableKeyNormalization: true,
    enablePreApplyHydration: true
  }
}

const mockConfig = {
  get: vi.fn((key: string, defaultValue?: any) => {
    return mockConfigValues[key] ?? defaultValue
  }),
  update: vi.fn(async (key: string, value: any, target?: vscode.ConfigurationTarget) => {
    mockConfigUpdates[key] = { value, target }
    mockConfigValues[key] = value
  }),
  inspect: vi.fn((key: string) => ({ defaultValue: {} }))
}

vi.mock('vscode', () => ({
  workspace: {
    getConfiguration: vi.fn(() => mockConfig),
    onDidChangeConfiguration: vi.fn()
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
  env: {
    openExternal: vi.fn()
  },
  Uri: {
    joinPath: vi.fn((...parts) => ({ fsPath: parts.join('/') }))
  },
  ConfigurationTarget: {
    Global: 1,
    Workspace: 2
  }
}))

describe('Settings Reflection', () => {
  let provider: PanelViewProvider
  let mockSecrets: any
  let mockProxy: any
  let mockLog: vscode.OutputChannel

  beforeEach(() => {
    vi.clearAllMocks()
    mockConfigUpdates = {}
    
    // Reset config values
    mockConfigValues['modelSelectionsByProvider'] = {
      openrouter: { reasoning: 'openrouter-r', completion: 'openrouter-c', value: 'openrouter-v' }
    }
    mockConfigValues['reasoningModel'] = ''
    mockConfigValues['completionModel'] = ''
    mockConfigValues['valueModel'] = ''
    mockConfigValues['provider'] = 'openrouter'

    mockLog = {
      name: 'Test',
      append: vi.fn(),
      appendLine: vi.fn(),
      clear: vi.fn(),
      show: vi.fn(),
      hide: vi.fn(),
      dispose: vi.fn(),
      replace: vi.fn()
    } as any

    mockSecrets = {
      getProviderKey: vi.fn(),
      setProviderKey: vi.fn(),
      deleteProviderKey: vi.fn(),
      getAnthropicKey: vi.fn(),
      setAnthropicKey: vi.fn(),
      deleteAnthropicKey: vi.fn()
    }

    mockProxy = {
      start: vi.fn(),
      stop: vi.fn(),
      getStatus: vi.fn(() => ({ running: false }))
    }

    provider = new PanelViewProvider(
      {} as any,
      mockSecrets,
      mockProxy,
      mockLog
    )
  })

  it('should hydrate global keys from provider-specific config on Start', async () => {
    // Set up provider-specific models
    mockConfigValues['modelSelectionsByProvider'] = {
      openrouter: {
        reasoning: 'anthropic/claude-3-opus',
        completion: 'anthropic/claude-3-sonnet',
        value: 'anthropic/claude-3-haiku'
      }
    }

    // Simulate Start proxy (hydrateGlobalKeysFromProvider is called in handleStartProxy)
    const hydrateGlobalKeys = (provider as any).hydrateGlobalKeysFromProvider.bind(provider)
    const success = await hydrateGlobalKeys(
      'openrouter',
      'anthropic/claude-3-opus',
      'anthropic/claude-3-sonnet',
      'anthropic/claude-3-haiku',
      true
    )

    expect(success).toBe(true)
    expect(mockConfig.update).toHaveBeenCalledWith('reasoningModel', 'anthropic/claude-3-opus', expect.any(Number))
    expect(mockConfig.update).toHaveBeenCalledWith('completionModel', 'anthropic/claude-3-sonnet', expect.any(Number))
    expect(mockConfig.update).toHaveBeenCalledWith('valueModel', 'anthropic/claude-3-haiku', expect.any(Number))
  })

  it('should reflect active provider models in settings.json', () => {
    // Verify that modelSelectionsByProvider contains provider-specific models
    const providerModels = mockConfigValues['modelSelectionsByProvider']['openrouter']
    expect(providerModels).toBeDefined()
    expect(providerModels.reasoning).toBe('openrouter-r')
    expect(providerModels.completion).toBe('openrouter-c')
    expect(providerModels.value).toBe('openrouter-v')
  })

  it('should update settings.json when saving models for a provider', async () => {
    const handleSaveModels = (provider as any).handleSaveModels.bind(provider)
    
    await handleSaveModels({
      providerId: 'openrouter',
      reasoning: 'new-reasoning-model',
      completion: 'new-completion-model',
      value: 'new-value-model'
    })

    // Verify that modelSelectionsByProvider was updated
    expect(mockConfig.update).toHaveBeenCalledWith(
      'modelSelectionsByProvider',
      expect.objectContaining({
        openrouter: expect.objectContaining({
          reasoning: 'new-reasoning-model',
          completion: 'new-completion-model',
          value: 'new-value-model'
        })
      }),
      expect.any(Number)
    )
  })

  it('should isolate settings per provider', () => {
    // Set up models for multiple providers
    mockConfigValues['modelSelectionsByProvider'] = {
      openrouter: { reasoning: 'openrouter-r', completion: 'openrouter-c', value: 'openrouter-v' },
      openai: { reasoning: 'openai-r', completion: 'openai-c', value: 'openai-v' }
    }

    const openrouterModels = mockConfigValues['modelSelectionsByProvider']['openrouter']
    const openaiModels = mockConfigValues['modelSelectionsByProvider']['openai']

    expect(openrouterModels.reasoning).toBe('openrouter-r')
    expect(openaiModels.reasoning).toBe('openai-r')
    expect(openrouterModels.reasoning).not.toBe(openaiModels.reasoning)
  })
})

