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
  UNKNOWN: 'unknown', // Comment 1: Unknown state until negotiation completes
}

// Comment 1: In-memory cache for endpoint kind probe results
const endpointKindCache = new Map() // key: normalized baseUrl, value: { kind, timestamp, lastProbedAt }
const CACHE_TTL_MS = 3600000 // 1 hour

const PROVIDER_KEY_SOURCES = {
  [PROVIDERS.custom]: ['CUSTOM_API_KEY', 'API_KEY'],
  [PROVIDERS.openrouter]: ['OPENROUTER_API_KEY'],
  [PROVIDERS.openai]: ['OPENAI_API_KEY'],
  [PROVIDERS.together]: ['TOGETHER_API_KEY'],
  [PROVIDERS.deepseek]: ['DEEPSEEK_API_KEY'],
  [PROVIDERS.glm]: ['GLM_API_KEY', 'ZAI_API_KEY'], // Comment 2: Support both names for backward compatibility
  [PROVIDERS.anthropic]: ['ANTHROPIC_API_KEY'],
  [PROVIDERS.grok]: ['GROK_API_KEY', 'XAI_API_KEY'],
}

// Comment 4: Data-driven known-host registry for Anthropic-like endpoints
// Broaden heuristics with a static array of known Anthropic-like host substrings or regex patterns
const ANTHROPIC_LIKE_PATTERNS = [
  { host: 'anthropic.com' },
  { host: 'anthropic.ai' },
  { host: 'deepseek.com', path: 'anthropic' },
  { host: 'z.ai', path: 'anthropic' },
  { host: 'moonshot.cn', path: 'anthropic' }, // Comment 4: Known Anthropic-like provider
  { host: 'minimax.chat', path: 'anthropic' }, // Comment 4: Known Anthropic-like provider
  { path: '/anthropic' }, // Generic path pattern
]

function isAnthropicLikeUrl(baseUrl) {
  try {
    const url = new URL(baseUrl)
    const host = url.host.toLowerCase()
    const path = url.pathname.toLowerCase()
    
    // Comment 2: Check against data-driven patterns
    for (const pattern of ANTHROPIC_LIKE_PATTERNS) {
      if (pattern.host && !host.includes(pattern.host)) continue
      if (pattern.path && !path.includes(pattern.path)) continue
      if (!pattern.host && !pattern.path) continue
      return true
    }
    return false
  } catch {
    return false
  }
}

/**
 * Detects which configured provider corresponds to a given base URL.
 *
 * @param {string} baseUrl - The base URL or host to inspect.
 * @returns {string} The matching value from `PROVIDERS` (e.g., `PROVIDERS.openrouter`, `PROVIDERS.openai`, `PROVIDERS.together`, `PROVIDERS.deepseek`, `PROVIDERS.glm`). Returns `PROVIDERS.custom` if no known provider is detected or if the URL cannot be parsed.
 */
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

/**
 * Comment 1: Negotiate endpoint kind by probing the actual endpoint
 * Issues a short-timeout GET request to test if the endpoint accepts Anthropic headers
 * On explicit header/route mismatch, retries with Authorization: Bearer
 */
