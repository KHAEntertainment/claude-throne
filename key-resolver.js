// Simple provider + key resolver for OpenAI-compatible backends
// Language: Node.js ESM

const PROVIDERS = {
  openrouter: 'openrouter',
  openai: 'openai',
  together: 'together',
  deepseek: 'deepseek',
  glm: 'glm',
  custom: 'custom',
}

/**
 * Detects which configured provider corresponds to a given base URL.
 *
 * @param {string} baseUrl - The base URL or host to inspect.
 * @returns {string} The matching value from `PROVIDERS` (e.g., `PROVIDERS.openrouter`, `PROVIDERS.openai`, `PROVIDERS.together`, `PROVIDERS.deepseek`, `PROVIDERS.glm`). Returns `PROVIDERS.custom` if no known provider is detected or if the URL cannot be parsed.
 */
export function detectProvider(baseUrl) {
  try {
    const url = new URL(baseUrl)
    const host = url.host.toLowerCase()
    if (host.includes('openrouter.ai')) return PROVIDERS.openrouter
    if (host.includes('api.openai.com')) return PROVIDERS.openai
    if (host.includes('together.ai') || host.includes('together.xyz')) return PROVIDERS.together
    if (host.includes('deepseek.com')) return PROVIDERS.deepseek
    if (host.includes('z.ai')) return PROVIDERS.glm
    return PROVIDERS.custom
  } catch {
    return PROVIDERS.custom
  }
}

/**
 * Resolve the appropriate API key for a given provider using environment variables and configured fallbacks.
 *
 * Checks a provider-specific environment variable first (and for the `custom` provider prefers a custom/global key),
 * then falls back through a fixed priority list: CUSTOM/API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, TOGETHER_API_KEY,
 * DEEPSEEK_API_KEY, and GLM_API_KEY or ZAI_API_KEY.
 *
 * @param {string} provider - Provider identifier (one of the values from PROVIDERS).
 * @param {Object} [env=process.env] - Environment-like object containing API key variables.
 * @returns {string|null} The resolved API key, or `null` if no key is found.
 */
export function resolveApiKey(provider, env = process.env) {
  // Highest priority for custom URLs
  const custom = env.CUSTOM_API_KEY || env.API_KEY
  if (provider === PROVIDERS.custom && custom) return custom

  // Provider-specific
  if (provider === PROVIDERS.openai && env.OPENAI_API_KEY) return env.OPENAI_API_KEY
  if (provider === PROVIDERS.together && env.TOGETHER_API_KEY) return env.TOGETHER_API_KEY
  if (provider === PROVIDERS.deepseek && env.DEEPSEEK_API_KEY) return env.DEEPSEEK_API_KEY
  if (provider === PROVIDERS.glm && (env.GLM_API_KEY || env.ZAI_API_KEY)) return env.GLM_API_KEY || env.ZAI_API_KEY
  if (provider === PROVIDERS.openrouter && env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY

  // Fallbacks
  if (custom) return custom
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY
  if (env.OPENAI_API_KEY) return env.OPENAI_API_KEY
  if (env.TOGETHER_API_KEY) return env.TOGETHER_API_KEY
  if (env.DEEPSEEK_API_KEY) return env.DEEPSEEK_API_KEY
  if (env.GLM_API_KEY || env.ZAI_API_KEY) return env.GLM_API_KEY || env.ZAI_API_KEY
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
