/**
 * XML Tool Parser - Extracts tool calls from model responses
 * Based on Kilo-Code's character-by-character parsing approach
 * 
 * This implementation properly preserves text content while extracting tool calls,
 * maintaining the correct order and position of text vs tools.
 */

// Default known tool names from Claude Code MCP tools
const DEFAULT_KNOWN_TOOLS = new Set([
  // File operations
  'Read', 'Write', 'Edit', 'Create', 'MultiEdit',
  // Execution
  'Execute',
  // Search
  'Grep', 'Glob', 'LS',
  // Task management
  'Task', 'TodoWrite',
  // Web
  'FetchUrl', 'WebSearch',
  // Context7
  'context7___resolve-library-id',
  'context7___get-library-docs',
  // DeepWiki
  'deepwiki___read_wiki_structure',
  'deepwiki___read_wiki_contents',
  'deepwiki___ask_question',
  // Ref
  'Ref___ref_search_documentation',
  'Ref___ref_read_url',
  // CopilotKit
  'copilotkit___search-docs',
  'copilotkit___search-code',
  // Legacy snake_case (for backward compatibility)
  'read_file', 'write_file', 'edit_file', 'create_file',
  'execute_command', 'search_files', 'list_files',
  'ask_followup_question'
])

// Registry for dynamically registered tools
let toolRegistry = new Set(DEFAULT_KNOWN_TOOLS)

/**
 * Register additional tool names dynamically
 * @param {string[]|Set<string>} tools - Tool names to add
 */
export function registerTools(tools) {
  if (Array.isArray(tools)) {
    tools.forEach(tool => toolRegistry.add(tool))
  } else if (tools instanceof Set) {
    tools.forEach(tool => toolRegistry.add(tool))
  } else if (typeof tools === 'string') {
    toolRegistry.add(tools)
  }
}

/**
 * Get current tool registry
 * @returns {Set<string>} Copy of current tool registry
 */
export function getKnownTools() {
  return new Set(toolRegistry)
}

/**
 * Reset tool registry to defaults
 */
export function resetToolRegistry() {
  toolRegistry = new Set(DEFAULT_KNOWN_TOOLS)
}

/**
 * Main parsing function - uses character-by-character parsing to extract
 * text and tool blocks while preserving their order and position
 * @param {string} content - The content to parse
 * @param {Set<string>|string[]} [knownTools] - Optional set/array of known tool names. If not provided, uses registry.
 */
export function parseAssistantMessage(content, knownTools = null) {
  // Safety check for invalid content
  if (!content || typeof content !== 'string') {
    console.warn('[XML Parser] Invalid content received:', content)
    return [{
      type: 'text',
      text: ''
    }]
  }

  try {
    // Use provided knownTools or fall back to registry
    const toolsToCheck = knownTools 
      ? (knownTools instanceof Set ? knownTools : new Set(knownTools))
      : toolRegistry
    
    const contentBlocks = []
    let currentTextStart = 0
    let i = 0

    while (i < content.length) {
      // Check if we're at the start of a known tool tag
      const toolMatch = findToolTag(content, i, toolsToCheck)
      
      if (toolMatch) {
        // Extract any text BEFORE this tool
        if (i > currentTextStart) {
          const text = content.substring(currentTextStart, i).trim()
          if (text) {
            contentBlocks.push({
              type: 'text',
              text: text
            })
          }
        }

        // Parse the tool block
        const toolResult = parseToolBlock(content, toolMatch)
        
        if (toolResult) {
          contentBlocks.push({
            type: 'tool_use',
            id: toolResult.id,
            name: toolResult.name,
            input: toolResult.input
          })
          
          // Move past the tool block
          i = toolResult.endIndex
          currentTextStart = toolResult.endIndex
        } else {
          // If tool parsing failed, treat it as text and continue
          i++
        }
      } else {
        // Not a tool tag, continue scanning
        i++
      }
    }

    // Extract any remaining text after the last tool
    if (currentTextStart < content.length) {
      const text = content.substring(currentTextStart).trim()
      if (text) {
        contentBlocks.push({
          type: 'text',
          text: text
        })
      }
    }

    // If no content blocks were found, return the original content as text
    if (contentBlocks.length === 0) {
      return [{
        type: 'text',
        text: content.trim()
      }]
    }

    return contentBlocks
  } catch (parseError) {
    console.warn('[XML Parser] Error parsing assistant message:', parseError)
    // Return raw content as text on error
    return [{
      type: 'text',
      text: content
    }]
  }
}

/**
 * Find a known tool tag starting at the given index
 * Returns the tool name and tag end position, or null if not found
 * @param {string} content - Content to search
 * @param {number} startIndex - Index to start searching from
 * @param {Set<string>} knownTools - Set of known tool names
 */
