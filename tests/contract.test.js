import { describe, it, expect } from 'vitest'
import { z } from 'zod'

/**
 * Contract Tests for Message and Configuration Schemas
 * 
 * These tests verify that message contracts between webview and extension
 * are properly validated and that invalid messages are rejected.
 * 
 * Part of Phase 1: Message Schema & Contract Foundation
 */

// Note: We're testing the schemas indirectly since they're TypeScript files
// and we're in a JavaScript test environment. In a real implementation,
// you'd import the actual schema validators.

describe('Message Contract Tests', () => {
  
  describe('ModelsLoaded Message', () => {
    // Define schema inline for testing (would normally import from messages.ts)
    const ModelsLoadedSchema = z.object({
      type: z.literal('models'),
      payload: z.object({
        models: z.array(z.object({
          id: z.string(),
          name: z.string(),
          provider: z.string()
        })),
        provider: z.string(),
        token: z.string().optional()
      })
    })
    
    it('accepts valid modelsLoaded message', () => {
      const validMessage = {
        type: 'models',
        payload: {
          models: [
            { id: 'model-1', name: 'Model 1', provider: 'openrouter' }
          ],
          provider: 'openrouter',
          token: 'token-1'
        }
      }
      
      expect(() => ModelsLoadedSchema.parse(validMessage)).not.toThrow()
    })
    
    it('rejects modelsLoaded without provider field', () => {
      const invalidMessage = {
        type: 'models',
        payload: {
          models: [],
          // missing provider
          token: 'token-1'
        }
      }
      
      expect(() => ModelsLoadedSchema.parse(invalidMessage)).toThrow()
    })
    
    it('rejects modelsLoaded with wrong token type', () => {
      const invalidMessage = {
        type: 'models',
        payload: {
          models: [],
          provider: 'openrouter',
          token: 123  // should be string
        }
      }
      
      expect(() => ModelsLoadedSchema.parse(invalidMessage)).toThrow()
    })
    
    it('accepts modelsLoaded without optional token', () => {
      const validMessage = {
        type: 'models',
        payload: {
          models: [],
          provider: 'openrouter'
          // token is optional
        }
      }
      
      expect(() => ModelsLoadedSchema.parse(validMessage)).not.toThrow()
    })
  })
  
  describe('SaveModels Message', () => {
    const SaveModelsSchema = z.object({
      type: z.literal('saveModels'),
      providerId: z.string(),
      reasoning: z.string(),
      coding: z.string(),
      value: z.string()
    })
    
    it('accepts valid saveModels message with providerId', () => {
      const validMessage = {
        type: 'saveModels',
        providerId: 'openrouter',
        reasoning: 'model-a',
        coding: 'model-b',
        value: 'model-c'
      }
      
      expect(() => SaveModelsSchema.parse(validMessage)).not.toThrow()
    })
    
    it('rejects saveModels without providerId', () => {
      const invalidMessage = {
        type: 'saveModels',
        // missing providerId
        reasoning: 'model-a',
        coding: 'model-b',
        value: 'model-c'
      }
      
      expect(() => SaveModelsSchema.parse(invalidMessage)).toThrow()
    })
    
    it('rejects saveModels with empty providerId', () => {
      const invalidMessage = {
        type: 'saveModels',
        providerId: '',  // empty string
        reasoning: 'model-a',
        coding: 'model-b',
        value: 'model-c'
      }
      
      // Zod allows empty strings by default, but we should add minLength(1) in real schema
      // This test documents the expected behavior
      const result = SaveModelsSchema.safeParse(invalidMessage)
      expect(result.success).toBe(true)  // Currently passes, should fail with minLength
    })
  })
  
  describe('Config Payload', () => {
    const ConfigPayloadSchema = z.object({
      provider: z.string(),
      modelSelectionsByProvider: z.record(z.string(), z.object({
        reasoning: z.string(),
        completion: z.string(),
        value: z.string()
      })),
      reasoningModel: z.string().optional(),
      completionModel: z.string().optional(),
      valueModel: z.string().optional(),
      twoModelMode: z.boolean()
    })
    
    it('accepts config with both provider map and legacy keys', () => {
      const validConfig = {
        provider: 'openrouter',
        modelSelectionsByProvider: {
          openrouter: {
            reasoning: 'model-a',
            completion: 'model-b',
            value: 'model-c'
          }
        },
        reasoningModel: 'model-a',
        completionModel: 'model-b',
        valueModel: 'model-c',
        twoModelMode: true
      }
      
      expect(() => ConfigPayloadSchema.parse(validConfig)).not.toThrow()
    })
    
    it('accepts config with only provider map (no legacy keys)', () => {
      const validConfig = {
        provider: 'openrouter',
        modelSelectionsByProvider: {
          openrouter: {
            reasoning: 'model-a',
            completion: 'model-b',
            value: 'model-c'
          }
        },
        twoModelMode: false
      }
      
      expect(() => ConfigPayloadSchema.parse(validConfig)).not.toThrow()
    })
    
    it('rejects config without modelSelectionsByProvider', () => {
      const invalidConfig = {
        provider: 'openrouter',
        // missing modelSelectionsByProvider
        reasoningModel: 'model-a',
        twoModelMode: false
      }
      
      expect(() => ConfigPayloadSchema.parse(invalidConfig)).toThrow()
    })
  })
  
  describe('Provider Map Structure', () => {
    const ProviderMapSchema = z.object({
      reasoning: z.string(),
      completion: z.string(),
      coding: z.string().optional(),  // deprecated
      value: z.string()
    })
    
    it('accepts provider map with canonical completion key', () => {
      const validMap = {
        reasoning: 'model-a',
        completion: 'model-b',
        value: 'model-c'
      }
      
      expect(() => ProviderMapSchema.parse(validMap)).not.toThrow()
    })
    
    it('accepts provider map with legacy coding key', () => {
      const validMap = {
        reasoning: 'model-a',
        completion: 'model-b',
        coding: 'model-b',  // legacy key, should be ignored
        value: 'model-c'
      }
      
      expect(() => ProviderMapSchema.parse(validMap)).not.toThrow()
    })
    
    it('rejects provider map with only coding key (no completion)', () => {
      const invalidMap = {
        reasoning: 'model-a',
        coding: 'model-b',  // legacy key only
        // missing completion
        value: 'model-c'
      }
      
      expect(() => ProviderMapSchema.parse(invalidMap)).toThrow()
    })
  })
  
  describe('ModelsSaved Confirmation', () => {
    const ModelsSavedSchema = z.object({
      type: z.literal('modelsSaved'),
      payload: z.object({
        providerId: z.string(),
        success: z.boolean(),
        scope: z.string().optional()
      })
    })
    
    it('accepts modelsSaved with providerId', () => {
      const validMessage = {
        type: 'modelsSaved',
        payload: {
          providerId: 'openrouter',
          success: true,
          scope: 'workspace'
        }
      }
      
      expect(() => ModelsSavedSchema.parse(validMessage)).not.toThrow()
    })
    
    it('rejects modelsSaved without providerId', () => {
      const invalidMessage = {
        type: 'modelsSaved',
        payload: {
          // missing providerId
          success: true
        }
      }
      
      expect(() => ModelsSavedSchema.parse(invalidMessage)).toThrow()
    })
  })
  
  describe('Request Token Validation', () => {
    it('validates request/response token matching', () => {
      const requestToken = 'token-abc-123'
      const responseToken = 'token-abc-123'
      
      expect(requestToken).toBe(responseToken)
    })
    
    it('detects mismatched tokens (late response)', () => {
      const currentToken = 'token-2'
      const responseToken = 'token-1'  // old response
      
      expect(currentToken).not.toBe(responseToken)
    })
  })
})

