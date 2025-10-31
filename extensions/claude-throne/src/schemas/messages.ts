/**
 * Message Schema Definitions for Webview ↔ Extension Communication
 * 
 * These schemas enforce contracts between the webview (main.js) and extension (PanelViewProvider.ts)
 * to prevent race conditions, stale data rendering, and configuration mismatches.
 * 
 * Schema Version: 1.0.0
 * Last Updated: 2025-10-28
 */

import { z } from 'zod'

// ============================================================================
// Core Data Types
// ============================================================================

/**
 * Model information structure
 */
export const ModelInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  provider: z.string(),
  context_length: z.number().optional(),
  pricing: z.object({
    prompt: z.string(),
    completion: z.string()
  }).optional()
})

export type ModelInfo = z.infer<typeof ModelInfoSchema>

/**
 * Provider map structure (canonical storage format)
 * 
 * Note: 'coding' is a deprecated alias for 'completion' - use 'completion' for all writes
 */
export const ProviderMapSchema = z.object({
  reasoning: z.string(),
  completion: z.string(),  // Canonical storage key
  /** @deprecated Use 'completion' instead */
  coding: z.string().optional(),  // Read-only fallback for backward compatibility
  value: z.string()
})

export type ProviderMap = z.infer<typeof ProviderMapSchema>

/**
 * Custom provider definition
 */
export const CustomProviderSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string().url()
})

export type CustomProvider = z.infer<typeof CustomProviderSchema>

/**
 * Model combo (saved pairing)
 */
export const ModelComboSchema = z.object({
  name: z.string(),
  reasoning: z.string(),
  completion: z.string(),
  value: z.string().optional()
})

export type ModelCombo = z.infer<typeof ModelComboSchema>

// ============================================================================
// Extension → Webview Messages
// ============================================================================

/**
 * Status update message
 */
export const StatusMessageSchema = z.object({
  type: z.literal('status'),
  payload: z.object({
    running: z.boolean(),
    port: z.number().optional(),
    reasoningModel: z.string().optional(),
    completionModel: z.string().optional(),
    valueModel: z.string().optional()
  })
})

export type StatusMessage = z.infer<typeof StatusMessageSchema>

/**
 * Models loaded message (with provider and token for race protection)
 */
export const ModelsLoadedMessageSchema = z.object({
  type: z.literal('models'),
  payload: z.object({
    models: z.array(ModelInfoSchema),
    provider: z.string(),  // REQUIRED: Must match current provider to render
    token: z.string().optional(),  // OPTIONAL: Sequence token for late response detection
    freeOnly: z.boolean().optional()
  })
})

export type ModelsLoadedMessage = z.infer<typeof ModelsLoadedMessageSchema>

/**
 * Configuration loaded message
 */
export const ConfigLoadedMessageSchema = z.object({
  type: z.literal('config'),
  payload: z.object({
    provider: z.string(),
    selectedCustomProviderId: z.string().optional(),
    twoModelMode: z.boolean(),
    port: z.number(),
    customBaseUrl: z.string().optional(),
    debug: z.boolean(),
    cacheAgeDays: z.number().optional(),
    cacheStale: z.boolean().optional(),
    cachedDefaults: z.any().optional(),
    modelSelectionsByProvider: z.record(z.string(), ProviderMapSchema),
    // Legacy global keys for fallback hydration
    reasoningModel: z.string().optional(),
    completionModel: z.string().optional(),
    valueModel: z.string().optional(),
    // Feature flags for webview behavior
    featureFlags: z.any().optional()
  })
})

export type ConfigLoadedMessage = z.infer<typeof ConfigLoadedMessageSchema>

/**
 * Popular models loaded message
 */
export const PopularModelsMessageSchema = z.object({
  type: z.literal('popularModels'),
  payload: z.object({
    pairings: z.array(ModelComboSchema),
    savedCombos: z.array(ModelComboSchema),
    currentReasoning: z.string().optional(),
    currentCompletion: z.string().optional()
  })
})

export type PopularModelsMessage = z.infer<typeof PopularModelsMessageSchema>

/**
 * Keys loaded message
 */
export const KeysLoadedMessageSchema = z.object({
  type: z.union([z.literal('keysLoaded'), z.literal('keys')]),
  payload: z.union([
    z.object({
      keyStatus: z.record(z.string(), z.boolean()).optional()
    }),
    z.record(z.string(), z.boolean())
  ])  // Support both formats for backward compatibility
})

export type KeysLoadedMessage = z.infer<typeof KeysLoadedMessageSchema>

/**
 * Key stored confirmation message
 */
export const KeyStoredMessageSchema = z.object({
  type: z.union([z.literal('keyStored'), z.literal('anthropicKeyStored')]),
  payload: z.object({
    provider: z.string().optional(),
    success: z.boolean(),
    error: z.string().optional()
  })
})

export type KeyStoredMessage = z.infer<typeof KeyStoredMessageSchema>

