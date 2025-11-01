/**
 * Message Schema Contract Tests
 * 
 * These tests ensure message contracts between the webview and extension are consistent
 * and that schema validation correctly handles both canonical and legacy message formats.
 */

import { describe, it, expect } from 'vitest'
import {
  safeValidateMessage,
  normalizeMessageType,
  validateExtensionMessage,
  validateWebviewMessage,
  type ExtensionToWebviewMessage,
  type WebviewToExtensionMessage
} from '../src/schemas/messages'

describe('Message Schema Validation', () => {
  describe('Extension → Webview Messages', () => {
    it('should validate status message', () => {
      const message = {
        type: 'status',
        payload: {
          running: true,
          port: 3000,
          reasoningModel: 'claude-3.5-sonnet',
          completionModel: 'claude-3.5-haiku'
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
    
    it('should validate models loaded message with provider and token', () => {
      const message = {
        type: 'models',
        payload: {
          models: [
            { id: 'model-1', name: 'Model 1', provider: 'openrouter' }
          ],
          provider: 'openrouter',
          token: 'seq-1'
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
    
    it('should reject models loaded message without provider', () => {
      const message = {
        type: 'models',
        payload: {
          models: [{ id: 'model-1', name: 'Model 1', provider: 'openrouter' }]
          // Missing required 'provider' field
        }
      }
      
      expect(() => validateExtensionMessage(message)).toThrow()
    })
    
    it('should validate keysLoaded message', () => {
      const message = {
        type: 'keysLoaded',
        payload: {
          keyStatus: {
            'openrouter': true,
            'openai': false
          }
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
    
    it('should validate keyStored message for Anthropic provider', () => {
      const message = {
        type: 'keyStored',
        payload: {
          provider: 'anthropic',
          success: true
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
    
    it('should validate keyStored message for other providers', () => {
      const message = {
        type: 'keyStored',
        payload: {
          provider: 'openrouter',
          success: true
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
    
    it('should validate keyStored message with error', () => {
      const message = {
        type: 'keyStored',
        payload: {
          provider: 'openai',
          success: false,
          error: 'Invalid API key format'
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
    
    it('should validate combosLoaded message without deletedId', () => {
      const message = {
        type: 'combosLoaded',
        payload: {
          combos: [
            { name: 'Fast Combo', reasoning: 'model-1', completion: 'model-2' }
          ]
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
    
    it('should validate combosLoaded message with deletedId', () => {
      const message = {
        type: 'combosLoaded',
        payload: {
          combos: [
            { name: 'Fast Combo', reasoning: 'model-1', completion: 'model-2' }
          ],
          deletedId: '0'
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
    
    it('should validate customProvidersLoaded message without deletedId', () => {
      const message = {
        type: 'customProvidersLoaded',
        payload: {
          providers: [
            { id: 'custom-1', name: 'Custom Provider', baseUrl: 'https://api.example.com/v1' }
          ]
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
    
    it('should validate customProvidersLoaded message with deletedId', () => {
      const message = {
        type: 'customProvidersLoaded',
        payload: {
          providers: [],
          deletedId: 'custom-1'
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
    
    it('should validate structured error message', () => {
      const message = {
        type: 'proxyError',
        payload: {
          provider: 'openrouter',
          error: 'Failed to connect',
          errorType: 'connection',
          token: 'seq-1'
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
    
    it('should validate modelsSaved confirmation message', () => {
      const message = {
        type: 'modelsSaved',
        payload: {
          providerId: 'openrouter',
          success: true
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
  })
  
  describe('Webview → Extension Messages', () => {
    it('should validate requestModels message', () => {
      const message = {
        type: 'requestModels',
        provider: 'openrouter',
        token: 'seq-1'
      }
      
      expect(() => validateWebviewMessage(message)).not.toThrow()
    })
    
    it('should validate saveModels message with canonical completion key', () => {
      const message = {
        type: 'saveModels',
        providerId: 'openrouter',
        reasoning: 'claude-3.5-sonnet',
        completion: 'claude-3.5-haiku',
        value: 'claude-3-opus'
      }
      
      expect(() => validateWebviewMessage(message)).not.toThrow()
    })
    
    it('should validate storeKey message', () => {
      const message = {
        type: 'storeKey',
        provider: 'openrouter',
        key: 'test-api-key-openrouter'
      }
      
      expect(() => validateWebviewMessage(message)).not.toThrow()
    })
    
    it('should validate storeKey message for Anthropic', () => {
      const message = {
        type: 'storeKey',
        provider: 'anthropic',
        key: 'test-api-key-anthropic'
      }
      
      expect(() => validateWebviewMessage(message)).not.toThrow()
    })
    
    it('should validate updateProvider message', () => {
      const message = {
        type: 'updateProvider',
        provider: 'openai'
      }
      
      expect(() => validateWebviewMessage(message)).not.toThrow()
    })
    
    it('should validate simple request messages', () => {
      const messages = [
        { type: 'webviewReady' },
        { type: 'requestStatus' },
        { type: 'requestKeys' },
        { type: 'requestConfig' },
        { type: 'requestPopularModels' },
        { type: 'requestCustomProviders' },
        { type: 'openSettings' }
      ]
      
      messages.forEach(msg => {
        expect(() => validateWebviewMessage(msg)).not.toThrow()
      })
    })
  })
  
  describe('Legacy Message Type Normalization', () => {
    it('should normalize legacy "keys" to "keysLoaded"', () => {
      const legacyMessage = {
        type: 'keys',
        payload: { openrouter: true }
      }
      
      const normalized = normalizeMessageType(legacyMessage)
      expect(normalized.type).toBe('keysLoaded')
      expect(normalized.payload).toEqual(legacyMessage.payload)
    })
    
    it('should normalize legacy "anthropicKeyStored" to "keyStored"', () => {
      const legacyMessage = {
        type: 'anthropicKeyStored',
        payload: { success: true }
      }
      
      const normalized = normalizeMessageType(legacyMessage)
      expect(normalized.type).toBe('keyStored')
    })
    
    it('should normalize legacy "listPublicModels" to "requestModels"', () => {
      const legacyMessage = {
        type: 'listPublicModels',
        token: 'seq-1'
      }
      
      const normalized = normalizeMessageType(legacyMessage)
      expect(normalized.type).toBe('requestModels')
    })
    
    it('should normalize legacy "storeAnthropicKey" to "storeKey"', () => {
      const legacyMessage = {
        type: 'storeAnthropicKey',
        key: 'test-anthropic-key'
      }
      
      const normalized = normalizeMessageType(legacyMessage)
      expect(normalized.type).toBe('storeKey')
    })
    
    it('should pass through canonical types unchanged', () => {
      const canonicalMessage = {
        type: 'requestModels',
        provider: 'openrouter'
      }
      
      const normalized = normalizeMessageType(canonicalMessage)
      expect(normalized).toEqual(canonicalMessage)
    })
  })
  
  describe('Safe Validation with Normalization', () => {
    it('should validate legacy message after normalization', () => {
      const legacyMessage = {
        type: 'keys',
        payload: { openrouter: true }
      }
      
      // Normalize first, then validate
      const normalized = normalizeMessageType(legacyMessage)
      const validated = safeValidateMessage(normalized, 'toWebview')
      expect(validated).not.toBeNull()
      if (validated) {
        expect(validated.type).toBe('keysLoaded')
      }
    })
    
    it('should reject invalid messages', () => {
      const invalidMessage = {
        type: 'models',
        payload: {
          models: [],
          // Missing required 'provider' field
        }
      }
      
      const validated = safeValidateMessage(invalidMessage, 'toWebview')
      expect(validated).toBeNull()
    })
    
    it('should call logger for invalid messages', () => {
      const invalidMessage = {
        type: 'models',
        payload: {
          models: []
          // Missing required 'provider'
        }
      }
      
      const logs: string[] = []
      const logger = (msg: string) => logs.push(msg)
      
      const validated = safeValidateMessage(invalidMessage, 'toWebview', logger)
      expect(validated).toBeNull()
      expect(logs.length).toBeGreaterThan(0)
      expect(logs.some(log => log.includes('Schema Validation Error'))).toBe(true)
    })
  })
  
  describe('Provider-Specific Message Patterns', () => {
    it('should handle provider switching in config message', () => {
      const message = {
        type: 'config',
        payload: {
          provider: 'openai',
          twoModelMode: true,
          port: 3000,
          debug: false,
          modelSelectionsByProvider: {
            openrouter: { reasoning: 'model-1', completion: 'model-2', value: 'model-3' },
            openai: { reasoning: 'gpt-4', completion: 'gpt-3.5-turbo', value: 'gpt-4o' }
          }
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
    
    it('should handle error messages with trace IDs', () => {
      const message = {
        type: 'proxyError',
        payload: {
          provider: 'openrouter',
          error: 'Timeout',
          errorType: 'timeout',
          token: 'seq-5',
          traceId: 'trace-abc123'
        }
      }
      
      expect(() => validateExtensionMessage(message)).not.toThrow()
    })
  })
})
