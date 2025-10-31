#!/usr/bin/env node
import Fastify from 'fastify'
import { TextDecoder } from 'util'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  detectProvider,
  resolveApiKey,
  providerSpecificHeaders,
  inferEndpointKind,
  inferEndpointKindSync,
  negotiateEndpointKind,
  ENDPOINT_KIND,
} from './key-resolver.js'
import { normalizeContent, removeUriFormat } from './transform.js'
import { injectXMLToolInstructions } from './xml-tool-formatter.js'
import { parseAssistantMessage } from './xml-tool-parser.js'
import { redactSecrets } from './utils/redaction.js'

let packageVersion = '0.0.0'
let packageDir = null

try {
  if (typeof import.meta !== 'undefined' && import.meta && import.meta.url) {
    packageDir = path.dirname(fileURLToPath(import.meta.url))
  }
} catch (err) {
  console.warn('[Startup] Failed to resolve package directory via import.meta:', err?.message || err)
}

if (!packageDir && typeof __dirname !== 'undefined') {
  packageDir = __dirname
}

if (!packageDir) {
  packageDir = process.cwd()
}

const packageJsonPath = path.join(packageDir, 'package.json')
try {
  const pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8'))
  packageVersion = pkg.version || packageVersion
} catch (err) {
  console.warn('[Startup] Failed to read package version:', err?.message || err)
}

const capabilitiesPath = path.join(packageDir, 'models-capabilities.json')
let modelCapabilities = null
if (existsSync(capabilitiesPath)) {
  try {
    modelCapabilities = JSON.parse(readFileSync(capabilitiesPath, 'utf8'))
  } catch (err) {
    console.warn('[Startup] Failed to parse models-capabilities.json:', err?.message || err)
  }
}

const baseUrl = process.env.ANTHROPIC_PROXY_BASE_URL || 'https://openrouter.ai/api'
const normalizedBaseUrl = baseUrl.replace(/\/+$/, '')
const provider = detectProvider(baseUrl)

// Load endpoint-kind overrides from env (from extension settings)
let endpointKindOverrides = {}
if (process.env.CUSTOM_ENDPOINT_OVERRIDES) {
  try {
    endpointKindOverrides = JSON.parse(process.env.CUSTOM_ENDPOINT_OVERRIDES)
  } catch (err) {
    console.warn('[Startup] Failed to parse CUSTOM_ENDPOINT_OVERRIDES:', err?.message || err)
  }
}

// Comment 1: Use sync version at startup, track detection source separately
// For custom providers without override, start as UNKNOWN until negotiation completes
let endpointKind = inferEndpointKindSync(provider, baseUrl, endpointKindOverrides)
let detectionSource = 'heuristic' // Default source
let lastProbedAt = null // Comment 1: Track when probe last ran
let negotiationPromise = null // Comment 1: Track ongoing negotiation

if (endpointKindOverrides[normalizedBaseUrl]) {
  detectionSource = 'override'
} else if (provider === 'deepseek' || provider === 'glm' || provider === 'anthropic') {
  detectionSource = 'heuristic'
} else if (provider === 'custom') {
  // Comment 1: For custom providers without override, set to UNKNOWN initially
  endpointKind = ENDPOINT_KIND.UNKNOWN
  detectionSource = 'probe' // Will be updated when negotiation completes
}

const { key, source: keySource } = resolveApiKey(provider)
const model = 'google/gemini-2.0-pro-exp-02-05:free'
const models = {
  reasoning: process.env.REASONING_MODEL || model,
  completion: process.env.COMPLETION_MODEL || model,
}

const ANTHROPIC_VERSION = process.env.ANTHROPIC_VERSION || '2023-06-01'
const ANTHROPIC_BETA = process.env.ANTHROPIC_BETA
const KEY_ENV_HINT = 'CUSTOM_API_KEY, API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, TOGETHER_API_KEY, DEEPSEEK_API_KEY, GLM_API_KEY, ZAI_API_KEY, ANTHROPIC_API_KEY, GROK_API_KEY, XAI_API_KEY'