/**
 * Models saved confirmation message
 */
export const ModelsSavedMessageSchema = z.object({
  type: z.literal('modelsSaved'),
  payload: z.object({
    providerId: z.string(),  // REQUIRED: Provider these models belong to
    success: z.boolean(),
    scope: z.string().optional(),
    runtimeProvider: z.string().optional(),
    configProvider: z.string().optional()
  })
})

export type ModelsSavedMessage = z.infer<typeof ModelsSavedMessageSchema>

/**
 * Combos loaded message
 */
export const CombosLoadedMessageSchema = z.object({
  type: z.union([z.literal('combosLoaded'), z.literal('comboDeleted')]),
  payload: z.object({
    combos: z.array(ModelComboSchema)
  })
})

export type CombosLoadedMessage = z.infer<typeof CombosLoadedMessageSchema>

/**
 * Custom providers loaded message
 */
export const CustomProvidersLoadedMessageSchema = z.object({
  type: z.union([z.literal('customProvidersLoaded'), z.literal('customProviderDeleted')]),
  payload: z.object({
    providers: z.array(CustomProviderSchema),
    deletedId: z.string().optional()
  })
})

export type CustomProvidersLoadedMessage = z.infer<typeof CustomProvidersLoadedMessageSchema>

/**
 * Error message payload schema (structured format)
 * Comment 1: Unified error payload structure with provider, error, errorType, and optional token
 */
export const ErrorMessagePayloadSchema = z.object({
  provider: z.string(),  // REQUIRED: Provider where error occurred
  error: z.string(),     // Error message
  errorType: z.string(), // Error category (timeout, rate_limited, upstream_error, connection, config, generic)
  token: z.string().optional(),  // OPTIONAL: Sequence token for request matching
  traceId: z.string().optional(),  // OPTIONAL: Trace ID for DEBUG mode tracking
  canManuallyEnter: z.boolean().optional()  // OPTIONAL: Whether manual entry is available
})

/**
 * Error message
 * Comment 1: Always use structured payload format (never plain strings)
 */
export const ErrorMessageSchema = z.object({
  type: z.union([z.literal('proxyError'), z.literal('modelsError')]),
  payload: ErrorMessagePayloadSchema  // Always structured, never plain string
})

export type ErrorMessage = z.infer<typeof ErrorMessageSchema>

// Union of all extension → webview messages
export const ExtensionToWebviewMessageSchema = z.discriminatedUnion('type', [
  StatusMessageSchema,
  ModelsLoadedMessageSchema,
  ConfigLoadedMessageSchema,
  PopularModelsMessageSchema,
  KeysLoadedMessageSchema,
  KeyStoredMessageSchema,
  ModelsSavedMessageSchema,
  CombosLoadedMessageSchema,
  CustomProvidersLoadedMessageSchema,
  ErrorMessageSchema
])

export type ExtensionToWebviewMessage = z.infer<typeof ExtensionToWebviewMessageSchema>

// ============================================================================
// Webview → Extension Messages
// ============================================================================

/**
 * Request models message (with optional token for response matching)
 */
export const RequestModelsMessageSchema = z.object({
  type: z.union([z.literal('requestModels'), z.literal('listPublicModels'), z.literal('listFreeModels')]),
  provider: z.string().optional(),
  token: z.string().optional()  // Sequence token to match with response
})

export type RequestModelsMessage = z.infer<typeof RequestModelsMessageSchema>

/**
 * Save models message (must include providerId)
 * Comment 5: Only accepts 'completion' key (canonical storage) - legacy 'coding' deprecated
 */
export const SaveModelsMessageSchema = z.object({
  type: z.literal('saveModels'),
  providerId: z.string(),  // REQUIRED: Avoid ambiguity and races
  reasoning: z.string(),
  completion: z.string(),  // Canonical key for coding/completion model
  value: z.string()
})

export type SaveModelsMessage = z.infer<typeof SaveModelsMessageSchema>

/**
 * Update provider message
 */
export const UpdateProviderMessageSchema = z.object({
  type: z.literal('updateProvider'),
  provider: z.string()
})

export type UpdateProviderMessage = z.infer<typeof UpdateProviderMessageSchema>

/**
 * Store key message
 */
export const StoreKeyMessageSchema = z.object({
  type: z.union([z.literal('storeKey'), z.literal('storeAnthropicKey')]),
  provider: z.string().optional(),
  key: z.string()
})

export type StoreKeyMessage = z.infer<typeof StoreKeyMessageSchema>

/**
 * Start/Stop proxy messages
 */
export const ProxyControlMessageSchema = z.object({
  type: z.union([z.literal('startProxy'), z.literal('stopProxy'), z.literal('revertApply')])
})

export type ProxyControlMessage = z.infer<typeof ProxyControlMessageSchema>

/**
 * Toggle two-model mode message
 */
