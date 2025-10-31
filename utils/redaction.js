function redactSecrets(text) {
  if (!text || typeof text !== "string") return text
  
  return text
    .replace(/sk-ant-api03-[A-Za-z0-9+/=\-_]{95,}/g, "[REDACTED]")
    .replace(/Authorization:\s*[^\s]+/g, "Authorization: [REDACTED]")  
    .replace(/"apiKey":\s*"[^"]+"/g, apiKey: [REDACTED])
    .replace(/"x-api-key":\s*"[^"]+"/g, x-api-key: [REDACTED])
}

module.exports = { redactSecrets }
