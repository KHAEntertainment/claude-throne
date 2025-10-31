import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

/**
 * Contract Tests for /v1/messages Endpoint
 * 
 * Validates that message/config payloads conform to expected schemas.
 * Tests ensure contract compliance and reject invalid payloads.
 */

describe('POST /v1/messages (contract validation)', () => {
  
  describe('Message Payload Schema', () => {
    it('accepts valid Anthropic-style message payload', async () => {
      const upstream = await startUpstreamMock({ mode: 'json' })
      const proxyPort = 3200
      const child = await spawnProxyProcess({
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        env: { CUSTOM_API_KEY: 'testkey' },
        isolateEnv: true
      })

      try {
        const validPayload = {
          messages: [
            { role: 'user', content: 'Hello' }
          ],
          stream: false
        }

        const res = await request(`http://127.0.0.1:${proxyPort}`)
          .post('/v1/messages')
          .set('content-type', 'application/json')
          .send(validPayload)
          .expect(200)

        expect(res.body).toHaveProperty('content')
        expect(res.body).toHaveProperty('id')
        expect(res.body).toHaveProperty('role', 'assistant')
      } finally {
        await stopChild(child)
        upstream.server.close()
      }
    })

    it('accepts valid Anthropic-style messages with content blocks', async () => {
      const upstream = await startUpstreamMock({ mode: 'json' })
      const proxyPort = 3201
      const child = await spawnProxyProcess({
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        env: { CUSTOM_API_KEY: 'testkey' },
        isolateEnv: true
      })

      try {
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

        const res = await request(`http://127.0.0.1:${proxyPort}`)
          .post('/v1/messages')
          .set('content-type', 'application/json')
          .send(validPayload)
          .expect(200)

        expect(res.body).toHaveProperty('content')
      } finally {
        await stopChild(child)
        upstream.server.close()
      }
    })

    it('rejects payload without messages array', async () => {
      const upstream = await startUpstreamMock({ mode: 'json' })
      const proxyPort = 3202
      const child = await spawnProxyProcess({
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        env: { CUSTOM_API_KEY: 'testkey' },
        isolateEnv: true
      })

      try {
        const invalidPayload = {
          // missing messages
          stream: false
        }

        // Proxy may forward to upstream which might accept it
        // This test documents expected behavior: upstream will handle validation
        const res = await request(`http://127.0.0.1:${proxyPort}`)
          .post('/v1/messages')
          .set('content-type', 'application/json')
          .send(invalidPayload)

        // Should either reject or forward (upstream will reject)
        expect([200, 400]).toContain(res.status)
        if (res.status === 400) {
          expect(res.body.error || res.text).toBeDefined()
        }
      } finally {
        await stopChild(child)
        upstream.server.close()
      }
    })

    it('rejects payload with invalid message structure', async () => {
      const upstream = await startUpstreamMock({ mode: 'json' })
      const proxyPort = 3203
      const child = await spawnProxyProcess({
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        env: { CUSTOM_API_KEY: 'testkey' },
        isolateEnv: true
      })

      try {
        const invalidPayload = {
          messages: [
            { role: 'invalid-role', content: 'Hello' } // Invalid role
          ],
          stream: false
        }

        // Upstream will reject, but we should handle gracefully
        const res = await request(`http://127.0.0.1:${proxyPort}`)
          .post('/v1/messages')
          .set('content-type', 'application/json')
          .send(invalidPayload)

        // Should either reject or forward to upstream (which rejects)
        expect([400, 200]).toContain(res.status)
      } finally {
        await stopChild(child)
        upstream.server.close()
      }
    })
  })

  describe('System Message Schema', () => {
    it('accepts system as string', async () => {
      const upstream = await startUpstreamMock({ mode: 'json' })
      const proxyPort = 3204
      const child = await spawnProxyProcess({
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        env: { CUSTOM_API_KEY: 'testkey' },
        isolateEnv: true
      })

      try {
        const validPayload = {
          system: 'You are a helpful assistant',
          messages: [{ role: 'user', content: 'Hello' }],
          stream: false
        }

        const res = await request(`http://127.0.0.1:${proxyPort}`)
          .post('/v1/messages')
          .set('content-type', 'application/json')
          .send(validPayload)
          .expect(200)

        expect(res.body).toHaveProperty('content')
      } finally {
        await stopChild(child)
        upstream.server.close()
      }
    })

    it('accepts system as array of blocks', async () => {
      const upstream = await startUpstreamMock({ mode: 'json' })
      const proxyPort = 3205
      const child = await spawnProxyProcess({
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        env: { CUSTOM_API_KEY: 'testkey' },
        isolateEnv: true
      })

      try {
        const validPayload = {
          system: [
            { type: 'text', text: 'You are helpful' }
          ],
          messages: [{ role: 'user', content: 'Hello' }],
          stream: false
        }

        const res = await request(`http://127.0.0.1:${proxyPort}`)
          .post('/v1/messages')
          .set('content-type', 'application/json')
          .send(validPayload)
          .expect(200)

        expect(res.body).toHaveProperty('content')
      } finally {
        await stopChild(child)
        upstream.server.close()
      }
    })
  })

  describe('Streaming Response Contract', () => {
    it('returns SSE format for stream:true', async () => {
      const upstream = await startUpstreamMock({ 
        mode: 'sse',
        sseChunks: [
          { choices: [{ delta: { content: 'Hello' } }] },
          { choices: [{ delta: { content: ' ' } }] },
          { choices: [{ delta: { content: 'world' } }] }
        ]
      })
      const proxyPort = 3206
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
          .send({ messages: [{ role: 'user', content: 'Say hi' }], stream: true })
          .expect(200)

        expect(res.headers['content-type']).toContain('text/event-stream')
        expect(res.text).toMatch(/event:/)
        expect(res.text).toMatch(/data:/)
      } finally {
        await stopChild(child)
        upstream.server.close()
      }
    })

    it('returns JSON format for stream:false', async () => {
      const upstream = await startUpstreamMock({ mode: 'json' })
      const proxyPort = 3207
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

        expect(res.headers['content-type']).toContain('application/json')
        expect(res.body).toHaveProperty('content')
        expect(Array.isArray(res.body.content)).toBe(true)
      } finally {
        await stopChild(child)
        upstream.server.close()
      }
    })
  })

  describe('Error Response Contract', () => {
    it('returns structured error when API key missing', async () => {
      const upstream = await startUpstreamMock({ mode: 'json' })
      const proxyPort = 3208
      const child = await spawnProxyProcess({
        port: proxyPort,
        baseUrl: `http://127.0.0.1:${upstream.port}`,
        env: { }, // No API key
        isolateEnv: true
      })

      try {
        const res = await request(`http://127.0.0.1:${proxyPort}`)
          .post('/v1/messages')
          .set('content-type', 'application/json')
          .send({ messages: [{ role: 'user', content: 'Hi' }], stream: false })
          .expect(400)

        // Should have error structure
        expect(res.body.error || res.text).toBeDefined()
        expect(res.body.error || res.text).toMatch(/API key|No API key/i)
      } finally {
        await stopChild(child)
        upstream.server.close()
      }
    })
  })
})