const FALLBACK_XML_MODELS = [
  'inclusionai/ling-1t',
  'z-ai/glm-4.6',
  'z-ai/glm-4.5',
  'deepseek-v2',
  'deepseek-v3',
]

const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function matchesPattern(modelName, pattern) {
  if (typeof pattern !== 'string' || !pattern) return false
  const value = modelName.toLowerCase()
  if (pattern.startsWith('/') && pattern.endsWith('/')) {
    try {
      const regex = new RegExp(pattern.slice(1, -1), 'i')
      return regex.test(modelName)
    } catch {
      return false
    }
  }
  if (pattern.includes('*')) {
    const regex = new RegExp('^' + pattern.split('*').map((part) => escapeRegex(part)).join('.*') + '$', 'i')
    return regex.test(modelName)
  }
  return value.includes(pattern.toLowerCase())
}

/**
 * Determine whether a model should receive XML-formatted tool instructions instead of native tool calls.
 *
 * The decision is true when `FORCE_XML_TOOLS` is set to "1", when the model matches an entry in
 * `modelCapabilities.xmlTools` for the given provider or the wildcard `*`, or when the model name
 * matches a known fallback pattern.
 *
 * @param {string} modelName - The model's name.
 * @param {string} providerId - The provider identifier used to look up provider-specific capability rules.
 * @returns {boolean} `true` if the model requires XML tool instructions, `false` otherwise.
 */
function modelNeedsXMLTools(modelName, providerId) {
  if (process.env.FORCE_XML_TOOLS === '1') {
    return true
  }
  if (!modelName) return false

  const config = modelCapabilities?.xmlTools || null
  if (config) {
    const patterns = [
      ...(config[providerId] || []),
      ...(config['*'] || []),
    ]
    for (const pattern of patterns) {
      if (matchesPattern(modelName, pattern)) return true
    }
  }

  const lowerModel = modelName.toLowerCase()
  return FALLBACK_XML_MODELS.some((pattern) => lowerModel.includes(pattern.toLowerCase()))
}

/**
 * Determine whether a model is allowed to invoke external tools for a given provider.
 * @param {string} modelName - Provider-specific model identifier (e.g., "gpt-4o-mini").
 * @param {string} providerId - Provider key used in capability maps (e.g., "openai", "anthropic").
 * @returns {boolean} `true` if the model supports tool calling for the provider, `false` otherwise. Defaults to `true` when `modelName` or `providerId` is not provided.
 */
