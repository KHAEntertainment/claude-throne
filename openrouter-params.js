/**
 * OpenRouter Parameter Registry
 *
 * Complete list of parameters supported by OpenRouter API
 * Based on OpenRouter TypeScript SDK Parameter enum
 * Used for feature detection and conditional parameter passing
 */

/**
 * OpenRouter-supported parameters (from SDK Parameter enum)
 * Used for feature detection and conditional parameter passing
 */
export const OPENROUTER_PARAMETERS = {
  // Sampling parameters
  Temperature: 'temperature',
  TopP: 'top_p',
  TopK: 'top_k',
  MinP: 'min_p',
  TopA: 'top_a',
  FrequencyPenalty: 'frequency_penalty',
  PresencePenalty: 'presence_penalty',
  RepetitionPenalty: 'repetition_penalty',

  // Generation parameters
  MaxTokens: 'max_tokens',
  Stop: 'stop',

  // Tool parameters
  Tools: 'tools',
  ToolChoice: 'tool_choice',
  ParallelToolCalls: 'parallel_tool_calls',

  // Reasoning parameters
  IncludeReasoning: 'include_reasoning',
  Reasoning: 'reasoning',

  // Format parameters
  ResponseFormat: 'response_format',
  StructuredOutputs: 'structured_outputs',

  // Advanced parameters
  LogitBias: 'logit_bias',
  Logprobs: 'logprobs',
  TopLogprobs: 'top_logprobs',
  Seed: 'seed',

  // Search parameters
  WebSearchOptions: 'web_search_options',
  Verbosity: 'verbosity'
}

/**
 * Check if a model supports a specific parameter
 * @param {string} modelName - Model identifier
 * @param {string} parameter - Parameter name from OPENROUTER_PARAMETERS
 * @param {Map} capabilitiesMap - OpenRouter model capabilities map
 * @returns {boolean} True if model supports the parameter
 */
export function modelSupportsParameter(modelName, parameter, capabilitiesMap) {
  if (!capabilitiesMap) return true // Assume support if no data

  const capabilities = capabilitiesMap.get(modelName)
  if (!capabilities) return true // Unknown model, assume support

  return capabilities.supportedParameters.has(parameter)
}

/**
 * Get all parameters supported by a specific model
 * @param {string} modelName - Model identifier
 * @param {Map} capabilitiesMap - OpenRouter model capabilities map
 * @returns {Set<string>|null} Set of supported parameter names, or null if unknown
 */
export function getModelSupportedParameters(modelName, capabilitiesMap) {
  if (!capabilitiesMap) return null

  const capabilities = capabilitiesMap.get(modelName)
  if (!capabilities) return null

  return capabilities.supportedParameters
}

/**
 * Filter a payload to only include parameters supported by the target model
 * Useful for debugging or strict parameter validation
 * @param {object} payload - Request payload
 * @param {string} modelName - Model identifier
 * @param {Map} capabilitiesMap - OpenRouter model capabilities map
 * @returns {object} Filtered payload with only supported parameters
 */
export function filterUnsupportedParameters(payload, modelName, capabilitiesMap) {
  if (!capabilitiesMap) return payload // No filtering if no capability data

  const capabilities = capabilitiesMap.get(modelName)
  if (!capabilities) return payload // Unknown model, pass through

  const filtered = {}
  const supportedParams = capabilities.supportedParameters

  // Always include core fields
  const coreFields = ['model', 'messages', 'stream']
  for (const field of coreFields) {
    if (payload[field] !== undefined) {
      filtered[field] = payload[field]
    }
  }

  // Include only supported parameters
  for (const [key, value] of Object.entries(payload)) {
    if (coreFields.includes(key)) continue // Already handled

    // Check if parameter is supported
    const paramName = key.toLowerCase()
    if (supportedParams.has(paramName) || supportedParams.has(key)) {
      filtered[key] = value
    }
  }

  return filtered
}

/**
 * Get parameter category information
 * @param {string} parameter - Parameter name
 * @returns {string} Category name ('sampling', 'generation', 'tools', 'reasoning', 'format', 'advanced', 'search', 'unknown')
 */
export function getParameterCategory(parameter) {
  const paramLower = parameter.toLowerCase()

  // Sampling parameters
  if (['temperature', 'top_p', 'top_k', 'min_p', 'top_a',
       'frequency_penalty', 'presence_penalty', 'repetition_penalty'].includes(paramLower)) {
    return 'sampling'
  }

  // Generation parameters
  if (['max_tokens', 'stop'].includes(paramLower)) {
    return 'generation'
  }

  // Tool parameters
  if (['tools', 'tool_choice', 'parallel_tool_calls'].includes(paramLower)) {
    return 'tools'
  }

  // Reasoning parameters
  if (['include_reasoning', 'reasoning'].includes(paramLower)) {
    return 'reasoning'
  }

  // Format parameters
  if (['response_format', 'structured_outputs'].includes(paramLower)) {
    return 'format'
  }

  // Advanced parameters
  if (['logit_bias', 'logprobs', 'top_logprobs', 'seed'].includes(paramLower)) {
    return 'advanced'
  }

  // Search parameters
  if (['web_search_options', 'verbosity'].includes(paramLower)) {
    return 'search'
  }

  return 'unknown'
}
