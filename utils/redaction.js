// Comment 10: Shared redaction utility for sanitizing secrets in logs
// Deduplicated from index.js and ProxyManager.ts

/**
 * Redacts secrets from text strings using common patterns
 * @param {string} text - Text to redact
 * @returns {string} - Redacted text
 */
export function redactSecrets(text) {
  if (!text || typeof text !== 'string') return text
  
  // Patterns that might indicate secrets
  const secretPatterns = [
    /(api[_-]?key|apikey)\s*[:=]\s*["']?([a-zA-Z0-9_-]{20,})["']?/gi,
    /(authorization|bearer)\s*[:=]\s*["']?([a-zA-Z0-9_-]{20,})["']?/gi,
    /(x-api-key)\s*[:=]\s*["']?([a-zA-Z0-9_-]{20,})["']?/gi,
    /(token|secret|password)\s*[:=]\s*["']?([a-zA-Z0-9_-]{16,})["']?/gi,
    // JSON body patterns
    /"api[_-]?key"\s*:\s*"([^"]{20,})"/gi,
    /"authorization"\s*:\s*"([^"]{20,})"/gi,
    /"token"\s*:\s*"([^"]{16,})"/gi,
  ]
  
  let redacted = text
  for (const pattern of secretPatterns) {
    redacted = redacted.replace(pattern, (match, key, value) => {
      const secretValue = value || (match.match(/["']([^"']{16,})["']/) || [])[1]
      if (secretValue && secretValue.length > 16) {
        return match.replace(secretValue, '[REDACTED]')
      }
      return match
    })
  }
  
  return redacted
}