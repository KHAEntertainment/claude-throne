/**
 * Enhance Tool Transformer
 * 
 * Adds error tolerance to tool calling by validating and repairing
 * malformed tool calls. Helps with models that occasionally generate
 * invalid JSON in tool call arguments.
 */

/**
 * Transform request to validate tool schemas
 * @param {object} request - Request payload
 * @param {object} options - Transformer options
 * @returns {Promise<object>} Transformed request
 */
async function transform(request, options = {}) {
  // Validate tool schemas if present
  if (request.tools && Array.isArray(request.tools)) {
    request.tools = request.tools.map(tool => {
      // Ensure input_schema exists
      if (!tool.input_schema) {
        tool.input_schema = {
          type: 'object',
          properties: {},
          required: []
        };
      }
      
      // Ensure properties exist
      if (!tool.input_schema.properties) {
        tool.input_schema.properties = {};
      }
      
      // Ensure required is an array
      if (!Array.isArray(tool.input_schema.required)) {
        tool.input_schema.required = [];
      }
      
      return tool;
    });
  }
  
  return request;
}

/**
 * Reverse transform to repair malformed tool calls
 * @param {object} response - Response payload
 * @param {object} options - Transformer options
 * @returns {Promise<object>} Transformed response
 */
async function reverseTransform(response, options = {}) {
  // Handle streaming delta with tool use
  if (response.type === 'content_block_delta' && response.delta?.type === 'input_json_delta') {
    // For streaming, we can't fully validate until complete
    // Just ensure the structure is valid
    return response;
  }
  
  // Handle single tool_use block (when response itself is a tool_use)
  if (response.type === 'tool_use' && response.input) {
    try {
      // Validate that input is a valid object
      if (typeof response.input === 'string') {
        // Try to parse if it's a JSON string
        response.input = JSON.parse(response.input);
      }
      
      // Ensure input is an object
      if (typeof response.input !== 'object' || response.input === null) {
        console.error('[Transformer:enhancetool] Invalid tool input, using empty object:', response.input);
        response.input = {};
      }
    } catch (error) {
      console.error('[Transformer:enhancetool] Failed to parse tool input:', error);
      // Provide fallback structure
      response.input = {};
    }
    return response;
  }
  
  // Handle complete content blocks with tool use
  if (response.content && Array.isArray(response.content)) {
    response.content = response.content.map(block => {
      if (block.type === 'tool_use' && block.input) {
        try {
          // Validate that input is a valid object
          if (typeof block.input === 'string') {
            // Try to parse if it's a JSON string
            block.input = JSON.parse(block.input);
          }
          
          // Ensure input is an object
          if (typeof block.input !== 'object' || block.input === null) {
            console.error('[Transformer:enhancetool] Invalid tool input, using empty object:', block.input);
            block.input = {};
          }
        } catch (error) {
          console.error('[Transformer:enhancetool] Failed to parse tool input:', error);
          // Provide fallback structure
          block.input = {};
        }
      }
      return block;
    });
  }
  
  return response;
}

export default {
  transform,
  reverseTransform
};
