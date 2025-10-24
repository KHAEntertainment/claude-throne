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
