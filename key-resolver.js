// Simple provider + key resolver for OpenAI-compatible backends
// Language: Node.js ESM

const PROVIDERS = {
  openrouter: 'openrouter',
  openai: 'openai',
  together: 'together',
  groq: 'groq',
  custom: 'custom',
}

export function detectProvider(baseUrl) {
  try {
    const url = new URL(baseUrl)
    const host = url.host.toLowerCase()
    if (host.includes('openrouter.ai')) return PROVIDERS.openrouter
    if (host.includes('api.openai.com')) return PROVIDERS.openai
    if (host.includes('together.ai') || host.includes('together.xyz')) return PROVIDERS.together
    if (host.includes('api.groq.com')) return PROVIDERS.groq
    return PROVIDERS.custom
  } catch {
    return PROVIDERS.custom
  }
}

export function resolveApiKey(provider, env = process.env) {
  // Highest priority for custom URLs
  const custom = env.CUSTOM_API_KEY || env.API_KEY
  if (provider === PROVIDERS.custom && custom) return custom

  // Provider-specific
  if (provider === PROVIDERS.openai && env.OPENAI_API_KEY) return env.OPENAI_API_KEY
  if (provider === PROVIDERS.together && env.TOGETHER_API_KEY) return env.TOGETHER_API_KEY
  if (provider === PROVIDERS.groq && env.GROQ_API_KEY) return env.GROQ_API_KEY
  if (provider === PROVIDERS.openrouter && env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY

  // Fallbacks
  if (custom) return custom
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY
  if (env.OPENAI_API_KEY) return env.OPENAI_API_KEY
  if (env.TOGETHER_API_KEY) return env.TOGETHER_API_KEY
  if (env.GROQ_API_KEY) return env.GROQ_API_KEY
  return null
}

export function providerSpecificHeaders(provider, env = process.env) {
  const headers = {}
  if (provider === PROVIDERS.openrouter) {
    // OpenRouter appreciates HTTP-Referer and X-Title
    const referer = env.OPENROUTER_SITE_URL || env.HTTP_REFERER || env.APP_URL
    const title = env.OPENROUTER_APP_TITLE || env.APP_NAME || 'anthropic-proxy'
    if (referer) headers['HTTP-Referer'] = referer
    if (title) headers['X-Title'] = title
  }
  return headers
}

export const PROVIDER = PROVIDERS

