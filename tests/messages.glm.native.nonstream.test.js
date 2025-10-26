import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

describe('POST /v1/messages (GLM Anthropic native non-streaming)', () => {
  it('passes through Anthropic payload and uses x-api-key auth', async () => {
    const upstreamResponse = {
      id: 'msg_glm_test',
      type: 'message',
      role: 'assistant',
      model: 'glm-4-plus',
      stop_reason: 'end_turn',
      content: [
        { type: 'text', text: 'Hello from GLM Anthropic-native upstream.' }
      ],
      usage: { input_tokens: 12, output_tokens: 5 }
    }

    const upstream = await startUpstreamMock({
      mode: 'json',
      endpoint: 'anthropic',
      jsonResponse: upstreamResponse
    })
    const proxyPort = 3213
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: {
        FORCE_PROVIDER: 'glm',
        ZAI_API_KEY: 'test-glm-key',
        ANTHROPIC_VERSION: '2023-06-01'
      },
      isolateEnv: true
    })

    const anthropicRequest = {
      model: 'glm-4-plus',
      stream: false,
      system: [{ type: 'text', text: 'You are a helpful assistant.' }],
      messages: [
        {
          role: 'user',
          content: [{ type: 'text', text: 'Say hello' }]
        }
      ],
      tool_choice: 'auto'
    }

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send(anthropicRequest)
        .expect(200)

      expect(res.body).toEqual(upstreamResponse)

      const receivedHeaders = upstream.received.headers
      expect(receivedHeaders['x-api-key']).toBe('test-glm-key')
      expect(receivedHeaders['authorization']).toBeUndefined()
      expect(receivedHeaders['anthropic-version']).toBe('2023-06-01')

      const parsedBody = JSON.parse(upstream.received.body)
      expect(parsedBody.messages[0].content[0].type).toBe('text')
      expect(parsedBody.messages[0].content[0].text).toBe('Say hello')
      expect(parsedBody.tools).toBeUndefined()
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })
})
