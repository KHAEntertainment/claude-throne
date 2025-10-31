// Comment 10: Shared redaction utility for sanitizing secrets in logs
// Deduplicated from index.js and ProxyManager.ts

/**
 * Redacts secrets from text strings using common patterns
 * @param {string} text - Text to redact
 * @returns {string} - Redacted text
 */
export function redactSecrets(text) {
  if (!text || typeof text !== 'string') return text

  return text
    .replace(/sk-ant-api03-[A-Za-z0-9+\/=\-_]{95,}/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED]')
    .replace(/Authorization:\s*Bearer\s+[^\s]+/gi, 'Authorization: [REDACTED]')
    .replace(/Authorization:\s*[^\s]+/gi, 'Authorization: [REDACTED]')
    .replace(/"apiKey"\s*:\s*"[^"]+"/g, '"apiKey": "[REDACTED]"')
    .replace(/"x-api-key"\s*:\s*"[^"]+"/g, '"x-api-key": "[REDACTED]"')
    .replace(/api[-_]?key["\s:=]+[^\s,}"']+/gi, 'api_key=[REDACTED]')
}
