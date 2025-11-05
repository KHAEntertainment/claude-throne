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
      // Comment 4: Omit deprecated 'reasoning' field instead of setting to undefined
      const { reasoning, ...restDelta } = response.delta;
      return {
        type: 'content_block_delta',
        index: response.index,
        delta: {
          ...restDelta,
          type: 'thinking_delta',
          thinking: reasoning
        }
      };
    }
    
    // Check for reasoning_content in delta (alternative format)
    if (response.delta?.reasoning_content) {
      // Comment 4: Omit deprecated 'reasoning_content' field instead of setting to undefined
      const { reasoning_content, ...restDelta } = response.delta;
      return {
        type: 'content_block_delta',
        index: response.index,
        delta: {
          ...restDelta,
          type: 'thinking_delta',
          thinking: reasoning_content
        }
      };
    }
  }
  
  // Handle content_block_start with reasoning
  if (response.type === 'content_block_start') {
    if (response.content_block?.reasoning) {
      // Comment 4: Omit deprecated 'reasoning' field instead of setting to undefined
      const { reasoning, ...restBlock } = response.content_block;
      return {
        type: 'content_block_start',
        index: response.index,
        content_block: {
          ...restBlock,
          type: 'thinking',
          thinking: reasoning
        }
      };
    }
    
    if (response.content_block?.reasoning_content) {
      // Comment 4: Omit deprecated 'reasoning_content' field instead of setting to undefined
      const { reasoning_content, ...restBlock } = response.content_block;
      return {
        type: 'content_block_start',
        index: response.index,
        content_block: {
          ...restBlock,
          type: 'thinking',
          thinking: reasoning_content
        }
      };
    }
  }
  
  // Handle complete response with reasoning content
  if (response.content && Array.isArray(response.content)) {
    response.content = response.content.map(block => {
      // Convert reasoning blocks to thinking blocks
      if (block.reasoning) {
        // Comment 4: Omit deprecated 'reasoning' field instead of setting to undefined
        const { reasoning, ...rest } = block;
        return {
          ...rest,
          type: 'thinking',
          thinking: reasoning
        };
      }
      
      if (block.reasoning_content) {
        // Comment 4: Omit deprecated 'reasoning_content' field instead of setting to undefined
        const { reasoning_content, ...rest } = block;
        return {
          ...rest,
          type: 'thinking',
          thinking: reasoning_content
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
