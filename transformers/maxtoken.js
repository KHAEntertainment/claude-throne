/**
 * Max Token Transformer
 * 
 * Enforces maximum token limits to prevent truncated output.
 * Useful for models with non-standard token limits or to prevent
 * truncation issues when the client doesn't specify max_tokens.
 */

/**
 * Transform request to enforce max token limits
 * @param {object} request - Request payload
 * @param {object} options - Transformer options (should include max_tokens)
 * @returns {Promise<object>} Transformed request
 */
async function transform(request, options = {}) {
  const configuredMaxTokens = options.max_tokens;
  
  if (configuredMaxTokens) {
    // If request doesn't have max_tokens, set it
    if (!request.max_tokens) {
      request.max_tokens = configuredMaxTokens;
    } else {
      // If request has max_tokens but exceeds the configured limit, cap it
      if (request.max_tokens > configuredMaxTokens) {
        request.max_tokens = configuredMaxTokens;
      }
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
