# OpenRouter Tool Calling Investigation

**Date:** 2025-10-23  
**Version:** v1.5.0  
**Status:** ⚠️ PARTIAL SUCCESS - Needs Further Investigation

---

## 🎯 Executive Summary

We implemented **universal XML tool calling** for Claude Throne v1.5.0, but encountered **OpenRouter-specific limitations** that prevent full functionality. Simple queries work perfectly, but tool calls have issues:

- **Haiku:** Returns 400 errors when using native tools (56 tools too many)
- **Ling-1T:** Returns blank responses even with XML tool instructions

**Key Insight:** Other CLI tools (Cursor, Aider, etc.) successfully use OpenRouter with tools, so **this is solvable** - we just need to understand their approach.

---

## 📊 Current State

### ✅ What Works
1. **Simple questions** - Both models return text correctly
2. **Proxy infrastructure** - Conditional XML injection working
3. **Parsing logic** - Character-by-character XML parsing functional
4. **Model detection** - Correctly identifies which models need XML vs native

### ❌ What Doesn't Work
1. **Haiku + Native Tools** - 400 Bad Request from OpenRouter
2. **Ling-1T + XML Tools** - Blank responses, model appears confused
3. **Tool concurrency** - 56 tools overwhelms both approaches

### 🤔 What's Unclear
1. **How many tools can OpenRouter handle?** (Haiku fails with 56)
2. **Does Ling-1T actually support tool calling?** (May be model limitation)
3. **What format do other CLI tools use?** (Need to investigate)
4. **Is there a tool limit we should enforce?** (10? 20? 30?)

---

## 🔍 Technical Deep Dive

### Architecture Overview

```
Claude Code (Anthropic API)
    ↓
    Sends: { messages, tools: [56 tools] }  ← ALL tools, every request
    ↓
Claude Throne Proxy
    ↓
    Conditional Logic:
    - If model needs XML: Inject XML instructions, no tools param
    - If model supports native: Pass tools param directly
    ↓
OpenRouter API
    ↓
    ⚠️ PROBLEM: Both approaches fail with 56 tools
```

### Current Implementation

**File:** `index.js`

**Key Components:**

1. **Model Registry (Line ~18-24):**
```javascript
const MODELS_REQUIRING_XML_TOOLS = new Set([
  'inclusionai/ling-1t',
  'z-ai/glm-4.6',
  'z-ai/glm-4.5',
  'deepseek-v2',
  'deepseek-v3',
])
```

2. **Detection Function (Line ~30-38):**
```javascript
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
```

3. **Conditional Injection (Line ~296-313, ~443-460):**
```javascript
// Determine if XML is needed
const needsXMLTools = tools.length > 0 && modelNeedsXMLTools(selectedModel)

// Inject XML or use messages as-is
const messagesWithXML = needsXMLTools
  ? injectXMLToolInstructions(messages, tools)
  : messages

// Build payload
const openaiPayload = {
  model: selectedModel,
  messages: messagesWithXML,
  // ...
}

// Add native tools for compatible models
if (!needsXMLTools && tools.length > 0) {
  openaiPayload.tools = tools  // ← PROBLEM: 56 tools causes 400
}
```

4. **Dual-Mode Parsing (Line ~610-623):**
```javascript
if (needsXMLTools) {
  // Parse XML: "<Read><path>...</path></Read>"
  contentBlocks = parseAssistantMessage(openaiMessage.content || '')
} else {
  // Parse native: {tool_calls: [{function: {name, arguments}}]}
  contentBlocks = parseNativeToolResponse(openaiMessage)
}
```

### XML Tool Format (xml-tool-formatter.js)

**Generated Instructions:**
```
====

TOOL USE

You have access to a set of tools that are executed upon the user's approval.
You must use exactly one tool per message, and every assistant message must 
include a tool call. You use tools step-by-step to accomplish a given task,
with each tool use informed by the result of the previous tool use.

# Tool Use Formatting

Tool uses are formatted using XML-style tags. The tool name itself becomes 
the XML tag name. Each parameter is enclosed within its own set of tags.

<actual_tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
</actual_tool_name>

Available tools:
## Read
Description: Read file contents
Parameters:
- file_path (required): Path to file
...
[Repeats for all 56 tools]
====
```

