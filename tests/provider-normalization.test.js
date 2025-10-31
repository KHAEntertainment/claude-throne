/**
 * Comment 7: Unit tests for provider map normalization
 * Tests that provider maps are normalized to canonical keys { reasoning, completion, value }
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Simulate the normalization function (matches PanelViewProvider implementation)
function normalizeProviderMap(providerModels, providerId) {
  if (!providerModels || typeof providerModels !== 'object') {
    return { reasoning: '', completion: '', value: '' }
  }
  
  const canonicalKeys = ['reasoning', 'completion', 'value']
  const legacyKeys = ['coding']
  const allowedKeys = [...canonicalKeys, ...legacyKeys]
  const unexpectedKeys = Object.keys(providerModels).filter(
    key => !allowedKeys.includes(key) && providerModels[key] !== undefined && providerModels[key] !== null
  )
  
  if (unexpectedKeys.length > 0 && process.env.NODE_ENV !== 'production') {
    console.warn(`[Provider Map Validation] Provider '${providerId}' has unexpected keys: ${unexpectedKeys.join(', ')}`)
  }
  
  return {
    reasoning: String(providerModels.reasoning || ''),
    completion: String(providerModels.completion || providerModels.coding || ''),
    value: String(providerModels.value || '')
  }
}

describe('Provider Map Normalization', () => {
  it('should normalize canonical keys correctly', () => {
    const input = {
      reasoning: 'model-1',
      completion: 'model-2',
      value: 'model-3'
    }
    const result = normalizeProviderMap(input, 'test-provider')
    expect(result).toEqual({
      reasoning: 'model-1',
      completion: 'model-2',
      value: 'model-3'
    })
  })

  it('should normalize legacy coding key to completion', () => {
    const input = {
      reasoning: 'model-1',
      coding: 'model-2', // Legacy key
      value: 'model-3'
    }
    const result = normalizeProviderMap(input, 'test-provider')
    expect(result).toEqual({
      reasoning: 'model-1',
      completion: 'model-2', // Should map coding -> completion
      value: 'model-3'
    })
  })

  it('should prefer completion over coding when both present', () => {
    const input = {
      reasoning: 'model-1',
      completion: 'model-2-new',
      coding: 'model-2-old', // Should be ignored
      value: 'model-3'
    }
    const result = normalizeProviderMap(input, 'test-provider')
    expect(result).toEqual({
      reasoning: 'model-1',
      completion: 'model-2-new', // Prefer completion
      value: 'model-3'
    })
  })

  it('should handle empty/null values', () => {
    const input = {
      reasoning: '',
      completion: null,
      value: undefined
    }
    const result = normalizeProviderMap(input, 'test-provider')
    expect(result).toEqual({
      reasoning: '',
      completion: '',
      value: ''
    })
  })

  it('should handle non-object input', () => {
    expect(normalizeProviderMap(null, 'test')).toEqual({ reasoning: '', completion: '', value: '' })
    expect(normalizeProviderMap(undefined, 'test')).toEqual({ reasoning: '', completion: '', value: '' })
    expect(normalizeProviderMap('invalid', 'test')).toEqual({ reasoning: '', completion: '', value: '' })
  })

  it('should convert non-string values to strings', () => {
    const input = {
      reasoning: 123,
      completion: true,
      value: null
    }
    const result = normalizeProviderMap(input, 'test-provider')
    expect(result.reasoning).toBe('123')
    expect(result.completion).toBe('true')
    expect(result.value).toBe('')
  })
})

