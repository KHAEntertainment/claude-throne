/**
 * Integration tests for transformer system
 * Tests transformers working with the full request/response pipeline
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest'
import { spawnProxyProcess, stopProxyProcess, findAvailablePort, startUpstreamMock } from './utils.js'

describe('Transformer integration tests', () => {
  let upstreamPort
  let upstreamServer
  let proxyPort
  let proxyProcess

  beforeAll(async () => {
    upstreamPort = await findAvailablePort()
    proxyPort = await findAvailablePort()
  })

  afterAll(async () => {
    if (upstreamServer) {
      upstreamServer.close()
    }
    if (proxyProcess) {
      await stopProxyProcess(proxyProcess)
    }
  })

  it('should apply tooluse transformer and set tool_choice', async () => {
    const mockResponse = {
      id: 'chatcmpl-test',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'I will use the test tool.',
            tool_calls: [
              {
                id: 'call_test',
                type: 'function',
                function: {
                  name: 'test_tool',
                  arguments: '{"param": "value"}'
                }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }

    const { received, close } = startUpstreamMock({
      mode: 'json',
      jsonResponse: mockResponse
    })

    upstreamServer = close

    await new Promise((resolve) => {
      close.listen(upstreamPort, '127.0.0.1', resolve)
    })

    // Start proxy with OpenRouter provider and a model that uses tooluse transformer
    proxyProcess = spawnProxyProcess({
      port: proxyPort,
      env: {
        ANTHROPIC_PROXY_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`,
        CUSTOM_API_KEY: 'test-key',
        REASONING_MODEL: 'inclusionai/ring-1t',
        COMPLETION_MODEL: 'inclusionai/ring-1t'
      }
    })

    // Wait for proxy to start
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Send request with tools
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': 'test-key'
      },
      body: JSON.stringify({
        model: 'inclusionai/ring-1t',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: 'Use the test tool'
          }
        ],
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            input_schema: {
              type: 'object',
              properties: {
                param: { type: 'string' }
              }
            }
          }
        ]
      })
    })

    expect(response.ok).toBe(true)
    const data = await response.json()

    // Verify the request sent to upstream had tool_choice set by tooluse transformer
    const sentBody = JSON.parse(received.body)
    expect(sentBody.tool_choice).toEqual({ type: 'auto' })

    // Verify response contains tool use
    expect(data.content).toBeDefined()
    const toolUse = data.content.find((block) => block.type === 'tool_use')
    expect(toolUse).toBeDefined()
    expect(toolUse.name).toBe('test_tool')
  })

  it('should apply reasoning transformer to streaming delta.reasoning', async () => {
    const sseChunks = [
      { choices: [{ delta: { role: 'assistant' }, index: 0 }] },
      { choices: [{ delta: { reasoning: 'Let me think step by step...' }, index: 0 }] },
      { choices: [{ delta: { content: 'The answer is 42.' }, index: 0 }] },
      { choices: [{ delta: {}, index: 0, finish_reason: 'stop' }] }
    ]

    const { received, close } = startUpstreamMock({
      mode: 'sse',
      sseChunks
    })

    upstreamServer = close

    await new Promise((resolve) => {
      close.listen(upstreamPort, '127.0.0.1', resolve)
    })

    // Start proxy with a reasoning model
    proxyProcess = spawnProxyProcess({
      port: proxyPort,
      env: {
        ANTHROPIC_PROXY_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`,
        CUSTOM_API_KEY: 'test-key',
        REASONING_MODEL: 'deepseek-reasoner',
        COMPLETION_MODEL: 'deepseek-reasoner'
      }
    })

    // Wait for proxy to start
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Send streaming request
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': 'test-key'
      },
      body: JSON.stringify({
        model: 'deepseek-reasoner',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: 'What is the answer?'
          }
        ],
        stream: true
      })
    })

    expect(response.ok).toBe(true)

    // Collect SSE events
    const events = []
    const text = await response.text()
    const lines = text.split('\n')
    
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        try {
          const data = JSON.parse(line.substring(6))
          events.push(data)
        } catch (e) {
          // Ignore parsing errors for [DONE] etc
        }
      }
    }

    // Verify reasoning was transformed to thinking_delta
    const thinkingDelta = events.find(
      (e) => e.type === 'content_block_delta' && e.delta?.type === 'thinking_delta'
    )
    expect(thinkingDelta).toBeDefined()
    expect(thinkingDelta.delta.thinking).toContain('think step by step')
  })

  it('should apply maxtoken transformer to enforce token limits', async () => {
    const mockResponse = {
      id: 'chatcmpl-test',
      choices: [
        {
          message: {
            role: 'assistant',
            content: 'Response within token limit'
          },
          finish_reason: 'stop'
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }

    const { received, close } = startUpstreamMock({
      mode: 'json',
      jsonResponse: mockResponse
    })

    upstreamServer = close

    await new Promise((resolve) => {
      close.listen(upstreamPort, '127.0.0.1', resolve)
    })

    // Start proxy with Deepseek provider and reasoner model (configured with maxtoken in capabilities)
    proxyProcess = spawnProxyProcess({
      port: proxyPort,
      env: {
        ANTHROPIC_PROXY_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`,
        CUSTOM_API_KEY: 'test-key',
        REASONING_MODEL: 'deepseek-reasoner',
        COMPLETION_MODEL: 'deepseek-reasoner'
      }
    })

    // Wait for proxy to start
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Send request without max_tokens - should be set by transformer
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': 'test-key'
      },
      body: JSON.stringify({
        model: 'deepseek-reasoner',
        messages: [
          {
            role: 'user',
            content: 'Hello'
          }
        ]
        // Note: no max_tokens specified
      })
    })

    expect(response.ok).toBe(true)

    // Verify the request sent to upstream had max_tokens set by maxtoken transformer
    const sentBody = JSON.parse(received.body)
    expect(sentBody.max_tokens).toBe(65536) // From models-capabilities.json config
  })

  it('should apply enhancetool transformer to repair malformed tool calls', async () => {
    const mockResponse = {
      id: 'chatcmpl-test',
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_test',
                type: 'function',
                function: {
                  name: 'test_tool',
                  // Malformed JSON arguments (invalid)
                  arguments: 'invalid json{'
                }
              }
            ]
          },
          finish_reason: 'tool_calls'
        }
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 }
    }

    const { received, close } = startUpstreamMock({
      mode: 'json',
      jsonResponse: mockResponse
    })

    upstreamServer = close

    await new Promise((resolve) => {
      close.listen(upstreamPort, '127.0.0.1', resolve)
    })

    // Start proxy with a model that uses enhancetool transformer
    proxyProcess = spawnProxyProcess({
      port: proxyPort,
      env: {
        ANTHROPIC_PROXY_BASE_URL: `http://127.0.0.1:${upstreamPort}/v1`,
        CUSTOM_API_KEY: 'test-key',
        REASONING_MODEL: 'inclusionai/ring-1t',
        COMPLETION_MODEL: 'inclusionai/ring-1t'
      }
    })

    // Wait for proxy to start
    await new Promise((resolve) => setTimeout(resolve, 2000))

    // Send request
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': 'test-key'
      },
      body: JSON.stringify({
        model: 'inclusionai/ring-1t',
        max_tokens: 1024,
        messages: [
          {
            role: 'user',
            content: 'Use the tool'
          }
        ],
        tools: [
          {
            name: 'test_tool',
            description: 'A test tool',
            input_schema: {
              type: 'object',
              properties: {}
            }
          }
        ]
      })
    })

    expect(response.ok).toBe(true)
    const data = await response.json()

    // Verify enhancetool transformer provided fallback for malformed input
    expect(data.content).toBeDefined()
    const toolUse = data.content.find((block) => block.type === 'tool_use')
    expect(toolUse).toBeDefined()
    expect(toolUse.input).toEqual({}) // Should be empty object fallback
  })
})
