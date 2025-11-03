import { describe, it, expect } from 'vitest'

import { getModelsEndpointForBase } from './endpoints'

describe('getModelsEndpointForBase', () => {
  it('resolves moonshot anthropic endpoint to models list', () => {
    const base = 'https://api.moonshot.ai/anthropic/v1/messages'
    const modelsEndpoint = getModelsEndpointForBase(base)
    expect(modelsEndpoint).toBe('https://api.moonshot.ai/v1/models')
  })

  it('resolves minimax anthropic endpoint to models list', () => {
    const base = 'https://api.minimax.io/anthropic'
    const modelsEndpoint = getModelsEndpointForBase(base)
    expect(modelsEndpoint).toBe('https://api.minimax.io/v1/models')
  })

  it('resolves z.ai anthropic endpoint to paas models list', () => {
    const base = 'https://api.z.ai/anthropic/v1/messages'
    const modelsEndpoint = getModelsEndpointForBase(base)
    expect(modelsEndpoint).toBe('https://api.z.ai/api/paas/v4/models')
  })

  it('returns unchanged URL when already pointing to models', () => {
    const base = 'https://api.example.com/v1/models'
    const modelsEndpoint = getModelsEndpointForBase(base)
    expect(modelsEndpoint).toBe('https://api.example.com/v1/models')
  })

  it('falls back to appending /models for invalid URLs', () => {
    const base = 'not-a-valid-url'
    const modelsEndpoint = getModelsEndpointForBase(base)
    expect(modelsEndpoint).toBe('not-a-valid-url/models')
  })
})

