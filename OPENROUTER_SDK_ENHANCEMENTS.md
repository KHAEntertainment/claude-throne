# OpenRouter SDK Pattern Enhancements - Implementation Summary

## Overview

Successfully implemented 5 targeted improvements to enhance Thronekeeper's OpenRouter support by selectively adopting patterns from the OpenRouter TypeScript SDK. All changes are **OpenRouter-specific** and do not affect other providers (Deepseek, GLM, Anthropic, custom endpoints).

**Status:** ✅ All recommendations implemented and syntax-validated

---

## Changes Summary

### 1. ✅ Provider Options Object (High Impact)

**Location:** `index.js:1093-1105`

**What Changed:**
- Added OpenRouter-specific `provider` options object to requests
- Enables `require_parameters: false` for automatic backend parameter filtering
- Supports passthrough of routing preferences (sort, zdr) from client

**Code Added:**
```javascript
// Add OpenRouter-specific provider options
if (provider === 'openrouter') {
  openaiPayload.provider = {
    require_parameters: false,  // Let OpenRouter backend filter parameters per model
    // Optional: add routing preferences from payload
    ...(payload.provider || {})
  }

  // Log provider options for debugging
  if (process.env.DEBUG) {
    debug('[Provider Options]', openaiPayload.provider)
  }
}
```

**Benefits:**
- ✅ Reduces 400 errors from unsupported parameters
- ✅ OpenRouter backend automatically filters incompatible parameters
- ✅ Enables advanced routing features (cost optimization, zero-downtime routing)

---

### 2. ✅ Complete Tool Choice Normalization (High Impact)

**Location:** `index.js:1035-1078` (function definition), `index.js:1129-1131` (usage)

**What Changed:**
- Added comprehensive `normalizeToolChoice()` function
- Handles ALL Anthropic tool_choice formats → OpenRouter formats
- Replaced limited normalization with complete format support

**Supported Conversions:**
| Anthropic Format | OpenRouter Format | Use Case |
|-----------------|-------------------|----------|
| `{type: 'auto'}` | `'auto'` | Let model decide |
| `{type: 'any'}` | `'required'` | Force tool use |
| `{type: 'tool', name: 'foo'}` | `{type: 'function', function: {name: 'foo'}}` | Specific tool |
| `'auto'` | `'auto'` | Pass-through |

**Code Added:**
```javascript
function normalizeToolChoice(toolChoice, providerId) {
  if (!toolChoice || providerId !== 'openrouter') {
    return toolChoice
  }

  // Handle string formats (pass through)
  if (typeof toolChoice === 'string') {
    return toolChoice
  }

  // Handle object formats
  if (typeof toolChoice === 'object') {
    // Anthropic: {type: 'auto'} → OpenRouter: 'auto'
    if (toolChoice.type === 'auto') {
      return 'auto'
    }

    // Anthropic: {type: 'any'} → OpenRouter: 'required'
    if (toolChoice.type === 'any') {
      return 'required'
    }

    // Anthropic: {type: 'tool', name: 'foo'} → OpenRouter: {type: 'function', function: {name: 'foo'}}
    if (toolChoice.type === 'tool' && toolChoice.name) {
      return {
        type: 'function',
        function: { name: toolChoice.name }
      }
    }

    // OpenRouter native format (pass through)
    if (toolChoice.type === 'function') {
      return toolChoice
    }
  }

  return toolChoice
}
```

**Usage:**
```javascript
if (payload.tool_choice) {
  // Normalize tool_choice for OpenRouter (handles all Anthropic formats)
  openaiPayload.tool_choice = normalizeToolChoice(payload.tool_choice, provider)
}
```

**Benefits:**
- ✅ Fixes "invalid tool_choice" 400 errors
- ✅ Supports force tool usage (`{type: 'any'}`)
- ✅ Supports specific tool selection
- ✅ Backward compatible with existing code

---

### 3. ✅ Reasoning Parameter Translation (High Impact)

**Location:** `index.js:1177-1201`

**What Changed:**
- Added translation of Anthropic `thinking` parameter → OpenRouter `reasoning` parameter
- Checks dynamic model capabilities before adding parameter
- Supports both object and boolean formats

