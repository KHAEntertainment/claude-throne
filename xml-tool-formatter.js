/**
 * XML Tool Formatter - Generates XML tool documentation for system prompts
 * Based on Kilo-Code's approach for universal tool compatibility
 */

// Sentinel marker to detect if XML tool instructions have already been injected
const XML_TOOL_INSTRUCTIONS_SENTINEL = '====\n\nTOOL USE\n\n'

export function generateXMLToolInstructions(tools) {
  if (!tools || tools.length === 0) {
    return ''
  }

  const toolInstructions = `${XML_TOOL_INSTRUCTIONS_SENTINEL}

You have access to a set of tools that are executed upon the user's approval. You must use exactly one tool per message, and every assistant message must include a tool call. You use tools step-by-step to accomplish a given task, with each tool use informed by the result of the previous tool use.

# Tool Use Formatting

Tool uses are formatted using XML-style tags. The tool name itself becomes the XML tag name. Each parameter is enclosed within its own set of tags. Here's the structure:

<actual_tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
...
</actual_tool_name>

Always use the actual tool name as the XML tag name for proper parsing and execution.

Available tools:
${tools.map(tool => formatToolDocumentation(tool)).join('\n')}

====`

  return toolInstructions
}

function formatToolDocumentation(tool) {
  const { name, description, parameters } = tool.function
  const properties = parameters?.properties || {}
  const required = parameters?.required || []

  let doc = `## ${name}
Description: ${description}

Parameters:
${Object.entries(properties).map(([paramName, schema]) => {
  const isRequired = required.includes(paramName) ? ' (required)' : ' (optional)'
  return `- ${paramName}${isRequired}: ${schema.description || 'No description'}`
}).join('\n')}

Usage:
<${name}>
${Object.keys(properties).map(paramName => 
  `  <${paramName}>value</${paramName}>`
).join('\n')}
</${name}>`

  return doc
}

export function injectXMLToolInstructions(messages, tools, options = {}) {
  // Check if injection is disabled via env/config
  if (process.env.DISABLE_XML_TOOL_INSTRUCTIONS === '1' || options.disabled) {
    return messages
  }
  
  const xmlInstructions = generateXMLToolInstructions(tools)
  
  if (!xmlInstructions) {
    return messages
  }

  // Check for sentinel marker to prevent double-injection
  for (const msg of messages) {
    if (msg.role === 'system' && typeof msg.content === 'string') {
      if (msg.content.includes(XML_TOOL_INSTRUCTIONS_SENTINEL)) {
        // Already injected, skip
        return messages
      }
    }
  }

  // Create system message with XML tool instructions
  const systemMessage = {
    role: 'system',
    content: xmlInstructions
  }

  // Insert at the beginning, before any existing system messages
  const existingSystemIndex = messages.findIndex(msg => msg.role === 'system')
  
  if (existingSystemIndex === 0) {
    // Prepend to existing system message
    const existingSystem = messages[0]
    return [
      {
        ...existingSystem,
        content: xmlInstructions + '\n\n' + existingSystem.content
      },
      ...messages.slice(1)
    ]
  } else if (existingSystemIndex > 0) {
    // Insert before first system message
    return [
      ...messages.slice(0, existingSystemIndex),
      systemMessage,
      ...messages.slice(existingSystemIndex)
    ]
  } else {
    // No system message, add at beginning
    return [systemMessage, ...messages]
  }
}