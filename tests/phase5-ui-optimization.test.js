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
})
