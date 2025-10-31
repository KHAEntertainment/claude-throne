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

/**
 * Determine whether a base URL matches any known Anthropic-like host or path pattern.
 *
 * The function parses the provided URL and checks it against a data-driven list of
 * Anthropic-like host and path patterns. If the URL cannot be parsed, the function
 * returns `false`.
 *
 * @param {string} baseUrl - The base URL to test (e.g., "https://api.anthropic.com" or "https://example.com/anthropic").
 * @returns {boolean} `true` if the URL matches any Anthropic-like host or path pattern, `false` otherwise.
 */
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
 * Determine which known provider best matches the given base URL.
 *
 * @param {string} baseUrl - The base URL or host to inspect.
 * @returns {string} The matching value from `PROVIDERS` (for example `PROVIDERS.openrouter`, `PROVIDERS.openai`, `PROVIDERS.together`, `PROVIDERS.deepseek`, `PROVIDERS.glm`, `PROVIDERS.anthropic`, `PROVIDERS.grok`). Returns `PROVIDERS.custom` if no known provider is detected or if the URL cannot be parsed.
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
 * Determine whether a base URL exposes an Anthropic-native or OpenAI-compatible API and cache the result.
 *
 * Probes the service at the provided base URL (using the optional API key) with a short timeout and, if probing is inconclusive or fails, falls back to a heuristic. The determined endpoint kind is cached for a short period to avoid repeated probing.
 *
 * @param {string} baseUrl - The base URL of the endpoint to probe (may include or omit trailing slash).
 * @param {string|null} key - Optional API key used during the probe; may be null for anonymous probes.
 * @returns {{ kind: symbol, lastProbedAt: number }} An object containing `kind` (one of `ENDPOINT_KIND` values) and `lastProbedAt` (epoch milliseconds when the probe completed or when the cached value was set).
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
    
    // Comment 1: On ambiguous responses (400/404/401/403), retry with OpenAI-style Authorization header
    // 400/404 suggest route mismatch, 401/403 are ambiguous (could be either endpoint type)
    if (resp.status === 400 || resp.status === 404 || resp.status === 401 || resp.status === 403) {
      // Try OpenAI-compatible endpoint to disambiguate
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
        
        // If OpenAI endpoint responds (ok or 401/403), it's OpenAI-compatible
        if (openaiResp.ok || openaiResp.status === 401 || openaiResp.status === 403) {
          const kind = ENDPOINT_KIND.OPENAI_COMPATIBLE
          endpointKindCache.set(normalizedUrl, { kind, timestamp: now, lastProbedAt: now })
          return { kind, lastProbedAt: now }
        }
        // OpenAI probe failed (non-ok and not 401/403) - classify as Anthropic-native
        // This means the endpoint doesn't recognize OpenAI-style requests
        const kind = ENDPOINT_KIND.ANTHROPIC_NATIVE
        endpointKindCache.set(normalizedUrl, { kind, timestamp: now, lastProbedAt: now })
        return { kind, lastProbedAt: now }
      } catch (openaiErr) {
        // OpenAI probe failed (network/timeout) - classify as Anthropic-native
        console.warn(`[negotiateEndpointKind] OpenAI probe failed:`, openaiErr.message)
        const kind = ENDPOINT_KIND.ANTHROPIC_NATIVE
        endpointKindCache.set(normalizedUrl, { kind, timestamp: now, lastProbedAt: now })
        return { kind, lastProbedAt: now }
      }
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

/**
 * Infer the endpoint kind for a provider and base URL using explicit overrides, heuristics, or an endpoint probe.
 *
 * @param {string} provider - Provider identifier (one of PROVIDERS).
 * @param {string} baseUrl - The provider base URL to inspect.
 * @param {Object<string,string>} [overrides={}] - Optional map of normalized base URLs to override values ('anthropic' | 'anthropic-native' | 'openai' | 'openai-compatible').
 * @param {string|null} [key=null] - Optional API key used to probe custom endpoints; if omitted, probing is skipped.
 * @returns {{ kind: number, source: 'override'|'heuristic'|'probe', lastProbedAt?: number }}
 *   An object describing the inferred endpoint kind:
 *   - `kind`: one of ENDPOINT_KIND (ANThROPIC_NATIVE, OPENAI_COMPATIBLE, or UNKNOWN).
 *   - `source`: indicates whether the result came from an 'override', a 'heuristic', or a 'probe'.
 *   - `lastProbedAt`: provided when the result originates from a successful probe.
 *   When a probe for a custom provider fails, returns `kind: ENDPOINT_KIND.UNKNOWN` with `source: 'probe'`.
 */
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

/**
 * Infer the endpoint kind synchronously from provider, base URL, and explicit overrides without performing network probes.
 *
 * Checks an exact URL override first; if none applies it uses provider hints and Anthropic-like URL heuristics to decide.
 * @param {string} provider - Provider identifier (one of the values in `PROVIDERS`).
 * @param {string} baseUrl - Base URL of the endpoint being classified.
 * @param {Object.<string,string>} [overrides={}] - Optional mapping of normalized base URLs to override kinds (e.g., `"anthropic"`, `"openai"`).
 * @returns {number} `ENDPOINT_KIND.ANTHROPIC_NATIVE` when the override, provider, or URL heuristics indicate Anthropic-native; otherwise `ENDPOINT_KIND.OPENAI_COMPATIBLE`.
 */
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
 * Determine the API key for a provider by checking configured environment variable names in priority order.
 *
 * @param {string} provider - Provider identifier (one of the values from PROVIDERS).
 * @param {Object} [env=process.env] - Environment-like object to read variables from.
 * @returns {{key: string|null, source: string|null}} The first found key and the environment variable name it came from, or `{ key: null, source: null }` if none was found.
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