**Problem:** This massive instruction block (for 56 tools) may be:
1. Too long for Ling-1T context window
2. Confusing the model (too many options)
3. Using too many tokens

### Native Tool Format (OpenAI Standard)

**Request:**
```javascript
{
  "model": "anthropic/claude-haiku-4.5",
  "messages": [...],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "Read",
        "description": "Read file contents",
        "parameters": {
          "type": "object",
          "properties": {
            "file_path": {"type": "string", "description": "Path to file"}
          },
          "required": ["file_path"]
        }
      }
    },
    // ... 55 more tools
  ]
}
```

**OpenRouter Response:**
```json
{
  "error": {
    "code": 400,
    "message": "Provider returned error"
  }
}
```

**Possible Causes (from OpenRouter):**
1. Tool concurrency not supported by model
2. Invalid tool schema
3. Message format incompatibility
4. Context length exceeded

---

## 🧪 Test Results

### Test 1: Simple Question (No Tools)
```
Model: Haiku
Query: "What is today's date?"
Tools: 0
Result: ✅ "Today's date is 2025-10-23."
```

### Test 2: Simple Question (Tools Available but Not Needed)
```
Model: Haiku
Query: "What is today's date?"
Tools: 56 available
Result: ✅ "Today's date is 2025-10-23."
```

### Test 3: Tool Request with Haiku (Native Mode)
```
Model: Haiku
Query: "Check core-memory for more information about this project"
Tools: 56 available (native format)
Log: [Tool Mode] Native tool calling for anthropic/claude-haiku-4.5
Result: ❌ 400 Bad Request - "Provider returned error"
```

### Test 4: Tool Request with Ling-1T (XML Mode)
```
Model: Ling-1T
Query: "Tell me about this codebase in 2 sentences"
Tools: 56 available (XML format)
Log: [Tool Mode] XML tool calling enabled for inclusionai/ling-1t
Result: ❌ Blank response (⏺)
```

### Test 5: Text Response After Tool Failure
```
Model: Haiku (after 400 error)
Query: "ok try once more please"
Result: ❌ Another 400 error
```

### Test 6: Non-Tool Response
```
Model: Haiku
Query: "what is the error you're getting from core-memory?"
Result: ✅ Explains the error correctly (text response)
```

---

## 🔬 Observed Behaviors

### Haiku (anthropic/claude-haiku-4.5)

**With 0 tools:**
- ✅ Perfect responses
- ✅ Fast (1-2 seconds)
- ✅ No errors

**With 56 tools (native format):**
- ❌ Immediate 400 errors
- ❌ "Tool concurrency not supported"
- ❌ Cannot recover even on retry

**Hypothesis:**
- OpenRouter's Haiku endpoint has a **tool limit**
- Likely around 10-20 tools maximum
- Need to filter tools to smaller subset

### Ling-1T (inclusionai/ling-1t)

**With 0 tools:**
- ✅ Responds correctly
- ✅ Slower (4-10 seconds, reasoning model)
- ✅ No errors

**With 56 tools (XML format):**
- ❌ Returns blank responses
- ❌ Takes full response time (10+ seconds) but outputs nothing
- ❌ No error, just empty content

**Hypothesis:**
- Model **receives** XML instructions but can't process them
- May not support tool calling at all
- Or XML format is wrong for this model
- Or too many tools confuse it

---

## 📚 Reference Projects to Study

These projects successfully use OpenRouter with tool calling:

### 1. **Cursor**
- **What they do:** Successfully uses OpenRouter models with tools
- **Investigation needed:** 
  - How many tools do they send at once?
  - Do they filter/prioritize tools?
  - What format do they use?

### 2. **Aider**
- **GitHub:** https://github.com/paul-gauthier/aider
- **What they do:** CLI coding assistant with OpenRouter support
- **Investigation needed:**
  - Check their OpenRouter integration
  - See how they handle tool definitions
  - Study their model-specific adaptations

