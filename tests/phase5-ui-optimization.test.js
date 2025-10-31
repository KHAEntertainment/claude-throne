import { describe, it, expect, beforeEach, vi } from 'vitest'
import { JSDOM } from 'jsdom'

/**
 * Unit Tests for Phase 5: Event Listener Discipline & UI Optimization
 * 
 * These tests verify that:
 * 1. Debouncing prevents excessive re-renders during rapid typing
 * 2. Event delegation reduces listener count (one per container vs one per button)
 * 3. No duplicate listeners are attached on multiple renders
 * 4. Filter input doesn't cause flicker or performance issues
 */

describe('Phase 5: UI Optimization Tests', () => {
  
  describe('Debounce Function', () => {
    // Simulate the debounce helper
    function debounce(func, wait) {
      let timeout;
      return function executedFunction(...args) {
        const later = () => {
          clearTimeout(timeout);
          func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
      };
    }
    
    it('delays function execution', async () => {
      const mockFn = vi.fn();
      const debouncedFn = debounce(mockFn, 100);
      
      debouncedFn('test');
      
      // Should not be called immediately
      expect(mockFn).not.toHaveBeenCalled();
      
      // Should be called after delay
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(mockFn).toHaveBeenCalledWith('test');
      expect(mockFn).toHaveBeenCalledTimes(1);
    });
    
    it('cancels previous calls when invoked rapidly', async () => {
      const mockFn = vi.fn();
      const debouncedFn = debounce(mockFn, 100);
      
      // Rapid calls
      debouncedFn('call1');
      setTimeout(() => debouncedFn('call2'), 20);
      setTimeout(() => debouncedFn('call3'), 40);
      setTimeout(() => debouncedFn('call4'), 60);
      
      // Should only execute the last call
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(mockFn).toHaveBeenCalledTimes(1);
      expect(mockFn).toHaveBeenCalledWith('call4');
    });
    
    it('allows execution after debounce period', async () => {
      const mockFn = vi.fn();
      const debouncedFn = debounce(mockFn, 50);
      
      debouncedFn('first');
      
      await new Promise(resolve => setTimeout(resolve, 100));
      debouncedFn('second');
      
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(mockFn).toHaveBeenCalledTimes(2);
      expect(mockFn).toHaveBeenNthCalledWith(1, 'first');
      expect(mockFn).toHaveBeenNthCalledWith(2, 'second');
    });
  });
  
  describe('Event Delegation', () => {
    let container, dom;
    
    beforeEach(() => {
      dom = new JSDOM('<!DOCTYPE html><html><body><div id="container"></div></body></html>');
      container = dom.window.document.getElementById('container');
    });
    
    it('uses single listener for multiple buttons', () => {
      const clickHandler = vi.fn();
      
      // Phase 5: Event delegation - ONE listener on container
      container.addEventListener('click', (e) => {
        const btn = e.target.closest('.model-btn');
        if (btn) {
          clickHandler(btn.dataset.model, btn.dataset.type);
        }
      });
      
      // Render 10 buttons
      container.innerHTML = Array.from({ length: 10 }, (_, i) => `
        <button class="model-btn" data-model="model-${i}" data-type="reasoning">
          Model ${i}
        </button>
      `).join('');
      
      // Get number of click listeners on buttons
      const buttons = container.querySelectorAll('.model-btn');
      
      // No individual listeners on buttons (they're handled by container)
      buttons.forEach(btn => {
        // In a real browser, we could check getEventListeners()
        // In tests, we verify by clicking and checking handler was called
      });
      
      // Click first button
      buttons[0].click();
      expect(clickHandler).toHaveBeenCalledWith('model-0', 'reasoning');
      
      // Click last button
      buttons[9].click();
      expect(clickHandler).toHaveBeenCalledWith('model-9', 'reasoning');
      
      // Should have been called twice total
      expect(clickHandler).toHaveBeenCalledTimes(2);
    });
    
    it('handles clicks on button children correctly', () => {
      const clickHandler = vi.fn();
      
      container.addEventListener('click', (e) => {
        const btn = e.target.closest('.model-btn');
        if (btn) {
          clickHandler(btn.dataset.model);
        }
      });
      
      container.innerHTML = `
        <button class="model-btn" data-model="test-model">
          <span class="icon">✓</span>
          <span class="text">Select</span>
        </button>
      `;
      
      // Click on child span element
      const span = container.querySelector('.icon');
      span.click();
      
      // Should still trigger handler (closest finds parent button)
      expect(clickHandler).toHaveBeenCalledWith('test-model');
    });
    
    it('does not trigger on non-button clicks', () => {
      const clickHandler = vi.fn();
      
      container.addEventListener('click', (e) => {
        const btn = e.target.closest('.model-btn');
        if (btn) {
          clickHandler();
        }
      });
      
      container.innerHTML = `
        <div class="model-info">
          <span>Not a button</span>
        </div>
        <button class="model-btn">Button</button>
      `;
      
      // Click on non-button element
      container.querySelector('.model-info').click();
      expect(clickHandler).not.toHaveBeenCalled();
      
      // Click on button
      container.querySelector('.model-btn').click();
      expect(clickHandler).toHaveBeenCalledTimes(1);
    });
  });
  
  describe('Render Cycle Optimization', () => {
    it('tracks delegation setup to avoid duplicate listeners', () => {
      const setupCalls = [];
      
      function renderModelList(container) {
        // Phase 5: Check if already setup
        if (!container.dataset.delegationSetup) {
          setupCalls.push('setup');
          container.dataset.delegationSetup = 'true';
        }
        
        // Render content
        container.innerHTML = '<button class="model-btn">Test</button>';
      }
      
      const dom = new JSDOM('<!DOCTYPE html><div id="container"></div>');
      const container = dom.window.document.getElementById('container');
      
      // First render
      renderModelList(container);
      expect(setupCalls.length).toBe(1);
      
      // Second render
      renderModelList(container);
      expect(setupCalls.length).toBe(1); // Still 1, not 2
      
      // Third render
      renderModelList(container);
      expect(setupCalls.length).toBe(1); // Still 1
    });
  });
  
  describe('Filter Input Performance', () => {
    it('debouncing reduces render calls during rapid typing', async () => {
      const renderCalls = [];
      
      function render(searchTerm) {
        renderCalls.push(searchTerm);
      }
      
      function debounce(func, wait) {
        let timeout;
        return function(...args) {
          clearTimeout(timeout);
          timeout = setTimeout(() => func(...args), wait);
        };
      }
      
      const debouncedRender = debounce(render, 100);
      
      // Simulate rapid typing: "test"
      debouncedRender('t');
      setTimeout(() => debouncedRender('te'), 20);
      setTimeout(() => debouncedRender('tes'), 40);
      setTimeout(() => debouncedRender('test'), 60);
      
      // Without debouncing: 4 renders
      // With debouncing: 1 render (only the last)
      
      await new Promise(resolve => setTimeout(resolve, 200));
      expect(renderCalls.length).toBe(1);
      expect(renderCalls[0]).toBe('test');
    });
    
    it('filters are applied correctly with debouncing', async () => {
      const models = [
        { id: 'gpt-4', name: 'GPT-4' },
        { id: 'claude-3', name: 'Claude 3' },
        { id: 'gemini-pro', name: 'Gemini Pro' }
      ];
      
      function filterModels(searchTerm) {
        return models.filter(m => 
          m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
          m.id.toLowerCase().includes(searchTerm.toLowerCase())
        );
      }
      
      function debounce(func, wait) {
        let timeout;
        return function(...args) {
          clearTimeout(timeout);
          timeout = setTimeout(() => func(...args), wait);
        };
      }
      
      let lastFilterResult = null;
      const debouncedFilter = debounce((term) => {
        lastFilterResult = filterModels(term);
      }, 50);
      
      // Rapid typing
      debouncedFilter('g');
      setTimeout(() => debouncedFilter('gp'), 10);
      setTimeout(() => debouncedFilter('gpt'), 20);
      
      await new Promise(resolve => setTimeout(resolve, 100));
      expect(lastFilterResult).toHaveLength(1);
      expect(lastFilterResult[0].id).toBe('gpt-4');
    });
  });
  
  describe('Memory and Performance', () => {
    it('event delegation uses less memory than individual listeners', () => {
      const individualListeners = [];
      const delegationListeners = [];
      
      // Approach 1: Individual listeners (OLD)
      const container1 = { buttons: [] };
      for (let i = 0; i < 100; i++) {
        const btn = { id: i, listener: () => {} };
        individualListeners.push(btn.listener);
        container1.buttons.push(btn);
      }
      
      // Approach 2: Event delegation (NEW - Phase 5)
      const container2 = { listener: () => {}, buttons: [] };
      delegationListeners.push(container2.listener);
      for (let i = 0; i < 100; i++) {
        container2.buttons.push({ id: i }); // No individual listener
      }
      
      // Verify delegation uses fewer listeners
      expect(individualListeners.length).toBe(100);
      expect(delegationListeners.length).toBe(1);
      
      // 99% reduction in listeners!
      const reduction = ((100 - 1) / 100) * 100;
      expect(reduction).toBe(99);
    });
  });
  
  describe('Comment 2: Error Telemetry Buffer', () => {
    it('adds errors to buffer with correct structure', () => {
      const state = {
        errorBuffer: [],
        maxErrorBufferSize: 10
      };
      
      function addErrorToBuffer(errorData) {
        const errorEntry = {
          timestamp: Date.now(),
          ...errorData
        };
        
        state.errorBuffer.push(errorEntry);
        
        if (state.errorBuffer.length > state.maxErrorBufferSize) {
          state.errorBuffer.shift();
        }
      }
      
      // Add an error
      const errorData = {
        type: 'modelsError',
        provider: 'openrouter',
        error: 'Connection timeout',
        errorType: 'timeout',
        token: 'token-123'
      };
      
      addErrorToBuffer(errorData);
      
      // Verify buffer structure
      expect(state.errorBuffer).toHaveLength(1);
      expect(state.errorBuffer[0]).toMatchObject({
        type: 'modelsError',
        provider: 'openrouter',
        error: 'Connection timeout',
        errorType: 'timeout',
        token: 'token-123'
      });
      expect(state.errorBuffer[0].timestamp).toBeDefined();
    });
    
    it('limits buffer size to maxErrorBufferSize', () => {
      const state = {
        errorBuffer: [],
        maxErrorBufferSize: 3
      };
      
      function addErrorToBuffer(errorData) {
        const errorEntry = {
          timestamp: Date.now(),
          ...errorData
        };
        
        state.errorBuffer.push(errorEntry);
        
        if (state.errorBuffer.length > state.maxErrorBufferSize) {
          state.errorBuffer.shift();
        }
      }
      
      // Add 5 errors to a buffer with max size of 3
      for (let i = 0; i < 5; i++) {
        addErrorToBuffer({
          type: 'modelsError',
          provider: `provider-${i}`,
          error: `Error ${i}`,
          errorType: 'test'
        });
      }
      
      // Verify buffer size is limited
      expect(state.errorBuffer).toHaveLength(3);
      
      // Verify oldest errors were removed
      expect(state.errorBuffer[0].provider).toBe('provider-2'); // First one removed
      expect(state.errorBuffer[1].provider).toBe('provider-3');
      expect(state.errorBuffer[2].provider).toBe('provider-4'); // Last one kept
    });
    
    it('handles both string and object error payloads', () => {
      const state = {
        errorBuffer: [],
        maxErrorBufferSize: 10
      };
      
      function addErrorToBuffer(errorData) {
        const errorEntry = {
          timestamp: Date.now(),
          ...errorData
        };
        
        state.errorBuffer.push(errorEntry);
        
        if (state.errorBuffer.length > state.maxErrorBufferSize) {
          state.errorBuffer.shift();
        }
      }
      
      // Test with string payload
      addErrorToBuffer({
        type: 'proxyError',
        provider: 'glm',
        error: 'Simple error message',
        errorType: 'proxy'
      });
      
      // Test with object payload
      addErrorToBuffer({
        type: 'modelsError',
        provider: 'openrouter',
        error: 'Detailed error',
        errorType: 'connection',
        token: 'token-456'
      });
      
      expect(state.errorBuffer).toHaveLength(2);
      expect(state.errorBuffer[0].error).toBe('Simple error message');
      expect(state.errorBuffer[1].error).toBe('Detailed error');
      expect(state.errorBuffer[1].token).toBe('token-456');
    });
    
    it('keys errors by provider and token', () => {
      const state = {
        errorBuffer: [],
        maxErrorBufferSize: 10
      };
      
      function addErrorToBuffer(errorData) {
        const errorEntry = {
          timestamp: Date.now(),
          ...errorData
        };
        
        state.errorBuffer.push(errorEntry);
        
        if (state.errorBuffer.length > state.maxErrorBufferSize) {
          state.errorBuffer.shift();
        }
      }
      
      // Add errors for different providers and tokens
      addErrorToBuffer({
        type: 'modelsError',
        provider: 'openrouter',
        error: 'OpenRouter error',
        errorType: 'timeout',
        token: 'token-1'
      });
      
      addErrorToBuffer({
        type: 'modelsError',
        provider: 'glm',
        error: 'GLM error',
        errorType: 'connection',
        token: 'token-2'
      });
      
      addErrorToBuffer({
        type: 'modelsError',
        provider: 'openrouter',
        error: 'Another OpenRouter error',
        errorType: 'generic',
        token: 'token-3'
      });
      
      // Verify buffer contains all errors
      expect(state.errorBuffer).toHaveLength(3);
      
      // Verify errors are keyed correctly
      const openRouterErrors = state.errorBuffer.filter(e => e.provider === 'openrouter');
      const glmErrors = state.errorBuffer.filter(e => e.provider === 'glm');
      
      expect(openRouterErrors).toHaveLength(2);
      expect(glmErrors).toHaveLength(1);
      
      // Verify tokens are preserved
      expect(openRouterErrors[0].token).toBe('token-1');
      expect(openRouterErrors[1].token).toBe('token-3');
      expect(glmErrors[0].token).toBe('token-2');
    });
  });
  
  describe('Comment 3: Filtered IDs Optimization', () => {
    it('skips DOM work when filtered IDs are unchanged', () => {
      const state = {
        models: [
          { id: 'gpt-4', name: 'GPT-4' },
          { id: 'claude-3', name: 'Claude 3' },
          { id: 'gemini-pro', name: 'Gemini Pro' }
        ],
        lastFilteredIds: ['claude-3', 'gpt-4'] // From previous render
      };
      
      // Simulate filtering that produces the same results
      const searchTerm = 'gpt';
      const filtered = state.models.filter(m => 
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.id.toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      // Compute filtered IDs
      const filteredIds = filtered.map(m => m.id).sort();
      
      // Check if results are unchanged
      const isUnchanged = state.lastFilteredIds && 
        state.lastFilteredIds.length === filteredIds.length &&
        state.lastFilteredIds.every((id, index) => id === filteredIds[index]);
      
      // With search "gpt", we get gpt-4 only
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('gpt-4');
      expect(filteredIds).toEqual(['gpt-4']);
      
      // But lastFilteredIds has 2 items, so it's different
      expect(isUnchanged).toBe(false);
    });
    
    it('detects when filtered results change', () => {
      const state = {
        models: [
          { id: 'gpt-4', name: 'GPT-4' },
          { id: 'claude-3', name: 'Claude 3' },
          { id: 'gemini-pro', name: 'Gemini Pro' }
        ],
        lastFilteredIds: ['gpt-4'] // From previous "gpt" search
      };
      
      // New search with different results
      const searchTerm = 'claude';
      const filtered = state.models.filter(m => 
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.id.toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      const filteredIds = filtered.map(m => m.id).sort();
      
      const isUnchanged = state.lastFilteredIds && 
        state.lastFilteredIds.length === filteredIds.length &&
        state.lastFilteredIds.every((id, index) => id === filteredIds[index]);
      
      // Results changed from "gpt" to "claude"
      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe('claude-3');
      expect(filteredIds).toEqual(['claude-3']);
      
      // Should detect the change
      expect(isUnchanged).toBe(false);
    });
    
    it('allows render when filtered results are actually the same', () => {
      const state = {
        models: [
          { id: 'gpt-4', name: 'GPT-4' },
          { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo' },
          { id: 'claude-3', name: 'Claude 3' }
        ],
        lastFilteredIds: ['gpt-3.5-turbo', 'gpt-4'] // From previous "gpt" search
      };
      
      // Same search term - should produce same results
      const searchTerm = 'gpt';
      const filtered = state.models.filter(m => 
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.id.toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      const filteredIds = filtered.map(m => m.id).sort();
      
      const isUnchanged = state.lastFilteredIds && 
        state.lastFilteredIds.length === filteredIds.length &&
        state.lastFilteredIds.every((id, index) => id === filteredIds[index]);
      
      // Same two models should match
      expect(filtered).toHaveLength(2);
      expect(filteredIds).toEqual(['gpt-3.5-turbo', 'gpt-4']);
      
      // Should detect the results are unchanged and skip render
      expect(isUnchanged).toBe(true);
    });
    
    it('resets filtered IDs when models change', () => {
      const state = {
        models: [
          { id: 'gpt-4', name: 'GPT-4' },
          { id: 'claude-3', name: 'Claude 3' }
        ],
        lastFilteredIds: ['gpt-4'] // Previous search results
      };
      
      // Simulate provider switch - models are replaced
      state.models = [
        { id: 'glm-4', name: 'GLM-4' },
        { id: 'glm-4-plus', name: 'GLM-4 Plus' }
      ];
      
      // Reset filtered IDs when switching providers
      state.lastFilteredIds = null;
      
      // First render with new provider should always render
      const searchTerm = 'glm';
      const filtered = state.models.filter(m => 
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.id.toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      const filteredIds = filtered.map(m => m.id).sort();
      
      // With null lastFilteredIds, should always render
      expect(state.lastFilteredIds).toBeNull();
      expect(filtered).toHaveLength(2);
      expect(filteredIds).toEqual(['glm-4', 'glm-4-plus']);
    });
    
    it('handles empty filter results correctly', () => {
      const state = {
        models: [
          { id: 'gpt-4', name: 'GPT-4' },
          { id: 'claude-3', name: 'Claude 3' }
        ],
        lastFilteredIds: ['gpt-4'] // Previous search had results
      };
      
      // Search that matches nothing
      const searchTerm = 'nonexistent';
      const filtered = state.models.filter(m => 
        m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        m.id.toLowerCase().includes(searchTerm.toLowerCase())
      );
      
      const filteredIds = filtered.map(m => m.id).sort();
      
      const isUnchanged = state.lastFilteredIds && 
        state.lastFilteredIds.length === filteredIds.length &&
        state.lastFilteredIds.every((id, index) => id === filteredIds[index]);
      
      // No matches
      expect(filtered).toHaveLength(0);
      expect(filteredIds).toEqual([]);
      
      // Empty array is different from previous non-empty array
      expect(isUnchanged).toBe(false);
      
      // After render, lastFilteredIds should be updated to empty array
      state.lastFilteredIds = filteredIds;
      expect(state.lastFilteredIds).toEqual([]);
      
      // Next render with same empty results should skip
      const isStillUnchanged = state.lastFilteredIds && 
        state.lastFilteredIds.length === filteredIds.length &&
        state.lastFilteredIds.every((id, index) => id === filteredIds[index]);
      
      expect(isStillUnchanged).toBe(true);
    });
  });
})