export async function negotiateEndpointKind(baseUrl, key) {
  const normalizedUrl = baseUrl.replace(/\/+$/, '')
  const now = Date.now()
  
  // Check cache first
  const cached = endpointKindCache.get(normalizedUrl)
  if (cached && now - cached.timestamp < CACHE_TTL_MS) {
    return { kind: cached.kind, lastProbedAt: cached.lastProbedAt }
  }
  
  const probeUrl = `${normalizedUrl}/v1/models`
  
  // Comment 1: Try Anthropic-native first with short timeout (1-2s), no retries
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 1500) // 1.5 second timeout
    
    const resp = await fetch(probeUrl, {
      method: 'GET',
      headers: {
        'x-api-key': key || 'test-key',
        'anthropic-version': '2023-06-01',
      },
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    
    // Comment 1: On explicit header/route mismatch (e.g., 400/404), retry with Authorization
    if (resp.status === 400 || resp.status === 404) {
      // Header/route mismatch - try OpenAI-compatible endpoint
      try {
        const openaiController = new AbortController()
        const openaiTimeoutId = setTimeout(() => openaiController.abort(), 1500)
        const openaiResp = await fetch(probeUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${key || 'test-key'}`,
          },
          signal: openaiController.signal,
        })
        clearTimeout(openaiTimeoutId)
        
        // If OpenAI endpoint responds (even with 401/403), it's OpenAI-compatible
        if (openaiResp.status === 401 || openaiResp.status === 403 || openaiResp.ok) {
          const kind = ENDPOINT_KIND.OPENAI_COMPATIBLE
          endpointKindCache.set(normalizedUrl, { kind, timestamp: now, lastProbedAt: now })
          return { kind, lastProbedAt: now }
        }
      } catch (openaiErr) {
        // OpenAI probe failed, continue to fallback
        console.warn(`[negotiateEndpointKind] OpenAI probe failed:`, openaiErr.message)
      }
    } else if (resp.status === 401 || resp.status === 403) {
      // 401/403 with Anthropic headers suggests Anthropic-native endpoint (wrong key but correct format)
      const kind = ENDPOINT_KIND.ANTHROPIC_NATIVE
      endpointKindCache.set(normalizedUrl, { kind, timestamp: now, lastProbedAt: now })
      return { kind, lastProbedAt: now }
    } else if (resp.ok) {
      // 200 OK with Anthropic headers confirms Anthropic-native
      const kind = ENDPOINT_KIND.ANTHROPIC_NATIVE
      endpointKindCache.set(normalizedUrl, { kind, timestamp: now, lastProbedAt: now })
      return { kind, lastProbedAt: now }
    }
  } catch (err) {
    // Network error or timeout - fall back to heuristic
    console.warn(`[negotiateEndpointKind] Probe failed for ${normalizedUrl}:`, err.message)
  }
  
  // Fallback to heuristic detection
  const kind = isAnthropicLikeUrl(baseUrl) 
    ? ENDPOINT_KIND.ANTHROPIC_NATIVE 
    : ENDPOINT_KIND.OPENAI_COMPATIBLE
  endpointKindCache.set(normalizedUrl, { kind, timestamp: now, lastProbedAt: now })
  return { kind, lastProbedAt: now }
}

export async function inferEndpointKind(provider, baseUrl, overrides = {}, key = null) {
  // Check for explicit override first (from env JSON or extension settings)
  const normalizedUrl = baseUrl.replace(/\/+$/, '')
  if (overrides[normalizedUrl]) {
    const override = overrides[normalizedUrl].toLowerCase()
    if (override === 'anthropic' || override === 'anthropic-native') {
      return { kind: ENDPOINT_KIND.ANTHROPIC_NATIVE, source: 'override' }
    }
    if (override === 'openai' || override === 'openai-compatible') {
      return { kind: ENDPOINT_KIND.OPENAI_COMPATIBLE, source: 'override' }
    }
  }
  
  // Fall back to automatic detection
  if (provider === PROVIDERS.deepseek || provider === PROVIDERS.glm || provider === PROVIDERS.anthropic) {
    return { kind: ENDPOINT_KIND.ANTHROPIC_NATIVE, source: 'heuristic' }
  }
  if (isAnthropicLikeUrl(baseUrl)) {
    return { kind: ENDPOINT_KIND.ANTHROPIC_NATIVE, source: 'heuristic' }
  }
  
  // Comment 1: For custom providers without override, probe the endpoint
  if (provider === PROVIDERS.custom && key) {
    try {
      const result = await negotiateEndpointKind(baseUrl, key)
      return { kind: result.kind, source: 'probe', lastProbedAt: result.lastProbedAt }
    } catch (err) {
      console.warn(`[inferEndpointKind] Probe failed, using heuristic:`, err.message)
      // Return unknown so request is gated until negotiation completes
      return { kind: ENDPOINT_KIND.UNKNOWN, source: 'probe' }
    }
  }
  
  return { kind: ENDPOINT_KIND.OPENAI_COMPATIBLE, source: 'heuristic' }
}

// Synchronous version for backward compatibility (used at startup)
export function inferEndpointKindSync(provider, baseUrl, overrides = {}) {
  const normalizedUrl = baseUrl.replace(/\/+$/, '')
  if (overrides[normalizedUrl]) {
    const override = overrides[normalizedUrl].toLowerCase()
    if (override === 'anthropic' || override === 'anthropic-native') {
      return ENDPOINT_KIND.ANTHROPIC_NATIVE
    }
    if (override === 'openai' || override === 'openai-compatible') {
      return ENDPOINT_KIND.OPENAI_COMPATIBLE
    }
  }
  
  if (provider === PROVIDERS.deepseek || provider === PROVIDERS.glm || provider === PROVIDERS.anthropic) {
    return ENDPOINT_KIND.ANTHROPIC_NATIVE
  }
  if (isAnthropicLikeUrl(baseUrl)) {
    return ENDPOINT_KIND.ANTHROPIC_NATIVE
  }
  return ENDPOINT_KIND.OPENAI_COMPATIBLE
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