### 3. **Continue**
- **GitHub:** https://github.com/continuedev/continue
- **What they do:** VS Code extension supporting OpenRouter
- **Investigation needed:**
  - Tool calling implementation
  - Model compatibility matrix
  - Error handling strategies

### 4. **LiteLLM**
- **GitHub:** https://github.com/BerriAI/litellm
- **What they do:** Universal LLM proxy (like us!)
- **Investigation needed:**
  - OpenRouter adapter implementation
  - Tool schema transformations
  - Model-specific quirks handling

### 5. **OpenRouter Documentation**
- **URL:** https://openrouter.ai/docs
- **Check for:**
  - Official tool calling examples
  - Model-specific limitations
  - Best practices for tool schemas
  - Tool concurrency limits

---

## 🎯 Hypotheses to Test

### Hypothesis 1: Tool Count Limit
**Theory:** OpenRouter has a maximum tool count per request (e.g., 10-20 tools)

**Test:**
```javascript
// Instead of sending all 56 tools
if (tools.length > MAX_TOOLS_PER_REQUEST) {
  tools = filterToMostRelevant(tools, MAX_TOOLS_PER_REQUEST)
}
```

**How to verify:**
1. Start with 10 tools
2. Gradually increase until we hit the limit
3. Document the threshold

### Hypothesis 2: Tool Schema Issues
**Theory:** Our tool schema format doesn't match OpenRouter's expectations

**Test:**
1. Compare our schema to OpenRouter examples
2. Check parameter types (are we using correct types?)
3. Verify required fields are present

### Hypothesis 3: Model-Specific Formats
**Theory:** Each model needs a different tool format

**Test:**
1. Check if Ling-1T has specific tool calling documentation
2. Try alternative XML formats (e.g., different tag structure)
3. Test with simpler tool definitions

### Hypothesis 4: Context Window Overflow
**Theory:** 56 tools + XML instructions exceed context window

**Test:**
```javascript
// Calculate token count
const xmlInstructions = generateXMLToolInstructions(tools)
const estimatedTokens = xmlInstructions.length / 4  // Rough estimate

if (estimatedTokens > MAX_TOOL_INSTRUCTION_TOKENS) {
  // Reduce tools or use native format
}
```

---

## 🛠️ Potential Solutions

### Solution 1: Intelligent Tool Filtering

**Approach:** Only send relevant tools based on context

```javascript
function filterRelevantTools(tools, query, maxTools = 15) {
  // Priority ranking
  const coreTool= ['Read', 'Write', 'Execute', 'LS', 'Grep']
  const webTools = ['FetchUrl', 'WebSearch']
  const mcpTools = tools.filter(t => t.name.includes('___'))
  
  // Build subset based on query
  let selected = []
  
  // Always include core tools
  selected.push(...tools.filter(t => coreTools.includes(t.name)))
  
  // Add context-relevant tools
  if (query.toLowerCase().includes('search') || query.toLowerCase().includes('find')) {
    selected.push(...tools.filter(t => ['Grep', 'Glob', 'WebSearch'].includes(t.name)))
  }
  
  if (query.toLowerCase().includes('read') || query.toLowerCase().includes('file')) {
    selected.push(...tools.filter(t => t.name === 'Read'))
  }
  
  // Add MCP tools if explicitly mentioned
  const mentionedMcp = mcpTools.filter(t => 
    query.toLowerCase().includes(t.name.split('___')[0])
  )
  selected.push(...mentionedMcp)
  
  // Deduplicate and limit
  selected = [...new Set(selected)].slice(0, maxTools)
  
  return selected
}
```

**Pros:**
- Reduces payload size
- Focuses model attention
- More likely to work with OpenRouter limits

**Cons:**
- Model might need a tool we didn't send
- Requires smart filtering logic
- May need multiple attempts

### Solution 2: Progressive Tool Loading

**Approach:** Start with few tools, add more if needed

```javascript
let toolSubset = getBasicTools()  // 5-10 essential tools

// Send request with basic tools
let response = await sendRequest(messages, toolSubset)

// If model says "I need tool X"
if (response.needsAdditionalTool) {
  toolSubset.push(response.requestedTool)
  response = await sendRequest(messages, toolSubset)
}
```

