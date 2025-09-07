import { describe, it, expect } from 'vitest'
import { detectProvider, resolveApiKey, providerSpecificHeaders } from '../key-resolver.js'

describe('key-resolver', () => {
  it('detects providers from base URL', () => {
    expect(detectProvider('https://openrouter.ai/api')).toBe('openrouter')
    expect(detectProvider('https://api.openai.com')).toBe('openai')
    expect(detectProvider('https://api.together.ai')).toBe('together')
    expect(detectProvider('https://api.together.xyz')).toBe('together')
    expect(detectProvider('https://api.groq.com/openai/v1')).toBe('groq')
    expect(detectProvider('https://example.com/v1')).toBe('custom')
  })

  it('resolves keys in priority order for custom', () => {
    const env = {
      CUSTOM_API_KEY: 'custom',
      API_KEY: 'api',
      OPENAI_API_KEY: 'openai',
      OPENROUTER_API_KEY: 'openrouter',
    }
    expect(resolveApiKey('custom', env)).toBe('custom')
    expect(resolveApiKey('openai', env)).toBe('openai')
    expect(resolveApiKey('openrouter', env)).toBe('openrouter')
  })

  it('includes OpenRouter headers when provider is openrouter', () => {
    const env = { OPENROUTER_SITE_URL: 'http://localhost', OPENROUTER_APP_TITLE: 'Test App' }
    const headers = providerSpecificHeaders('openrouter', env)
    expect(headers['HTTP-Referer']).toBe('http://localhost')
    expect(headers['X-Title']).toBe('Test App')
  })
})

