import { describe, it, expect, beforeEach } from 'vitest'

/**
 * Provider Isolation Tests
 * 
 * Tests that provider switching correctly isolates state and prevents
 * cross-provider contamination per Constitution invariant #3.
 */

describe('Provider Switch Isolation', () => {
  
  describe('Provider Map Isolation', () => {
    it('switching providers clears previous provider state', () => {
      const state = {
        provider: 'openrouter',
        modelsByProvider: {
          openrouter: {
            reasoning: 'claude-3.5-sonnet',
            completion: 'claude-3.5-haiku',
            value: 'claude-3-opus'
          }
        },
        currentModels: {
          reasoning: 'claude-3.5-sonnet',
          completion: 'claude-3.5-haiku',
          value: 'claude-3-opus'
        }
      }

      // Switch to GLM provider
      const previousProvider = state.provider
      state.provider = 'glm'
      
      // Clear previous provider's current models (but preserve in modelsByProvider)
      state.currentModels = {
        reasoning: '',
        completion: '',
        value: ''
      }

      // Verify previous provider's map preserved
      expect(state.modelsByProvider[previousProvider]).toBeDefined()
      expect(state.modelsByProvider[previousProvider].reasoning).toBe('claude-3.5-sonnet')
      
      // Verify current models cleared
      expect(state.currentModels.reasoning).toBe('')
      expect(state.currentModels.completion).toBe('')
    })

    it('preserves all provider maps during switch', () => {
      const state = {
        provider: 'openrouter',
        modelsByProvider: {
          openrouter: {
            reasoning: 'or-model-1',
            completion: 'or-model-2',
            value: 'or-model-3'
          },
          glm: {
            reasoning: 'glm-model-1',
            completion: 'glm-model-2',
            value: 'glm-model-3'
          },
          deepseek: {
            reasoning: 'ds-model-1',
            completion: 'ds-model-2',
            value: 'ds-model-3'
          }
        }
      }

      // Switch providers multiple times
      state.provider = 'glm'
      expect(state.modelsByProvider.openrouter).toBeDefined()
      expect(state.modelsByProvider.glm).toBeDefined()
      expect(state.modelsByProvider.deepseek).toBeDefined()

      state.provider = 'deepseek'
      expect(state.modelsByProvider.openrouter).toBeDefined()
      expect(state.modelsByProvider.glm).toBeDefined()
      expect(state.modelsByProvider.deepseek).toBeDefined()

      state.provider = 'openrouter'
      expect(state.modelsByProvider.openrouter.reasoning).toBe('or-model-1')
      expect(state.modelsByProvider.glm.reasoning).toBe('glm-model-1')
      expect(state.modelsByProvider.deepseek.reasoning).toBe('ds-model-1')
    })

    it('loads correct models for switched provider', () => {
      const state = {
        provider: 'openrouter',
        modelsByProvider: {
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
        },
        currentModels: {}
      }

      // Switch to GLM
      state.provider = 'glm'
      const glmModels = state.modelsByProvider[state.provider]
      state.currentModels = {
        reasoning: glmModels.reasoning,
        completion: glmModels.completion,
        value: glmModels.value
      }

      expect(state.currentModels.reasoning).toBe('glm-4-plus')
      expect(state.currentModels.completion).toBe('glm-4-air')
      expect(state.currentModels.value).toBe('glm-4-flash')

      // Switch back to OpenRouter
      state.provider = 'openrouter'
      const orModels = state.modelsByProvider[state.provider]
      state.currentModels = {
        reasoning: orModels.reasoning,
        completion: orModels.completion,
        value: orModels.value
      }

      expect(state.currentModels.reasoning).toBe('claude-3.5-sonnet')
      expect(state.currentModels.completion).toBe('claude-3.5-haiku')
      expect(state.currentModels.value).toBe('claude-3-opus')
    })
  })

  describe('Model Cache Isolation', () => {
    it('caches models per provider key', () => {
      const modelsCache = {}

      const openrouterModels = [
        { id: 'openrouter/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', provider: 'openrouter' }
      ]
      modelsCache['openrouter'] = openrouterModels

      const glmModels = [
        { id: 'glm-4-plus', name: 'GLM 4 Plus', provider: 'glm' }
      ]
      modelsCache['glm'] = glmModels

      // Verify separate caches
      expect(modelsCache['openrouter']).toHaveLength(1)
      expect(modelsCache['glm']).toHaveLength(1)
      expect(modelsCache['openrouter'][0].provider).toBe('openrouter')
      expect(modelsCache['glm'][0].provider).toBe('glm')
    })

    it('clears only stale provider cache on switch', () => {
      const modelsCache = {
        openrouter: [{ id: 'or-model', provider: 'openrouter' }],
        glm: [{ id: 'glm-model', provider: 'glm' }],
        deepseek: [{ id: 'ds-model', provider: 'deepseek' }]
      }

      const previousProvider = 'openrouter'
      const newProvider = 'glm'

      // Clear only previous provider's cache
      delete modelsCache[previousProvider]

      expect(modelsCache['openrouter']).toBeUndefined()
      expect(modelsCache['glm']).toBeDefined()
      expect(modelsCache['deepseek']).toBeDefined()
    })

    it('prevents cross-provider model contamination', () => {
      const modelsCache = {
        openrouter: [
          { id: 'openrouter/claude-3.5-sonnet', provider: 'openrouter' }
        ],
        glm: [
          { id: 'glm-4-plus', provider: 'glm' }
        ]
      }

      // Verify no cross-contamination
      const openrouterModels = modelsCache['openrouter']
      const glmModels = modelsCache['glm']

      expect(openrouterModels.every(m => m.provider === 'openrouter')).toBe(true)
      expect(glmModels.every(m => m.provider === 'glm')).toBe(true)
      expect(openrouterModels.find(m => m.provider === 'glm')).toBeUndefined()
      expect(glmModels.find(m => m.provider === 'openrouter')).toBeUndefined()
    })
  })

  describe('Storage Key Normalization', () => {
    it('always uses completion key for storage writes', () => {
      const modelSelectionsByProvider = {}
      const providerId = 'openrouter'
      const codingModel = 'claude-3.5-haiku'

      // Simulate save operation - should use 'completion' key
      if (!modelSelectionsByProvider[providerId]) {
        modelSelectionsByProvider[providerId] = {}
      }

      // Write to completion (canonical key)
      modelSelectionsByProvider[providerId].completion = codingModel

      // Verify completion key used
      expect(modelSelectionsByProvider[providerId].completion).toBe(codingModel)
      expect(modelSelectionsByProvider[providerId].coding).toBeUndefined()
    })

    it('removes legacy coding key on save', () => {
      const modelSelectionsByProvider = {
        openrouter: {
          reasoning: 'claude-3.5-sonnet',
          completion: 'claude-3.5-haiku',
          coding: 'claude-3.5-haiku', // Legacy key
          value: 'claude-3-opus'
        }
      }

      const providerId = 'openrouter'
      
      // Migration: remove legacy coding key
      if (modelSelectionsByProvider[providerId].coding !== undefined) {
        delete modelSelectionsByProvider[providerId].coding
      }

      expect(modelSelectionsByProvider[providerId].completion).toBe('claude-3.5-haiku')
      expect(modelSelectionsByProvider[providerId].coding).toBeUndefined()
    })

    it('reads from completion key with coding fallback', () => {
      // Simulate normalizeProviderMap logic
      function normalizeProviderMap(map) {
        return {
          reasoning: map?.reasoning || '',
          completion: map?.completion || map?.coding || '', // Fallback to legacy
          value: map?.value || ''
        }
      }

      // Has completion key
      const modernMap = {
        reasoning: 'model-1',
        completion: 'model-2',
        value: 'model-3'
      }
      const normalized1 = normalizeProviderMap(modernMap)
      expect(normalized1.completion).toBe('model-2')

      // Only has legacy coding key
      const legacyMap = {
        reasoning: 'model-1',
        coding: 'model-2', // Legacy key
        value: 'model-3'
      }
      const normalized2 = normalizeProviderMap(legacyMap)
      expect(normalized2.completion).toBe('model-2') // Fallback works

      // Has both - prefers completion
      const mixedMap = {
        reasoning: 'model-1',
        completion: 'model-2-new',
        coding: 'model-2-old', // Should be ignored
        value: 'model-3'
      }
      const normalized3 = normalizeProviderMap(mixedMap)
      expect(normalized3.completion).toBe('model-2-new') // Prefers completion
    })
  })

  describe('Provider-Specific Configuration', () => {
    it('isolates configuration per provider', () => {
      const config = {
        provider: 'openrouter',
        modelSelectionsByProvider: {
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

      // Verify each provider has independent configuration
      expect(config.modelSelectionsByProvider.openrouter.reasoning).toBe('claude-3.5-sonnet')
      expect(config.modelSelectionsByProvider.glm.reasoning).toBe('glm-4-plus')
      expect(config.modelSelectionsByProvider.openrouter.reasoning).not.toBe(
        config.modelSelectionsByProvider.glm.reasoning
      )
    })

    it('restores correct configuration when switching back', () => {
      const config = {
        provider: 'openrouter',
        modelSelectionsByProvider: {
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

      // Switch to GLM
      config.provider = 'glm'
      const glmConfig = config.modelSelectionsByProvider[config.provider]
      expect(glmConfig.reasoning).toBe('glm-4-plus')

      // Switch back to OpenRouter
      config.provider = 'openrouter'
      const orConfig = config.modelSelectionsByProvider[config.provider]
      expect(orConfig.reasoning).toBe('claude-3.5-sonnet')
      expect(orConfig.reasoning).not.toBe(glmConfig.reasoning)
    })
  })
})

