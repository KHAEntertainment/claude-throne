import { describe, it, expect } from 'vitest'
import { redactSecrets } from '../utils/redaction.js'

describe('redactSecrets utility', () => {
  it('redacts Authorization Bearer tokens', () => {
    const input = 'Authorization: Bearer sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz'
    const output = redactSecrets(input)
    expect(output).toContain('[REDACTED]')
    expect(output).not.toContain('sk-ant-api03')
  })

  it('redacts x-api-key headers', () => {
    const input = 'x-api-key: sk-1234567890abcdefghijklmnopqrstuvwxyz'
    const output = redactSecrets(input)
    expect(output).toContain('[REDACTED]')
    expect(output).not.toContain('sk-1234567890')
  })

  it('redacts apiKey in JSON bodies', () => {
    const input = '{"apiKey": "sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz", "other": "data"}'
    const output = redactSecrets(input)
    expect(output).toContain('[REDACTED]')
    expect(output).not.toContain('sk-ant-api03')
    expect(output).toContain('"other": "data"')
  })

  it('redacts nested JSON with apiKey fields', () => {
    const input = JSON.stringify({
      headers: {
        'x-api-key': 'sk-ant-api03-abc123def456ghi789jkl012mno345pqr678stu901vwx234yz'
      },
      body: { message: 'test' }
    })
    const output = redactSecrets(input)
    expect(output).toContain('[REDACTED]')
    expect(output).not.toContain('sk-ant-api03')
    // Verify JSON is valid and structure is preserved
    const parsed = JSON.parse(output)
    expect(parsed.body.message).toBe('test')
    expect(parsed.headers['x-api-key']).toBe('[REDACTED]')
  })

  it('preserves non-secret content', () => {
    const input = 'This is a normal log message with no secrets'
    const output = redactSecrets(input)
    expect(output).toBe(input)
  })

  it('handles null and undefined', () => {
    expect(redactSecrets(null)).toBe(null)
    expect(redactSecrets(undefined)).toBe(undefined)
  })

  it('handles empty strings', () => {
    expect(redactSecrets('')).toBe('')
  })
})

