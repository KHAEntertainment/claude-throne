import { z } from 'zod'
import { ProviderMapSchema } from './messages'

/**
 * Configuration Schema Definitions
 * 
 * These schemas enforce contracts for VS Code configuration settings
 * and ensure consistency between workspace/global scopes.
 * 
 * Schema Version: 1.0.0
 * Last Updated: 2025-10-28
 */

// ============================================================================
// Core Configuration Types
// ============================================================================

/**
 * Provider ID (built-in providers)
 */
export const ProviderIdSchema = z.enum([
  'openrouter',
  'openai',
  'together',
  'deepseek',
  'glm',
  'custom'
])

export type ProviderId = z.infer<typeof ProviderIdSchema>

/**
 * Configuration target (workspace vs global)
 */
export const ConfigurationTargetSchema = z.enum(['workspace', 'global'])

export type ConfigurationTarget = z.infer<typeof ConfigurationTargetSchema>

/**
 * Custom endpoint kind
 */
export const CustomEndpointKindSchema = z.enum(['auto', 'openai', 'anthropic'])

export type CustomEndpointKind = z.infer<typeof CustomEndpointKindSchema>

// ============================================================================
// VS Code Configuration Schema
// ============================================================================

/**
 * Complete Claude Throne configuration structure
 * 
 * This schema represents the full configuration stored in VS Code settings.
 * It includes both the new provider-scoped format and legacy global keys.
 */
export const ClaudeThroneConfigSchema = z.object({
  // Provider configuration
  provider: z.string().default('openrouter'),
  selectedCustomProviderId: z.string().optional(),
  customBaseUrl: z.string().optional(),
  customEndpointKind: CustomEndpointKindSchema.default('auto'),
  
  // Model selections (provider-scoped - NEW FORMAT)
  modelSelectionsByProvider: z.record(z.string(), ProviderMapSchema).default({}),
  
  // Legacy global model keys (for backward compatibility and fallback)
  reasoningModel: z.string().optional(),
  completionModel: z.string().optional(),
  valueModel: z.string().optional(),
  
  // Two-model mode
  twoModelMode: z.boolean().default(false),
  
  // Proxy configuration
  proxy: z.object({
    port: z.number().default(3000),
    debug: z.boolean().default(false)
  }).default({ port: 3000, debug: false }),
  
  // Apply behavior
  autoApply: z.boolean().default(true),
  applyScope: ConfigurationTargetSchema.default('workspace'),
  
  // Anthropic defaults cache
  anthropicDefaults: z.any().optional(),
  anthropicDefaultsTimestamp: z.number().default(0),
  
  // Saved combos and custom providers
  savedCombos: z.array(z.object({
    name: z.string(),
    reasoning: z.string(),
    completion: z.string(),
    value: z.string().optional()
  })).default([]),
  
  customProviders: z.array(z.object({
    id: z.string(),
    name: z.string(),
    baseUrl: z.string()
  })).default([]),
  
  // Feature flags (for gradual rollout)
  featureFlags: z.object({
    enableSchemaValidation: z.boolean().default(true),
    enableTokenValidation: z.boolean().default(true),
    enableKeyNormalization: z.boolean().default(true),
    enablePreApplyHydration: z.boolean().default(true)
  }).optional()
})

export type ClaudeThroneConfig = z.infer<typeof ClaudeThroneConfigSchema>

// ============================================================================
// Hydration & Normalization Helpers
// ============================================================================

/**
 * Normalize provider map to ensure canonical 'completion' key
 * 
 * This function handles the transition from legacy 'coding' key to 'completion'.
 * It reads from both keys (completion || coding) but only writes 'completion'.
 * 
 * @param map - Provider map (possibly with legacy 'coding' key)
 * @returns Normalized map with 'completion' key
 */
export function normalizeProviderMap(map: any): {
  reasoning: string
  completion: string
  value: string
} {
  return {
    reasoning: map?.reasoning || '',
    completion: map?.completion || map?.coding || '',  // Fallback to legacy key
    value: map?.value || ''
  }
}

/**
 * Hydrate global keys from provider-specific configuration
 * 
 * This is used before applying settings to ensure the active provider's
 * models are reflected in the global keys that Claude Code reads.
 * 
 * @param config - Full configuration
 * @param providerId - Active provider ID
 * @returns Hydrated global keys
 */