**Pros:**
- Adaptive approach
- Learns from model feedback
- Respects limits

**Cons:**
- Multiple requests (slower)
- Complex logic
- May not work if model can't request tools

### Solution 3: Model-Specific Tool Caps

**Approach:** Hard limits per model type

```javascript
const MODEL_TOOL_LIMITS = {
  'anthropic/claude-haiku-4.5': 20,
  'inclusionai/ling-1t': 10,
  'z-ai/glm-4.6': 15,
  // Default for unknown models
  'default': 12
}

function getToolLimit(modelName) {
  for (const [pattern, limit] of Object.entries(MODEL_TOOL_LIMITS)) {
    if (modelName.includes(pattern)) return limit
  }
  return MODEL_TOOL_LIMITS.default
}

// In request building
const maxTools = getToolLimit(selectedModel)
const toolsToSend = tools.slice(0, maxTools)
```

**Pros:**
- Simple to implement
- Prevents known failures
- Easy to adjust limits

**Cons:**
- Requires discovering limits empirically
- Arbitrary tool selection (first N tools)
- Might exclude needed tools

### Solution 4: Hybrid Approach (Smart + Limits)

**Combination of Solutions 1 and 3:**

```javascript
// Get model's tool limit
const maxTools = getToolLimit(selectedModel)

// Filter intelligently within that limit
const relevantTools = filterRelevantTools(tools, userQuery, maxTools)

// Send smart subset
const toolsToSend = relevantTools
```

**Pros:**
- Best of both approaches
- Respects limits AND sends relevant tools
- Most likely to succeed

**Cons:**
- More complex
- Requires both filtering logic and limit tracking

### Solution 5: Disable Tool Calling for Problematic Models

**Approach:** Whitelist known-working models

```javascript
const MODELS_WITH_TOOL_SUPPORT = new Set([
  'anthropic/claude-opus-4',
  'anthropic/claude-sonnet-4',
  'openai/gpt-4',
  // Add tested models
])

function supportsTools(modelName) {
  return Array.from(MODELS_WITH_TOOL_SUPPORT).some(pattern =>
    modelName.includes(pattern)
  )
}

// In request
if (!supportsTools(selectedModel)) {
  console.warn(`[Tool Warning] ${selectedModel} may not support tools via OpenRouter`)
  // Don't send tools parameter
}
```

**Pros:**
- Conservative (only enable for known-working)
- Prevents failures
- Clear documentation

**Cons:**
- Limited model support
- Requires extensive testing
- May exclude capable models

---

## 📝 Investigation Checklist

When circling back, investigate these in order:

### Phase 1: Research (No Code Changes)
- [ ] Study Aider's OpenRouter implementation
- [ ] Study Continue's tool calling code
- [ ] Study LiteLLM's OpenRouter adapter
- [ ] Read OpenRouter official documentation on tools
- [ ] Check OpenRouter Discord/GitHub for tool limits
- [ ] Test Cursor's behavior with different tool counts
- [ ] Document tool limits per model (empirical testing)

### Phase 2: Experimentation (Test Branch)
- [ ] Test Haiku with 10, 20, 30, 40, 50 tools (find limit)
- [ ] Test Ling-1T with 5, 10, 15 tools (find limit)
- [ ] Try different XML formats for Ling-1T
- [ ] Test tool schema variations (simplified vs full)
- [ ] Measure token count of XML instructions vs native
- [ ] Test with different tool selection strategies

### Phase 3: Implementation (Feature Branch)
- [ ] Implement intelligent tool filtering
- [ ] Add model-specific tool limits
- [ ] Create tool priority ranking system
- [ ] Add fallback logic for tool failures
- [ ] Enhance logging for tool selection
- [ ] Update documentation with findings

### Phase 4: Testing (QA)
- [ ] Test each OpenRouter model with tools
- [ ] Verify simple queries still work
- [ ] Test tool calls with various counts
- [ ] Validate XML vs native decision logic
- [ ] Check error handling and recovery
- [ ] Performance testing (token usage, latency)

