import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { startUpstreamMock, spawnProxyProcess, stopChild, findAvailablePort } from './utils.js'

describe('POST /v1/messages (OpenRouter tool unsupported fallback)', () => {
  it('strips tools and injects text instructions when model does not support tool calling', async () => {
    const upstream = await startUpstreamMock({ mode: 'json' })
    const proxyPort = await findAvailablePort()
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: { 
        OPENROUTER_API_KEY: 'testkey',
        COMPLETION_MODEL: 'google/gemini-2.0-pro-exp-02-05:free', // Model in toolCallUnsupported list
        FORCE_PROVIDER: 'openrouter'
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

})

describe('POST /v1/messages (OpenRouter tool style + fallback behavior)', () => {
  it('enables JSON tool calling for models flagged for json tool style', async () => {
    const upstream = await startUpstreamMock({ mode: 'json' })
    const proxyPort = await findAvailablePort()
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: {
        OPENROUTER_API_KEY: 'testkey',
        COMPLETION_MODEL: 'deepseek/deepseek-r1',
        FORCE_PROVIDER: 'openrouter'
      },
    })

    try {
      const payload = {
        messages: [
          { role: 'user', content: 'Call the calculator tool.' }
        ],
        tools: [
          {
            name: 'calculator',
            description: 'Performs arithmetic.',
            input_schema: {
              type: 'object',
              properties: {
                expression: { type: 'string' }
              }
            }
          }
        ],
        stream: false,
      }

      const response = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send(payload)
        .expect(200)

      const forwarded = JSON.parse(upstream.received.body)
      expect(forwarded).toBeTruthy()
      expect(forwarded.parallel_tool_calls).toBe(false)
      expect(Array.isArray(forwarded.tools)).toBe(true)
      // Comment 1: OpenRouter should receive string 'auto', not object { type: 'auto' }
      expect(forwarded.tool_choice).toBe('auto')
      expect(response.body.warnings).toBeUndefined()
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })

  it('normalizes tool_choice object { type: "auto" } to string "auto" for OpenRouter', async () => {
    const upstream = await startUpstreamMock({ mode: 'json' })
    const proxyPort = await findAvailablePort()
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: {
        OPENROUTER_API_KEY: 'testkey',
        COMPLETION_MODEL: 'anthropic/claude-3-5-sonnet',
        FORCE_PROVIDER: 'openrouter'
      },
    })

    try {
      const payload = {
        messages: [
          { role: 'user', content: 'Call a tool.' }
        ],
        tools: [
          {
            name: 'test_tool',
            description: 'Test tool',
            input_schema: {
              type: 'object',
              properties: {
                param: { type: 'string' }
              }
            }
          }
        ],
        tool_choice: { type: 'auto' }, // Send object format
        stream: false,
      }

      const response = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send(payload)
        .expect(200)

      const forwarded = JSON.parse(upstream.received.body)
      expect(forwarded).toBeTruthy()
      // Comment 6: OpenRouter should receive string 'auto', not object { type: 'auto' }
      expect(forwarded.tool_choice).toBe('auto')
      expect(typeof forwarded.tool_choice).toBe('string')
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })

  it('injects fallback text and warning when upstream response is empty', async () => {
    const upstream = await startUpstreamMock({
      mode: 'json',
      jsonResponse: {
        id: 'chatcmpl-empty',
        choices: [
          { message: { role: 'assistant', content: '' }, finish_reason: 'stop' }
        ],
        usage: { prompt_tokens: 1, completion_tokens: 0 }
      }
    })
    const proxyPort = await findAvailablePort()
    const child = await spawnProxyProcess({
      port: proxyPort,
      baseUrl: `http://127.0.0.1:${upstream.port}`,
      env: {
        OPENROUTER_API_KEY: 'testkey',
        COMPLETION_MODEL: 'anthropic/claude-3.7-sonnet:thinking',
        FORCE_PROVIDER: 'openrouter'
      },
    })

    try {
      const payload = {
        messages: [
          { role: 'user', content: 'Say hello' }
        ],
        stream: false,
      }

      const response = await request(`http://127.0.0.1:${proxyPort}`)
        .post('/v1/messages')
        .set('content-type', 'application/json')
        .send(payload)
        .expect(200)

      expect(Array.isArray(response.body.content)).toBe(true)
      const textBlock = response.body.content.find(block => block.type === 'text')
      expect(textBlock).toBeTruthy()
      expect(textBlock.text).toContain('Model response was empty')
      expect(response.body.warnings).toContain('Model response was empty and a placeholder message was inserted.')
    } finally {
      await stopChild(child)
      upstream.server.close()
    }
  })
})

