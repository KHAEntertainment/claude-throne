#!/usr/bin/env node
import Fastify from 'fastify'
import { TextDecoder } from 'util'
import { detectProvider, resolveApiKey, providerSpecificHeaders } from './key-resolver.js'
import { normalizeContent, removeUriFormat } from './transform.js'
import { injectXMLToolInstructions } from './xml-tool-formatter.js'
import { parseAssistantMessage } from './xml-tool-parser.js'

const baseUrl = process.env.ANTHROPIC_PROXY_BASE_URL || 'https://openrouter.ai/api'
const provider = detectProvider(baseUrl)
const key = resolveApiKey(provider)
const model = 'google/gemini-2.0-pro-exp-02-05:free'
const models = {
  reasoning: process.env.REASONING_MODEL || model,
  completion: process.env.COMPLETION_MODEL || model,
}

// Models that require XML tool calling (don't support native OpenAI tool format)
const MODELS_REQUIRING_XML_TOOLS = new Set([
  'inclusionai/ling-1t',
  'z-ai/glm-4.6',
  'z-ai/glm-4.5',
  'deepseek-v2',
  'deepseek-v3',
])

/**
 * Check if a model requires XML tool calling instead of native OpenAI format
 */
function modelNeedsXMLTools(modelName) {
  if (!modelName) return false
  const lowerModel = modelName.toLowerCase()
  for (const pattern of MODELS_REQUIRING_XML_TOOLS) {
    if (lowerModel.includes(pattern.toLowerCase())) {
      return true
    }
  }
  return false
}

/**
 * Parse native OpenAI tool response format (for models that support it)
 */
function parseNativeToolResponse(openaiMessage) {
  const blocks = []
  
  // Add text content if present
  if (openaiMessage.content) {
    blocks.push({
      type: 'text',
      text: openaiMessage.content
    })
  }
  
  // Add native tool calls if present
  if (openaiMessage.tool_calls && openaiMessage.tool_calls.length > 0) {
    openaiMessage.tool_calls.forEach(tc => {
      try {
        blocks.push({
          type: 'tool_use',
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments)
        })
      } catch (err) {
        console.warn('[Tool Parse] Failed to parse native tool call:', err)
      }
    })
  }
  
  // Return at least one block (empty text if nothing else)
  return blocks.length > 0 ? blocks : [{type: 'text', text: ''}]
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
  logger: {
    level: 'info',
    redact: {
      paths: [
        'req.headers.authorization',
        'req.body.system',
        'req.body.messages',
        'req.body.tools',
        'req.body.metadata',
        'res.headers["set-cookie"]'
      ],
      censor: '[REDACTED]'
    },
    serializers: {
      req(req) { 
        return { 
          id: req.id, 
          method: req.method, 
          url: req.url, 
          headers: { host: req.headers.host } 
        }; 
      },
      res(res) { 
        return { statusCode: res.statusCode }; 
      }
    }
  }
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

    const resp = await fetch(`${baseUrl}/v1/models`, { 
      method: 'GET', 
      headers
    })
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
        version: '1.4.19',
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
        hasApiKey: true, // Key is available from provider detection
        models: {
            reasoning: models.reasoning || 'not set',
            completion: models.completion || 'not set'
        },
        timestamp: Date.now(),
        uptime: process.uptime()
    }
});