---

## 🐛 Known Issues Log

### Issue #1: Haiku 400 Error with Native Tools
**Status:** 🔴 UNRESOLVED  
**Severity:** HIGH  
**Frequency:** Always (with 56 tools)

**Error:**
```
[OpenRouter Error] {
  status: 400,
  model: 'anthropic/claude-haiku-4.5',
  possibleCauses: ['Tool concurrency not supported by model', ...]
}
```

**Reproduction:**
1. Send request with 56 tools (native format)
2. Haiku via OpenRouter
3. Immediate 400 error

**Workaround:** Reduce tool count (untested threshold)

**Root Cause:** Unknown (likely OpenRouter tool limit)

### Issue #2: Ling-1T Blank Responses with XML
**Status:** 🔴 UNRESOLVED  
**Severity:** HIGH  
**Frequency:** Always (with 56 tools)

**Behavior:**
- Request completes (10+ seconds)
- HTTP 200 response
- Empty content blocks returned

**Reproduction:**
1. Send request with 56 tools (XML format)
2. Ling-1T model
3. Blank response

**Workaround:** None found

**Root Cause:** Unknown (model limitation? XML format? Too many tools?)

### Issue #3: Tool Request Without Tools Specified
**Status:** 🟡 OBSERVED  
**Severity:** MEDIUM  
**Frequency:** Intermittent

**Behavior:**
User says "Check core-memory" but request shows `Tools: 0`

**Investigation Needed:**
- Is Claude Code filtering tools?
- Is there a flag we're missing?
- Context-dependent tool sending?

---

## 💡 Insights & Observations

### 1. Claude Code Always Sends All Tools
Claude Code (Anthropic API) sends the **full tool array** in EVERY request, regardless of whether tools are needed. This is API design - tools represent "what's available", not "what to use".

**Implication:** We can't rely on `tools.length` to determine if tools should be used.

### 2. OpenRouter ≠ Anthropic
OpenRouter is a **proxy to many providers**, each with different capabilities:
- Anthropic's native API handles 50+ tools fine
- OpenRouter's wrapper adds limitations
- Each underlying provider (Anthropic, OpenAI, etc.) has different limits

**Implication:** We need provider-specific handling, not just model-specific.

### 3. XML Instructions Are Verbose
For 56 tools, the XML instruction block is **thousands of tokens**:
- Tool name + description + parameters × 56
- Eats into context window
- May confuse simpler models

**Implication:** XML might only be viable with fewer tools.

### 4. Error Messages Are Generic
OpenRouter's 400 errors don't specify:
- Exact tool limit
- Which tool failed
- What schema issue exists

**Implication:** We need empirical testing to find limits.

### 5. Other Tools Work
Cursor, Aider, Continue all work with OpenRouter + tools successfully.

**Implication:** There's a working pattern we haven't discovered yet.

---

## 📖 Code References

### Files Modified in v1.5.0

1. **`index.js`** (main proxy)
   - Lines 18-39: Model capability detection
   - Lines 44-72: Native tool response parser
   - Lines 296-313: Conditional injection (non-streaming)
   - Lines 443-460: Conditional injection (streaming)
   - Lines 464-484: Enhanced tool logging
   - Lines 610-638: Conditional response parsing

2. **`xml-tool-formatter.js`** (XML generation)
   - Line 6-60: `generateXMLToolInstructions()`
   - Line 41-60: `formatToolDocumentation()`
   - Line 62-98: `injectXMLToolInstructions()`

3. **`xml-tool-parser.js`** (XML parsing)
   - Line 44-104: `parseAssistantMessage()` - Main parser
   - Line 111-139: `findToolTag()` - Tag detection
   - Line 146-178: `parseToolBlock()` - Tool extraction
   - Line 185-230: `parseToolParameters()` - Parameter parsing

### Key Functions

**Determine tool mode:**
```javascript
const needsXMLTools = tools.length > 0 && modelNeedsXMLTools(selectedModel)
```

