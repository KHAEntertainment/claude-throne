#!/usr/bin/env node
import Fastify from 'fastify'
import { TextDecoder } from 'util'
import { detectProvider, resolveApiKey, providerSpecificHeaders } from './key-resolver.js'
import { normalizeContent, removeUriFormat } from './transform.js'

const baseUrl = process.env.ANTHROPIC_PROXY_BASE_URL || 'https://openrouter.ai/api'
const provider = detectProvider(baseUrl)
const key = resolveApiKey(provider)
const model = 'google/gemini-2.0-pro-exp-02-05:free'
const models = {
  reasoning: process.env.REASONING_MODEL || model,
  completion: process.env.COMPLETION_MODEL || model,
}

// Startup diagnostics
console.log('[Startup] Claude Throne Proxy initializing...')
console.log('[Startup] Configuration:')
console.log(`[Startup] - Provider: ${provider}`)
console.log(`[Startup] - Base URL: ${baseUrl}`)
console.log(`[Startup] - Reasoning Model: ${models.reasoning}`)
console.log(`[Startup] - Completion Model: ${models.completion}`)
console.log(`[Startup] - API Key: ${key ? 'present' : 'MISSING'}`)
console.log(`[Startup] - Debug Mode: ${process.env.DEBUG ? 'enabled' : 'disabled'}`)
if (models.reasoning !== models.completion) {
  console.log('[Startup] - Two-model mode detected')
} else {
  console.log('[Startup] - Single-model mode')
}

const fastify = Fastify({
  logger: true
})
function debug(...args) {
  if (!process.env.DEBUG) return
  console.log(...args)
}

// Helper to roughly count tokens; tolerates undefined/null.
function countTokens(text) {
  if (typeof text !== 'string' || !text) {
    return 0;
  }
  return text.split(' ').length;
}

// Safe word count for usage fallback
const safeWords = (v) => typeof v === 'string' ? v.split(/\s+/).filter(Boolean).length : 0;

// Helper function to send SSE events and flush immediately.
const sendSSE = (reply, event, data) => {
  const sseMessage = `event: ${event}\n` +
                     `data: ${JSON.stringify(data)}\n\n`
  reply.raw.write(sseMessage)
  // Flush if the flush method is available.
  if (typeof reply.raw.flush === 'function') {
    reply.raw.flush()
  }
}

function mapStopReason(finishReason) {
  switch (finishReason) {
    case 'tool_calls': return 'tool_use'
    case 'stop': return 'end_turn'
    case 'length': return 'max_tokens'
    case 'content_filter': return 'content_filter'
    default: return 'end_turn'
  }
}

fastify.get('/v1/models', async (request, reply) => {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...providerSpecificHeaders(provider)
    }
    if (key) headers['Authorization'] = `Bearer ${key}`

    const resp = await fetch(`${baseUrl}/v1/models`, { method: 'GET', headers })
    const text = await resp.text()
    reply.code(resp.status)
    // Pass-through upstream JSON as-is; many clients expect OpenAI-style { data: [...] }
    try {
      reply.type('application/json').send(JSON.parse(text))
    } catch {
      reply.type('application/json').send({ error: text })
    }
  } catch (err) {
    reply.code(500).send({ error: String(err?.message || err) })
  }
})

fastify.get('/healthz', async (request, reply) => {
    return {
        status: 'ok',
        version: '1.4.11',
        provider,
        baseUrl,
        models,
    }
})

fastify.get('/health', async (request, reply) => {
    return {
        status: 'healthy',
        provider,
        baseUrl,
        hasApiKey: !!key,
        models: {
            reasoning: models.reasoning || 'not set',
            completion: models.completion || 'not set'
        },
        timestamp: Date.now(),
        uptime: process.uptime()
    }
});

