import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

describe('Authentication headers', () => {
  it('uses Authorization bearer header for OpenAI-compatible endpoints', async () => {
    const upstream = await startUpstreamMock({ mode: 'json', endpoint: 'openai' })
    const proxyPort = 3213
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: {
        FORCE_PROVIDER: 'openai',
        OPENAI_API_KEY: 'openai-key'
      },
      isolateEnv: true
    })

    try {
      await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send({ messages: [{ role: 'user', content: 'hi' }], stream: false })
        .expect(200)

      const headers = upstream.received.headers
      expect(headers['authorization']).toBe('Bearer openai-key')
      expect(headers['x-api-key']).toBeUndefined()
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })

  it('uses x-api-key header for Anthropic-native endpoints', async () => {
    const upstream = await startUpstreamMock({ mode: 'json', endpoint: 'anthropic' })
    const proxyPort = 3214
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: {
        FORCE_PROVIDER: 'deepseek',
        DEEPSEEK_API_KEY: 'anth-key',
        ANTHROPIC_VERSION: '2023-06-01'
      },
      isolateEnv: true
    })

    try {
      await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send({ model: 'deepseek-v2', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], stream: false })
        .expect(200)

      const headers = upstream.received.headers
      expect(headers['x-api-key']).toBe('anth-key')
      expect(headers['authorization']).toBeUndefined()
      expect(headers['anthropic-version']).toBe('2023-06-01')
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })
})