fastify.post('/v1/messages/count_tokens', async (request, reply) => {
  try {
    const { messages, system, tools } = request.body
    
    let totalTokens = 0
    
    // Count system message
    if (system) {
      const systemText = Array.isArray(system) 
        ? system.map(s => s.text || s.content || '').join(' ')
        : (typeof system === 'string' ? system : '')
      totalTokens += Math.ceil(systemText.length / 4)
    }
    
    // Count messages
    if (messages && Array.isArray(messages)) {
      for (const msg of messages) {
        if (typeof msg.content === 'string') {
          totalTokens += Math.ceil(msg.content.length / 4)
        } else if (Array.isArray(msg.content)) {
          for (const block of msg.content) {
            if (block.type === 'text' && block.text) {
              totalTokens += Math.ceil(block.text.length / 4)
            } else if (block.type === 'tool_result' && block.content) {
              totalTokens += Math.ceil(block.content.length / 4)
            }
          }
        }
      }
    }
    
    // Count tools (rough estimate)
    if (tools && Array.isArray(tools)) {
      const toolsJson = JSON.stringify(tools)
      totalTokens += Math.ceil(toolsJson.length / 4)
    }
    
    return {
      input_tokens: totalTokens
    }
  } catch (err) {
    console.error('[count_tokens error]', err)
    reply.code(500)
    return { error: { message: err.message, type: 'internal_error' } }
  }
})

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

    // Conditionally inject XML tool instructions for models that need them
    const needsXMLTools = tools.length > 0 && modelNeedsXMLTools(selectedModel)
    const messagesWithXML = needsXMLTools
      ? injectXMLToolInstructions(messages, tools)
      : messages
    
    const openaiPayload = {
      model: selectedModel,
      messages: messagesWithXML,
      max_tokens: payload.max_tokens,
      temperature: payload.temperature !== undefined ? payload.temperature : 1,
      stream: payload.stream === true,
    }
    
    // Add native tools parameter for models that support it
    if (!needsXMLTools && tools.length > 0) {
      openaiPayload.tools = tools
    }

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

    // Conditionally inject XML tool instructions for models that need them
    const needsXMLTools = tools.length > 0 && modelNeedsXMLTools(selectedModel)
    const messagesWithXML = needsXMLTools
      ? injectXMLToolInstructions(messages, tools)
      : messages
    
    const openaiPayload = {
      model: selectedModel,
      messages: messagesWithXML,
      max_tokens: payload.max_tokens,
      temperature: payload.temperature !== undefined ? payload.temperature : 1,
      stream: payload.stream === true,
    }
    
    // Add native tools parameter for models that support it
    if (!needsXMLTools && tools.length > 0) {
      openaiPayload.tools = tools
    }
    
    debug('OpenAI payload:', openaiPayload)

    // Tool mode logging and detection
    if (tools.length > 0) {
      if (needsXMLTools) {
        console.log(`[Tool Mode] XML tool calling enabled for ${selectedModel}`)
        console.log(`[Tool Info] ${tools.length} tools available (XML format)`)
      } else {
        console.log(`[Tool Mode] Native tool calling for ${selectedModel}`)
        console.log(`[Tool Info] ${tools.length} tools available (native format)`)
      }
      
      // Warn about tool concurrency for models that may have issues
      if (tools.length > 1 && needsXMLTools) {
        const problematicModels = ['glm-4.6', 'glm-4.5', 'deepseek']
        const hasKnownIssue = problematicModels.some(m => selectedModel.includes(m))
        
        if (hasKnownIssue) {
          console.log(`[Tool Warning] Model ${selectedModel} may not support concurrent tool calls`)
          console.log(`[Tool Warning] Consider using Claude Haiku/Opus for tool-heavy tasks`)
        }
      }
    }

    // Build headers (let fetch handle connection management automatically)
    const headers = {
      'Content-Type': 'application/json',
      ...providerSpecificHeaders(provider)
    }

    if (key) {
      headers['Authorization'] = `Bearer ${key}`
    }

    // Validate configuration early
    if (!key) {
      reply.code(400)
      return {
        error: `No API key found for provider "${provider}". Checked CUSTOM_API_KEY, API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, TOGETHER_API_KEY, GROQ_API_KEY.`,
      }
    }
    
    const requestStartMs = Date.now()
    let firstChunkLogged = false
    let ttfbMs = null
    
    // Use different URL for z.ai passthrough mode
    const requestUrl = (provider === 'glm' && baseUrl.includes('api.z.ai/api/anthropic')) 
      ? `${baseUrl}/v1/messages` 
      : `${baseUrl}/v1/chat/completions`;
    
    console.log(`[Request] Starting request to ${requestUrl}`)
    
    // No timeout - let reasoning models take the time they need
    // System TCP timeout (75-120s) will handle truly hung connections
    
    const openaiResponse = await fetch(requestUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(openaiPayload)
    });
    
    const elapsedMs = Date.now() - requestStartMs
    
    console.log(`[Timing] Response received in ${elapsedMs}ms (HTTP ${openaiResponse.status})`)

    if (!openaiResponse.ok) {
      const errorDetails = await openaiResponse.text()
      
      // Parse error response
      let errorJson
      try {
        errorJson = JSON.parse(errorDetails)
      } catch {
        errorJson = { 
          error: { 
            message: errorDetails,
            type: 'upstream_error'
          } 
        }
      }
      
      // Enhanced logging for debugging (redacted)
      console.error('[OpenRouter Error]', {
        status: openaiResponse.status,
        model: '[REDACTED]',
        provider,
        messageCount: messages.length,
        toolCount: tools.length,
        error: errorJson.error?.message || errorDetails.substring(0, 200)
      })
      
      // Specific handling for common errors
      if (openaiResponse.status === 400) {
        console.error('[400 Bad Request Details]', {
          possibleCauses: [
            'Tool concurrency not supported by model',
            'Invalid tool schema',
            'Message format incompatibility',
            'Context length exceeded'
          ],
          suggestion: 'Try with fewer tools or different model'
        })
      }
      
      debug('OpenRouter error response:', {
        status: openaiResponse.status,
        statusText: openaiResponse.statusText,
        requestUrl,
        requestedModel: payload.model,
        selectedModel: openaiPayload.model,
        elapsedMs,
        errorBody: errorDetails
      })
      
      reply.code(openaiResponse.status)
      return errorJson
    }
    
    debug('OpenRouter response timing:', { requestUrl, elapsedMs, status: openaiResponse.status })

    // If stream is not enabled, process the complete response.
    if (!openaiPayload.stream) {
      const data = await openaiResponse.json()

      
      // Log token usage and timing for non-streaming
      const logInputTokens = data.usage?.prompt_tokens || 0
      const logOutputTokens = data.usage?.completion_tokens || 0
      const logTotalTokens = logInputTokens + logOutputTokens
      console.log(`[Tokens] Input: ${logInputTokens}, Output: ${logOutputTokens}, Total: ${logTotalTokens}`)
      console.log(`[Timing] Total request time: ${elapsedMs}ms (${(logOutputTokens / (elapsedMs / 1000)).toFixed(1)} tokens/sec)`)
      
      // Add context for slow responses (reasoning models)
      if (elapsedMs > 15000) {
        console.log(`[Info] Long response time is normal for reasoning models (thinking tokens, multi-step reasoning)`)
      }
      
      if (data.error) {
        throw new Error(data.error.message)
      }


      const choice = data.choices[0]
      const openaiMessage = choice.message

      // Map finish_reason to anthropic stop_reason.
      const stopReason = mapStopReason(choice.finish_reason)
      
      // Parse response based on tool mode (XML vs native)
      let contentBlocks = []
      try {
        if (needsXMLTools) {
          // Parse XML tool calls from response content

          contentBlocks = parseAssistantMessage(openaiMessage.content || '')

        } else {
          // Parse native OpenAI tool response format
          debug('Parsing native tool response')
          contentBlocks = parseNativeToolResponse(openaiMessage)

        }
      } catch (parseError) {

        // If parsing fails, create a simple text block with the raw content
        contentBlocks = [{
          type: 'text',
          text: openaiMessage.content || ''
        }]
      }

      // Ensure we have at least one content block
      if (!contentBlocks || contentBlocks.length === 0) {

        contentBlocks = [{
          type: 'text',
          text: openaiMessage.content || ''
        }]
      }

      // Create a message id; if available, replace prefix, otherwise generate one.
      const messageId = data.id
        ? data.id.replace('chatcmpl', 'msg')
        : 'msg_' + Math.random().toString(36).substr(2, 24)

      // Safe usage calculation with fallbacks
      const inputTokens = data.usage?.prompt_tokens || 
        messagesWithXML.reduce((acc, msg) => acc + safeWords(msg.content), 0)
      
      const outputTokens = data.usage?.completion_tokens || 
        safeWords(openaiMessage.content)

      const anthropicResponse = {
        content: contentBlocks,
        id: messageId,
        model: openaiPayload.model,
        role: 'assistant',
        stop_reason: stopReason,
        stop_sequence: null,
        type: 'message',
        usage: {
          input_tokens: inputTokens,
          output_tokens: outputTokens,
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
    let fullContent = ''  // Accumulate full content for XML parsing at end
    let usage = null
    let textBlockStarted = false
    let encounteredToolCall = false
    const toolCallAccumulators = {}  // key: tool call index, value: accumulated arguments string
    let chunkBuffer = ''  // Buffer for incomplete JSON chunks
    const decoder = new TextDecoder('utf-8')
    const reader = openaiResponse.body.getReader()
    let done = false

    try {
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
            
          }
          // OpenAI streaming responses are typically sent as lines prefixed with "data: "
          const lines = chunk.split('\n')


          for (const line of lines) {
            const trimmed = line.trim()
            if (trimmed === '' || !trimmed.startsWith('data:')) continue
            const dataStr = trimmed.replace(/^data:\s*/, '')
            if (dataStr === '[DONE]') {
              // Try to flush any buffered data before ending
              if (chunkBuffer) {
                debug('[Streaming] Attempting to parse buffered data on stream end')
                try {
                  const finalParsed = JSON.parse(chunkBuffer)
                  // Process final chunk if it has content
                  if (finalParsed.choices?.[0]?.delta?.content) {
                    accumulatedContent += finalParsed.choices[0].delta.content
                    if (textBlockStarted) {
                      sendSSE(reply, 'content_block_delta', {
                        type: 'content_block_delta',
                        index: 0,
                        delta: {
                          type: 'text_delta',
                          text: finalParsed.choices[0].delta.content
                        }
                      })
                    }
                  }
                } catch (err) {
                  debug('[Streaming] Could not parse buffered data, discarding:', chunkBuffer.substring(0, 100))
                }
                chunkBuffer = ''
              }
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

          // Try to parse JSON, buffer if incomplete
          let parsed
          try {
            // Try buffered + new chunk first
            const attemptStr = chunkBuffer + dataStr
            parsed = JSON.parse(attemptStr)
            chunkBuffer = '' // Success, clear buffer
          } catch (parseError) {
            // JSON incomplete - buffer and wait for next chunk
            if (process.env.DEBUG) {
              debug('[Streaming] Incomplete JSON chunk, buffering:', {
                error: parseError.message,
                position: parseError.message.match(/position (\d+)/)?.[1],
                chunkLength: dataStr.length,
                bufferLength: chunkBuffer.length
              })
            }
            chunkBuffer += dataStr
            continue // Skip to next line
          }

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
            // Accumulate for both immediate sending and XML parsing at end
            accumulatedContent += delta.content
            fullContent += delta.content
            
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
  } catch (streamError) {
    console.error('[Error] Stream processing failed:', streamError)
    
    // Send error event to client instead of crashing
    if (!reply.raw.writableEnded) {
      try {
        sendSSE(reply, 'error', {
          type: 'error',
          error: {
            type: 'internal_error',
            message: streamError.message
          }
        })
        reply.raw.end()
      } catch (sendError) {
        // If we can't send SSE, just end the response
        console.error('[Error] Could not send error event:', sendError)
        if (!reply.raw.writableEnded) {
          reply.raw.end()
        }
      }
    }
    
    // Don't re-throw - just log and close gracefully
    return
  }
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

// Add debug before starting server to ensure routes are registered
console.log('[Startup] About to register routes and start server...');

// Start the server
try {
  start();
} catch (err) {
  console.error('[Startup] Failed to start server:', err);
  process.exit(1);
}
