// Simple provider + key resolver for Anthropic/OpenAI style backends
// Language: Node.js ESM

const PROVIDERS = {
  openrouter: 'openrouter',
  openai: 'openai',
  together: 'together',
  deepseek: 'deepseek',
  glm: 'glm',
  anthropic: 'anthropic',
  grok: 'grok',
  custom: 'custom',
}

export const ENDPOINT_KIND = {
  OPENAI_COMPATIBLE: 'openai-compatible',
  ANTHROPIC_NATIVE: 'anthropic-native',
}

const PROVIDER_KEY_SOURCES = {
  [PROVIDERS.custom]: ['CUSTOM_API_KEY', 'API_KEY'],
  [PROVIDERS.openrouter]: ['OPENROUTER_API_KEY'],
  [PROVIDERS.openai]: ['OPENAI_API_KEY'],
  [PROVIDERS.together]: ['TOGETHER_API_KEY'],
  [PROVIDERS.deepseek]: ['DEEPSEEK_API_KEY'],
  [PROVIDERS.glm]: ['GLM_API_KEY', 'ZAI_API_KEY'],
  [PROVIDERS.anthropic]: ['ANTHROPIC_API_KEY'],
  [PROVIDERS.grok]: ['GROK_API_KEY', 'XAI_API_KEY'],
}

function isAnthropicLikeUrl(baseUrl) {
  try {
    const url = new URL(baseUrl)
    const host = url.host.toLowerCase()
    const path = url.pathname.toLowerCase()
    if (host.includes('anthropic.com')) return true
    if (host.includes('anthropic.ai')) return true
    if (host.includes('deepseek.com') && path.includes('anthropic')) return true
    if (host.includes('z.ai') && path.includes('anthropic')) return true
    if (path.includes('/anthropic')) return true
    return false
  } catch {
    return false
  }
}

export function detectProvider(baseUrl, env = process.env) {
  const forced = (env.FORCE_PROVIDER || '').toLowerCase()
  if (forced && Object.values(PROVIDERS).includes(forced)) {
    return forced
  }

  try {
    const url = new URL(baseUrl)
    const host = url.host.toLowerCase()
    const path = url.pathname.toLowerCase()

    if (host.includes('openrouter.ai')) return PROVIDERS.openrouter
    if (host.includes('api.openai.com')) return PROVIDERS.openai
    if (host.includes('together.ai') || host.includes('together.xyz')) return PROVIDERS.together
    if (host.includes('deepseek.com')) return PROVIDERS.deepseek
    if (host.includes('z.ai')) return PROVIDERS.glm
    if (host.includes('anthropic.com') || host.endsWith('.anthropic.app')) return PROVIDERS.anthropic
    if (host.includes('x.ai') || host.includes('grok')) return PROVIDERS.grok
    if (/\/anthropic/.test(path)) return PROVIDERS.anthropic
    return PROVIDERS.custom
  } catch {
    return PROVIDERS.custom
  }
}

export function inferEndpointKind(provider, baseUrl) {
  if (provider === PROVIDERS.deepseek || provider === PROVIDERS.glm || provider === PROVIDERS.anthropic) {
    return ENDPOINT_KIND.ANTHROPIC_NATIVE
  }
  if (isAnthropicLikeUrl(baseUrl)) {
    return ENDPOINT_KIND.ANTHROPIC_NATIVE
  }
  return ENDPOINT_KIND.OPENAI_COMPATIBLE
}

export function resolveApiKey(provider, env = process.env) {
  const sources = PROVIDER_KEY_SOURCES[provider] || []
  for (const name of sources) {
    if (env[name]) {
      return { key: env[name], source: name }
    }
  }
  return { key: null, source: null }
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

