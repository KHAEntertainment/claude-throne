/**
 * XML Tool Parser - Extracts tool calls from model responses
 * Based on Kilo-Code's character-by-character parsing approach
 */

export function parseXMLToolCalls(content) {
  // Safety check for invalid content
  if (!content || typeof content !== 'string') {
    console.warn('parseXMLToolCalls: Invalid content received:', content)
    return []
  }
  
  const toolCalls = []
  const toolRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
  let match
  
  while ((match = toolRegex.exec(content)) !== null) {
    const toolName = match[1]
    const toolContent = match[2]
    
    // Skip if this looks like HTML, not a tool call
    if (['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'strong', 'em', 'br', 'hr'].includes(toolName)) {
      continue
    }
    
    // Validate that the XML is well-formed by checking if all tags within toolContent are properly closed
    if (!isWellFormedXML(toolContent)) {
      continue
    }
    
    // Parse parameters from XML content
    const params = {}
    const paramRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
    let paramMatch
    
    while ((paramMatch = paramRegex.exec(toolContent)) !== null) {
      const paramName = paramMatch[1]
      const paramValue = paramMatch[2].trim()
      
      // Handle nested parameters (like args containing path)
      if (paramName === 'args' && paramValue.includes('<')) {
        const nestedParams = {}
        const nestedRegex = /<(\w+)>([\s\S]*?)<\/\1>/g
        let nestedMatch
        
        while ((nestedMatch = nestedRegex.exec(paramValue)) !== null) {
          nestedParams[nestedMatch[1]] = nestedMatch[2].trim()
        }
        params[paramName] = nestedParams
      } else {
        params[paramName] = paramValue
      }
    }
    
    toolCalls.push({
      id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'function',
      function: {
        name: toolName,
        arguments: JSON.stringify(params)
      }
    })
  }
  
  return toolCalls
}

function isWellFormedXML(xmlContent) {
  // Simple check to ensure all opening tags have corresponding closing tags
  const stack = []
  const tagRegex = /<\/?(\w+)[^>]*>/g
  let match
  
  while ((match = tagRegex.exec(xmlContent)) !== null) {
    const tag = match[0]
    const tagName = match[1]
    
    if (tag.startsWith('</')) {
      // Closing tag
      if (stack.length === 0 || stack.pop() !== tagName) {
        return false
      }
    } else if (!tag.endsWith('/>')) {
      // Opening tag (not self-closing)
      stack.push(tagName)
    }
  }
  
  return stack.length === 0
}

function parseTag(content, startIndex) {
  if (content[startIndex] !== '<') {
    return null
  }

  let i = startIndex + 1
  let isClosing = false
  
  // Check for closing tag
  if (i < content.length && content[i] === '/') {
    isClosing = true
    i++
  }

  // Parse tag name
  let tagName = ''
  while (i < content.length && content[i] !== '>' && !isWhitespace(content[i])) {
    tagName += content[i]
    i++
  }

  // Skip to closing '>'
  while (i < content.length && content[i] !== '>') {
    i++
  }

  if (i >= content.length || content[i] !== '>') {
    return null // Invalid tag
  }

  return {
    tagName,
    isClosing,
    endIndex: i + 1
  }
}

function isWhitespace(char) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}

export function extractTextContent(content) {
  // Safety check for invalid content
  if (!content || typeof content !== 'string') {
    console.warn('extractTextContent: Invalid content received:', content)
    return ''
  }
  
  // Remove XML tags to get plain text content, preserving line breaks
  // First remove tool XML, then clean up remaining tags
  const withoutToolXML = content.replace(/<\w+>[\s\S]*?<\/\w+>/g, '')
  return withoutToolXML.replace(/<[^>]*>/g, '').replace(/\n\s*\n/g, '\n\n').trim()
}

export function hasXMLToolCalls(content) {
  // Check for XML tool patterns (more specific than just any XML)
  // Look for common tool names and proper XML structure
  const toolNames = ['read_file', 'write_file', 'search_files', 'execute_command', 'ask_followup_question']
  const toolPattern = toolNames.map(name => `<${name}>`).join('|')
  return new RegExp(`(${toolPattern})`).test(content) && /<\/\w+>/.test(content)
}

export function parseAssistantMessage(content) {
  // Safety check for invalid content
  if (!content || typeof content !== 'string') {
    console.warn('parseAssistantMessage: Invalid content received:', content)
    return [{
      type: 'text',
      text: ''
    }]
  }
  
  try {
    const toolCalls = parseXMLToolCalls(content)
    const textContent = extractTextContent(content)
    
    const contentBlocks = []
    
    // Add text content if not empty
    if (textContent) {
      contentBlocks.push({
        type: 'text',
        text: textContent
      })
    }
    
    // Add tool calls with safe JSON parsing
    toolCalls.forEach(toolCall => {
      try {
        contentBlocks.push({
          type: 'tool_use',
          id: toolCall.id,
          name: toolCall.function.name,
          input: JSON.parse(toolCall.function.arguments)
        })
      } catch (jsonError) {
        console.warn('Error parsing tool call arguments:', jsonError, 'toolCall:', toolCall)
        // Skip malformed tool calls
      }
    })
    
    return contentBlocks
  } catch (parseError) {
    console.warn('Error parsing assistant message:', parseError, 'content:', content)
    // Return a simple text block with the raw content if parsing fails
    return [{
      type: 'text',
      text: content
    }]
  }
}