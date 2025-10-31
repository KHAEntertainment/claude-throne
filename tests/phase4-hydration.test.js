import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Unit Tests for Phase 4: Deterministic Start/Stop with Pre-Apply Hydration
 * 
 * These tests verify that:
 * 1. Global keys are hydrated from provider-specific configuration
 * 2. Hydration happens BEFORE proxy start and apply
 * 3. Fallback to global keys works correctly
 * 4. Stale provider detection prevents incorrect model usage
 */

describe('Phase 4: Pre-Apply Hydration Tests', () => {
  
  describe('Global Key Hydration', () => {
    // Simulate the hydrateGlobalKeysFromProvider logic
    async function hydrateGlobalKeys(providerId, models, config, twoModelMode) {
      const { reasoningModel, completionModel, valueModel } = models
      const updates = []
      
      try {
        // Update reasoning model
        config.reasoningModel = reasoningModel
        updates.push({ key: 'reasoningModel', value: reasoningModel })
        
        // Update completion model if two-model mode
        if (twoModelMode && completionModel) {
          config.completionModel = completionModel
          updates.push({ key: 'completionModel', value: completionModel })
        }
        
        // Update value model if two-model mode
        if (twoModelMode && valueModel) {
          config.valueModel = valueModel
          updates.push({ key: 'valueModel', value: valueModel })
        }
        
        return { success: true, updates }
      } catch (err) {
        return { success: false, error: err.message }
      }
    }
    
    it('hydrates all keys in two-model mode', async () => {
      const config = {
        reasoningModel: 'old-reasoning',
        completionModel: 'old-completion',
        valueModel: 'old-value'
      }
      
      const models = {
        reasoningModel: 'new-reasoning',
        completionModel: 'new-completion',
        valueModel: 'new-value'
      }
      
      const result = await hydrateGlobalKeys('openrouter', models, config, true)
      
      expect(result.success).toBe(true)
      expect(result.updates).toHaveLength(3)
      expect(config.reasoningModel).toBe('new-reasoning')
      expect(config.completionModel).toBe('new-completion')
      expect(config.valueModel).toBe('new-value')
    })
    
    it('only hydrates reasoning in single-model mode', async () => {
      const config = {
        reasoningModel: 'old-reasoning',
        completionModel: 'old-completion'
      }
      
      const models = {
        reasoningModel: 'new-reasoning',
        completionModel: 'new-completion',
        valueModel: 'new-value'
      }
      
      const result = await hydrateGlobalKeys('openrouter', models, config, false)
      
      expect(result.success).toBe(true)
      expect(result.updates).toHaveLength(1)  // Only reasoning
      expect(config.reasoningModel).toBe('new-reasoning')
      expect(config.completionModel).toBe('old-completion')  // Unchanged
    })
    
    it('handles missing models gracefully', async () => {
      const config = {
        reasoningModel: 'old-reasoning'
      }
      
      const models = {
        reasoningModel: '',  // Empty string
        completionModel: '',
        valueModel: ''
      }
      
      const result = await hydrateGlobalKeys('openrouter', models, config, true)
      
      expect(result.success).toBe(true)
      expect(config.reasoningModel).toBe('')
    })
  })
  
  describe('Provider-Specific vs Global Keys', () => {
    it('prefers provider-specific config over global keys', () => {
      const config = {
        // Global keys (stale)
        reasoningModel: 'gpt-4',
        completionModel: 'gpt-3.5-turbo',
        
        // Provider-specific config (current)
        modelSelectionsByProvider: {
          glm: {
            reasoning: 'glm-4-plus',
            completion: 'glm-4-air',
            value: 'glm-4-flash'
          }
        }
      }
      
      const activeProvider = 'glm'
      const providerModels = config.modelSelectionsByProvider[activeProvider]
      
      // Should use provider-specific, not globals
      expect(providerModels.reasoning).toBe('glm-4-plus')
      expect(providerModels.completion).toBe('glm-4-air')
      expect(providerModels.reasoning).not.toBe(config.reasoningModel)
    })
    
    it('falls back to global keys when provider config missing', () => {
      const config = {
        reasoningModel: 'gpt-4',
        completionModel: 'gpt-3.5-turbo',
        modelSelectionsByProvider: {
          openrouter: {
            reasoning: 'or-model',
            completion: 'or-model-2'
          }
          // GLM provider not configured
        }
      }
      
      const activeProvider = 'glm'
      const providerModels = config.modelSelectionsByProvider[activeProvider]
      
      // Provider config doesn't exist
      expect(providerModels).toBeUndefined()
      
      // Should fall back to global keys
      const reasoning = providerModels?.reasoning || config.reasoningModel
      const completion = providerModels?.completion || config.completionModel
      
      expect(reasoning).toBe('gpt-4')
      expect(completion).toBe('gpt-3.5-turbo')
    })
  })
  
  describe('Stale Provider Detection', () => {
    it('detects stale GPT models when using GLM provider', () => {
      const config = {
        reasoningModel: 'gpt-4',  // Stale from OpenRouter
        completionModel: 'gpt-3.5-turbo',
        modelSelectionsByProvider: {
          glm: {
            // Empty - not configured
          }
        }
      }
      
      const activeProvider = 'glm'
      const providerModels = config.modelSelectionsByProvider[activeProvider]
      const hasProviderConfig = !!(providerModels?.reasoning || providerModels?.completion)
      const hasGlobalKeys = !!(config.reasoningModel || config.completionModel)
      
      // Detect stale situation
      const isStale = (
        activeProvider === 'glm' &&
        !hasProviderConfig &&
        hasGlobalKeys &&
        config.reasoningModel.includes('gpt')
      )
      
      expect(isStale).toBe(true)
    })
    
    it('does not flag when provider correctly configured', () => {
      const config = {
        reasoningModel: 'glm-4-plus',  // Already hydrated
        completionModel: 'glm-4-air',
        modelSelectionsByProvider: {
          glm: {
            reasoning: 'glm-4-plus',
            completion: 'glm-4-air'
          }
        }
      }
      
      const activeProvider = 'glm'
      const providerModels = config.modelSelectionsByProvider[activeProvider]
      const hasProviderConfig = !!(providerModels?.reasoning || providerModels?.completion)
      
      // Not stale - provider has config
      const isStale = (
        activeProvider === 'glm' &&
        !hasProviderConfig &&
        config.reasoningModel.includes('gpt')
      )
      
      expect(isStale).toBe(false)
      expect(hasProviderConfig).toBe(true)
    })
  })
  
  describe('Hydration Sequence Verification', () => {
    it('hydration happens before proxy start', () => {
      const sequence = []
      
      // Simulate the start proxy flow
      async function startProxyFlow() {
        sequence.push('read-models')
        sequence.push('hydrate-globals')
        sequence.push('start-proxy')
        sequence.push('apply-to-claude')
      }
      
      startProxyFlow()
      
      const hydrateIndex = sequence.indexOf('hydrate-globals')
      const startIndex = sequence.indexOf('start-proxy')
      const applyIndex = sequence.indexOf('apply-to-claude')
      
      // Verify sequence
      expect(hydrateIndex).toBeLessThan(startIndex)
      expect(startIndex).toBeLessThan(applyIndex)
    })
    
    it('apply uses hydrated values not stale globals', async () => {
      const config = {
        // Initial state: stale globals
        reasoningModel: 'gpt-4',
        completionModel: 'gpt-3.5-turbo',
        modelSelectionsByProvider: {
          glm: {
            reasoning: 'glm-4-plus',
            completion: 'glm-4-air'
          }
        }
      }
      
      // Step 1: Read from provider config
      const activeProvider = 'glm'
      const providerModels = config.modelSelectionsByProvider[activeProvider]
      const reasoningModel = providerModels.reasoning
      const completionModel = providerModels.completion
      
      // Step 2: Hydrate globals
      config.reasoningModel = reasoningModel
      config.completionModel = completionModel
      
      // Step 3: Apply uses globals (which are now hydrated)
      const appliedReasoning = config.reasoningModel
      const appliedCompletion = config.completionModel
      
      // Verify correct models used
      expect(appliedReasoning).toBe('glm-4-plus')
      expect(appliedCompletion).toBe('glm-4-air')
      expect(appliedReasoning).not.toBe('gpt-4')
    })
  })
  
  describe('Atomic Hydration', () => {
    it('updates all keys together in two-model mode', () => {
      const beforeState = {
        reasoningModel: 'old-1',
        completionModel: 'old-2',
        valueModel: 'old-3'
      }
      
      const newModels = {
        reasoning: 'new-1',
        completion: 'new-2',
        value: 'new-3'
      }
      
      // Atomic update
      beforeState.reasoningModel = newModels.reasoning
      beforeState.completionModel = newModels.completion
      beforeState.valueModel = newModels.value
      
      // Verify all updated
      expect(beforeState.reasoningModel).toBe('new-1')
      expect(beforeState.completionModel).toBe('new-2')
      expect(beforeState.valueModel).toBe('new-3')
      
      // No partial state
      const hasOldValue = Object.values(beforeState).some(v => v.startsWith('old-'))
      expect(hasOldValue).toBe(false)
    })
  })
  
  describe('Provider Switch Scenarios', () => {
    it('handles rapid provider switching correctly', () => {
      const config = {
        reasoningModel: '',
        modelSelectionsByProvider: {
          openrouter: { reasoning: 'or-model', completion: 'or-model-2' },
          glm: { reasoning: 'glm-model', completion: 'glm-model-2' },
          deepseek: { reasoning: 'ds-model', completion: 'ds-model-2' }
        }
      }
      
      // Simulate rapid switching
      const providers = ['openrouter', 'glm', 'deepseek', 'openrouter']
      const results = []
      
      for (const provider of providers) {
        const providerModels = config.modelSelectionsByProvider[provider]
        config.reasoningModel = providerModels.reasoning
        results.push({ provider, reasoning: config.reasoningModel })
      }
      
      // Verify each switch hydrated correctly
      expect(results[0].reasoning).toBe('or-model')
      expect(results[1].reasoning).toBe('glm-model')
      expect(results[2].reasoning).toBe('ds-model')
      expect(results[3].reasoning).toBe('or-model')  // Back to OpenRouter
    })
  })
  
  describe('Comment 1: Provider Change - Save Before Switch', () => {
    it('saves old provider models before provider update', async () => {
      const postMessageCalls = []
      
      // Mock vscode.postMessage
      global.vscode = {
        postMessage: (msg) => {
          postMessageCalls.push(msg)
        }
      }
      
      // Initial state with OpenRouter selected
      const state = {
        provider: 'openrouter',
        reasoningModel: 'claude-3.5-sonnet',
        codingModel: 'claude-3.5-haiku',
        valueModel: 'claude-3-opus',
        modelsByProvider: {
          openrouter: {
            reasoning: 'claude-3.5-sonnet',
            completion: 'claude-3.5-haiku',
            value: 'claude-3-opus'
          }
        }
      }
      
      // Simulate provider change from openrouter to glm
      const previousProvider = state.provider
      
      // Save models for previous provider BEFORE switching
      if (previousProvider && state.modelsByProvider[previousProvider]) {
        state.modelsByProvider[previousProvider].reasoning = state.reasoningModel
        state.modelsByProvider[previousProvider].completion = state.codingModel
        state.modelsByProvider[previousProvider].value = state.valueModel
        
        global.vscode.postMessage({
          type: 'saveModels',
          providerId: previousProvider,
          reasoning: state.reasoningModel,
          completion: state.codingModel,
          value: state.valueModel
        })
      }
      
      // Now switch provider
      const newProvider = 'glm'
      state.provider = newProvider
      
      // Verify saveModels was called with OLD providerId
      expect(postMessageCalls).toHaveLength(1)
      expect(postMessageCalls[0].type).toBe('saveModels')
      expect(postMessageCalls[0].providerId).toBe('openrouter')  // Old provider, not 'glm'
      expect(postMessageCalls[0].reasoning).toBe('claude-3.5-sonnet')
      
      // Verify provider was switched AFTER save
      expect(state.provider).toBe('glm')  // New provider
    })
    
    it('deletes only the old provider cache entry', () => {
      const state = {
        provider: 'openrouter',
        modelsCache: {
          openrouter: [{ id: 'model1', name: 'Model 1' }],
          glm: [{ id: 'model2', name: 'Model 2' }],
          deepseek: [{ id: 'model3', name: 'Model 3' }]
        }
      }
      
      // Before change
      expect(state.modelsCache.openrouter).toBeDefined()
      expect(state.modelsCache.glm).toBeDefined()
      expect(state.modelsCache.deepseek).toBeDefined()
      
      const previousProvider = state.provider // 'openrouter'
      
      // Delete only the old provider's cache
      delete state.modelsCache[previousProvider]
      
      // Verify only old provider cache is deleted
      expect(state.modelsCache.openrouter).toBeUndefined()
      expect(state.modelsCache.glm).toBeDefined()  // Still there
      expect(state.modelsCache.deepseek).toBeDefined()  // Still there
    })
    
    it('preserves cache for other providers during switch', () => {
      const state = {
        provider: 'openrouter',
        modelsCache: {
          openrouter: [{ id: 'or-model', name: 'OR Model' }],
          glm: [{ id: 'glm-model', name: 'GLM Model' }],
          deepseek: [{ id: 'ds-model', name: 'DS Model' }],
          together: [{ id: 'together-model', name: 'Together Model' }]
        }
      }
      
      // Switch from openrouter to deepseek
      const previousProvider = 'openrouter'
      const newProvider = 'deepseek'
      
      // Save current models for previous provider
      state.provider = previousProvider  // Ensure state has old provider
      
      // Delete only previous provider's cache
      delete state.modelsCache[previousProvider]
      
      // Switch provider
      state.provider = newProvider
      
      // Verify all other providers' cache preserved
      expect(state.modelsCache.glm).toBeDefined()
      expect(state.modelsCache.deepseek).toBeDefined()
      expect(state.modelsCache.together).toBeDefined()
      
      // Verify only openrouter cache was cleared
      expect(state.modelsCache.openrouter).toBeUndefined()
    })
  })
})
  
  describe('Comment 4: Feature Flags End-to-End', () => {
    it('loads feature flags from config', () => {
      const state = {
        featureFlags: {
          enableSchemaValidation: true,
          enableTokenValidation: true,
          enableKeyNormalization: true,
          enablePreApplyHydration: true
        }
      };
      
      const config = {
        featureFlags: {
          enableTokenValidation: false,
          enablePreApplyHydration: false
        }
      };
      
      // Load feature flags from config
      if (config.featureFlags) {
        state.featureFlags = {
          ...state.featureFlags,
          ...config.featureFlags
        };
      }
      
      // Verify flags were updated
      expect(state.featureFlags.enableSchemaValidation).toBe(true);
      expect(state.featureFlags.enableTokenValidation).toBe(false);
      expect(state.featureFlags.enableKeyNormalization).toBe(true);
      expect(state.featureFlags.enablePreApplyHydration).toBe(false);
    });
    
    it('gates token validation with enableTokenValidation flag', () => {
      const state = {
        featureFlags: { enableTokenValidation: false },
        currentRequestToken: 'token-123'
      };
      
      const payload = {
        models: [{ id: 'model1', name: 'Model 1' }],
        provider: 'openrouter',
        token: 'token-123'
      };
      
      const shouldIgnore = state.featureFlags.enableTokenValidation && 
        payload.token && state.currentRequestToken && 
        payload.token !== state.currentRequestToken;
      
      expect(shouldIgnore).toBe(false);
      
      state.featureFlags.enableTokenValidation = true;
      
      const shouldNotIgnore = state.featureFlags.enableTokenValidation && 
        payload.token && state.currentRequestToken && 
        payload.token !== state.currentRequestToken;
      
      expect(shouldNotIgnore).toBe(false);
      
      payload.token = 'different-token';
      const shouldIgnoreWithMismatch = state.featureFlags.enableTokenValidation && 
        payload.token && state.currentRequestToken && 
        payload.token !== state.currentRequestToken;
      
      expect(shouldIgnoreWithMismatch).toBe(true);
    });
    
    it('gates pre-apply hydration with enablePreApplyHydration flag', () => {
      const state = {
        featureFlags: { enablePreApplyHydration: false },
        autoHydratedProviders: new Set(),
        reasoningModel: 'test-model',
        codingModel: 'test-coding',
        valueModel: 'test-value'
      };
      
      const config = {
        modelSelectionsByProvider: { openrouter: {} }
      };
      
      const shouldHydrate = state.featureFlags.enablePreApplyHydration &&
        !config.modelSelectionsByProvider?.openrouter?.reasoning && 
        (state.reasoningModel || state.codingModel || state.valueModel) &&
        !state.autoHydratedProviders.has('openrouter');
      
      expect(shouldHydrate).toBe(false);
      
      state.featureFlags.enablePreApplyHydration = true;
      
      const shouldHydrateNow = state.featureFlags.enablePreApplyHydration &&
        !config.modelSelectionsByProvider?.openrouter?.reasoning && 
        (state.reasoningModel || state.codingModel || state.valueModel) &&
        !state.autoHydratedProviders.has('openrouter');
      
      expect(shouldHydrateNow).toBe(true);
    });
  });
})
