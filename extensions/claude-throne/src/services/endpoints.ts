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
