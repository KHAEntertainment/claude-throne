/**
 * Tool Use Transformer
 * 
 * Optimizes tool calling behavior by setting tool_choice to 'auto'
 * when tools are available. This helps models that support tool calling
 * but need explicit guidance to use them effectively.
 */

/**
 * Transform request to encourage tool usage
 * @param {object} request - Request payload
 * @param {object} options - Transformer options
 * @returns {Promise<object>} Transformed request
 */
async function transform(request, options = {}) {
  // If tools are present and tool_choice is not set, encourage usage
  if (request.tools && Array.isArray(request.tools) && request.tools.length > 0) {
    if (!request.tool_choice) {
      request.tool_choice = { type: 'auto' };
    }
  }
  
  return request;
}

/**
 * Reverse transform (pass-through for this transformer)
 * @param {object} response - Response payload
 * @param {object} options - Transformer options
 * @returns {Promise<object>} Transformed response
 */
async function reverseTransform(response, options = {}) {
  // No response modification needed
  return response;
}

export default {
  transform,
  reverseTransform
};
