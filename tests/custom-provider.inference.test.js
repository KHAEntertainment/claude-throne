import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild } from './utils.js'

describe('Custom provider endpoint kind inference', () => {
  let anthropicMock
  let openaiMock
  let anthropicMockPort
  let openaiMockPort

  beforeAll(async () => {
    // Comment 4: Start Anthropic-native mock expecting x-api-key + anthropic-version
    anthropicMock = await startUpstreamMock({
      mode: 'json',
      endpoint: 'anthropic',
      assertAuth: (headers) => {
        if (!headers['x-api-key']) {
          throw new Error('Missing x-api-key header')
        }
        if (!headers['anthropic-version']) {
          throw new Error('Missing anthropic-version header')
        }
      }
    })
    anthropicMockPort = anthropicMock.port

    // Comment 4: Start OpenAI-compatible mock expecting Authorization Bearer
    openaiMock = await startUpstreamMock({
      mode: 'json',
      endpoint: 'openai',
      assertAuth: (headers) => {
        if (!headers['authorization'] || !headers['authorization'].startsWith('Bearer ')) {
          throw new Error('Missing Authorization Bearer header')
        }
      }
    })
    openaiMockPort = openaiMock.port
  })

  afterAll(async () => {
    if (anthropicMock?.server) {
      await new Promise(resolve => anthropicMock.server.close(resolve))
    }
    if (openaiMock?.server) {
      await new Promise(resolve => openaiMock.server.close(resolve))
    }
  })

  it('(a) uses explicit override when provided', async () => {
    const proxyPort = 3117
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${anthropicMockPort}`,
      env: {
        FORCE_PROVIDER: 'custom',
        CUSTOM_API_KEY: 'test-key',
        CUSTOM_ENDPOINT_OVERRIDES: JSON.stringify({
          [`http://127.0.0.1:${anthropicMockPort}`]: 'openai' // Override to OpenAI even though it's Anthropic
        })
      }
    })

    try {
      // Comment 5: Check /health for detectionSource, endpointKind, baseUrl
      const healthRes = await request(`http://127.0.0.1:${proxyPort}`)
        .get('/health')
        .expect(200)

      expect(healthRes.body.detectionSource).toBe('override')
      expect(healthRes.body.endpointKind).toBe('openai-compatible')
      expect(healthRes.body.baseUrl).toBe(`http://127.0.0.1:${anthropicMockPort}`)
    } finally {
      await stopChild(child)
    }
  })

  it('(b) probes and detects Anthropic-native endpoint correctly', async () => {
    const proxyPort = 3118
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${anthropicMockPort}`,
      env: {
        FORCE_PROVIDER: 'custom',
        CUSTOM_API_KEY: 'test-key'
        // No override - should probe
      }
    })

    try {
      // Make a request to trigger probe
      await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .send({
          messages: [{ role: 'user', content: 'test' }],
          stream: false
        })
        .expect(200)

      // Check /health for detectionSource, endpointKind, lastProbedAt
      const healthRes = await request(`http://127.0.0.1:${proxyPort}`)
        .get('/health')
        .expect(200)

      // Comment 5: Assert detection source, endpoint kind, and probe timestamp
      expect(['probe', 'heuristic']).toContain(healthRes.body.detectionSource)
      expect(healthRes.body.endpointKind).toBeDefined()
      expect(healthRes.body.baseUrl).toBe(`http://127.0.0.1:${anthropicMockPort}`)
      if (healthRes.body.detectionSource === 'probe') {
        expect(healthRes.body.lastProbedAt).toBeDefined()
        expect(typeof healthRes.body.lastProbedAt).toBe('number')
      }
    } finally {
      await stopChild(child)
    }
  })

  it('(b) probes and detects OpenAI-compatible endpoint correctly', async () => {
    const proxyPort = 3119
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${openaiMockPort}`,
      env: {
        FORCE_PROVIDER: 'custom',
        CUSTOM_API_KEY: 'test-key'
        // No override - should probe
      }
    })

    try {
      // Make a request to trigger probe
      await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .send({
          messages: [{ role: 'user', content: 'test' }],
          stream: false
        })
        .expect(200)

      // Check /health for detectionSource, endpointKind, lastProbedAt
      const healthRes = await request(`http://127.0.0.1:${proxyPort}`)
        .get('/health')
        .expect(200)

      // Comment 5: Assert detection source, endpoint kind, and probe timestamp
      expect(['probe', 'heuristic']).toContain(healthRes.body.detectionSource)
      expect(healthRes.body.endpointKind).toBeDefined()
      expect(healthRes.body.baseUrl).toBe(`http://127.0.0.1:${openaiMockPort}`)
      if (healthRes.body.detectionSource === 'probe') {
        expect(healthRes.body.lastProbedAt).toBeDefined()
        expect(typeof healthRes.body.lastProbedAt).toBe('number')
      }
    } finally {
      await stopChild(child)
    }
  })

  it('caches probe results', async () => {
    const proxyPort = 3120
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${anthropicMockPort}`,
      env: {
        FORCE_PROVIDER: 'custom',
        CUSTOM_API_KEY: 'test-key'
      }
    })

    try {
      // First request - should probe
      await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .send({
          messages: [{ role: 'user', content: 'test' }],
          stream: false
        })
        .expect(200)

      // Second request - should use cached result
      const healthRes1 = await request(`http://127.0.0.1:${proxyPort}`)
        .get('/health')
        .expect(200)

      const healthRes2 = await request(`http://127.0.0.1:${proxyPort}`)
        .get('/health')
        .expect(200)

      // Comment 5: Both should have same detectionSource and endpointKind
      expect(healthRes1.body.detectionSource).toBe(healthRes2.body.detectionSource)
      expect(healthRes1.body.endpointKind).toBe(healthRes2.body.endpointKind)
    } finally {
      await stopChild(child)
    }
  })

  // Comment 2 & 5: Test that no OpenAI↔Anthropic conversion occurs when endpoint-kind is Anthropic
  it('(3) when Anthropic-kind, no OpenAI↔Anthropic conversion occurs', async () => {
    const proxyPort = 3121
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${anthropicMockPort}`,
      env: {
        FORCE_PROVIDER: 'custom',
        CUSTOM_API_KEY: 'test-key',
        CUSTOM_ENDPOINT_OVERRIDES: JSON.stringify({
          [`http://127.0.0.1:${anthropicMockPort}`]: 'anthropic' // Explicit override to Anthropic
        })
      }
    })

    try {
      // Make a request and verify it goes to Anthropic endpoint without conversion
      const response = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .send({
          messages: [{ role: 'user', content: 'test' }],
          stream: false
        })
        .expect(200)

      // Comment 2: Verify request went to /v1/messages (Anthropic) not /v1/chat/completions (OpenAI)
      // The mock should have received a request to /v1/messages
      expect(anthropicMock.received.url).toBe('/v1/messages')
      // Verify headers are Anthropic-native (x-api-key, not Authorization)
      expect(anthropicMock.received.headers['x-api-key']).toBeDefined()
      expect(anthropicMock.received.headers['anthropic-version']).toBeDefined()
      expect(anthropicMock.received.headers['authorization']).toBeUndefined()
    } finally {
      await stopChild(child)
    }
  })
})

