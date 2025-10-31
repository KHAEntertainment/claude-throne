import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

describe('Health endpoint', () => {
  it('returns detectionSource=override and endpointKind=anthropic-native when CUSTOM_ENDPOINT_OVERRIDES is set to anthropic', async () => {
    const upstream = await startUpstreamMock({ mode: 'json', endpoint: 'anthropic' })
    const proxyPort = 3217
    const baseUrl = `http://127.0.0.1:${upstream.port}`
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl,
      env: {
        CUSTOM_ENDPOINT_OVERRIDES: JSON.stringify({ [baseUrl]: 'anthropic' }),
        FORCE_PROVIDER: 'custom',
        CUSTOM_API_KEY: 'test-key'
      },
      isolateEnv: true
    })

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .get('/health')
        .expect(200)
      
      expect(res.body.endpointKind).toBe('anthropic-native')
      expect(res.body.detectionSource).toBe('override')
      expect(res.body.baseUrl).toBe(baseUrl)
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })

  it('returns detectionSource=override and endpointKind=openai-compatible when CUSTOM_ENDPOINT_OVERRIDES is set to openai', async () => {
    const upstream = await startUpstreamMock({ mode: 'json', endpoint: 'openai' })
    const proxyPort = 3218
    const baseUrl = `http://127.0.0.1:${upstream.port}`
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl,
      env: {
        CUSTOM_ENDPOINT_OVERRIDES: JSON.stringify({ [baseUrl]: 'openai' }),
        FORCE_PROVIDER: 'custom',
        CUSTOM_API_KEY: 'test-key'
      },
      isolateEnv: true
    })

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .get('/health')
        .expect(200)
      
      expect(res.body.endpointKind).toBe('openai-compatible')
      expect(res.body.detectionSource).toBe('override')
      expect(res.body.baseUrl).toBe(baseUrl)
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })
})