**Code Added:**
```javascript
// Add reasoning parameter for OpenRouter reasoning models
if (provider === 'openrouter' && payload.thinking) {
  // Check if model supports reasoning parameter (dynamic or static)
  const supportsReasoning = openrouterModelCapabilities?.get(selectedModel)?.supportsReasoning ?? true

  if (supportsReasoning) {
    // Translate Anthropic 'thinking' to OpenRouter 'reasoning'
    if (typeof payload.thinking === 'object') {
      openaiPayload.reasoning = {
        effort: payload.thinking.effort || 'medium',
        summary: payload.thinking.summary || 'auto'
      }
    } else if (payload.thinking === true) {
      // Default reasoning config
      openaiPayload.reasoning = {
        effort: 'medium',
        summary: 'auto'
      }
    }

    console.log(`[Reasoning] Enabled for ${selectedModel}:`, openaiPayload.reasoning)
  } else {
    console.log(`[Reasoning] Skipped for ${selectedModel} (not supported by model)`)
  }
}
```

**Parameter Format:**
```javascript
// Anthropic format (input)
{
  "thinking": {
    "effort": "high",      // high | medium | low | minimal
    "summary": "detailed"  // auto | concise | detailed
  }
}

// OpenRouter format (output)
{
  "reasoning": {
    "effort": "high",
    "summary": "detailed"
  }
}
```

**Benefits:**
- ✅ Enables reasoning control for compatible models (deepseek-r1, claude-3.7-sonnet:thinking)
- ✅ Fixes missing reasoning configuration issue
- ✅ Graceful detection of model support
- ✅ Clear logging for debugging

---

### 4. ✅ Dynamic Model Capability Detection (High Impact)

**Location:** `index.js:271-326` (setup), `index.js:171-202` (usage in `modelSupportsToolCalling`)

**What Changed:**
- Added runtime fetching of OpenRouter model capabilities via `/v1/models` API
- Caches capabilities for 1 hour to reduce API calls
- Enhances `modelSupportsToolCalling()` to check dynamic data first, then static config

**Code Added:**
```javascript
// Model capability cache for OpenRouter dynamic detection
let openrouterModelCapabilities = null
let lastCapabilityFetch = null
const CAPABILITY_CACHE_TTL = 3600000 // 1 hour

/**
 * Fetch and cache OpenRouter model capabilities dynamically
 * @returns {Promise<Map|null>} Map of model capabilities or null on error
 */
async function fetchOpenRouterCapabilities() {
  if (provider !== 'openrouter') return null

  const now = Date.now()
  if (openrouterModelCapabilities && lastCapabilityFetch && (now - lastCapabilityFetch) < CAPABILITY_CACHE_TTL) {
    return openrouterModelCapabilities
  }

  try {
    const response = await fetch(`${normalizedBaseUrl}/v1/models`, {
      headers: { 'Authorization': `Bearer ${key}` }
    })

    if (!response.ok) {
      console.warn('[Capabilities] Failed to fetch OpenRouter models:', response.status)
      return null
    }

    const data = await response.json()
    openrouterModelCapabilities = new Map()

    // Build capability map: modelId -> { supportsTools, supportsParallelTools, supportedParameters }
    for (const model of data.data || []) {
      const capabilities = {
        supportsTools: model.supported_parameters?.includes('tools') ?? false,
        supportsParallelTools: model.supported_parameters?.includes('parallel_tool_calls') ?? false,
        supportsReasoning: model.supported_parameters?.includes('reasoning') ?? false,
        supportedParameters: new Set(model.supported_parameters || [])
      }
      openrouterModelCapabilities.set(model.id, capabilities)
    }

    lastCapabilityFetch = now
    console.log(`[Capabilities] Loaded ${openrouterModelCapabilities.size} OpenRouter model capabilities`)
    return openrouterModelCapabilities
  } catch (err) {
    console.warn('[Capabilities] Error fetching OpenRouter models:', err.message)
    return null
  }
}

// Fetch capabilities at startup (non-blocking)
if (provider === 'openrouter' && key) {
  fetchOpenRouterCapabilities().catch(err => {
    console.warn('[Startup] Could not prefetch OpenRouter capabilities:', err.message)
  })
}
```