export function hydrateGlobalKeysFromProvider(
  config: ClaudeThroneConfig,
  providerId: string
): {
  reasoningModel: string
  completionModel: string
  valueModel: string
} {
  const providerMap = config.modelSelectionsByProvider?.[providerId]
  
  if (providerMap) {
    const normalized = normalizeProviderMap(providerMap)
    return {
      reasoningModel: normalized.reasoning,
      completionModel: normalized.completion,
      valueModel: normalized.value
    }
  }
  
  // Fallback to existing global keys if provider-specific not found
  return {
    reasoningModel: config.reasoningModel || '',
    completionModel: config.completionModel || '',
    valueModel: config.valueModel || ''
  }
}

/**
 * Check if configuration needs fallback hydration
 * 
 * Returns true if legacy global keys exist but provider-specific map is empty.
 * This indicates a migration scenario where we should save global keys to provider map.
 * 
 * @param config - Full configuration
 * @param providerId - Active provider ID
 * @returns True if fallback hydration needed
 */
export function needsFallbackHydration(
  config: ClaudeThroneConfig,
  providerId: string
): boolean {
  const providerMap = config.modelSelectionsByProvider?.[providerId]
  const hasGlobalKeys = !!(config.reasoningModel || config.completionModel)
  const hasProviderMap = !!(providerMap?.reasoning || providerMap?.completion)
  
  return hasGlobalKeys && !hasProviderMap
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate full configuration
 * @throws ZodError if validation fails
 */
export function validateConfig(config: unknown): ClaudeThroneConfig {
  return ClaudeThroneConfigSchema.parse(config)
}

/**
 * Safe validation with defaults
 * 
 * This function validates configuration but provides sensible defaults
 * for missing fields instead of throwing errors.
 * 
 * @param config - Configuration to validate
 * @returns Validated configuration with defaults filled in
 */
export function safeValidateConfig(config: unknown): ClaudeThroneConfig {
  try {
    return ClaudeThroneConfigSchema.parse(config)
  } catch (error) {
    // Return default configuration if validation fails
    console.warn('[Config Validation] Using default configuration due to validation errors:', error)
    return ClaudeThroneConfigSchema.parse({})
  }
}

/**
 * Validate provider map structure
 * @throws ZodError if validation fails
 */
export function validateProviderMap(map: unknown): z.infer<typeof ProviderMapSchema> {
  return ProviderMapSchema.parse(map)
}

// ============================================================================
// Configuration Invariant Checks
// ============================================================================

/**
 * Verify configuration invariants (from CONSTITUTION.md)
 * 
 * These checks ensure that the configuration satisfies critical invariants:
 * 1. Provider map uses 'completion' key (not 'coding')
 * 2. All providers have valid model selections
 * 3. Active provider has models configured
 * 
 * @param config - Configuration to check
 * @returns Array of invariant violations (empty if all pass)
 */
export function checkConfigurationInvariants(
  config: ClaudeThroneConfig
): string[] {
  const violations: string[] = []
  
  // Check 1: Verify completion key usage (not coding)
  for (const [providerId, providerMap] of Object.entries(config.modelSelectionsByProvider || {})) {
    if (providerMap.coding && !providerMap.completion) {
      violations.push(
        `Provider '${providerId}' uses legacy 'coding' key without 'completion'. ` +
        `This violates the canonical storage invariant.`
      )
    }
  }
  
  // Check 2: Verify active provider has configuration
  const activeProvider = config.provider || 'openrouter'
  const activeProviderMap = config.modelSelectionsByProvider?.[activeProvider]
  
  if (!activeProviderMap || (!activeProviderMap.reasoning && !config.reasoningModel)) {
    violations.push(
      `Active provider '${activeProvider}' has no model selections. ` +
      `This may cause proxy start failures.`
    )
  }
  
  // Check 3: Verify two-model mode has all required models
  if (config.twoModelMode) {
    const normalized = normalizeProviderMap(activeProviderMap)
    if (!normalized.completion || !normalized.value) {
      violations.push(
        `Two-model mode enabled but provider '${activeProvider}' is missing completion or value models.`
      )
    }
  }
  
  return violations
}