function modelSupportsToolCalling(modelName, providerId) {
  if (!modelName || !providerId) return true // Default to supporting tools
  
  const config = modelCapabilities?.toolCallUnsupported || null
  if (config) {
    const patterns = [
      ...(config[providerId] || []),
      ...(config['*'] || []),
    ]
    for (const pattern of patterns) {
      if (matchesPattern(modelName, pattern)) {
        console.log(`[Tool Capability] Model ${modelName} does not support tool calling (matched pattern: ${pattern})`)
        return false
      }
    }
  }
  
  return true
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
console.log(`[Startup] - Endpoint Kind: ${endpointKind}`)
console.log(`[Startup] - Base URL: ${baseUrl}`)
console.log(`[Startup] - Reasoning Model: ${models.reasoning}`)
console.log(`[Startup] - Completion Model: ${models.completion}`)
console.log(`[Startup] - API Key: ${key ? 'present' : 'MISSING'}`)
console.log(`[Startup] - API Key Source: ${keySource || 'none'}`)
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

/**
 * Logs debug information to the console with secrets redacted when DEBUG is set.
 * @param {...any} args - Values to log; objects are JSON-stringified for redaction when possible.
 */
function debug(...args) {
  if (!process.env.DEBUG) return
  // Redact secrets from debug output
  const redactedArgs = args.map(arg => {
    if (typeof arg === 'string') {
      return redactSecrets(arg)
    }
    if (typeof arg === 'object' && arg !== null) {
      try {
        const str = JSON.stringify(arg)
        return JSON.parse(redactSecrets(str))
      } catch {
        return arg
      }
    }
    return arg
  })
  console.log(...redactedArgs)
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

function buildUpstreamHeaders({ provider: providerId, endpointKind: upstreamKind, key: apiKey }) {
  const headers = {
    'Content-Type': 'application/json',
    ...providerSpecificHeaders(providerId),
  }

  if (!apiKey) {
    return headers
  }

  if (upstreamKind === ENDPOINT_KIND.ANTHROPIC_NATIVE) {
    headers['x-api-key'] = apiKey
    headers['anthropic-version'] = ANTHROPIC_VERSION
    if (ANTHROPIC_BETA) {
      headers['anthropic-beta'] = ANTHROPIC_BETA
    }
  } else {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  return headers
}

fastify.get('/v1/models', async (request, reply) => {
  try {
    const headers = buildUpstreamHeaders({ provider, endpointKind, key })

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

/**
 * Builds and returns the service health payload containing readiness, model selections, and endpoint detection metadata.
 *
 * If the proxy is not ready (no API key), the handler sets the HTTP response status to 503 and includes diagnostic fields about the missing key and attempted key sources.
 *
 * @returns {object} Health payload with the following keys:
 *  - status: 'ok' or 'unhealthy'
 *  - version: package version
 *  - provider: detected provider identifier
 *  - baseUrl: configured upstream base URL (if any)
 *  - endpointKind: inferred or overridden endpoint kind
 *  - detectionSource: how endpointKind was determined (override|probe|heuristic)
 *  - lastProbedAt: timestamp of the last endpoint probe or null
 *  - models: { reasoning, completion } current model values or 'not set'
 *  - modelSelection: { order, currentReasoning, currentCompletion } selection metadata
 *  - timestamp: current epoch ms
 *  - uptime: process uptime in seconds
 *
 * When an API key is missing, the payload additionally includes:
 *  - missingKey: true
 *  - keySourcesTried: hints of env locations tried for a key
 *  - forcedProvider: value of FORCE_PROVIDER (if set)
 */
async function healthCheckHandler(request, reply) {
  const isReady = !!key // Proxy is ready when API key is available
  const status = isReady ? 'ok' : 'unhealthy'
  
  if (!isReady) {
    reply.code(503)
  }
  
  // Model selection order: explicit model > thinking flag (reasoning) > default (completion)
  const modelSelectionOrder = [
    '1. Explicit model parameter in request (highest priority)',
    '2. REASONING_MODEL env var (if thinking=true)',
    '3. COMPLETION_MODEL env var (default)',
    '4. Hardcoded default: google/gemini-2.0-pro-exp-02-05:free (fallback)'
  ]
  
  // Comment 6: Include missing-key diagnostics when key is missing
  // Comment 1 & 5: Include detectionSource, endpointKind, lastProbedAt, and base URL in health response
  const healthResponse = {
    status,
    version: packageVersion,
    provider,
    baseUrl,
    endpointKind,
    detectionSource, // Comment 1 & 5: How endpoint kind was determined (override|probe|heuristic)
    lastProbedAt, // Comment 5: Timestamp of last probe (null if never probed)
    models: {
      reasoning: models.reasoning || 'not set',
      completion: models.completion || 'not set'
    },
    modelSelection: {
      order: modelSelectionOrder,
      currentReasoning: models.reasoning || 'not set',
      currentCompletion: models.completion || 'not set'
    },
    timestamp: Date.now(),
    uptime: process.uptime()
  }
  
  if (!isReady) {
    healthResponse.missingKey = true
    healthResponse.keySourcesTried = KEY_ENV_HINT
    healthResponse.endpointKind = endpointKind
    if (baseUrl) healthResponse.baseUrl = baseUrl
    if (process.env.FORCE_PROVIDER) healthResponse.forcedProvider = process.env.FORCE_PROVIDER
  }
  
  return healthResponse
}

// Unified health check handler - both routes use same handler
fastify.get('/health', healthCheckHandler)
fastify.get('/healthz', async (request, reply) => {
  // Note deprecation in logs when DEBUG is enabled
  if (process.env.DEBUG) {
    console.warn('[Deprecation] /healthz endpoint is deprecated, use /health instead')
  }
  return healthCheckHandler(request, reply)
})

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
    const needsXMLTools = tools.length > 0 && modelNeedsXMLTools(selectedModel, provider)
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

    const headers = buildUpstreamHeaders({
      provider,
      endpointKind,
      key: key ? '***REDACTED***' : null
    })

    // Model selection order documentation
    const modelSelectionOrder = [
      '1. Explicit model parameter in request (highest priority)',
      '2. REASONING_MODEL env var (if thinking=true)',
      '3. COMPLETION_MODEL env var (default)',
      '4. Hardcoded default: google/gemini-2.0-pro-exp-02-05:free (fallback)'
    ]
    
    // Determine selection reason
    let selectionReason = 'explicit request'
    if (!payload.model) {
      if (payload.thinking) {
        selectionReason = 'REASONING_MODEL env var (thinking=true)'
      } else {
        selectionReason = 'COMPLETION_MODEL env var (default)'
      }
    }
    
    return {
      debug: true,
      modelSelection: {
        requestedModel: payload.model || null,
        selectedModel,
        selectionReason,
        order: modelSelectionOrder,
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
    const requestStartMs = Date.now()
    let firstChunkLogged = false
    let ttfbMs = null
    
    // Comment 1: Gate requests until endpoint kind is determined for custom providers
    if (provider === 'custom' && endpointKind === ENDPOINT_KIND.UNKNOWN) {
      // Start negotiation if not already in progress
      if (!negotiationPromise && key) {
        negotiationPromise = negotiateEndpointKind(baseUrl, key)
          .then(result => {
            endpointKind = result.kind
            detectionSource = 'probe'
            lastProbedAt = result.lastProbedAt
            if (process.env.DEBUG) {
              console.log(`[Negotiation] Endpoint kind determined: ${endpointKind} (probed at ${new Date(result.lastProbedAt).toISOString()})`)
            }
            negotiationPromise = null
            return result
          })
          .catch(err => {
            console.warn(`[Negotiation] Failed:`, err.message)
            // Fallback to heuristic - use sync inference
            const heuristicResult = inferEndpointKindSync(provider, baseUrl, endpointKindOverrides)
            endpointKind = heuristicResult
            detectionSource = 'heuristic'
            negotiationPromise = null
            return { kind: endpointKind }
          })
      }
      
      // Wait for negotiation to complete
      if (negotiationPromise) {
        await negotiationPromise
      }
      
      // If still unknown after negotiation attempt, block request
      if (endpointKind === ENDPOINT_KIND.UNKNOWN) {
        reply.code(503)
        return {
          error: {
            message: 'Endpoint kind negotiation in progress. Please wait a moment and retry, or set an explicit override via CUSTOM_ENDPOINT_OVERRIDES environment variable.',
            type: 'negotiation_pending',
            hint: 'Set CUSTOM_ENDPOINT_OVERRIDES={"https://your-endpoint.com":"openai"} or {"https://your-endpoint.com":"anthropic"} to skip negotiation.'
          }
        }
      }
    }
    
    const isAnthropicNative = endpointKind === ENDPOINT_KIND.ANTHROPIC_NATIVE

    if (!key) {
      reply.code(400)
      const hint = isAnthropicNative
        ? `Store the provider API key in the extension (Thronekeeper: Store ${provider === 'deepseek' ? 'Deepseek' : provider === 'glm' ? 'GLM' : provider} API Key) or set the correct env var (${provider === 'deepseek' ? 'DEEPSEEK_API_KEY' : provider === 'glm' ? 'ZAI_API_KEY or GLM_API_KEY' : 'API_KEY'}), and confirm the provider switch in settings.`
        : `Use Authorization: Bearer <token> header or configure ${provider === 'openrouter' ? 'OpenRouter' : provider} API key in the extension settings.`
      return {
        error: {
          message: `No API key found for provider "${provider}". Checked ${KEY_ENV_HINT}.`,
          type: 'missing_api_key',
          hint
        }
      }
    }

    const requestUrl = isAnthropicNative
      ? `${normalizedBaseUrl}/v1/messages`
      : `${normalizedBaseUrl}/v1/chat/completions`
    const headers = buildUpstreamHeaders({ provider, endpointKind, key })

    if (isAnthropicNative) {
      console.log(`[Anthropic Native] Handling request for provider: ${provider}`)
      console.log(`[Anthropic Native] Forwarding to: ${requestUrl}`)
      console.log(`[Anthropic Native] Authentication: x-api-key header injected`)
    }
    
    console.log(`[Request] Starting request to ${requestUrl}`)

    if (isAnthropicNative) {
      const anthropicPayload = buildAnthropicPayload(payload)

      const upstreamResponse = await fetch(requestUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify(anthropicPayload)
      })

      const elapsedMs = Date.now() - requestStartMs
      console.log(`[Timing] Response received in ${elapsedMs}ms (HTTP ${upstreamResponse.status})`)

      if (!upstreamResponse.ok) {
        const errorDetails = await upstreamResponse.text()
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

        console.error('[Anthropic Error]', {
          status: upstreamResponse.status,
          provider,
          messageCount: Array.isArray(payload?.messages) ? payload.messages.length : 0,
          error: errorJson.error?.message?.slice?.(0, 200) || errorDetails.slice(0, 200),
        })

        reply.code(upstreamResponse.status)
        return errorJson
      }

      if (payload.stream === true) {
        // Check for non-2xx status before starting SSE stream
        if (!upstreamResponse.ok) {
          // Surface upstream non-2xx as SSE error event
          reply.raw.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          })
          
          let errorBody = ''
          try {
            // Read truncated error body (limit to 1000 chars to avoid large responses)
            const reader = upstreamResponse.body?.getReader()
            if (reader) {
              const decoder = new TextDecoder('utf-8')
              let done = false
              let bodyLength = 0
              while (!done && bodyLength < 1000) {
                const { value, done: doneReading } = await reader.read()
                done = doneReading
                if (value) {
                  const chunk = decoder.decode(value, { stream: true })
                  errorBody += chunk
                  bodyLength += chunk.length
                  if (bodyLength >= 1000) break
                }
              }
            }
          } catch (err) {
            errorBody = upstreamResponse.statusText || 'Unknown error'
          }
          
          // Truncate error body if too long
          const truncatedBody = errorBody.length > 1000 
            ? errorBody.substring(0, 1000) + '...'
            : errorBody
          
          // Emit single error event and end stream
          sendSSE(reply, 'error', {
            type: 'error',
            error: {
              type: 'upstream_error',
              message: `Upstream returned ${upstreamResponse.status}: ${truncatedBody}`,
              status: upstreamResponse.status
            }
          })
          reply.raw.end()
          return
        }
        
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        })

        try {
          const reader = upstreamResponse.body?.getReader()
          const decoder = new TextDecoder('utf-8')

          if (!reader) {
            throw new Error('Upstream stream reader unavailable')
          }

          let done = false
          while (!done) {
            const { value, done: doneReading } = await reader.read()
            done = doneReading
            if (value) {
              const chunk = decoder.decode(value)
              if (!firstChunkLogged && chunk.trim()) {
                ttfbMs = Date.now() - requestStartMs
                debug('Anthropic streaming first-byte timing:', { ttfbMs, chunkLength: chunk.length })
                firstChunkLogged = true
              }
              reply.raw.write(chunk)
              if (typeof reply.raw.flush === 'function') {
                reply.raw.flush()
              }
            }
          }

          reply.raw.end()
        } catch (streamErr) {
          console.error('[Error] Anthropic stream relay failed:', streamErr)
          if (!reply.raw.writableEnded) {
            try {
              sendSSE(reply, 'error', {
                type: 'error',
                error: {
                  type: 'internal_error',
                  message: streamErr.message
                }
              })
            } catch {}
            reply.raw.end()
          }
        }
        return
      }

      const text = await upstreamResponse.text()
      try {
        const data = JSON.parse(text)
        reply.code(upstreamResponse.status)
        reply.type('application/json').send(data)
      } catch {
        reply.code(upstreamResponse.status)
        reply.type('application/json').send({ error: text })
      }
      return
    }

    // Comment 2: Guard - never run OpenAI↔Anthropic mapping when endpoint-kind is Anthropic
    // At this point, isAnthropicNative is false, so we proceed with OpenAI-compatible flow
    if (endpointKind === ENDPOINT_KIND.ANTHROPIC_NATIVE) {
      console.error('[Guard Violation] Anthropic-native endpoint reached OpenAI conversion path - this should not happen')
      reply.code(500)
      return { error: { message: 'Internal error: endpoint kind mismatch', type: 'internal_error' } }
    }

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
    
    // Comment 7: Enhanced logging of incoming payload.model and payload.thinking
    console.log(`[Model Selection] Incoming payload.model: ${payload.model || 'none'}, payload.thinking: ${payload.thinking || false}`)
    
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

    // Comment 4: Check tool calling capability for OpenRouter models
    const supportsToolCalling = modelSupportsToolCalling(selectedModel, provider)
    let shouldDropTools = false
    
    if (provider === 'openrouter' && tools.length > 0 && !supportsToolCalling) {
      console.warn(`[Tool Capability] Model ${selectedModel} does not support tool calling. Stripping tools and tool_choice.`)
      shouldDropTools = true
    }
    
    // Conditionally inject XML tool instructions for models that need them
    const needsXMLTools = !shouldDropTools && tools.length > 0 && modelNeedsXMLTools(selectedModel, provider)
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
    
    // Add native tools parameter for models that support it (only if not dropping tools)
    if (!shouldDropTools && !needsXMLTools && tools.length > 0) {
      openaiPayload.tools = tools
      if (payload.tool_choice) {
        openaiPayload.tool_choice = payload.tool_choice
      }
    } else if (shouldDropTools && tools.length > 0) {
      // Comment 4: Inject text-based tool instructions when tools are dropped
      const toolInstructions = tools.map(t => `- ${t.function.name}: ${t.function.description || 'No description'}`).join('\n')
      const instructionText = `The following tools are available. Describe which tool you would use and with what parameters:\n\n${toolInstructions}`
      if (messagesWithXML.length > 0 && messagesWithXML[messagesWithXML.length - 1].role === 'user') {
        messagesWithXML[messagesWithXML.length - 1].content += '\n\n' + instructionText
      } else {
        messagesWithXML.push({ role: 'user', content: instructionText })
      }
      openaiPayload.messages = messagesWithXML
      console.log(`[Tool Capability] Injected text-based tool instructions for ${selectedModel}`)
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
      // For streaming requests, surface non-2xx as SSE error event
      if (openaiPayload.stream) {
        reply.raw.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        })
        
        let errorBody = ''
        try {
          // Read truncated error body (limit to 1000 chars)
          const reader = openaiResponse.body?.getReader()
          if (reader) {
            const decoder = new TextDecoder('utf-8')
            let done = false
            let bodyLength = 0
            while (!done && bodyLength < 1000) {
              const { value, done: doneReading } = await reader.read()
              done = doneReading
              if (value) {
                const chunk = decoder.decode(value, { stream: true })
                errorBody += chunk
                bodyLength += chunk.length
                if (bodyLength >= 1000) break
              }
            }
          }
        } catch (err) {
          errorBody = openaiResponse.statusText || 'Unknown error'
        }
        
        // Truncate error body if too long
        const truncatedBody = errorBody.length > 1000 
          ? errorBody.substring(0, 1000) + '...'
          : errorBody
        
        // Emit single error event and end stream
        sendSSE(reply, 'error', {
          type: 'error',
          error: {
            type: 'upstream_error',
            message: `Upstream returned ${openaiResponse.status}: ${truncatedBody}`,
            status: openaiResponse.status
          }
        })
        reply.raw.end()
        return
      }
      
      // Non-streaming: return JSON error
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

function normalizeAnthropicSystem(system) {
  if (!system) return undefined
  if (typeof system === 'string') {
    return [{ type: 'text', text: system }]
  }
  if (Array.isArray(system)) {
    return system
      .map((entry) => {
        if (typeof entry === 'string') {
          return { type: 'text', text: entry }
        }
        if (entry && typeof entry === 'object') {
          if (entry.type) return { ...entry }
          if (typeof entry.text === 'string') {
            return { type: 'text', text: entry.text }
          }
        }
        return null
      })
      .filter(Boolean)
  }
  if (system && typeof system === 'object') {
    if (Array.isArray(system.content)) {
      return system.content
        .map((block) => normalizeAnthropicContentBlock(block))
        .filter(Boolean)
    }
    if (typeof system.text === 'string') {
      return [{ type: 'text', text: system.text }]
    }
  }
  return undefined
}

function normalizeAnthropicContentBlock(block) {
  if (!block) return null
  if (typeof block === 'string') {
    return { type: 'text', text: block }
  }
  if (typeof block !== 'object') {
    return null
  }
  if (block.type === 'text') {
    if (typeof block.text === 'string') {
      return { type: 'text', text: block.text }
    }
    if (Array.isArray(block.content)) {
      return {
        type: 'text',
        text: block.content
          .map((item) => (typeof item === 'string' ? item : ''))
          .join(' ')
          .trim()
      }
    }
  }
  if (block.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: block.input ?? {}
    }
  }
  if (block.type === 'tool_result') {
    const normalized = {
      type: 'tool_result',
      tool_use_id: block.tool_use_id || block.id,
    }
    if (Array.isArray(block.content)) {
      normalized.content = block.content
    } else if (typeof block.text === 'string') {
      normalized.content = block.text
    } else if (block.content !== undefined) {
      normalized.content = block.content
    }
    if (block.is_error !== undefined) normalized.is_error = block.is_error
    return normalized
  }
  if (block.type) {
    return { ...block }
  }
  if (typeof block.text === 'string') {
    return { type: 'text', text: block.text }
  }
  return null
}

function normalizeAnthropicContent(content) {
  if (!content) return []
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }]
  }
  if (Array.isArray(content)) {
    return content.map((block) => normalizeAnthropicContentBlock(block)).filter(Boolean)
  }
  if (typeof content === 'object') {
    const block = normalizeAnthropicContentBlock(content)
    return block ? [block] : []
  }
  return []
}

