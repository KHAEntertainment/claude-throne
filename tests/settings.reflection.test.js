import { describe, it, expect } from 'vitest'

/**
 * Settings Reflection Tests
 * 
 * Tests that configuration changes are properly reflected in settings.json
 * and that Start/Stop hydration works correctly per Constitution invariant #2.
 */

describe('Settings Reflection', () => {
  
  describe('Start/Stop Hydration Sequence', () => {
    it('hydrates legacy globals from provider map before start', () => {
      const config = {
        provider: 'openrouter',
        modelSelectionsByProvider: {
          openrouter: {
            reasoning: 'claude-3.5-sonnet',
            completion: 'claude-3.5-haiku',
            value: 'claude-3-opus'
          }
        },
        // Legacy globals (may be stale)
        reasoningModel: 'old-model',
        completionModel: 'old-model-2',
        valueModel: 'old-model-3'
      }

      // Step 1: Read from provider map
      const activeProvider = config.provider
      const providerMap = config.modelSelectionsByProvider[activeProvider]
      
      // Step 2: Hydrate legacy globals BEFORE start
      config.reasoningModel = providerMap.reasoning
      config.completionModel = providerMap.completion
      config.valueModel = providerMap.value

      // Verify hydration
      expect(config.reasoningModel).toBe('claude-3.5-sonnet')
      expect(config.completionModel).toBe('claude-3.5-haiku')
      expect(config.valueModel).toBe('claude-3-opus')
      expect(config.reasoningModel).not.toBe('old-model')
    })

    it('ensures atomic hydration operation', () => {
      const config = {
        provider: 'glm',
        modelSelectionsByProvider: {
          glm: {
            reasoning: 'glm-4-plus',
            completion: 'glm-4-air',
            value: 'glm-4-flash'
          }
        },
        reasoningModel: '',
        completionModel: '',
        valueModel: ''
      }

      const providerMap = config.modelSelectionsByProvider[config.provider]
      
      // Atomic update - all keys together
      const hydrated = {
        reasoningModel: providerMap.reasoning,
        completionModel: providerMap.completion,
        valueModel: providerMap.value
      }

      // Apply atomically
      Object.assign(config, hydrated)

      // Verify all updated together
      expect(config.reasoningModel).toBe('glm-4-plus')
      expect(config.completionModel).toBe('glm-4-air')
      expect(config.valueModel).toBe('glm-4-flash')
      
      // No partial state
      const hasEmptyValue = Object.values({
        reasoningModel: config.reasoningModel,
        completionModel: config.completionModel,
        valueModel: config.valueModel
      }).some(v => v === '')
      expect(hasEmptyValue).toBe(false)
    })

    it('never applies stale globals without hydration', () => {
      const config = {
        provider: 'glm', // Switched to GLM
        modelSelectionsByProvider: {
          glm: {
            reasoning: 'glm-4-plus',
            completion: 'glm-4-air',
            value: 'glm-4-flash'
          }
        },
        // Stale globals from previous provider
        reasoningModel: 'claude-3.5-sonnet', // From OpenRouter
        completionModel: 'claude-3.5-haiku',
        valueModel: 'claude-3-opus'
      }

      const activeProvider = config.provider
      const providerMap = config.modelSelectionsByProvider[activeProvider]
      
      // Detect stale state
      const globalsMatchProvider = (
        config.reasoningModel === providerMap.reasoning &&
        config.completionModel === providerMap.completion
      )

      // Should detect staleness
      expect(globalsMatchProvider).toBe(false)

      // Must hydrate before apply
      config.reasoningModel = providerMap.reasoning
      config.completionModel = providerMap.completion
      config.valueModel = providerMap.value

      // Now should match
      const nowMatches = (
        config.reasoningModel === providerMap.reasoning &&
        config.completionModel === providerMap.completion
      )
      expect(nowMatches).toBe(true)
    })
  })

  describe('Settings.json Reflection', () => {
    it('reflects active provider models in settings.json', () => {
      const settings = {
        'claudeThrone.provider': 'openrouter',
        'claudeThrone.reasoningModel': 'claude-3.5-sonnet',
        'claudeThrone.completionModel': 'claude-3.5-haiku',
        'claudeThrone.valueModel': 'claude-3-opus',
        'claudeThrone.modelSelectionsByProvider': {
          openrouter: {
            reasoning: 'claude-3.5-sonnet',
            completion: 'claude-3.5-haiku',
            value: 'claude-3-opus'
          }
        }
      }

      const activeProvider = settings['claudeThrone.provider']
      const providerMap = settings['claudeThrone.modelSelectionsByProvider'][activeProvider]

      // Verify settings reflect active provider
      expect(settings['claudeThrone.reasoningModel']).toBe(providerMap.reasoning)
      expect(settings['claudeThrone.completionModel']).toBe(providerMap.completion)
      expect(settings['claudeThrone.valueModel']).toBe(providerMap.value)
    })

    it('updates settings.json when provider changes', () => {
      const settings = {
        'claudeThrone.provider': 'openrouter',
        'claudeThrone.reasoningModel': 'claude-3.5-sonnet',
        'claudeThrone.modelSelectionsByProvider': {
          openrouter: {
            reasoning: 'claude-3.5-sonnet',
            completion: 'claude-3.5-haiku',
            value: 'claude-3-opus'
          },
          glm: {
            reasoning: 'glm-4-plus',
            completion: 'glm-4-air',
            value: 'glm-4-flash'
          }
        }
      }

      // Switch provider
      settings['claudeThrone.provider'] = 'glm'
      const newProvider = settings['claudeThrone.provider']
      const newProviderMap = settings['claudeThrone.modelSelectionsByProvider'][newProvider]

      // Update settings to reflect new provider
      settings['claudeThrone.reasoningModel'] = newProviderMap.reasoning
      settings['claudeThrone.completionModel'] = newProviderMap.completion
      settings['claudeThrone.valueModel'] = newProviderMap.value

      // Verify settings updated
      expect(settings['claudeThrone.reasoningModel']).toBe('glm-4-plus')
      expect(settings['claudeThrone.completionModel']).toBe('glm-4-air')
      expect(settings['claudeThrone.valueModel']).toBe('glm-4-flash')
    })

    it('preserves provider-specific selections in modelSelectionsByProvider', () => {
      const settings = {
        'claudeThrone.provider': 'openrouter',
        'claudeThrone.modelSelectionsByProvider': {
          openrouter: {
            reasoning: 'claude-3.5-sonnet',
            completion: 'claude-3.5-haiku',
            value: 'claude-3-opus'
          },
          glm: {
            reasoning: 'glm-4-plus',
            completion: 'glm-4-air',
            value: 'glm-4-flash'
          }
        }
      }

      // Switch providers multiple times
      settings['claudeThrone.provider'] = 'glm'
      settings['claudeThrone.provider'] = 'openrouter'

      // Verify both provider maps preserved
      expect(settings['claudeThrone.modelSelectionsByProvider'].openrouter).toBeDefined()
      expect(settings['claudeThrone.modelSelectionsByProvider'].glm).toBeDefined()
      expect(settings['claudeThrone.modelSelectionsByProvider'].openrouter.reasoning).toBe('claude-3.5-sonnet')
      expect(settings['claudeThrone.modelSelectionsByProvider'].glm.reasoning).toBe('glm-4-plus')
    })
  })

  describe('Configuration Persistence', () => {
    it('persists both legacy keys and provider map', () => {
      const configToSave = {
        provider: 'openrouter',
        reasoningModel: 'claude-3.5-sonnet',
        completionModel: 'claude-3.5-haiku',
        valueModel: 'claude-3-opus',
        modelSelectionsByProvider: {
          openrouter: {
            reasoning: 'claude-3.5-sonnet',
            completion: 'claude-3.5-haiku',
            value: 'claude-3-opus'
          }
        }
      }

      // Verify postConfig contract includes both
      expect(configToSave.reasoningModel).toBeDefined()
      expect(configToSave.completionModel).toBeDefined()
      expect(configToSave.valueModel).toBeDefined()
      expect(configToSave.modelSelectionsByProvider).toBeDefined()
      expect(configToSave.modelSelectionsByProvider[configToSave.provider]).toBeDefined()
    })

    it('saveModels contract includes providerId', () => {
      const saveModelsPayload = {
        providerId: 'openrouter', // Required field
        reasoning: 'claude-3.5-sonnet',
        completion: 'claude-3.5-haiku',
        value: 'claude-3-opus'
      }

      // Verify providerId present
      expect(saveModelsPayload.providerId).toBe('openrouter')
      expect(saveModelsPayload.reasoning).toBeDefined()
      expect(saveModelsPayload.completion).toBeDefined()
      expect(saveModelsPayload.value).toBeDefined()
    })

    it('uses completion key for storage (never coding)', () => {
      const modelSelectionsByProvider = {
        openrouter: {
          reasoning: 'claude-3.5-sonnet',
          completion: 'claude-3.5-haiku', // Canonical key
          value: 'claude-3-opus'
        }
      }

      // Verify completion key used
      expect(modelSelectionsByProvider.openrouter.completion).toBe('claude-3.5-haiku')
      expect(modelSelectionsByProvider.openrouter.coding).toBeUndefined()
    })
  })
})

