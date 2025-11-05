/**
 * Transformer Registry and Pipeline System
 * 
 * Inspired by claude-code-router's bidirectional transformer architecture.
 * Provides a registry for model-specific transformers that can modify requests
 * before sending to providers and responses before returning to clients.
 * 
 * Each transformer exports:
 * - transform(request, options): Modify request payload before upstream call
 * - reverseTransform(response, options): Modify response payload before client return
 */

class TransformerRegistry {
  constructor() {
    this.transformers = new Map();
  }

  /**
   * Register a transformer by name
   * @param {string} name - Transformer name
   * @param {object} transformer - Object with transform/reverseTransform functions
   */
  register(name, transformer) {
    if (!transformer.transform || typeof transformer.transform !== 'function') {
      throw new Error(`Transformer ${name} must export a transform function`);
    }
    if (!transformer.reverseTransform || typeof transformer.reverseTransform !== 'function') {
      throw new Error(`Transformer ${name} must export a reverseTransform function`);
    }
    this.transformers.set(name, transformer);
  }

  /**
   * Get a transformer by name
   * @param {string} name - Transformer name
   * @returns {object|null} Transformer object or null if not found
   */
  get(name) {
    return this.transformers.get(name) || null;
  }

  /**
   * Check if a transformer is registered
   * @param {string} name - Transformer name
   * @returns {boolean}
   */
  has(name) {
    return this.transformers.has(name);
  }
}

/**
 * Apply a sequence of transformers to data (request direction)
 * @param {Array<string|Array>} transformerConfigs - Array of transformer names or [name, options] tuples
 * @param {object} data - Data to transform
 * @param {TransformerRegistry} registry - Transformer registry
 * @returns {Promise<object>} Transformed data
 */
async function applyTransformers(transformerConfigs, data, registry) {
  let result = data;
  
  for (const config of transformerConfigs) {
    const [name, options] = Array.isArray(config) ? config : [config, {}];
    
    const transformer = registry.get(name);
    if (!transformer) {
      console.error(`[Transformer] Transformer '${name}' not found in registry, skipping`);
      continue;
    }
    
    try {
      result = await transformer.transform(result, options);
    } catch (error) {
      console.error(`[Transformer] Error in ${name}.transform():`, error);
      // Continue with untransformed data on error
    }
  }
  
  return result;
}

/**
 * Apply reverse transformers to data (response direction)
 * Transformers are applied in REVERSE order compared to request direction
 * @param {Array<string|Array>} transformerConfigs - Array of transformer names or [name, options] tuples
 * @param {object} data - Data to transform
 * @param {TransformerRegistry} registry - Transformer registry
 * @returns {Promise<object>} Transformed data
 */
async function applyReverseTransformers(transformerConfigs, data, registry) {
  let result = data;
  
  // Apply in reverse order
  for (let i = transformerConfigs.length - 1; i >= 0; i--) {
    const config = transformerConfigs[i];
    const [name, options] = Array.isArray(config) ? config : [config, {}];
    
    const transformer = registry.get(name);
    if (!transformer) {
      console.error(`[Transformer] Transformer '${name}' not found in registry, skipping`);
      continue;
    }
    
    try {
      result = await transformer.reverseTransform(result, options);
    } catch (error) {
      console.error(`[Transformer] Error in ${name}.reverseTransform():`, error);
      // Continue with untransformed data on error
    }
  }
  
  return result;
}

export {
  TransformerRegistry,
  applyTransformers,
  applyReverseTransformers
};
