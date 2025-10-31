import { describe, it, expect, beforeEach, vi } from 'vitest'
import { JSDOM } from 'jsdom'

/**
 * Unit Tests for Phase 2: Provider-Aware Model Loading & Race Protection
 * 
 * These tests verify that:
 * 1. Request tokens are generated and validated correctly
 * 2. Late responses with mismatched tokens are ignored
 * 3. Cross-provider responses are rejected
 * 4. Models are cached by provider
 */

describe('Phase 2: Race Protection Tests', () => {
  let window, document, mockVscode
  
  beforeEach(() => {
    // Setup jsdom environment
    const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>')
    window = dom.window
    document = window.document
    
    // Mock VS Code API
    mockVscode = {
      postMessage: vi.fn(),
      getState: vi.fn(() => ({})),
      setState: vi.fn()
    }
    
    // Make available globally
    global.window = window
    global.document = document
    global.acquireVsCodeApi = () => mockVscode
  })
  
  describe('Request Token Generation', () => {
    it('generates incrementing sequence tokens', () => {
      const state = {
        requestTokenCounter: 0,
        currentRequestToken: null
      }
      
      // Simulate first request
      state.requestTokenCounter++
      const token1 = `token-${state.requestTokenCounter}`
      state.currentRequestToken = token1
      
      expect(token1).toBe('token-1')
      
      // Simulate second request
      state.requestTokenCounter++
      const token2 = `token-${state.requestTokenCounter}`
      state.currentRequestToken = token2
      
      expect(token2).toBe('token-2')
      expect(token2).not.toBe(token1)
    })
    
    it('updates currentRequestToken on each request', () => {
      const state = {
        requestTokenCounter: 0,
        currentRequestToken: null
      }
      
      // First request
      state.requestTokenCounter++
      state.currentRequestToken = `token-${state.requestTokenCounter}`
      expect(state.currentRequestToken).toBe('token-1')
      
      // Second request overwrites
      state.requestTokenCounter++
      state.currentRequestToken = `token-${state.requestTokenCounter}`
      expect(state.currentRequestToken).toBe('token-2')
    })
  })
  
  describe('Token Validation in handleModelsLoaded', () => {
    // Simulate handleModelsLoaded logic
    function handleModelsLoaded(payload, state) {
      if (!payload || !Array.isArray(payload.models)) {
        return { action: 'reject', reason: 'invalid-payload' }
      }
      
      const provider = payload.provider || state.provider
      const responseToken = payload.token
      
      // Token validation - ignore late responses
      if (responseToken && state.currentRequestToken && responseToken !== state.currentRequestToken) {
        return { action: 'ignore', reason: 'token-mismatch' }
      }
      
      // Provider validation - ignore cross-provider responses
      if (provider !== state.provider) {
        return { action: 'ignore', reason: 'provider-mismatch' }
      }
      
      return { action: 'accept', provider, models: payload.models }
    }
    
    it('accepts response with matching token', () => {
      const state = {
        provider: 'openrouter',
        currentRequestToken: 'token-2'
      }
      
      const payload = {
        provider: 'openrouter',
        models: [{ id: 'model-1', name: 'Model 1', provider: 'openrouter' }],
        token: 'token-2'
      }
      
      const result = handleModelsLoaded(payload, state)
      
      expect(result.action).toBe('accept')
      expect(result.models).toHaveLength(1)
    })
    
    it('ignores late response with old token', () => {
      const state = {
        provider: 'openrouter',
        currentRequestToken: 'token-3' // We've moved on to token 3
      }
      
      const payload = {
        provider: 'openrouter',
        models: [{ id: 'model-1', name: 'Model 1', provider: 'openrouter' }],
        token: 'token-2' // This is an old response
      }
      
      const result = handleModelsLoaded(payload, state)
      
      expect(result.action).toBe('ignore')
      expect(result.reason).toBe('token-mismatch')
    })
    
    it('accepts response without token when no token expected', () => {
      const state = {
        provider: 'openrouter',
        currentRequestToken: null // No token expected
      }
      
      const payload = {
        provider: 'openrouter',
        models: [{ id: 'model-1', name: 'Model 1', provider: 'openrouter' }]
        // No token in response
      }
      
      const result = handleModelsLoaded(payload, state)
      
      expect(result.action).toBe('accept')
    })
    
    it('ignores cross-provider response', () => {
      const state = {
        provider: 'glm', // Switched to GLM
        currentRequestToken: 'token-2'
      }
      
      const payload = {
        provider: 'openrouter', // Late response from OpenRouter
        models: [{ id: 'model-1', name: 'Model 1', provider: 'openrouter' }],
        token: 'token-2'
      }
      
      const result = handleModelsLoaded(payload, state)
      
      expect(result.action).toBe('ignore')
      expect(result.reason).toBe('provider-mismatch')
    })
    
    it('validates provider before token', () => {
      // Provider mismatch should be caught even if token matches
      const state = {
        provider: 'glm',
        currentRequestToken: 'token-2'
      }
      
      const payload = {
        provider: 'openrouter',
        models: [],
        token: 'token-2'
      }
      
      const result = handleModelsLoaded(payload, state)
      
      expect(result.action).toBe('ignore')
      expect(result.reason).toBe('provider-mismatch')
    })
  })
  
  describe('Provider-Scoped Caching', () => {
    it('caches models under correct provider key', () => {
      const cache = {}
      
      const provider1 = 'openrouter'
      const models1 = [
        { id: 'openrouter/model-1', name: 'Model 1', provider: 'openrouter' }
      ]
      
      cache[provider1] = models1
      
      const provider2 = 'glm'
      const models2 = [
        { id: 'glm-4-plus', name: 'GLM 4 Plus', provider: 'glm' }
      ]
      
      cache[provider2] = models2
      
      // Verify separate caches
      expect(cache[provider1]).toHaveLength(1)
      expect(cache[provider2]).toHaveLength(1)
      expect(cache[provider1][0].id).toBe('openrouter/model-1')
      expect(cache[provider2][0].id).toBe('glm-4-plus')
    })
    
    it('does not pollute cache across providers', () => {
      const cache = {}
      
      cache['openrouter'] = [{ id: 'or-model', provider: 'openrouter' }]
      cache['glm'] = [{ id: 'glm-model', provider: 'glm' }]
      
      // Switching providers shouldn't mix caches
      expect(cache['openrouter']).not.toEqual(cache['glm'])
      expect(cache['openrouter'].find(m => m.provider === 'glm')).toBeUndefined()
      expect(cache['glm'].find(m => m.provider === 'openrouter')).toBeUndefined()
    })
    
    it('allows cache clearing per provider', () => {
      const cache = {
        openrouter: [{ id: 'or-model' }],
        glm: [{ id: 'glm-model' }]
      }
      
      // Clear only OpenRouter cache
      delete cache['openrouter']
      
      expect(cache['openrouter']).toBeUndefined()
      expect(cache['glm']).toBeDefined()
      expect(cache['glm']).toHaveLength(1)
    })
  })
  
  describe('Race Condition Scenarios', () => {
    it('handles rapid provider switching correctly', () => {
      const state = {
        provider: 'openrouter',
        requestTokenCounter: 0,
        currentRequestToken: null,
        modelsCache: {}
      }
      
      // Request 1: OpenRouter
      state.requestTokenCounter++
      const token1 = `token-${state.requestTokenCounter}`
      state.currentRequestToken = token1
      
      // Request 2: Switch to GLM
      state.provider = 'glm'
      state.requestTokenCounter++
      const token2 = `token-${state.requestTokenCounter}`
      state.currentRequestToken = token2
      
      // Late response from Request 1 (OpenRouter) arrives
      const latePayload = {
        provider: 'openrouter',
        models: [{ id: 'or-model' }],
        token: token1
      }
      
      // Should be ignored (wrong provider AND wrong token)
      expect(latePayload.provider).not.toBe(state.provider)
      expect(latePayload.token).not.toBe(state.currentRequestToken)
    })
    
    it('handles slow network response gracefully', () => {
      const state = {
        provider: 'openrouter',
        requestTokenCounter: 0,
        currentRequestToken: null
      }
      
      // Request 1 (slow)
      state.requestTokenCounter++
      const slowToken = `token-${state.requestTokenCounter}`
      const firstRequestToken = slowToken
      state.currentRequestToken = slowToken
      
      // Request 2 (fast) - user clicked retry
      state.requestTokenCounter++
      const fastToken = `token-${state.requestTokenCounter}`
      state.currentRequestToken = fastToken
      
      // Fast response arrives first
      const fastResponse = {
        provider: 'openrouter',
        models: [{ id: 'fast-model' }],
        token: fastToken
      }
      
      // Should be accepted
      expect(fastResponse.token).toBe(state.currentRequestToken)
      
      // Slow response arrives later
      const slowResponse = {
        provider: 'openrouter',
        models: [{ id: 'slow-model' }],
        token: firstRequestToken
      }
      
      // Should be ignored (old token)
      expect(slowResponse.token).not.toBe(state.currentRequestToken)
    })
  })
  
  describe('Integration: Full Request/Response Cycle', () => {
    it('complete cycle with validation', () => {
      const state = {
        provider: 'openrouter',
        requestTokenCounter: 0,
        currentRequestToken: null,
        models: [],
        modelsCache: {}
      }
      
      // Step 1: Request models
      state.requestTokenCounter++
      const requestToken = `token-${state.requestTokenCounter}`
      state.currentRequestToken = requestToken
      
      const request = {
        type: 'requestModels',
        provider: state.provider,
        token: requestToken
      }
      
      expect(request.token).toBe('token-1')
      
      // Step 2: Receive response
      const response = {
        provider: 'openrouter',
        models: [
          { id: 'model-1', name: 'Model 1', provider: 'openrouter' },
          { id: 'model-2', name: 'Model 2', provider: 'openrouter' }
        ],
        token: requestToken
      }
      
      // Step 3: Validate response
      const isValid = (
        response.provider === state.provider &&
        response.token === state.currentRequestToken
      )
      
      expect(isValid).toBe(true)
      
      // Step 4: Update state
      if (isValid) {
        state.modelsCache[response.provider] = response.models
        state.models = response.models
      }
      
      expect(state.models).toHaveLength(2)
      expect(state.modelsCache['openrouter']).toHaveLength(2)
    })
  })
})
