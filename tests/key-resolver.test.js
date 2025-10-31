import { describe, it, expect } from 'vitest'
import { detectProvider, resolveApiKey, providerSpecificHeaders, inferEndpointKindSync, ENDPOINT_KIND } from '../key-resolver.js'

describe('key-resolver', () => {
  it('detects providers from base URL', () => {
    expect(detectProvider('https://openrouter.ai/api')).toBe('openrouter')
    expect(detectProvider('https://api.openai.com')).toBe('openai')
    expect(detectProvider('https://api.together.ai')).toBe('together')
    expect(detectProvider('https://api.together.xyz')).toBe('together')
    expect(detectProvider('https://api.x.ai/v1')).toBe('grok')
    expect(detectProvider('https://example.com/v1')).toBe('custom')
  })

  it('resolves keys in priority order for custom', () => {
    const env = {
      CUSTOM_API_KEY: 'custom',
      API_KEY: 'api',
      OPENAI_API_KEY: 'openai',
      OPENROUTER_API_KEY: 'openrouter',
    }
    expect(resolveApiKey('custom', env)).toEqual({ key: 'custom', source: 'CUSTOM_API_KEY' })
    expect(resolveApiKey('openai', env)).toEqual({ key: 'openai', source: 'OPENAI_API_KEY' })
    expect(resolveApiKey('openrouter', env)).toEqual({ key: 'openrouter', source: 'OPENROUTER_API_KEY' })
  })

  it('includes OpenRouter headers when provider is openrouter', () => {
    const env = { OPENROUTER_SITE_URL: 'http://localhost', OPENROUTER_APP_TITLE: 'Test App' }
    const headers = providerSpecificHeaders('openrouter', env)
    expect(headers['HTTP-Referer']).toBe('http://localhost')
    expect(headers['X-Title']).toBe('Test App')
  })

  it('infers endpoint kind correctly', () => {
    expect(inferEndpointKindSync('deepseek', 'https://api.deepseek.com/anthropic')).toBe(ENDPOINT_KIND.ANTHROPIC_NATIVE)
    expect(inferEndpointKindSync('glm', 'https://api.z.ai/api/anthropic')).toBe(ENDPOINT_KIND.ANTHROPIC_NATIVE)
    expect(inferEndpointKindSync('openrouter', 'https://openrouter.ai/api')).toBe(ENDPOINT_KIND.OPENAI_COMPATIBLE)
    expect(inferEndpointKindSync('custom', 'https://example.com/v1')).toBe(ENDPOINT_KIND.OPENAI_COMPATIBLE)
  })
  
  // Comment 2 & 4: Test expanded Anthropic-like URL patterns with known-host registry
  it('detects Anthropic-like URLs with expanded patterns from known-host registry', () => {
    // Test moonshot pattern (known Anthropic-like provider)
    expect(inferEndpointKindSync('custom', 'https://api.moonshot.cn/v1/anthropic')).toBe(ENDPOINT_KIND.ANTHROPIC_NATIVE)
    // Test minimax pattern (known Anthropic-like provider)
    expect(inferEndpointKindSync('custom', 'https://api.minimax.chat/v1/anthropic')).toBe(ENDPOINT_KIND.ANTHROPIC_NATIVE)
    // Test generic /anthropic path
    expect(inferEndpointKindSync('custom', 'https://example.com/api/anthropic')).toBe(ENDPOINT_KIND.ANTHROPIC_NATIVE)
    // Test non-Anthropic URLs
    expect(inferEndpointKindSync('custom', 'https://example.com/v1')).toBe(ENDPOINT_KIND.OPENAI_COMPATIBLE)
    // Test that explicit overrides take precedence over heuristics
    const overrides = { 'https://example.com/v1': 'anthropic' }
    expect(inferEndpointKindSync('custom', 'https://example.com/v1', overrides)).toBe(ENDPOINT_KIND.ANTHROPIC_NATIVE)
  })
  
  // Comment 4: Test precedence: override > negotiation > heuristic
  it('ensures override precedence over heuristics', () => {
    const overrides = { 'https://api.moonshot.cn/v1/anthropic': 'openai' }
    // Override should take precedence even if URL matches Anthropic pattern
    expect(inferEndpointKindSync('custom', 'https://api.moonshot.cn/v1/anthropic', overrides)).toBe(ENDPOINT_KIND.OPENAI_COMPATIBLE)
  })
})