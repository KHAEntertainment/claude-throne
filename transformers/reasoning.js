/**
 * Reasoning Transformer
 * 
 * Processes reasoning_content fields for models that include chain-of-thought
 * reasoning in their responses. Converts various reasoning formats to Anthropic's
 * thinking_delta event format for streaming, and extracts reasoning_content for
 * non-streaming responses.
 */

/**
 * Transform request (pass-through for this transformer)
 * @param {object} request - Request payload
 * @param {object} options - Transformer options
 * @returns {Promise<object>} Transformed request
 */
async function transform(request, options = {}) {
  // No request modification needed
  return request;
}

/**
 * Reverse transform to process reasoning content
 * @param {object} response - Response payload
 * @param {object} options - Transformer options
 * @returns {Promise<object>} Transformed response
 */
async function reverseTransform(response, options = {}) {
  // Handle streaming delta with reasoning
  if (response.type === 'content_block_delta') {
    // Check for reasoning in delta
    if (response.delta?.reasoning) {
      // Convert to thinking_delta format
      return {
        type: 'content_block_delta',
        index: response.index,
        delta: {
          type: 'thinking_delta',
          thinking: response.delta.reasoning
        }
      };
    }
    
    // Check for reasoning_content in delta (alternative format)
    if (response.delta?.reasoning_content) {
      return {
        type: 'content_block_delta',
        index: response.index,
        delta: {
          type: 'thinking_delta',
          thinking: response.delta.reasoning_content
        }
      };
    }
  }
  
  // Handle content_block_start with reasoning
  if (response.type === 'content_block_start') {
    if (response.content_block?.reasoning) {
      return {
        type: 'content_block_start',
        index: response.index,
        content_block: {
          type: 'thinking',
          thinking: response.content_block.reasoning
        }
      };
    }
    
    if (response.content_block?.reasoning_content) {
      return {
        type: 'content_block_start',
        index: response.index,
        content_block: {
          type: 'thinking',
          thinking: response.content_block.reasoning_content
        }
      };
    }
  }
  
  // Handle complete response with reasoning content
  if (response.content && Array.isArray(response.content)) {
    response.content = response.content.map(block => {
      // Convert reasoning blocks to thinking blocks
      if (block.reasoning) {
        return {
          type: 'thinking',
          thinking: block.reasoning
        };
      }
      
      if (block.reasoning_content) {
        return {
          type: 'thinking',
          thinking: block.reasoning_content
        };
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
