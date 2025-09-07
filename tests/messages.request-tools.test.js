import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

describe('POST /v1/messages (request-side tool mapping)', () => {
  it('converts Anthropic assistant tool_use to OpenAI tool_calls upstream', async () => {
    const upstream = await startUpstreamMock({ mode: 'json' })
    const proxyPort = 3115
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: { CUSTOM_API_KEY: 'testkey' },
    })

    try {
      const payload = {
        messages: [
          { role: 'user', content: 'Weather please' },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'call_1',
                name: 'get_weather',
                input: { city: 'SF' },
              },
              {
                type: 'tool_result',
                tool_use_id: 'call_1',
                content: '{"temp": 70}',
              },
            ],
          },
        ],
        stream: false,
      }

      await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send(payload)
        .expect(200)

      // Inspect what the upstream mock received
      const forwarded = JSON.parse(upstream.received.body)
      expect(forwarded).toBeTruthy()
      expect(Array.isArray(forwarded.messages)).toBe(true)

      const assistantWithCalls = forwarded.messages.find(
        (m) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0
      )
      expect(assistantWithCalls).toBeTruthy()
      const call = assistantWithCalls.tool_calls[0]
      expect(call.type).toBe('function')
      expect(call.function.name).toBe('get_weather')
      expect(call.function.arguments).toBe('{"city":"SF"}')

      const toolMsg = forwarded.messages.find((m) => m.role === 'tool' && m.tool_call_id === 'call_1')
      expect(toolMsg).toBeTruthy()
      expect(typeof toolMsg.content).toBe('string')
      expect(toolMsg.content).toContain('temp')
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })
})