function findToolTag(content, startIndex, knownTools) {
  if (content[startIndex] !== '<') {
    return null
  }

  // Check if this is a closing tag (skip those)
  if (content[startIndex + 1] === '/') {
    return null
  }

  // Extract tag name
  let i = startIndex + 1
  let tagName = ''
  
  while (i < content.length && content[i] !== '>' && content[i] !== ' ') {
    tagName += content[i]
    i++
  }

  // Skip to closing '>'
  while (i < content.length && content[i] !== '>') {
    i++
  }

  if (i >= content.length) {
    return null // Incomplete tag
  }

  // Check if this is a known tool
  if (knownTools.has(tagName)) {
    return {
      toolName: tagName,
      tagEndIndex: i + 1
    }
  }

  // Warn about unknown but tool-like tags (for metrics)
  if (tagName && /^[A-Z]/.test(tagName) && !tagName.includes(' ')) {
    console.warn(`[XML Parser] Encountered unknown tool-like tag: <${tagName}>. Consider registering it.`)
  }

  return null
}

/**
 * Parse a complete tool block starting from a known tool tag
 * Returns the tool object with name, input, and end position
 */
function parseToolBlock(content, toolMatch) {
  const { toolName, tagEndIndex } = toolMatch
  const closingTag = `</${toolName}>`
  
  // Find the matching closing tag
  const closingTagIndex = content.indexOf(closingTag, tagEndIndex)
  
  if (closingTagIndex === -1) {
    console.warn(`[XML Parser] No closing tag found for <${toolName}>`)
    return null
  }

  // Extract content between opening and closing tags
  const toolContent = content.substring(tagEndIndex, closingTagIndex)
  
  // Parse parameters from the tool content
  const input = parseToolParameters(toolContent)

  return {
    id: generateToolId(),
    name: toolName,
    input: input,
    endIndex: closingTagIndex + closingTag.length
  }
}

/**
 * Parse parameters from tool content
 * Example: "<path>/file.txt</path><content>hello</content>" 
 *       -> { path: '/file.txt', content: 'hello' }
 */
function parseToolParameters(toolContent) {
  const params = {}
  const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
  let match

  while ((match = paramRegex.exec(toolContent)) !== null) {
    const paramName = match[1]
    let paramValue = match[2]

    // Special handling for 'content' parameter - preserve formatting
    if (paramName === 'content' || paramName === 'code_edit' || paramName === 'new_str' || paramName === 'old_str') {
      // Only trim leading/trailing newlines, not all whitespace
      paramValue = paramValue.replace(/^\n+/, '').replace(/\n+$/, '')
    } else {
      paramValue = paramValue.trim()
    }

    // Handle nested parameters (like <args><path>...</path></args>)
    if (paramValue.includes('<')) {
      const nestedParams = {}
      const nestedRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
      let nestedMatch

      while ((nestedMatch = nestedRegex.exec(paramValue)) !== null) {
        nestedParams[nestedMatch[1]] = nestedMatch[2].trim()
      }

      // If we found nested params, use them; otherwise use the raw value
      if (Object.keys(nestedParams).length > 0) {
        params[paramName] = nestedParams
      } else {
        params[paramName] = paramValue
      }
    } else {
      params[paramName] = paramValue
    }
  }

  return params
}

// Monotonic counter for tool call IDs (ensures stable, collision-free IDs)
let toolIdCounter = 0

/**
 * Generate a unique tool call ID using a monotonic counter
 * Format: toolu_<timestamp>_<counter> ensures uniqueness and stability
 */
function generateToolId() {
  toolIdCounter++
  const timestamp = Date.now()
  // Use counter for uniqueness within the same millisecond
  return `toolu_${timestamp}_${toolIdCounter.toString(36)}`
}

/**
 * Check if content has any XML tool calls
 * (Useful for quick detection without full parsing)
 * @param {string} content - Content to check
 * @param {Set<string>|string[]} [knownTools] - Optional set/array of known tool names
 */
export function hasXMLToolCalls(content, knownTools = null) {
  if (!content || typeof content !== 'string') {
    return false
  }

  const toolsToCheck = knownTools 
    ? (knownTools instanceof Set ? knownTools : new Set(knownTools))
    : toolRegistry

  // Check if any known tool tags are present
  for (const toolName of toolsToCheck) {
    if (content.includes(`<${toolName}>`)) {
      return true
    }
  }

  return false
}

/**
 * Legacy function for backward compatibility
 * Extracts just the tool calls (without text)
 */
export function parseXMLToolCalls(content) {
  const blocks = parseAssistantMessage(content)
  return blocks
    .filter(block => block.type === 'tool_use')
    .map(block => ({
      id: block.id,
      type: 'function',
      function: {
        name: block.name,
        arguments: JSON.stringify(block.input)
      }
    }))
}

/**
 * Legacy function for backward compatibility
 * Extracts just the text content (without tools)
 */
export function extractTextContent(content) {
  const blocks = parseAssistantMessage(content)
  return blocks
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
}