fastify.post('/v1/debug/echo', async (request, reply) => {
  try {
    const payload = request.body



    const messages = []
    if (payload.system && Array.isArray(payload.system)) {
      payload.system.forEach(sysMsg => {
        const normalized = normalizeContent(sysMsg.text || sysMsg.content)
        if (normalized) {
          messages.push({
            role: 'system',
            content: normalized
          })
        }
      })
    }
    if (payload.messages && Array.isArray(payload.messages)) {
      payload.messages.forEach(msg => {
        const items = Array.isArray(msg.content) ? msg.content : []
        const toolUseItems = items.filter(item => item.type === 'tool_use')
        const toolResultItems = items.filter(item => item.type === 'tool_result')

        const normalized = normalizeContent(msg.content)
        const newMsg = { role: msg.role }
        if (normalized) newMsg.content = normalized

        if (msg.role === 'assistant' && toolUseItems.length > 0) {
          newMsg.tool_calls = toolUseItems.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input ?? {}),
            },
          }))
        }

        if (newMsg.content || newMsg.tool_calls) {
          messages.push(newMsg)
        }

        if (toolResultItems.length > 0) {
          toolResultItems.forEach(tr => {
            messages.push({
              role: 'tool',
              content: typeof tr.text === 'string' ? tr.text : (tr.content ?? ''),
              tool_call_id: tr.tool_use_id,
            })
          })
        }
      })
    }



    const tools = (payload.tools || []).filter(tool => !['BatchTool'].includes(tool.name)).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: removeUriFormat(tool.input_schema),
      },
    }))

    const selectedModel = payload.model 
      || (payload.thinking ? models.reasoning : models.completion)

    const openaiPayload = {
      model: selectedModel,
      messages,
      max_tokens: payload.max_tokens,
      temperature: payload.temperature !== undefined ? payload.temperature : 1,
      stream: payload.stream === true,
    }
    if (tools.length > 0) openaiPayload.tools = tools

    const headers = {
      'Content-Type': 'application/json',
      ...providerSpecificHeaders(provider)
    }
    if (key) {
      headers['Authorization'] = 'Bearer ***REDACTED***'
    }

    return {
      debug: true,
      modelSelection: {
        requestedModel: payload.model || null,
        selectedModel,
        reasoningModel: models.reasoning,
        completionModel: models.completion,
        wasOverridden: !payload.model,
        thinking: payload.thinking || false
      },
      configuration: {
        provider,
        baseUrl,
        hasApiKey: !!key
      },
      headers,
      openaiPayload
    }
  } catch (err) {
    console.error(err)
    reply.code(500)
    return { error: err.message }
  }
})

