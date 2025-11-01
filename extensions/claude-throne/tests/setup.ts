import { vi } from 'vitest'

// Setup global test environment
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}))

// Mock requestAnimationFrame
global.requestAnimationFrame = vi.fn((cb) => setTimeout(cb, 0))
global.cancelAnimationFrame = vi.fn()

// Mock intersection observer
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn()
}))

// Centralized VS Code configuration mock with proper backing store
const configBacking = new Map<string, any>([
  ['featureFlags', { 
    enableSchemaValidation: false,  // Disabled in tests to avoid validation complexity
    enableTokenValidation: false, 
    enableKeyNormalization: true, 
    enablePreApplyHydration: true 
  }],
  ['provider', 'openrouter'],
  ['modelSelectionsByProvider', { 
    openrouter: { reasoning: 'claude-3.5-sonnet', completion: 'claude-3.5-haiku', value: 'claude-3-opus' },
    openai: { reasoning: 'gpt-4', completion: 'gpt-3.5-turbo', value: 'gpt-4o' }
  }],
  ['twoModelMode', false],
  ['proxy.port', 3000],
  ['proxy.debug', false],
  ['autoApply', true],
  ['applyScope', 'workspace'],
  ['customProviders', []],
  ['savedCombos', []],
])

// Expose config backing for tests to inspect/modify
;(globalThis as any).__vscodeConfigBacking = configBacking
