import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

describe('Model selection', () => {
  it('uses model from payload when specified', async () => {
    const upstream = await startUpstreamMock({ mode: 'json' })
    const proxyPort = 3201
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: { 
        CUSTOM_API_KEY: 'testkey',
        REASONING_MODEL: 'google/gemini-2.0-pro-exp-02-05:free',
        COMPLETION_MODEL: 'google/gemini-2.0-pro-exp-02-05:free'
      },
    })

    try {
      await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send({ 
          model: 'qwen/qwen3-coder:free',
          messages: [{ role: 'user', content: 'Say hi' }], 
          stream: false 
        })
        .expect(200)

      const upstreamPayload = JSON.parse(upstream.received.body)
      expect(upstreamPayload.model).toBe('qwen/qwen3-coder:free')
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })

  it('falls back to REASONING_MODEL when thinking is true and no model specified', async () => {
    const upstream = await startUpstreamMock({ mode: 'json' })
    const proxyPort = 3202
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: { 
        CUSTOM_API_KEY: 'testkey',
        REASONING_MODEL: 'openai/o1-mini',
        COMPLETION_MODEL: 'google/gemini-2.0-pro-exp-02-05:free'
      },
    })

    try {
      await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send({ 
          thinking: true,
          messages: [{ role: 'user', content: 'Say hi' }], 
          stream: false 
        })
        .expect(200)

      const upstreamPayload = JSON.parse(upstream.received.body)
      expect(upstreamPayload.model).toBe('openai/o1-mini')
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })

  it('falls back to COMPLETION_MODEL when no model specified and thinking is false', async () => {
    const upstream = await startUpstreamMock({ mode: 'json' })
    const proxyPort = 3203
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: { 
        CUSTOM_API_KEY: 'testkey',
        REASONING_MODEL: 'openai/o1-mini',
        COMPLETION_MODEL: 'deepseek/deepseek-chat-v3.1:free'
      },
    })

    try {
      await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send({ 
          messages: [{ role: 'user', content: 'Say hi' }], 
          stream: false 
        })
        .expect(200)

      const upstreamPayload = JSON.parse(upstream.received.body)
      expect(upstreamPayload.model).toBe('deepseek/deepseek-chat-v3.1:free')
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })

  it('uses hardcoded default when no model or env vars specified', async () => {
    const upstream = await startUpstreamMock({ mode: 'json' })
    const proxyPort = 3204
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: { 
        CUSTOM_API_KEY: 'testkey'
      },
      isolateEnv: true
    })

    try {
      await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send({ 
          messages: [{ role: 'user', content: 'Say hi' }], 
          stream: false 
        })
        .expect(200)

      const upstreamPayload = JSON.parse(upstream.received.body)
      expect(upstreamPayload.model).toBe('google/gemini-2.0-pro-exp-02-05:free')
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })

  it('explicit model takes precedence over thinking flag', async () => {
    const upstream = await startUpstreamMock({ mode: 'json' })
    const proxyPort = 3205
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: { 
        CUSTOM_API_KEY: 'testkey',
        REASONING_MODEL: 'openai/o1-mini',
        COMPLETION_MODEL: 'google/gemini-2.0-pro-exp-02-05:free'
      },
    })

    try {
      await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send({ 
          model: 'qwen/qwen3-coder:free',
          thinking: true,
          messages: [{ role: 'user', content: 'Say hi' }], 
          stream: false 
        })
        .expect(200)

      const upstreamPayload = JSON.parse(upstream.received.body)
      expect(upstreamPayload.model).toBe('qwen/qwen3-coder:free')
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })
})
