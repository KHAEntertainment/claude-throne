import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

describe('POST /v1/messages (OpenRouter tool unsupported fallback)', () => {
  it('strips tools and injects text instructions when model does not support tool calling', async () => {
    const upstream = await startUpstreamMock({ mode: 'json' })
    const proxyPort = 3116
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: { 
        OPENROUTER_API_KEY: 'testkey',
        COMPLETION_MODEL: 'google/gemini-2.0-pro-exp-02-05:free' // Model in toolCallUnsupported list
      },
    })

    try {
      const payload = {
        messages: [
          { role: 'user', content: 'Use the weather tool' }
        ],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather for a city',
            input_schema: {
              type: 'object',
              properties: {
                city: { type: 'string' }
              }
            }
          }
        ],
        tool_choice: 'auto',
        stream: false,
      }

      const response = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send(payload)
        .expect(200)

      // Inspect what the upstream mock received
      const forwarded = JSON.parse(upstream.received.body)
      expect(forwarded).toBeTruthy()
      
      // Tools should be stripped from payload
      expect(forwarded.tools).toBeUndefined()
      expect(forwarded.tool_choice).toBeUndefined()
      
      // Text-based tool instructions should be injected in messages
      const lastMessage = forwarded.messages[forwarded.messages.length - 1]
      expect(lastMessage.role).toBe('user')
      expect(lastMessage.content).toContain('get_weather')
      expect(lastMessage.content).toContain('weather for a city')
      
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })

  it('returns structured 400 with hint when feature flag forces error instead of fallback', async () => {
    const upstream = await startUpstreamMock({ mode: 'json', status: 404 })
    const proxyPort = 3117
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: { 
        OPENROUTER_API_KEY: 'testkey',
        COMPLETION_MODEL: 'google/gemini-2.0-pro-exp-02-05:free',
        FORCE_TOOL_ERROR: '1' // Feature flag to force error instead of fallback
      },
    })

    try {
      const payload = {
        messages: [
          { role: 'user', content: 'Use the weather tool' }
        ],
        tools: [
          {
            name: 'get_weather',
            description: 'Get weather',
            input_schema: { type: 'object' }
          }
        ],
        stream: false,
      }

      // Mock upstream returning 404 for tool requests
      upstream.responseBody = JSON.stringify({
        error: {
          message: 'No endpoints found that support tool use',
          type: 'invalid_request_error'
        }
      })

      const response = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send(payload)
        .expect(400)

      // Should return structured error with hint
      expect(response.body.error).toBeTruthy()
      expect(response.body.error.type).toBe('tool_unsupported')
      expect(response.body.error.hint).toContain('does not support tool calling')
      
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })
})