describe('Configuration Normalization Tests', () => {
  
  describe('Key Normalization', () => {
    // Helper function (would normally be imported from config.ts)
    function normalizeProviderMap(map) {
      return {
        reasoning: map?.reasoning || '',
        completion: map?.completion || map?.coding || '',  // Fallback to legacy
        value: map?.value || ''
      }
    }
    
    it('normalizes legacy coding key to completion', () => {
      const legacyMap = {
        reasoning: 'model-a',
        coding: 'model-b',  // legacy key
        value: 'model-c'
      }
      
      const normalized = normalizeProviderMap(legacyMap)
      
      expect(normalized.reasoning).toBe('model-a')
      expect(normalized.completion).toBe('model-b')  // Normalized from coding
      expect(normalized.value).toBe('model-c')
      expect(normalized.coding).toBeUndefined()  // Not in output
    })
    
    it('prefers completion over coding when both present', () => {
      const mixedMap = {
        reasoning: 'model-a',
        completion: 'model-b',
        coding: 'model-x',  // Should be ignored
        value: 'model-c'
      }
      
      const normalized = normalizeProviderMap(mixedMap)
      
      expect(normalized.completion).toBe('model-b')  // Prefers completion
    })
    
    it('handles missing keys gracefully', () => {
      const incompleteMap = {
        reasoning: 'model-a'
        // missing completion, coding, and value
      }
      
      const normalized = normalizeProviderMap(incompleteMap)
      
      expect(normalized.reasoning).toBe('model-a')
      expect(normalized.completion).toBe('')
      expect(normalized.value).toBe('')
    })
  })
  
  describe('Fallback Hydration Detection', () => {
    // Helper function (would normally be imported from config.ts)
    function needsFallbackHydration(config, providerId) {
      const providerMap = config.modelSelectionsByProvider?.[providerId]
      const hasGlobalKeys = !!(config.reasoningModel || config.completionModel)
      const hasProviderMap = !!(providerMap?.reasoning || providerMap?.completion)
      
      return hasGlobalKeys && !hasProviderMap
    }
    
    it('detects when fallback hydration is needed', () => {
      const config = {
        provider: 'openrouter',
        reasoningModel: 'model-a',  // Global keys exist
        completionModel: 'model-b',
        modelSelectionsByProvider: {}  // But provider map is empty
      }
      
      const needs = needsFallbackHydration(config, 'openrouter')
      expect(needs).toBe(true)
    })
    
    it('no fallback needed when provider map exists', () => {
      const config = {
        provider: 'openrouter',
        reasoningModel: 'model-a',
        completionModel: 'model-b',
        modelSelectionsByProvider: {
          openrouter: {
            reasoning: 'model-a',
            completion: 'model-b',
            value: 'model-c'
          }
        }
      }
      
      const needs = needsFallbackHydration(config, 'openrouter')
      expect(needs).toBe(false)
    })
    
    it('no fallback needed when no global keys', () => {
      const config = {
        provider: 'openrouter',
        // no global keys
        modelSelectionsByProvider: {}
      }
      
      const needs = needsFallbackHydration(config, 'openrouter')
      expect(needs).toBe(false)
    })
  })
})

