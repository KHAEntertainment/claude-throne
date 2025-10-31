import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

/**
 * Schema Contract Tests for /v1/messages Endpoint
 * 
 * Validates that request/response payloads conform to Zod schemas.
 * These tests ensure contract compliance and catch schema violations early.
 * 
 * Required for guarded areas per Constitution.md.
 */

// Request payload schema (Anthropic-style)
const MessagesRequestSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant', 'system', 'tool']),
    content: z.union([
      z.string(),
      z.array(z.union([
        z.object({ type: z.literal('text'), text: z.string() }),
        z.object({ type: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.any() }),
        z.object({ type: z.literal('tool_result'), tool_use_id: z.string(), content: z.union([z.string(), z.array(z.any())]) })
      ]))
    ]).optional()
  })),
  system: z.union([z.string(), z.array(z.object({ type: z.string(), text: z.string() }))]).optional(),
  model: z.string().optional(),
  max_tokens: z.number().optional(),
  stream: z.boolean().optional(),
  temperature: z.number().optional(),
  tools: z.array(z.any()).optional()
})

// Response schema (non-streaming) - matches actual proxy response structure
const MessagesResponseSchema = z.object({
  id: z.string(),
  type: z.literal('message'),
  role: z.literal('assistant'),
  content: z.array(z.object({
    type: z.string(),
    text: z.string().optional()
  })),
  model: z.string().optional(),
  stop_reason: z.string().nullable().optional(),
  stop_sequence: z.string().nullable().optional(),
  usage: z.object({
    input_tokens: z.number(),
    output_tokens: z.number()
  }).optional()
})

// Error response schema
const ErrorResponseSchema = z.object({
  error: z.object({
    message: z.string(),
    type: z.string()
  })
})

describe('Schema Contract Tests: /v1/messages', () => {
  
  describe('Request Schema Validation', () => {
    it('validates valid Anthropic-style request payload', () => {
      const validPayload = {
        messages: [
          { role: 'user', content: 'Hello' }
        ],
        stream: false
      }

      const result = MessagesRequestSchema.safeParse(validPayload)
      expect(result.success).toBe(true)
      if (result.success) {
        expect(result.data.messages).toHaveLength(1)
        expect(result.data.messages[0].role).toBe('user')
      }
    })

    it('validates request with content blocks', () => {
      const validPayload = {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Hello' }
            ]
          }
        ],
        stream: false
      }

      const result = MessagesRequestSchema.safeParse(validPayload)
      expect(result.success).toBe(true)
    })

    it('validates request with system message', () => {
      const validPayload = {
        system: 'You are a helpful assistant',
        messages: [
          { role: 'user', content: 'Hello' }
        ],
        stream: false
      }

      const result = MessagesRequestSchema.safeParse(validPayload)
      expect(result.success).toBe(true)
    })

    it('rejects invalid request with missing messages', () => {
      const invalidPayload = {
        stream: false
        // missing messages
      }

      const result = MessagesRequestSchema.safeParse(invalidPayload)
      expect(result.success).toBe(false)
    })

    it('rejects invalid request with invalid role', () => {
      const invalidPayload = {
        messages: [
          { role: 'invalid-role', content: 'Hello' }
        ],
        stream: false
      }

      const result = MessagesRequestSchema.safeParse(invalidPayload)
      expect(result.success).toBe(false)
    })
  })

  describe('Response Schema Validation', () => {
    it('validates non-streaming response structure', async () => {
      const upstream = await startUpstreamMock({ mode: 'json' })
      const proxyPort = 3300
      const child = await spawnProxyProcess({
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        env: { CUSTOM_API_KEY: 'testkey' },
        isolateEnv: true
      })

      try {
        const res = await request(`http://127.0.0.1:${proxyPort}`)
          .post('/v1/messages')
          .set('content-type', 'application/json')
          .send({ messages: [{ role: 'user', content: 'Say hi' }], stream: false })
          .expect(200)

        // Validate response against schema
        const result = MessagesResponseSchema.safeParse(res.body)
        if (!result.success) {
          console.error('Schema validation failed:', JSON.stringify(result.error.errors, null, 2))
          console.error('Actual response:', JSON.stringify(res.body, null, 2))
        }
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.type).toBe('message')
          expect(result.data.role).toBe('assistant')
          expect(Array.isArray(result.data.content)).toBe(true)
        }
      } finally {
        await stopChild(child)
        upstream.server.close()
      }
    })

    it('validates error response structure', async () => {
      const upstream = await startUpstreamMock({ mode: 'json' })
      const proxyPort = 3301
      const child = await spawnProxyProcess({
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        env: { CUSTOM_API_KEY: 'testkey' }, // Use valid key, test will validate error structure elsewhere
        isolateEnv: true
      })

      try {
        // Test with invalid header to get structured error
        const res = await request(`http://127.0.0.1:${proxyPort}`)
          .post('/v1/messages')
          .set('content-type', 'application/json')
          .set('x-api-key', 'test-key') // Invalid for OpenAI-compatible endpoint
          .send({ messages: [{ role: 'user', content: 'Hi' }], stream: false })
          .expect(400)

        // Validate error response against schema
        const result = ErrorResponseSchema.safeParse(res.body)
        expect(result.success).toBe(true)
        if (result.success) {
          expect(result.data.error).toBeDefined()
          expect(result.data.error.message).toBeDefined()
          expect(result.data.error.type).toBeDefined()
        }
      } finally {
        await stopChild(child)
        upstream.server.close()
      }
    })
  })

  describe('End-to-End Contract Validation', () => {
    it('round-trip: valid request produces valid response', async () => {
      const upstream = await startUpstreamMock({ mode: 'json' })
      const proxyPort = 3302
      const child = await spawnProxyProcess({
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        env: { CUSTOM_API_KEY: 'testkey' },
        isolateEnv: true
      })

      try {
        const requestPayload = {
          messages: [
            { role: 'user', content: 'Hello' }
          ],
          stream: false
        }

        // Validate request before sending
        const requestValidation = MessagesRequestSchema.safeParse(requestPayload)
        expect(requestValidation.success).toBe(true)

        const res = await request(`http://127.0.0.1:${proxyPort}`)
          .post('/v1/messages')
          .set('content-type', 'application/json')
          .send(requestPayload)
          .expect(200)

        // Validate response
        const responseValidation = MessagesResponseSchema.safeParse(res.body)
        if (!responseValidation.success) {
          console.error('Response validation failed:', JSON.stringify(responseValidation.error.errors, null, 2))
          console.error('Actual response:', JSON.stringify(res.body, null, 2))
        }
        expect(responseValidation.success).toBe(true)
      } finally {
        await stopChild(child)
        upstream.server.close()
      }
    })
  })
})

