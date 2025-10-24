/**
 * Determines whether a URL corresponds to a known Anthropic-related endpoint.
 *
 * @param url - The URL to test; falsy values are treated as non-matching.
 * @returns `true` if the URL matches any known Anthropic-related patterns, `false` otherwise.
 */
export function isAnthropicEndpoint(url: string): boolean {
  if (!url) return false
  
  const patterns = [
    /anthropic\.com/i,
    /\/anthropic$/i,
    /\/api\/anthropic/i,
    /claude\.ai/i,
    /bedrock.*anthropic/i,
    /deepseek\.com/i,
    /z\.ai/i
  ]
  
  return patterns.some(pattern => pattern.test(url))
}