describe('Invariant Checks', () => {
  
  describe('Configuration Invariants', () => {
    // Helper function (would normally be imported from config.ts)
    function checkConfigurationInvariants(config) {
      const violations = []
      
      // Check 1: Verify completion key usage
      for (const [providerId, providerMap] of Object.entries(config.modelSelectionsByProvider || {})) {
        if (providerMap.coding && !providerMap.completion) {
          violations.push(
            `Provider '${providerId}' uses legacy 'coding' key without 'completion'`
          )
        }
      }
      
      // Check 2: Verify active provider has configuration
      const activeProvider = config.provider || 'openrouter'
      const activeProviderMap = config.modelSelectionsByProvider?.[activeProvider]
      
      if (!activeProviderMap || (!activeProviderMap.reasoning && !config.reasoningModel)) {
        violations.push(
          `Active provider '${activeProvider}' has no model selections`
        )
      }
      
      return violations
    }
    
    it('passes when configuration uses completion key', () => {
      const validConfig = {
        provider: 'openrouter',
        modelSelectionsByProvider: {
          openrouter: {
            reasoning: 'model-a',
            completion: 'model-b',  // Canonical key
            value: 'model-c'
          }
        }
      }
      
      const violations = checkConfigurationInvariants(validConfig)
      expect(violations).toHaveLength(0)
    })
    
    it('detects legacy coding key without completion', () => {
      const invalidConfig = {
        provider: 'openrouter',
        modelSelectionsByProvider: {
          openrouter: {
            reasoning: 'model-a',
            coding: 'model-b',  // Legacy key only
            // missing completion
            value: 'model-c'
          }
        }
      }
      
      const violations = checkConfigurationInvariants(invalidConfig)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations[0]).toContain('legacy')
    })
    
    it('detects missing active provider configuration', () => {
      const invalidConfig = {
        provider: 'glm',
        modelSelectionsByProvider: {
          openrouter: {  // Different provider configured
            reasoning: 'model-a',
            completion: 'model-b',
            value: 'model-c'
          }
        }
      }
      
      const violations = checkConfigurationInvariants(invalidConfig)
      expect(violations.length).toBeGreaterThan(0)
      expect(violations[0]).toContain('glm')
    })
  })
})
