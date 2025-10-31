/**
 * Helper functions for transforming request/response data
 */

/**
 * Normalize content from various formats to a string
 * @param {*} content - The content to normalize
 * @returns {string|null} - Normalized content as string, or null if invalid
 */
export function normalizeContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter(item => item && item.type === 'text' && typeof item.text === 'string')
      .map(item => item.text)
      .join(' ')
  }
  return null
}

/**
 * Recursively traverse JSON schema and remove format: 'uri'
 * 
 * This is used to strip URI format constraints from tool schemas for providers
 * that don't support them (e.g., some OpenAI-compatible endpoints).
 * 
 * Controlled by DISABLE_URI_FORMAT env var (set to '1' to enable removal).
 * When disabled (default), URI formats are preserved.
 * 
 * @param {*} schema - The schema to process
 * @param {boolean} [force=false] - Force removal regardless of env setting
 * @returns {*} - The cleaned schema
 */
export function removeUriFormat(schema, force = false) {
  // Check if URI format removal is enabled
  const shouldRemove = force || process.env.DISABLE_URI_FORMAT === '1'
  
  if (!shouldRemove) {
    return schema // Return unchanged if removal is disabled
  }
  if (!schema || typeof schema !== 'object') return schema;

  // If this is a string type with uri format, remove the format
  if (schema.type === 'string' && schema.format === 'uri') {
    const { format, ...rest } = schema;
    return rest;
  }

  // Handle array of schemas (like in anyOf, allOf, oneOf)
  if (Array.isArray(schema)) {
    return schema.map(item => removeUriFormat(item));
  }

  // Recursively process all properties
  const result = {};
  for (const key in schema) {
    if (key === 'properties' && typeof schema[key] === 'object') {
      result[key] = {};
      for (const propKey in schema[key]) {
        result[key][propKey] = removeUriFormat(schema[key][propKey]);
      }
    } else if (key === 'items' && typeof schema[key] === 'object') {
      result[key] = removeUriFormat(schema[key]);
    } else if (key === 'additionalProperties' && typeof schema[key] === 'object') {
      result[key] = removeUriFormat(schema[key]);
    } else if (['anyOf', 'allOf', 'oneOf'].includes(key) && Array.isArray(schema[key])) {
      result[key] = schema[key].map(item => removeUriFormat(item));
    } else {
      result[key] = removeUriFormat(schema[key]);
    }
  }
  return result;
}