fastify.post('/v1/messages', async (request, reply) => {
  try {
    const payload = request.body



    // Build messages array for the OpenAI payload.
    // Start with system messages if provided.
    const messages = []
    if (payload.system && Array.isArray(payload.system)) {
      payload.system.forEach(sysMsg => {
        const normalized = normalizeContent(sysMsg.text || sysMsg.content)
        if (normalized) {
          messages.push({
            role: 'system',
            content: normalized
          })
        }
      })
    }
    // Then add user (or other) messages.
    if (payload.messages && Array.isArray(payload.messages)) {
      payload.messages.forEach(msg => {
        const items = Array.isArray(msg.content) ? msg.content : []
        const toolUseItems = items.filter(item => item.type === 'tool_use')
        const toolResultItems = items.filter(item => item.type === 'tool_result')

        // Build the base message for this turn
        const normalized = normalizeContent(msg.content)
        const newMsg = { role: msg.role }
        if (normalized) newMsg.content = normalized

        // If the assistant message contained tool calls previously, include them
        if (msg.role === 'assistant' && toolUseItems.length > 0) {
          newMsg.tool_calls = toolUseItems.map(tc => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.input ?? {}),
            },
          }))
        }

        if (newMsg.content || newMsg.tool_calls) {
          messages.push(newMsg)
        }

        // Append tool results as separate tool role messages
        if (toolResultItems.length > 0) {
          toolResultItems.forEach(tr => {
            messages.push({
              role: 'tool',
              content: typeof tr.text === 'string' ? tr.text : (tr.content ?? ''),
              tool_call_id: tr.tool_use_id,
            })
          })
        }
      })
    }



    const tools = (payload.tools || []).filter(tool => !['BatchTool'].includes(tool.name)).map(tool => ({
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: removeUriFormat(tool.input_schema),
      },
    }))
    const selectedModel = payload.model 
      || (payload.thinking ? models.reasoning : models.completion)
    
    // Enhanced model selection logging
    const modelSource = payload.model ? 'explicit request' 
      : (payload.thinking ? 'REASONING_MODEL env var' : 'COMPLETION_MODEL env var')
    
    debug('Model selection:', {
      requestedModel: payload.model || 'none',
      selectedModel,
      source: modelSource,
      reasoning: models.reasoning,
      completion: models.completion,
      wasOverridden: !payload.model,
      thinking: payload.thinking || false
    })
    
    // Log model selection even without DEBUG for troubleshooting
    if (!payload.model) {
      console.log(`[Model] Auto-selected ${selectedModel} (${modelSource})`)
    } else {
      console.log(`[Model] Using requested model: ${selectedModel}`)
    }

    const openaiPayload = {
      model: selectedModel,
      messages,
      max_tokens: payload.max_tokens,
      temperature: payload.temperature !== undefined ? payload.temperature : 1,
      stream: payload.stream === true,
    }
    if (tools.length > 0) openaiPayload.tools = tools
    debug('OpenAI payload:', openaiPayload)

    // Build headers
    const headers = {
      'Content-Type': 'application/json',
      ...providerSpecificHeaders(provider)
    }

    if (key) {
      headers['Authorization'] = `Bearer ${key}`
    }

    // Validate configuration early
    debug('API key check:', { provider, hasKey: !!key })
    if (!key) {
      debug('No API key found, returning 400')
      reply.code(400)
      return {
        error: `No API key found for provider "${provider}". Checked CUSTOM_API_KEY, API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, TOGETHER_API_KEY, GROQ_API_KEY.`,
      }
    }
    
    const requestStartMs = Date.now()
    let firstChunkLogged = false
    let ttfbMs = null
    
    console.log(`[Request] Starting request to ${baseUrl}/v1/chat/completions`)
    console.log(`[Request] Model: ${openaiPayload.model}, Streaming: ${openaiPayload.stream}`)
    console.log(`[Request] Messages: ${messages.length}, Tools: ${tools.length}`)
    console.log(`[Request] Max tokens: ${openaiPayload.max_tokens || 'default'}, Temperature: ${openaiPayload.temperature}`)
    
    const openaiResponse = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(openaiPayload)
    });
    const elapsedMs = Date.now() - requestStartMs
    
    console.log(`[Timing] Request completed in ${elapsedMs}ms (HTTP ${openaiResponse.status})`)

    if (!openaiResponse.ok) {
      const errorDetails = await openaiResponse.text()
      debug('OpenRouter error response:', {
        status: openaiResponse.status,
        statusText: openaiResponse.statusText,
        baseUrl,
        requestedModel: payload.model,
        selectedModel: openaiPayload.model,
        elapsedMs,
        errorBody: errorDetails
      })
      
      reply.code(openaiResponse.status)
      
      // Attempt to parse error details as JSON
      try {
        const errorJson = JSON.parse(errorDetails)
        debug('Parsed error JSON:', errorJson)
        return errorJson
      } catch {
        debug('Error response was not valid JSON, returning string wrapper')
        return { error: errorDetails }
      }
    }
    
    debug('OpenRouter response timing:', { baseUrl, elapsedMs, status: openaiResponse.status })

    // If stream is not enabled, process the complete response.
    if (!openaiPayload.stream) {
      const data = await openaiResponse.json()
      debug('OpenAI response:', data)
      
      // Log token usage and timing for non-streaming
      const inputTokens = data.usage?.prompt_tokens || 0
      const outputTokens = data.usage?.completion_tokens || 0
      const totalTokens = inputTokens + outputTokens
      console.log(`[Tokens] Input: ${inputTokens}, Output: ${outputTokens}, Total: ${totalTokens}`)
      console.log(`[Timing] Total request time: ${elapsedMs}ms (${(outputTokens / (elapsedMs / 1000)).toFixed(1)} tokens/sec)`)
      
      if (data.error) {
        throw new Error(data.error.message)
      }


      const choice = data.choices[0]
      const openaiMessage = choice.message

      // Map finish_reason to anthropic stop_reason.
      const stopReason = mapStopReason(choice.finish_reason)
      const toolCalls = openaiMessage.tool_calls || []

      // Create a message id; if available, replace prefix, otherwise generate one.
      const messageId = data.id
        ? data.id.replace('chatcmpl', 'msg')
        : 'msg_' + Math.random().toString(36).substr(2, 24)

      const anthropicResponse = {
        content: [
          {
            text: openaiMessage.content,
            type: 'text'
          },
          ...toolCalls.map(toolCall => ({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.function.name,
            input: JSON.parse(toolCall.function.arguments),
          })),
        ],
        id: messageId,
        model: openaiPayload.model,
        role: openaiMessage.role,
        stop_reason: stopReason,
        stop_sequence: null,
        type: 'message',
        usage: {
          input_tokens: data.usage
            ? data.usage.prompt_tokens
            : messages.reduce((acc, msg) => acc + safeWords(msg.content), 0),
          output_tokens: data.usage
            ? data.usage.completion_tokens
            : safeWords(openaiMessage.content),
        }
      }

      return anthropicResponse
    }


    let isSucceeded = false
    function sendSuccessMessage() {
      if (isSucceeded) return
      isSucceeded = true

      // Streaming response using Server-Sent Events.
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive'
      })

      // Create a unique message id.
      const messageId = 'msg_' + Math.random().toString(36).substr(2, 24)

      // Send initial SSE event for message start.
      sendSSE(reply, 'message_start', {
        type: 'message_start',
        message: {
          id: messageId,
          type: 'message',
          role: 'assistant',
          model: openaiPayload.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 0, output_tokens: 0 },
        }
      })

      // Send initial ping.
      sendSSE(reply, 'ping', { type: 'ping' })
    }

    // Prepare for reading streamed data.
    let accumulatedContent = ''
    let accumulatedReasoning = ''
    let usage = null
    let textBlockStarted = false
    let encounteredToolCall = false
    const toolCallAccumulators = {}  // key: tool call index, value: accumulated arguments string
    const decoder = new TextDecoder('utf-8')
    const reader = openaiResponse.body.getReader()
    let done = false

    while (!done) {
      const { value, done: doneReading } = await reader.read()
      done = doneReading
      if (value) {
        const chunk = decoder.decode(value)
        
        // Track first-byte timing
        if (!firstChunkLogged && chunk.trim()) {
          ttfbMs = Date.now() - requestStartMs
          debug('Streaming first-byte timing:', { ttfbMs, chunkLength: chunk.length })
          firstChunkLogged = true
        }
        
        // Log chunks only if DEBUG_CHUNKS is enabled
        if (process.env.DEBUG_CHUNKS) {
          debug('OpenAI response chunk:', chunk)
        }
        // OpenAI streaming responses are typically sent as lines prefixed with "data: "
        const lines = chunk.split('\n')


        for (const line of lines) {
          const trimmed = line.trim()
          if (trimmed === '' || !trimmed.startsWith('data:')) continue
          const dataStr = trimmed.replace(/^data:\s*/, '')
          if (dataStr === '[DONE]') {
            const totalStreamMs = Date.now() - requestStartMs
            debug('Streaming completion timing:', { 
              totalStreamMs, 
              ttfbMs, 
              totalResponseTime: totalStreamMs,
              serverProcessingMs: ttfbMs ? ttfbMs - elapsedMs : null
            })
            // Finalize the stream with stop events.
            if (encounteredToolCall) {
              for (const idx in toolCallAccumulators) {
                sendSSE(reply, 'content_block_stop', {
                  type: 'content_block_stop',
                  index: parseInt(idx, 10)
                })
              }
            } else if (textBlockStarted) {
              sendSSE(reply, 'content_block_stop', {
                type: 'content_block_stop',
                index: 0
              })
            }
            sendSSE(reply, 'message_delta', {
              type: 'message_delta',
              delta: {
                stop_reason: encounteredToolCall ? 'tool_use' : 'end_turn',
                stop_sequence: null
              },
              usage: usage
                ? { output_tokens: usage.completion_tokens }
                : { output_tokens: safeWords(accumulatedContent) + safeWords(accumulatedReasoning) }
            })
            sendSSE(reply, 'message_stop', {
              type: 'message_stop'
            })
            reply.raw.end()
            return
          }

          const parsed = JSON.parse(dataStr)
          if (parsed.error) {
            throw new Error(parsed.error.message)
          }
          sendSuccessMessage()
          // Capture usage if available.
          if (parsed.usage) {
            usage = parsed.usage
          }
          const delta = parsed.choices[0].delta
          if (delta && delta.tool_calls) {
            for (const toolCall of delta.tool_calls) {
              encounteredToolCall = true
              const idx = toolCall.index
              if (toolCallAccumulators[idx] === undefined) {
                toolCallAccumulators[idx] = ""
                sendSSE(reply, 'content_block_start', {
                  type: 'content_block_start',
                  index: idx,
                  content_block: {
                    type: 'tool_use',
                    id: toolCall.id,
                    name: toolCall.function.name,
                    input: {}
                  }
                })
              }
              const newArgs = toolCall.function.arguments || ""
              const oldArgs = toolCallAccumulators[idx]
              if (newArgs.length > oldArgs.length) {
                const deltaText = newArgs.substring(oldArgs.length)
                sendSSE(reply, 'content_block_delta', {
                  type: 'content_block_delta',
                  index: idx,
                  delta: {
                    type: 'input_json_delta',
                    partial_json: deltaText
                  }
                })
                toolCallAccumulators[idx] = newArgs
              }
            }
          } else if (delta && delta.content) {
            if (!textBlockStarted) {
              textBlockStarted = true
              sendSSE(reply, 'content_block_start', {
                type: 'content_block_start',
                index: 0,
                content_block: {
                  type: 'text',
                  text: ''
                }
              })
            }
            accumulatedContent += delta.content
            sendSSE(reply, 'content_block_delta', {
              type: 'content_block_delta',
              index: 0,
              delta: {
                type: 'text_delta',
                text: delta.content
              }
            })
          } else if (delta && delta.reasoning) {
            if (!textBlockStarted) {
              textBlockStarted = true
              sendSSE(reply, 'content_block_start', {
                type: 'content_block_start',
                index: 0,
                content_block: {
                  type: 'text',
                  text: ''
                }
              })
            }
            accumulatedReasoning += delta.reasoning
            sendSSE(reply, 'content_block_delta', {
              type: 'content_block_delta',
              index: 0,
              delta: {
                type: 'thinking_delta',
                thinking: delta.reasoning
              }
            })
          }
        }
      }
    }

    reply.raw.end()
  } catch (err) {
    console.error(err)
    reply.code(500)
    return { error: err.message }
  }
})

const start = async () => {
  try {
    const portArg = process.argv.indexOf('--port');
    const port = portArg > -1 ? parseInt(process.argv[portArg + 1], 10) : (process.env.PORT || 3000);
    await fastify.listen({ port });
  } catch (err) {
    process.exit(1);
  }
}

start()
