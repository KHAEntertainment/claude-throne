export function isAnthropicEndpoint(url: string): boolean {
  if (!url) return false
  
  const patterns = [
    /anthropic\.com/i,
    /\/anthropic$/i,
    /\/api\/anthropic/i,
    /claude\.ai/i,
    /bedrock.*anthropic/i,
    /deepseek\.com\/anthropic/i,
    /z\.ai\/api\/anthropic/i
  ]
  
  return patterns.some(pattern => pattern.test(url))
}
