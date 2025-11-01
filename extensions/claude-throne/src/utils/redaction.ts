// Shared redaction utility for sanitizing secrets in extension logs.
// Mirrors the root-level implementation bundled with the proxy.

export function redactSecrets(text: string | null | undefined): string | null | undefined {
  if (!text || typeof text !== 'string') {
    return text as typeof text
  }

  return text
    .replace(/sk-ant-api03-[A-Za-z0-9+/=\-_]{95,}/g, '[REDACTED]')
    .replace(/sk-[A-Za-z0-9]{20,}/g, '[REDACTED]')
    .replace(/Authorization:\s*Bearer\s+[^\s]+/gi, 'Authorization: [REDACTED]')
    .replace(/Authorization:\s*[^\s]+/gi, 'Authorization: [REDACTED]')
    .replace(/"apiKey"\s*:\s*"[^"]+"/g, '"apiKey": "[REDACTED]"')
    .replace(/"x-api-key"\s*:\s*"[^"]+"/g, '"x-api-key": "[REDACTED]"')
    .replace(
      /(?<!["'])(api[-_]?key)(\s*[:=]\s*)([^\s,}"']+)/gi,
      (_match, key: string, separator: string) => {
        if (separator.includes('=')) {
          return `${key}=[REDACTED]`
        }
        return `${key}: [REDACTED]`
      }
    )
}