function normalizeAnthropicMessage(msg) {
  if (!msg || typeof msg !== 'object') return null
  const normalized = {
    role: msg.role || 'user',
    content: normalizeAnthropicContent(msg.content),
  }
  if (msg.id) normalized.id = msg.id
  if (msg.metadata) normalized.metadata = msg.metadata
  if (msg.stop_reason) normalized.stop_reason = msg.stop_reason
  if (msg.stop_sequence) normalized.stop_sequence = msg.stop_sequence
  if (msg.type) normalized.type = msg.type
  return normalized
}

function formatAnthropicTool(tool) {
  if (!tool || typeof tool !== 'object') return null
  const formatted = {
    name: tool.name,
    description: tool.description,
    input_schema: tool.input_schema || tool.parameters || {},
  }
  if (tool.cache_control) formatted.cache_control = tool.cache_control
  if (tool.metadata) formatted.metadata = tool.metadata
  return formatted
}

function buildAnthropicPayload(payload = {}) {
  const result = {}

  if (payload.model) result.model = payload.model
  if (typeof payload.system === 'string') {
    result.system = payload.system
  } else {
    const systemBlocks = normalizeAnthropicSystem(payload.system)
    if (systemBlocks && systemBlocks.length > 0) {
      result.system = systemBlocks
    }
  }

  const messages = Array.isArray(payload.messages)
    ? payload.messages.map((msg) => normalizeAnthropicMessage(msg)).filter(Boolean)
    : []
  result.messages = messages

  if (Array.isArray(payload.tools) && payload.tools.length > 0) {
    const tools = payload.tools.map((tool) => formatAnthropicTool(tool)).filter(Boolean)
    if (tools.length > 0) {
      result.tools = tools
    }
  }

  const optionalKeys = [
    'metadata',
    'tool_choice',
    'thinking',
    'stop_sequences',
    'temperature',
    'top_p',
    'top_k',
    'max_tokens',
    'extra_headers',
    'response_format',
  ]

  for (const keyName of optionalKeys) {
    if (payload[keyName] !== undefined) {
      result[keyName] = payload[keyName]
    }
  }

  result.stream = payload.stream === true

  if (payload.timeout !== undefined) {
    result.timeout = payload.timeout
  }

  return result
}