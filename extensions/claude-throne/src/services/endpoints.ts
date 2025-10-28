/**
 * Determines whether a URL corresponds to a known Anthropic-related endpoint.
 *
 * @param url - The URL to test; falsy values are treated as non-matching.
 * @returns `true` if the URL matches any known Anthropic-related patterns, `false` otherwise.
 */
export function isAnthropicEndpoint(url: string): boolean {
  if (!url) return false
  
  try {
    const u = new URL(url.trim())
    const host = u.hostname.toLowerCase()
    const path = u.pathname.toLowerCase()

    const hasAnthropicPath =
      path === '/anthropic' ||
      path.startsWith('/anthropic/') ||
      path.startsWith('/api/anthropic')

    // Bedrock: require 'anthropic' in path
    if (host.includes('bedrock') && host.endsWith('amazonaws.com')) {
      return /anthropic/.test(path)
    }
    
    // For Deepseek/GLM, require /anthropic path to avoid false positives
    if (host === 'api.deepseek.com' || host === 'api.z.ai') {
      return hasAnthropicPath
    }
    
    // For api.anthropic.com accept either root or /anthropic* paths
    if (host.endsWith('anthropic.com')) {
      return true
    }
    
    // Claude.ai (heuristic; rarely used as API base)
    if (host.endsWith('claude.ai')) {
      return true
    }
    
    // For any other host, check if it has an Anthropic path
    return hasAnthropicPath
  } catch {
    return false
  }
}

export type CustomEndpointKind = 'auto' | 'anthropic' | 'openai'

/**
 * Returns the correct models endpoint URL for a given base URL.
 * Handles Anthropic-style endpoints by transforming them to use OpenAI-compatible models endpoints.
 * 
 * @param baseUrl - The base URL to transform
 * @returns The correct models endpoint URL
 */
export function getModelsEndpointForBase(baseUrl: string): string {
  if (!baseUrl) return baseUrl

  try {
    const url = new URL(baseUrl.replace(/\/$/, ''))
    const host = url.hostname.toLowerCase()
    const path = url.pathname.toLowerCase()

    // Guard against double-normalization: return as-is if it already ends with /models
    if (path.endsWith('/models')) {
      return baseUrl.replace(/\/$/, '')
    }

    // If it's an Anthropic-style endpoint, transform to use the correct models endpoint
    if (isAnthropicEndpoint(baseUrl)) {
      // Remove /anthropic or /api/anthropic suffix and preserve base path
      let basePath = ''
      let modelsPath = '/v1/models'
      
      // Extract base path before /anthropic for all Anthropic-style endpoints
      if (path.includes('/anthropic')) {
        basePath = path.substring(0, path.indexOf('/anthropic'))
      }
      
      // Special case for api.z.ai to preserve existing behavior
      if (host === 'api.z.ai') {
        modelsPath = `${basePath}/api/paas/v4/models`
      } else {
        // For all other Anthropic-style hosts, use preserved base path + /v1/models
        modelsPath = `${basePath}/v1/models`
      }
      
      // Normalize double slashes and trailing slashes
      const finalPath = modelsPath.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
      return `${url.protocol}//${url.host}${finalPath}`
    }

    // For non-Anthropic endpoints, just append /models
    return `${baseUrl.replace(/\/$/, '')}/models`
  } catch {
    // If URL parsing fails, just append /models
    return `${baseUrl.replace(/\/$/, '')}/models`
  }
}
