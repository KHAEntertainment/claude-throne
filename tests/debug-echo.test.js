import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { spawnProxyProcess, stopChild } from './utils.js'

describe('POST /v1/debug/echo', () => {
  it('returns transformed payload without making API call', async () => {
    const proxyPort = 3301
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: 'http://127.0.0.1:9999',
      env: { CUSTOM_API_KEY: 'testkey' },
    })

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/debug/echo')
        .set('content-type', 'application/json')
        .send({
          model: 'qwen/qwen3-coder:free',
          messages: [{ role: 'user', content: 'Say hi' }],
          stream: false
        })
        .expect(200)

      expect(res.body.debug).toBe(true)
      expect(res.body.openaiPayload).toBeTruthy()
      expect(res.body.openaiPayload.model).toBe('qwen/qwen3-coder:free')
      expect(res.body.openaiPayload.messages).toHaveLength(1)
      expect(res.body.openaiPayload.messages[0].role).toBe('user')
      expect(res.body.openaiPayload.messages[0].content).toBe('Say hi')
    } finally {
      await stopChild(child)
    }
  })

  it('shows model resolution logic', async () => {
    const proxyPort = 3302
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: 'http://127.0.0.1:9999',
      env: { 
        CUSTOM_API_KEY: 'testkey',
        REASONING_MODEL: 'openai/o1-mini',
        COMPLETION_MODEL: 'google/gemini-2.0-pro-exp-02-05:free'
      },
    })

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/debug/echo')
        .set('content-type', 'application/json')
        .send({
          thinking: true,
          messages: [{ role: 'user', content: 'Think about this' }],
          stream: false
        })
        .expect(200)

      expect(res.body.modelSelection).toBeTruthy()
      expect(res.body.modelSelection.requestedModel).toBe(null)
      expect(res.body.modelSelection.selectedModel).toBe('openai/o1-mini')
      expect(res.body.modelSelection.reasoningModel).toBe('openai/o1-mini')
      expect(res.body.modelSelection.completionModel).toBe('google/gemini-2.0-pro-exp-02-05:free')
      expect(res.body.modelSelection.wasOverridden).toBe(true)
      expect(res.body.modelSelection.thinking).toBe(true)
    } finally {
      await stopChild(child)
    }
  })

  it('shows headers with redacted API key', async () => {
    const proxyPort = 3303
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: 'http://127.0.0.1:9999',
      env: { CUSTOM_API_KEY: 'secret-key-12345' },
    })

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/debug/echo')
        .set('content-type', 'application/json')
        .send({
          model: 'test-model',
          messages: [{ role: 'user', content: 'Test' }],
          stream: false
        })
        .expect(200)

      expect(res.body.headers).toBeTruthy()
      expect(res.body.headers['Content-Type']).toBe('application/json')
      expect(res.body.headers.Authorization).toBe('Bearer ***REDACTED***')
      expect(res.body.headers.Authorization).not.toContain('secret-key-12345')
    } finally {
      await stopChild(child)
    }
  })

  it('shows missing API key status', async () => {
    const proxyPort = 3304
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: 'http://127.0.0.1:9999',
      env: {},
      isolateEnv: true
    })

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/debug/echo')
        .set('content-type', 'application/json')
        .send({
          model: 'test-model',
          messages: [{ role: 'user', content: 'Test' }],
          stream: false
        })
        .expect(200)

      expect(res.body.configuration).toBeTruthy()
      expect(res.body.configuration.hasApiKey).toBe(false)
      expect(res.body.headers.Authorization).toBeUndefined()
    } finally {
      await stopChild(child)
    }
  })

  it('transforms tools properly', async () => {
    const proxyPort = 3305
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: 'http://127.0.0.1:9999',
      env: { CUSTOM_API_KEY: 'testkey' },
    })

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/debug/echo')
        .set('content-type', 'application/json')
        .send({
          model: 'test-model',
          messages: [{ role: 'user', content: 'Use a tool' }],
          tools: [
            {
              name: 'get_weather',
              description: 'Get the weather',
              input_schema: {
                type: 'object',
                properties: {
                  location: { type: 'string' }
                }
              }
            }
          ],
          stream: false
        })
        .expect(200)

      expect(res.body.openaiPayload.tools).toBeTruthy()
      expect(res.body.openaiPayload.tools).toHaveLength(1)
      expect(res.body.openaiPayload.tools[0].type).toBe('function')
      expect(res.body.openaiPayload.tools[0].function.name).toBe('get_weather')
      expect(res.body.openaiPayload.tools[0].function.description).toBe('Get the weather')
      expect(res.body.openaiPayload.tools[0].function.parameters).toBeTruthy()
    } finally {
      await stopChild(child)
    }
  })
})