**Select messages:**
```javascript
const messagesWithXML = needsXMLTools
  ? injectXMLToolInstructions(messages, tools)
  : messages
```

**Build payload:**
```javascript
const openaiPayload = {
  model: selectedModel,
  messages: messagesWithXML,
  // ...
}

if (!needsXMLTools && tools.length > 0) {
  openaiPayload.tools = tools  // Native format
}
```

**Parse response:**
```javascript
if (needsXMLTools) {
  contentBlocks = parseAssistantMessage(openaiMessage.content || '')
} else {
  contentBlocks = parseNativeToolResponse(openaiMessage)
}
```

---

## 🔮 Future Directions

### Short Term (Next Session)
1. **Research phase** - Study working implementations
2. **Find tool limits** - Empirical testing with different counts
3. **Implement filtering** - Smart tool subset selection

### Medium Term (Next Sprint)
1. **Model compatibility matrix** - Document what works with each model
2. **Adaptive tool sending** - Context-aware tool filtering
3. **Better error handling** - Graceful degradation when tools fail

### Long Term (Future Versions)
1. **Tool caching** - Reduce repeated tool definitions
2. **Multi-provider support** - Different strategies per provider
3. **Tool relevance ML** - Learn which tools are needed for which queries
4. **Streaming tool injection** - Progressive tool loading during conversation

---

## 📚 Resources & Links

### Documentation
- [OpenRouter API Docs](https://openrouter.ai/docs)
- [Anthropic Tool Use Guide](https://docs.anthropic.com/claude/docs/tool-use)
- [OpenAI Function Calling](https://platform.openai.com/docs/guides/function-calling)

### Reference Implementations
- [Aider](https://github.com/paul-gauthier/aider) - See `/aider/openrouter.py`
- [Continue](https://github.com/continuedev/continue) - See `/core/llm/`
- [LiteLLM](https://github.com/BerriAI/litellm) - See `/litellm/openrouter.py`

### Community
- [OpenRouter Discord](https://discord.gg/openrouter)
- [OpenRouter GitHub Issues](https://github.com/OpenRouter/OpenRouter/issues)

---

## 📄 Version History

### v1.5.0 (2025-10-23)
- ✅ Added XML tool calling support
- ✅ Character-by-character XML parser
- ✅ Conditional tool injection (model-aware)
- ✅ Dual-mode response parsing
- ❌ Haiku fails with native tools (400 error)
- ❌ Ling-1T returns blanks with XML tools
- 📝 **Status:** Needs tool count limiting

### Future v1.5.1 (Planned)
- 🎯 Tool count filtering
- 🎯 Model-specific tool limits
- 🎯 Enhanced error handling
- 🎯 Documentation of working patterns

---

## 🎓 Lessons Learned

1. **Don't assume API parity** - OpenRouter ≠ Anthropic, even for same models
2. **Test empirically** - Documentation doesn't always match reality
3. **Study working code** - Other tools have solved this problem
4. **Start simple** - Test with fewer tools before scaling up
5. **Provider matters** - Same model through different providers = different behavior

---

## ✅ Action Items for Next Session

1. **CRITICAL:** Find tool count limits
   ```bash
   # Test with: 5, 10, 15, 20, 25, 30 tools
   # Record exactly when it starts failing
   ```

2. **RESEARCH:** Study Aider's code
   ```bash
   git clone https://github.com/paul-gauthier/aider
   # Find OpenRouter integration
   # See how they handle tools
   ```

3. **IMPLEMENT:** Simple tool filtering
   ```javascript
   const MAX_TOOLS = 15  // Conservative start
   const toolsToSend = tools.slice(0, MAX_TOOLS)
   ```

4. **TEST:** Verify filtering fixes Haiku
   - Send 15 tools instead of 56
   - Confirm 400 error goes away
   - Document working threshold

5. **INVESTIGATE:** Ling-1T capabilities
   - Can it do tool calling at all?
   - Try with just 1-2 tools
   - Test different XML formats

---

**BOTTOM LINE:** The infrastructure is sound. We just need to find OpenRouter's limits and work within them. Other tools prove this is possible - we need to learn from their approaches.