export const ToggleTwoModelModeMessageSchema = z.object({
  type: z.literal('toggleTwoModelMode'),
  enabled: z.boolean()
})

export type ToggleTwoModelModeMessage = z.infer<typeof ToggleTwoModelModeMessageSchema>

/**
 * Save/Delete combo messages
 */
export const ComboManagementMessageSchema = z.object({
  type: z.union([z.literal('saveCombo'), z.literal('deleteCombo')]),
  name: z.string().optional(),
  reasoningModel: z.string().optional(),
  codingModel: z.string().optional(),
  valueModel: z.string().optional(),
  index: z.number().optional()
})

export type ComboManagementMessage = z.infer<typeof ComboManagementMessageSchema>

/**
 * Save/Delete custom provider messages
 */
export const CustomProviderManagementMessageSchema = z.object({
  type: z.union([z.literal('saveCustomProvider'), z.literal('deleteCustomProvider')]),
  name: z.string().optional(),
  baseUrl: z.string().optional(),
  id: z.string()
})

export type CustomProviderManagementMessage = z.infer<typeof CustomProviderManagementMessageSchema>

/**
 * Simple request messages (no payload)
 */
export const SimpleRequestMessageSchema = z.object({
  type: z.enum([
    'webviewReady',
    'requestStatus',
    'requestKeys',
    'requestConfig',
    'requestPopularModels',
    'requestCustomProviders',
    'openSettings',
    'refreshAnthropicDefaults'
  ])
})

export type SimpleRequestMessage = z.infer<typeof SimpleRequestMessageSchema>

/**
 * Update messages with simple payloads
 */
export const SimpleUpdateMessageSchema = z.object({
  type: z.enum(['updateCustomBaseUrl', 'updatePort', 'updateDebug']),
  url: z.string().optional(),
  port: z.number().optional(),
  enabled: z.boolean().optional()
})

export type SimpleUpdateMessage = z.infer<typeof SimpleUpdateMessageSchema>

/**
 * Open external URL message
 */
export const OpenExternalMessageSchema = z.object({
  type: z.literal('openExternal'),
  url: z.string().url()
})

export type OpenExternalMessage = z.infer<typeof OpenExternalMessageSchema>

// Union of all webview → extension messages
export const WebviewToExtensionMessageSchema = z.union([
  RequestModelsMessageSchema,
  SaveModelsMessageSchema,
  UpdateProviderMessageSchema,
  StoreKeyMessageSchema,
  ProxyControlMessageSchema,
  ToggleTwoModelModeMessageSchema,
  ComboManagementMessageSchema,
  CustomProviderManagementMessageSchema,
  SimpleRequestMessageSchema,
  SimpleUpdateMessageSchema,
  OpenExternalMessageSchema
])

export type WebviewToExtensionMessage = z.infer<typeof WebviewToExtensionMessageSchema>

// ============================================================================
// Validation Functions
// ============================================================================

/**
 * Validate and parse a value as an extension→webview message.
 *
 * @param message - The input value to validate as an extension→webview message
 * @returns The validated message as an ExtensionToWebviewMessage
 * @throws ZodError if validation fails
 */
export function validateExtensionMessage(message: unknown): ExtensionToWebviewMessage {
  return ExtensionToWebviewMessageSchema.parse(message)
}

/**
 * Validate a message sent from the webview to the extension.
 *
 * @returns The validated `WebviewToExtensionMessage`.
 * @throws ZodError if the message does not match the schema
 */
export function validateWebviewMessage(message: unknown): WebviewToExtensionMessage {
  return WebviewToExtensionMessageSchema.parse(message)
}

/**
 * Validate a message against the appropriate schema and return the parsed value or null on validation failure.
 *
 * Uses `direction` to choose the schema: `'toWebview'` validates as an Extension→Webview message, `'toExtension'` validates as a Webview→Extension message. When validation fails, Zod validation details are forwarded to `logger` if provided and the function returns `null`.
 *
 * @param message - The value to validate
 * @param direction - Which schema to validate against: `'toWebview'` or `'toExtension'`
 * @param logger - Optional function that receives validation details when validation fails
 * @returns The validated message (`ExtensionToWebviewMessage` or `WebviewToExtensionMessage`) if valid, `null` otherwise
 */
export function safeValidateMessage(
  message: unknown,
  direction: 'toWebview' | 'toExtension',
  logger?: (msg: string) => void
): ExtensionToWebviewMessage | WebviewToExtensionMessage | null {
  try {
    if (direction === 'toWebview') {
      return validateExtensionMessage(message)
    } else {
      return validateWebviewMessage(message)
    }
  } catch (error) {
    if (logger && error instanceof z.ZodError) {
      const errorDetails = 'issues' in error ? error.issues : []
      logger(`[Schema Validation Error] Invalid ${direction} message: ${JSON.stringify(errorDetails)}`)
      logger(`[Schema Validation Error] Rejected message: ${JSON.stringify(message)}`)
    }
    return null
  }
}