**Enhanced `modelSupportsToolCalling()`:**
```javascript
function modelSupportsToolCalling(modelName, providerId) {
  if (!modelName || !providerId) return true // Default to supporting tools

  // Check dynamic capabilities first (OpenRouter only)
  if (providerId === 'openrouter' && openrouterModelCapabilities) {
    const capabilities = openrouterModelCapabilities.get(modelName)
    if (capabilities) {
      const supportsTools = capabilities.supportsTools
      if (!supportsTools) {
        console.log(`[Tool Capability] Model ${modelName} does not support tool calling (from OpenRouter API)`)
      }
      return supportsTools
    }
  }

  // Fall back to static config
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
```

**Benefits:**
- ✅ Auto-discovers new OpenRouter models at startup
- ✅ Reduces 400 errors from outdated capability data
- ✅ Complements static `models-capabilities.json` (doesn't replace it)
- ✅ 1-hour caching reduces API overhead
- ✅ Non-blocking startup (failures logged but don't crash proxy)

---

### 5. ✅ Parameter Registry for Feature Detection (Medium Impact)

**Location:** New file `openrouter-params.js`

**What Changed:**
- Created comprehensive parameter registry based on SDK Parameter enum
- Provides helper functions for parameter validation and filtering
- Documents all 21+ OpenRouter-supported parameters

**New File: `openrouter-params.js`**
```javascript
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

// Helper functions exported:
// - modelSupportsParameter(modelName, parameter, capabilitiesMap)
// - getModelSupportedParameters(modelName, capabilitiesMap)
// - filterUnsupportedParameters(payload, modelName, capabilitiesMap)
// - getParameterCategory(parameter)
```

**Usage Example:**
```javascript
import { OPENROUTER_PARAMETERS, modelSupportsParameter } from './openrouter-params.js'

// Check if model supports reasoning
if (modelSupportsParameter(selectedModel, OPENROUTER_PARAMETERS.Reasoning, openrouterModelCapabilities)) {
  openaiPayload.reasoning = { effort: 'high' }
}
```

**Benefits:**
- ✅ Clear documentation of available parameters
- ✅ Type-safe parameter handling (via constants)
- ✅ Easy to extend with new parameters
- ✅ Enables conditional parameter logic
- ✅ Future-proof architecture

---

## Files Modified

1. **`index.js`**
   - Added `normalizeToolChoice()` function (lines 1035-1078)
   - Added dynamic capability detection (lines 271-326)
   - Enhanced `modelSupportsToolCalling()` (lines 171-202)
   - Added provider options object (lines 1093-1105)
   - Added reasoning parameter translation (lines 1177-1201)
   - Updated tool_choice normalization usage (lines 1129-1131)
   - Added import for `openrouter-params.js` (line 20)

2. **`openrouter-params.js`** (NEW FILE)
   - Complete OpenRouter parameter registry
   - Helper functions for parameter validation
   - 173 lines of documentation and utilities

---

## Testing Recommendations

### Test Case 1: Tool Choice Normalization
```bash
# Test with Anthropic {type: 'any'} format (force tool use)
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek/deepseek-r1",
    "messages": [{"role": "user", "content": "What is 2+2?"}],
    "tools": [{"name": "calculator", "description": "Calculate math", "input_schema": {"type": "object", "properties": {}}}],
    "tool_choice": {"type": "any"}
  }'

# Expected: tool_choice normalized to 'required', request succeeds
```

### Test Case 2: Reasoning Parameter
```bash
# Test reasoning parameter translation
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "deepseek/deepseek-r1",
    "messages": [{"role": "user", "content": "Explain quantum mechanics"}],
    "thinking": {"effort": "high", "summary": "detailed"}
  }'

# Expected: Console logs "[Reasoning] Enabled for deepseek/deepseek-r1: { effort: 'high', summary: 'detailed' }"
```

### Test Case 3: Dynamic Capabilities
```bash
# Restart proxy and check startup logs
npm start

# Expected logs:
# [Capabilities] Loaded XXX OpenRouter model capabilities
# [Tool Capability] Model google/gemini-2.0-pro-exp-02-05:free does not support tool calling (from OpenRouter API)
```

### Test Case 4: Provider Options
```bash
# Test with DEBUG=1 to see provider options
DEBUG=1 npm start

# Send request and check logs
curl -X POST http://localhost:3000/v1/messages \
  -H "Content-Type: application/json" \
  -d '{
    "model": "openai/gpt-4o",
    "messages": [{"role": "user", "content": "Hello"}],
    "provider": {"sort": "price"}
  }'

# Expected: "[Provider Options] { require_parameters: false, sort: 'price' }"
```

---

## Compatibility Matrix

| Feature | OpenRouter | Deepseek | GLM | Anthropic | Custom |
|---------|-----------|----------|-----|-----------|--------|
| Provider Options | ✅ Added | ⚫ No change | ⚫ No change | ⚫ No change | ⚫ No change |
| Tool Choice Normalization | ✅ Added | ⚫ No change | ⚫ No change | ⚫ No change | ⚫ No change |
| Reasoning Parameter | ✅ Added | ⚫ No change | ⚫ No change | ⚫ No change | ⚫ No change |
| Dynamic Capabilities | ✅ Added | ⚫ No change | ⚫ No change | ⚫ No change | ⚫ No change |
| XML Tools | ✅ Existing | ✅ Existing | ✅ Existing | ⚫ N/A | ✅ Existing |
| Streaming Buffering | ✅ Existing | ✅ Existing | ✅ Existing | ✅ Existing | ✅ Existing |

**Legend:**
- ✅ Feature enabled
- ⚫ No change from before
- ⚫ N/A: Not applicable

---

## Architecture Improvements

### Before:
```
Client Request → Thronekeeper
  ↓
  • Basic tool_choice normalization (only {type: 'auto'})
  • No reasoning parameter support
  • Static capability detection only
  • No provider options
  ↓
OpenRouter API → Response
```

### After:
```
Client Request → Thronekeeper
  ↓
  • Complete tool_choice normalization (all formats)
  • Reasoning parameter translation (thinking → reasoning)
  • Dynamic + static capability detection
  • Provider options with automatic filtering
  ↓
OpenRouter API → Response
```

---

## Expected Impact

### Immediate Benefits:
1. **Reduced 400 Errors** - Better parameter handling and automatic filtering
2. **Reasoning Model Support** - deepseek-r1, claude-3.7-sonnet:thinking now receive reasoning config
3. **Better Tool Choice** - Support for force tool use (`{type: 'any'}`) and specific tool selection
4. **Auto-Discovery** - New OpenRouter models detected automatically

### Long-Term Benefits:
1. **Future-Proof** - Parameter registry makes adding new parameters easy
2. **Better Debugging** - Enhanced logging shows parameter decisions
3. **Cost Optimization** - Provider options enable price-based routing
4. **Reduced Maintenance** - Dynamic capabilities reduce need to update static config

---

## Rollback Plan (If Needed)

All changes are isolated to OpenRouter provider with `if (provider === 'openrouter')` guards.

**To disable specific features:**

1. **Disable dynamic capabilities**: Comment out line 322-325 (startup fetch)
2. **Disable provider options**: Comment out lines 1093-1105
3. **Disable reasoning parameter**: Comment out lines 1177-1201
4. **Revert tool_choice normalization**: Restore old lines from git history

**Full rollback:**
```bash
git diff HEAD -- index.js openrouter-params.js
git checkout HEAD -- index.js
rm openrouter-params.js
```

---

## Next Steps

1. ✅ **Complete** - All 5 recommendations implemented
2. 🧪 **Test** - Run test cases above to verify behavior
3. 📊 **Monitor** - Watch logs for "[Capabilities]", "[Reasoning]", "[Provider Options]"
4. 🔧 **Tune** - Adjust capability cache TTL if needed (currently 1 hour)
5. 📝 **Document** - Update user-facing docs with new features

---

## Summary

Successfully adopted 5 SDK patterns that enhance OpenRouter support without compromising Thronekeeper's existing strengths:

✅ **Provider options** - Automatic parameter filtering
✅ **Tool choice normalization** - Complete Anthropic format support
✅ **Reasoning parameters** - Thinking config for reasoning models
✅ **Dynamic capabilities** - Auto-discover new models
✅ **Parameter registry** - Future-proof architecture

**Result:** More robust OpenRouter integration while maintaining compatibility with all other providers.
