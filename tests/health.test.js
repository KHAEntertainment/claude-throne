import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild, findAvailablePort } from './utils.js'

describe('Health endpoint', () => {
  it.each([
    { override: 'anthropic', expectedKind: 'anthropic-native', upstreamEndpoint: 'anthropic' },
    { override: 'openai', expectedKind: 'openai-compatible', upstreamEndpoint: 'openai' },
  ])('returns detectionSource=override and endpointKind=$expectedKind when CUSTOM_ENDPOINT_OVERRIDES is set to $override', async ({ override, expectedKind, upstreamEndpoint }) => {
    const upstream = await startUpstreamMock({ mode: 'json', endpoint: upstreamEndpoint })
    const proxyPort = await findAvailablePort()
    const baseUrl = `http://127.0.0.1:${upstream.port}`
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl,
      env: {
        CUSTOM_ENDPOINT_OVERRIDES: JSON.stringify({ [baseUrl]: override }),
        FORCE_PROVIDER: 'custom',
        CUSTOM_API_KEY: 'test-key'
      },
      isolateEnv: true
    })

    try {
      const res = await request(`http://127.0.0.1:${proxyPort}`)
        .get('/health')
        .expect(200)
      
      expect(res.body.endpointKind).toBe(expectedKind)
      expect(res.body.detectionSource).toBe('override')
      expect(res.body.baseUrl).toBe(baseUrl)
    } finally {
      await stopChild(child)
      await new Promise((resolve) => {
        upstream.server.close(() => resolve())
      })
    }
  })
})

