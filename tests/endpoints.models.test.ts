import { describe, it, expect } from 'vitest'

import { getModelsEndpointForBase, isAnthropicEndpoint } from '../extensions/claude-throne/src/services/endpoints'

describe('Endpoint resolution: getModelsEndpointForBase()', () => {
  it('resolves Deepseek base to /v1/models', () => {
    const base = 'https://api.deepseek.com/v1'
    const url = getModelsEndpointForBase(base)
    expect(url).toBe('https://api.deepseek.com/v1/models')
  })

  it('resolves GLM base to /api/paas/v4/models', () => {
    const base = 'https://api.z.ai/api/paas/v4'
    const url = getModelsEndpointForBase(base)
    expect(url).toBe('https://api.z.ai/api/paas/v4/models')
  })

  it('resolves Anthropic-style GLM path to /api/paas/v4/models', () => {
    const base = 'https://api.z.ai/api/anthropic/v1/messages'
    const url = getModelsEndpointForBase(base)
    expect(url).toBe('https://api.z.ai/api/paas/v4/models')
  })
})

describe('Anthropic endpoint detection: isAnthropicEndpoint()', () => {
  it('Deepseek: true only when path includes /anthropic', () => {
    expect(isAnthropicEndpoint('https://api.deepseek.com/v1')).toBe(false)
    expect(isAnthropicEndpoint('https://api.deepseek.com/anthropic/v1')).toBe(true)
    expect(isAnthropicEndpoint('https://api.deepseek.com/anthropic/v1/messages')).toBe(true)
  })

  it('GLM: true only when path includes /anthropic', () => {
    expect(isAnthropicEndpoint('https://api.z.ai/api/paas/v4')).toBe(false)
    expect(isAnthropicEndpoint('https://api.z.ai/api/anthropic')).toBe(true)
    expect(isAnthropicEndpoint('https://api.z.ai/api/anthropic/v1/messages')).toBe(true)
  })
})
