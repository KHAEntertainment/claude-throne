// Claude Throne VS Code Extension - Modern UI
(function() {
    'use strict';
    
  // VS Code API - use the one from bootstrap if available
  const vscode = window.vscodeApi || acquireVsCodeApi();
  console.log('[STARTUP] VS Code API ready:', typeof vscode, vscode);

  // State
  let state = {
    provider: 'openrouter',
    twoModelMode: false,
    reasoningModel: '',
    codingModel: '',
    valueModel: '',
    models: [],
    modelsCache: {},
    customProviders: [],
    endpointOverrides: {}, // Comment 3: Store endpoint kind overrides
    // Comment 6: Trace ID for provider flows (DEBUG mode only)
    currentTraceId: null,
    // Provider-specific model storage
    // Comment 5: Use 'completion' as canonical key (read-only fallback to legacy 'coding' for backward compat)
    modelsByProvider: {
      openrouter: { reasoning: '', completion: '', value: '' },
      openai: { reasoning: '', completion: '', value: '' },
      together: { reasoning: '', completion: '', value: '' },
      deepseek: { reasoning: '', completion: '', value: '' },
      glm: { reasoning: '', completion: '', value: '' },
      custom: { reasoning: '', completion: '', value: '' }
    },
    proxyRunning: false,
    port: 3000,
    customCombos: [],
    workspaceCombos: [],
    inSaveOperation: false, // Track when we're in the middle of a save to prevent unnecessary reloads
    inSaveProvider: null, // Comment 12: Track which provider is being saved to prevent mismatched reload prevention
    autoHydratedProviders: new Set(), // Track which providers have been auto-hydrated to prevent loops
    // Phase 2: Request token for race protection
    requestTokenCounter: 0, // Incrementing counter for sequence tokens
    currentRequestToken: null, // Token of the most recent model loading request
    // Comment 19: Feature flags from config
  featureFlags: {
    enableSchemaValidation: true, // Default enabled
    enableTokenValidation: true,
    enableKeyNormalization: true,
    enablePreApplyHydration: true
  },
  // Comment 2: Error telemetry buffer
  errorBuffer: [], // In-memory buffer of recent errors
  maxErrorBufferSize: 10, // Keep last 10 errors
  // Comment 3: Performance optimization for filtering
  lastFilteredIds: null, // Track last filtered model IDs to avoid unnecessary DOM work
  lastTwoModelMode: false, // Track last twoModelMode to detect UI changes
  lastSelectedModels: { reasoning: '', coding: '', value: '' } // Track last selected models to detect selection changes
};

  // Comment 2: Add error to telemetry buffer
  function addErrorToBuffer(errorData) {
    const errorEntry = {
      timestamp: Date.now(),
      ...errorData
    };
    
    state.errorBuffer.push(errorEntry);
    
    // Keep buffer within size limit
    if (state.errorBuffer.length > state.maxErrorBufferSize) {
      state.errorBuffer.shift(); // Remove oldest entry
    }
    
    // Also log to console if debug mode is on (for easy troubleshooting)
    const debugCheckbox = document.getElementById('debugCheckbox');
    if (debugCheckbox && debugCheckbox.checked) {
      console.group(`[Error Telemetry] ${errorData.type} for ${errorData.provider}`);
      console.log('Error:', errorData.error);
      console.log('Type:', errorData.errorType);
      if (errorData.token) {
        console.log('Token:', errorData.token);
      }
      console.log('Time:', new Date(errorEntry.timestamp).toISOString());
      console.groupEnd();
    }
  }

  // Comment 2: Display error buffer in debug mode
  function displayErrorBuffer() {
    const debugCheckbox = document.getElementById('debugCheckbox');
    if (!debugCheckbox || !debugCheckbox.checked) {
      return; // Debug mode off, don't display
    }
    
    console.log('[Error Telemetry Buffer] Current state:', {
      bufferSize: state.errorBuffer.length,
      maxSize: state.maxErrorBufferSize,
      errors: state.errorBuffer
    });
  }

  // Comment 3: Normalize provider map to canonical keys { reasoning, completion, value }
  function normalizeProviderMap(providerModels, providerName) {
    if (!providerModels || typeof providerModels !== 'object') {
      return { reasoning: '', completion: '', value: '' };
    }
    
    // Comment 3: Runtime assertion in development to fail fast if unexpected keys are present
    const canonicalKeys = ['reasoning', 'completion', 'value'];
    const legacyKeys = ['coding']; // Legacy key that we still accept but normalize
    const allowedKeys = [...canonicalKeys, ...legacyKeys];
    const unexpectedKeys = Object.keys(providerModels).filter(
      key => !allowedKeys.includes(key) && providerModels[key] !== undefined && providerModels[key] !== null
    );
    
    if (unexpectedKeys.length > 0) {
      const warning = `[Provider Map Validation] Provider '${providerName}' has unexpected keys: ${unexpectedKeys.join(', ')}. Expected only: ${canonicalKeys.join(', ')}`;
      console.warn(warning);
    }
    
    // Normalize to canonical keys
    const normalized = {
      reasoning: String(providerModels.reasoning || ''),
      completion: String(providerModels.completion || providerModels.coding || ''), // Fallback to legacy 'coding'
      value: String(providerModels.value || '')
    };
    
    // Emit deprecation warning if using legacy 'coding' key
    if (!providerModels.completion && providerModels.coding) {
      console.warn(`[DEPRECATION] Provider '${providerName}' uses legacy 'coding' key. This key is deprecated and will be removed in a future version. Use 'completion' instead.`);
      console.warn(`[DEPRECATION] Migration: The next save operation will automatically migrate to 'completion' key.`);
    }
    
    return normalized;
  }

  // Phase 3: Helper function to get coding model with deprecation warning
  // @deprecated Use normalizeProviderMap instead for full normalization
  function getCodingModelFromProvider(providerModels, providerName) {
    const normalized = normalizeProviderMap(providerModels, providerName);
    return normalized.completion;
  }

  // Phase 5: Debounce helper to prevent excessive re-renders
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

  // Phase 5: Debounced render to prevent filter input flicker
  const debouncedRenderModelList = debounce((searchTerm) => {
    renderModelList(searchTerm);
  }, 300);

  // Comment 8: Safe message validation for incoming extension messages
  // Validates messages against schemas and logs mismatches in DEBUG mode
  function safeValidateMessage(message, direction) {
    // Comment 19: Check feature flag
    if (!state.featureFlags.enableSchemaValidation) {
      return message; // Validation disabled
    }

    if (!message || typeof message !== 'object') {
      console.error('[Schema Validation] Invalid message structure:', message);
      return null;
    }

    const { type, payload } = message;
    
    if (!type || typeof type !== 'string') {
      console.error('[Schema Validation] Missing or invalid message type:', message);
      return null;
    }

    // Comment 8: Validate payload based on message type with comprehensive checks
    switch (type) {
      case 'status':
        if (!payload || typeof payload !== 'object') return null;
        break;
        
      case 'models':
        if (!payload || typeof payload !== 'object') return null;
        // Comment 8: Require provider field for race protection
        if (!payload.provider || typeof payload.provider !== 'string') {
          console.error('[Schema Validation] models message missing provider field:', message);
          if (state.featureFlags.enableSchemaValidation) {
            console.error('[Schema Validation] Rejected models message due to missing provider');
          }
          return null;
        }
        if (!Array.isArray(payload.models)) {
          console.error('[Schema Validation] models payload.models is not an array:', message);
          return null;
        }
        // Comment 8: Validate token if present
        if (payload.token !== undefined && typeof payload.token !== 'string') {
          console.error('[Schema Validation] models payload.token must be string if present:', message);
          return null;
        }
        break;
        
      case 'config':
        if (!payload || typeof payload !== 'object') return null;
        // Comment 8: Required fields for config
        if (!payload.provider || typeof payload.provider !== 'string') {
          console.error('[Schema Validation] config message missing provider field:', message);
          return null;
        }
        // Comment 8: Validate modelSelectionsByProvider structure if present
        if (payload.modelSelectionsByProvider && typeof payload.modelSelectionsByProvider !== 'object') {
          console.error('[Schema Validation] config.modelSelectionsByProvider must be object:', message);
          return null;
        }
        break;
        
      case 'modelsSaved':
        if (!payload || typeof payload !== 'object') return null;
        // Comment 8: Require providerId for save confirmation matching
        if (!payload.providerId || typeof payload.providerId !== 'string') {
          console.error('[Schema Validation] modelsSaved message missing providerId field:', message);
          return null;
        }
        break;
        
      case 'modelsError':
      case 'proxyError':
        if (!payload) return null;
        // Comment 8: Validate structured error payload (always object now per Comment 1)
        if (typeof payload === 'object') {
          if (!payload.provider || typeof payload.provider !== 'string') {
            console.error('[Schema Validation] Error message missing provider field:', message);
            return null;
          }
          if (!payload.error || typeof payload.error !== 'string') {
            console.error('[Schema Validation] Error message missing error field:', message);
            return null;
          }
          if (!payload.errorType || typeof payload.errorType !== 'string') {
            console.error('[Schema Validation] Error message missing errorType field:', message);
            return null;
          }
          // Comment 8: Validate optional fields
          if (payload.token !== undefined && typeof payload.token !== 'string') {
            console.error('[Schema Validation] Error payload.token must be string if present:', message);
            return null;
          }
          if (payload.traceId !== undefined && typeof payload.traceId !== 'string') {
            console.error('[Schema Validation] Error payload.traceId must be string if present:', message);
            return null;
          }
        } else {
          // Comment 8: Backward compatibility - allow string payload but log warning
          console.warn('[Schema Validation] Error payload is string (legacy format), consider upgrading to structured format');
        }
        break;
        
      // Other message types - basic validation only
      case 'keys':
      case 'keysLoaded':
      case 'keyStored':
      case 'anthropicKeyStored':
      case 'combosLoaded':
      case 'comboDeleted':
      case 'customProvidersLoaded':
      case 'customProviderDeleted':
      case 'popularModels':
        // These require payload but we don't validate structure in safe mode
        if (!payload) {
          console.error('[Schema Validation] Message type requires payload:', type);
          return null;
        }
        break;
        
      default: {
        // Comment 8: Log schema mismatches in DEBUG mode
        const debugCheckbox = document.getElementById('debugCheckbox');
        if (debugCheckbox && debugCheckbox.checked) {
          console.warn('[Schema Validation] Unknown message type:', type, 'Message:', message);
        }
        // Allow unknown types in safe mode for backward compatibility
        break;
      }
    }

    return message; // Validation passed
  }

  // Provider metadata
    const providers = {
        openrouter: {
            name: 'OpenRouter',
            description: 'Access 400+ models with smart routing',
      helpUrl: 'https://openrouter.ai/keys',
      apiPrefix: ''
        },
        openai: {
            name: 'OpenAI',
            description: 'GPT-4, GPT-4o, and o1 models',
      helpUrl: 'https://platform.openai.com/api-keys',
      apiPrefix: 'openai/'
        },
        together: {
            name: 'Together AI',
            description: 'Open source models with fast inference',
      helpUrl: 'https://api.together.xyz/settings/api-keys',
      apiPrefix: 'together/'
        },
        deepseek: {
      name: 'Deepseek',
            description: 'Anthropic-compatible API with DeepSeek models',
      helpUrl: 'https://platform.deepseek.com/api_keys',
      apiPrefix: ''
        },
        glm: {
      name: 'GLM (Z.AI)',
            description: 'Anthropic-compatible API with GLM models',
      helpUrl: 'https://open.bigmodel.cn/',
      apiPrefix: ''
        },
        custom: {
            name: 'Custom Provider',
            description: 'Use any OpenAI-compatible endpoint',
      helpUrl: null,
      apiPrefix: ''
    }
  };

  // Comment 1: Define endpoint kind change handler before setupEventListeners() attaches it
  function onEndpointKindChange(e) {
    const endpointKind = e.target.value;
    const customUrlInput = document.getElementById('customUrl');
    const baseUrl = customUrlInput?.value?.trim();
    
    // Comment 1: Normalize base URL by trimming trailing slashes
    const normalizedBaseUrl = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
    
    if (normalizedBaseUrl) {
      // Comment 1: Optionally update local UI state optimistically
      const detectionSourceBadge = document.getElementById('detectionSourceBadge');
      if (detectionSourceBadge && endpointKind !== 'auto') {
        detectionSourceBadge.textContent = 'override';
        detectionSourceBadge.style.display = 'inline-block';
      } else if (detectionSourceBadge && endpointKind === 'auto') {
        detectionSourceBadge.textContent = 'auto';
        detectionSourceBadge.style.display = 'inline-block';
      }
      
      // Comment 1: Post message to extension to persist override
      vscode.postMessage({
        type: 'updateEndpointKind',
        baseUrl: normalizedBaseUrl,
        endpointKind: endpointKind
      });
    }
  }

  // Initialize
  document.addEventListener('DOMContentLoaded', init);

  function init() {
    console.log('[init] Initializing Claude Throne webview...');
        setupEventListeners();
    restoreState();
    
    // Notify backend that webview is ready
    console.log('[init] Sending webviewReady signal...');
    vscode.postMessage({ type: 'webviewReady' });
    
    // Request initial data from backend
    console.log('[init] Requesting config, keys, and status from backend...');
    vscode.postMessage({ type: 'requestConfig' });
    vscode.postMessage({ type: 'requestKeys' });
    vscode.postMessage({ type: 'requestStatus' });
    
    // Models will be loaded after config is received
  }
    
    function setupEventListeners() {
        // Provider selection
        const providerSelect = document.getElementById('providerSelect');
    providerSelect?.addEventListener('change', onProviderChange);
        
    // Custom URL
        const customUrlInput = document.getElementById('customUrl');
    customUrlInput?.addEventListener('input', onCustomUrlChange);
    
    // Comment 3: Endpoint kind selector
    const endpointKindSelect = document.getElementById('endpointKindSelect');
    endpointKindSelect?.addEventListener('change', onEndpointKindChange);

    // API Key
    const showKeyBtn = document.getElementById('showKeyBtn');
    showKeyBtn?.addEventListener('click', toggleKeyVisibility);

        const storeKeyBtn = document.getElementById('storeKeyBtn');
    storeKeyBtn?.addEventListener('click', storeApiKey);
        
        const apiKeyInput = document.getElementById('apiKeyInput');
    apiKeyInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') storeApiKey();
    });

    // Anthropic API Key
    const showAnthropicKeyBtn = document.getElementById('showAnthropicKeyBtn');
    showAnthropicKeyBtn?.addEventListener('click', toggleAnthropicKeyVisibility);

        const storeAnthropicKeyBtn = document.getElementById('storeAnthropicKeyBtn');
    storeAnthropicKeyBtn?.addEventListener('click', storeAnthropicKey);
        
        const anthropicKeyInput = document.getElementById('anthropicKeyInput');
    anthropicKeyInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') storeAnthropicKey();
    });

    // Two Model Toggle
    const twoModelToggle = document.getElementById('twoModelToggle');
    twoModelToggle?.addEventListener('change', onTwoModelToggle);

    // Debug Checkbox
    const debugCheckbox = document.getElementById('debugCheckbox');
    debugCheckbox?.addEventListener('change', (e) => {
      vscode.postMessage({
        type: 'updateDebug',
        enabled: e.target.checked
      });
    });

    // Model Search
    const modelSearch = document.getElementById('modelSearch');
    modelSearch?.addEventListener('input', onModelSearch);

    // Proxy Controls
    const startBtn = document.getElementById('startProxyBtn');
    startBtn?.addEventListener('click', startProxy);

    const stopBtn = document.getElementById('stopProxyBtn');
    stopBtn?.addEventListener('click', stopProxy);



    const portInput = document.getElementById('portInput');
    portInput?.addEventListener('input', onPortChange);

    // GitHub Link
    const repoLink = document.getElementById('repoLink');
    repoLink?.addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ 
        type: 'openExternal', 
        url: 'https://github.com/KHAEntertainment/claude-throne' 
      });
    });

    // Settings Button
    const settingsBtn = document.getElementById('settingsBtn');
    if (settingsBtn) {
      settingsBtn.addEventListener('click', () => {
        console.log('[Settings] Opening Thronekeeper settings');
        vscode.postMessage({ type: 'openSettings' });
      });
    }

    // Save Combo Button
    const saveComboBtn = document.getElementById('saveComboBtn');
    saveComboBtn?.addEventListener('click', requestSaveCombo);

    // Add Custom Provider Button
    const addCustomProviderBtn = document.getElementById('addCustomProviderBtn');
    addCustomProviderBtn?.addEventListener('click', requestAddCustomProvider);

    // Delete Custom Provider Button
    const deleteCustomProviderBtn = document.getElementById('deleteCustomProviderBtn');
    deleteCustomProviderBtn?.addEventListener('click', deleteCustomProvider);

    // Message handler
    window.addEventListener('message', handleMessage);
  }

  function handleMessage(event) {
    const rawMessage = event.data;
    
    // Comment 1: Validate message before processing
    const message = safeValidateMessage(rawMessage, 'toWebview');
    
    if (message === null) {
      console.error('[handleMessage] REJECTED invalid message:', rawMessage);
      return; // Don't process invalid messages
    }
    
    console.log('[handleMessage] Received message:', message.type, message);

    switch (message.type) {
      case 'status':
        updateStatus(message.payload);
        break;
      case 'models':
        handleModelsLoaded(message.payload);
        break;
      case 'config':
        handleConfigLoaded(message.payload);
        break;
      case 'popularModels':
        // Store featured pairings for later use
        window.lastFeaturedPairings = message.payload.pairings || [];
        // Store saved combos in state for consistency
        state.customCombos = message.payload.savedCombos || [];
        handlePopularModels(message.payload);
        break;
      case 'keys':
        handleKeysLoaded(message.payload);
        break;
      case 'keysLoaded':
        handleKeysLoaded(message.payload.keyStatus || message.payload);
        break;
      case 'keyStored':
        handleKeyStored(message.payload);
        break;
      case 'anthropicKeyStored':
        handleAnthropicKeyStored(message.payload);
        break;
      case 'proxyError': {
        // Comment 1: Handle structured error payload
        const proxyErrorPayload = typeof message.payload === 'string' 
          ? { provider: state.provider, error: message.payload, errorType: 'generic' }
          : message.payload;
        showError(proxyErrorPayload);
        break;
      }
      case 'modelsError':
        handleModelsError(message.payload);
        break;
      case 'combosLoaded':
        handleCombosLoaded(message.payload);
        updateComboSaveButton();
        break;
      case 'comboDeleted':
        handleComboDeleted(message.payload);
        updateComboSaveButton();
        break;
      case 'customProvidersLoaded':
        handleCustomProvidersLoaded(message.payload);
        break;
      case 'customProviderDeleted':
        handleCustomProviderDeleted(message.payload);
        break;
      case 'endpointKindUpdated':
        // Comment 3: Handle endpoint kind update confirmation and update badge
        if (message.payload && state.endpointOverrides) {
          const normalizedUrl = message.payload.baseUrl.replace(/\/+$/, '');
          state.endpointOverrides[normalizedUrl] = message.payload.endpointKind;
          // Update badge to show detection source
          const detectionSourceBadge = document.getElementById('detectionSourceBadge');
          if (detectionSourceBadge) {
            if (message.payload.endpointKind === 'auto') {
              detectionSourceBadge.textContent = 'auto';
            } else {
              detectionSourceBadge.textContent = 'override';
            }
            detectionSourceBadge.style.display = 'inline-block';
          }
        }
        break;
      case 'modelsSaved':
        handleModelsSaved(message.payload);
        break;
      case 'configWarning':
        // Comment 9: Handle configWarning message for provider-specific model fallback
        handleConfigWarning(message.payload);
        break;
      default:
        console.log('[handleMessage] Unknown message type:', message.type);
    }
  }

  function handleConfigWarning(payload) {
    console.warn('[Config Warning]', payload.message);
    if (payload.provider && payload.fallbackUsed) {
      showNotification(payload.message, 'warning', 5000);
    }
  }

  function restoreState() {
    const saved = vscode.getState();
    if (saved) {
      state = { ...state, ...saved };
      
      // Restore UI - provider dropdown will be populated after custom providers load
      document.getElementById('twoModelToggle').checked = state.twoModelMode;
      updateTwoModelUI();
    }
  }

  function saveState() {
    vscode.setState(state);
  }

  function handleModelsSaved(payload) {
    console.log('[handleModelsSaved] Model save confirmation received:', payload);
    
    // Comment 12: Only clear flag if this confirmation is for the provider that triggered the save
    if (payload.providerId === state.inSaveProvider) {
      state.inSaveOperation = false;
      state.inSaveProvider = null;
      console.log(`[handleModelsSaved] Cleared inSaveOperation flag for provider: ${payload.providerId}`);
    } else {
      console.log(`[handleModelsSaved] Ignoring save confirmation for different provider: ${payload.providerId} (expected: ${state.inSaveProvider})`);
      // Don't clear the flag - we're still waiting for the correct provider's save
      return;
    }
    
    if (!payload.success) {
      console.error('[handleModelsSaved] Model save failed:', payload);
      showNotification('Failed to save model selection', 'error');
      return;
    }
    
    // Only process if this save is for the current provider
    if (payload.providerId !== state.provider) {
      console.log(`[handleModelsSaved] Ignoring save for different provider: ${payload.providerId} (current: ${state.provider})`);
      return;
    }
    
    console.log('[handleModelsSaved] Model selections successfully saved, synchronizing UI state');
    
    // Update selected models display to ensure consistency with extension
    updateSelectedModelsDisplay();
    
    // Re-render model list to update button states correctly
    renderModelList();
    
    console.log('[handleModelsSaved] UI state synchronized with extension');
  }

  // Provider handling
  function onProviderChange(e) {
    // Comment 1: Capture previous provider first
    const previousProvider = state.provider;
    
    // Comment 1: Save current models for the old provider BEFORE changing state
    if (previousProvider && state.modelsByProvider[previousProvider]) {
      state.modelsByProvider[previousProvider].reasoning = state.reasoningModel;
      // Comment 5: Only write 'completion' key (canonical storage)
      state.modelsByProvider[previousProvider].completion = state.codingModel;
      state.modelsByProvider[previousProvider].value = state.valueModel;
      
      // Comment 1: Post saveModels with old providerId BEFORE provider update
      vscode.postMessage({
        type: 'saveModels',
        providerId: previousProvider,
        reasoning: state.reasoningModel,
        completion: state.codingModel,
        value: state.valueModel
      });
    }
    
    const newProvider = e.target.value;
    
    // Comment 5: Delete only the old provider's cache (isolated per-provider caches)
    delete state.modelsCache[previousProvider];
    console.log(`[onProviderChange] Cleared cache for previous provider: ${previousProvider}`);
    
    // Comment 5: Reset sequence token counter on provider switch to ensure clean state
    state.requestTokenCounter = 0;
    state.currentRequestToken = null;
    
    // Comment 6: Generate trace ID for provider flow (DEBUG mode only)
    const debugCheckbox = document.getElementById('debugCheckbox');
    const debug = debugCheckbox && debugCheckbox.checked;
    if (debug) {
      state.currentTraceId = `trace-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
      console.log(`[Trace ${state.currentTraceId}] Provider switch: ${previousProvider} → ${newProvider}`);
    } else {
      state.currentTraceId = null;
    }
    
    // Now update provider state
    state.provider = newProvider;
    state.models = [];
    
    // Comment 3: Reset filtered IDs and selection tracking when switching providers
    state.lastFilteredIds = null;
    state.lastSelectedModels = { reasoning: '', coding: '', value: '' };
    
    // Reset models and clear the visual list before loading
    renderModelList();
    
    // Initialize models storage for custom provider if needed
    if (!state.modelsByProvider[newProvider]) {
      // Comment 5: Only use 'completion' key for canonical storage
      state.modelsByProvider[newProvider] = { reasoning: '', completion: '', value: '' };
    }
    
    // Restore models for the new provider
    if (state.modelsByProvider[newProvider]) {
      // Comment 3: Normalize provider map before reading
      const normalized = normalizeProviderMap(state.modelsByProvider[newProvider], newProvider);
      state.reasoningModel = normalized.reasoning;
      state.codingModel = normalized.completion;
      state.valueModel = normalized.value;
    } else {
      state.reasoningModel = '';
      state.codingModel = '';
      state.valueModel = '';
    }
    
    updateProviderUI();
    updateSelectedModelsDisplay();
    loadModels();
    saveState();

        vscode.postMessage({
            type: 'updateProvider',
      provider: state.provider 
    });
  }

  function updateProviderUI() {
    const customSection = document.getElementById('customUrlSection');
    const combosCard = document.getElementById('popularCombosCard');
    const helpDiv = document.getElementById('providerHelp');
    const deleteBtn = document.getElementById('deleteCustomProviderBtn');
    const nameSection = document.getElementById('customProviderNameSection');
    
    // Check if this is a custom provider
    const isCustomProvider = state.customProviders.some(p => p.id === state.provider);
    
    // Show/hide custom provider name section
    if (nameSection) {
      nameSection.style.display = (state.provider === 'custom') ? 'block' : 'none';
    }
    
    // Show/hide custom URL
    if (state.provider === 'custom' || isCustomProvider) {
      customSection?.classList.add('visible');
      
      // Comment 3: Show endpoint kind selector for custom providers
      const endpointKindSection = document.getElementById('endpointKindSection');
      if (endpointKindSection) {
        endpointKindSection.style.display = 'block';
      }
      
      // If it's a saved custom provider, populate its URL and endpoint kind
      if (isCustomProvider) {
        const customProvider = state.customProviders.find(p => p.id === state.provider);
        if (customProvider) {
          if (document.getElementById('customUrl')) {
            document.getElementById('customUrl').value = customProvider.baseUrl;
          }
          // Comment 3: Set endpoint kind from overrides and show detection source badge
          const normalizedUrl = customProvider.baseUrl.replace(/\/+$/, '');
          const endpointKindSelect = document.getElementById('endpointKindSelect');
          const detectionSourceBadge = document.getElementById('detectionSourceBadge');
          if (endpointKindSelect && state.endpointOverrides) {
            const override = state.endpointOverrides[normalizedUrl];
            endpointKindSelect.value = override || 'auto';
            // Comment 3: Show badge with detection source
            if (detectionSourceBadge) {
              if (override) {
                detectionSourceBadge.textContent = 'override';
                detectionSourceBadge.style.display = 'inline-block';
              } else {
                detectionSourceBadge.textContent = 'auto';
                detectionSourceBadge.style.display = 'inline-block';
              }
            }
          }
        }
      }
    } else {
      customSection?.classList.remove('visible');
      // Comment 3: Hide endpoint kind selector for non-custom providers
      const endpointKindSection = document.getElementById('endpointKindSection');
      if (endpointKindSection) {
        endpointKindSection.style.display = 'none';
      }
    }

    // Clear form fields when switching to custom provider
    if (state.provider === 'custom') {
      const nameInput = document.getElementById('customProviderNameInput');
      const urlInput = document.getElementById('customUrl');
      const keyInput = document.getElementById('apiKeyInput');
      if (nameInput) nameInput.value = '';
      if (urlInput) urlInput.value = '';
      if (keyInput) keyInput.value = '';
    }

    // Show/hide popular combos (OpenRouter only)
    if (state.provider === 'openrouter') {
      combosCard?.classList.add('visible');
      vscode.postMessage({ type: 'requestPopularModels' });
    } else {
      combosCard?.classList.remove('visible');
    }

    // Show/hide delete button for custom providers
    if (deleteBtn) {
      if (isCustomProvider) {
        deleteBtn.style.display = 'block';
      } else {
        deleteBtn.style.display = 'none';
      }
    }

    // Show/hide "Add Custom Provider" button
    const addBtn = document.getElementById('addCustomProviderBtn');
    if (addBtn) {
      // Only show button when "custom" provider is selected (for one-off custom providers)
      addBtn.style.display = (state.provider === 'custom') ? 'block' : 'none';
      addBtn.title = 'Create a new saved custom provider that appears in the provider list';
    }

    // Update button behavior for custom provider creation
    const storeKeyBtn = document.getElementById('storeKeyBtn');
    if (storeKeyBtn) {
      if (state.provider === 'custom') {
        storeKeyBtn.textContent = 'Add Custom Provider';
        storeKeyBtn.onclick = addCustomProviderFromMain;
        storeKeyBtn.title = 'Create a new saved custom provider';
      } else {
        storeKeyBtn.textContent = 'Store Key';
        storeKeyBtn.onclick = storeApiKey;
        storeKeyBtn.title = 'Store API key';
      }
    }

    // Update help text - prioritize explicit cases first
    if (state.provider === 'custom' && helpDiv) {
      // Comment 3: Updated help text with endpoint kind recommendation
      helpDiv.innerHTML = 'Custom = one‑off URL below. Set endpoint type to avoid 401/404 errors. Saved Custom Providers appear in this list when created.';
    } else if (isCustomProvider && helpDiv) {
      // Comment 3: Updated help text with endpoint kind recommendation
      helpDiv.innerHTML = 'This is a saved custom provider. URL and key are stored for reuse. Set endpoint type to avoid 401/404 errors.';
    } else {
      // For built-in providers
      const providerInfo = providers[state.provider];
      if (providerInfo && helpDiv) {
        if (providerInfo.helpUrl) {
          helpDiv.innerHTML = `<a href="${providerInfo.helpUrl}" target="_blank">Get API Key →</a>`;
        } else {
          helpDiv.innerHTML = '';
        }
      }
    }
  }

    function onCustomUrlChange(e) {
        vscode.postMessage({
            type: 'updateCustomBaseUrl',
            url: e.target.value
        });
    }
    
  // API Key handling
  function toggleKeyVisibility() {
    const input = document.getElementById('apiKeyInput');
    const icon = document.getElementById('keyIcon');
    
    if (input.type === 'password') {
      input.type = 'text';
      icon.textContent = '🙈';
    } else {
      input.type = 'password';
      icon.textContent = '👁';
    }
  }

  function storeApiKey() {
    const input = document.getElementById('apiKeyInput');
    const key = input.value.trim();
    
    console.log('[storeApiKey] Called with key length:', key.length);
    console.log('[storeApiKey] vscode object:', vscode);
    console.log('[storeApiKey] vscode.postMessage type:', typeof vscode.postMessage);
    
        if (!key) {
      console.log('[storeApiKey] No key provided');
            return;
        }
        
    console.log('[storeApiKey] Sending storeKey message for provider:', state.provider);
    try {
        vscode.postMessage({
            type: 'storeKey',
        provider: state.provider,
            key: key
        });
      console.log('[storeApiKey] Message sent successfully');
    } catch (err) {
      console.error('[storeApiKey] Error sending message:', err);
    }
  }

  function handleKeyStored(payload) {
    console.log('[handleKeyStored] Received payload:', payload);
    
    if (payload.success) {
      // Show success feedback
      console.log('[handleKeyStored] Key stored successfully, loading models...');
      showNotification('API key stored successfully', 'success');
      
      // Request updated keys status to refresh UI
      vscode.postMessage({ type: 'requestKeys' });
      
      // Reload models if this was the first key
      loadModels();
        } else {
      console.error('[handleKeyStored] Failed to store key:', payload.error);
      showNotification('Failed to store API key: ' + (payload.error || 'Unknown error'), 'error');
    }
  }

  function toggleAnthropicKeyVisibility() {
    const input = document.getElementById('anthropicKeyInput');
    const icon = document.getElementById('anthropicKeyIcon');
    
    if (input.type === 'password') {
      input.type = 'text';
      icon.textContent = '🙈';
    } else {
      input.type = 'password';
      icon.textContent = '👁';
    }
  }

  function storeAnthropicKey() {
    const input = document.getElementById('anthropicKeyInput');
    const key = input.value.trim();
    
    console.log('[storeAnthropicKey] Called with key length:', key.length);
    
    if (!key) {
      console.log('[storeAnthropicKey] No key provided');
      return;
    }
    
    console.log('[storeAnthropicKey] Sending storeAnthropicKey message');
    try {
      vscode.postMessage({
        type: 'storeAnthropicKey',
        key: key
      });
      console.log('[storeAnthropicKey] Message sent successfully');
      // Clear input after sending
      input.value = '';
    } catch (err) {
      console.error('[storeAnthropicKey] Error sending message:', err);
    }
  }

  function addCustomProviderFromMain() {
    const name = document.getElementById('customProviderNameInput')?.value?.trim();
    const url = document.getElementById('customUrl')?.value?.trim();
    const key = document.getElementById('apiKeyInput')?.value?.trim();
    
    console.log('[addCustomProviderFromMain] Called with:', { name, url, keyLength: key?.length });
    
    // Validate all three fields
    if (!name) {
      showNotification('Provider name is required', 'error');
      return;
    }
    
    if (!url) {
      showNotification('Base URL is required', 'error');
      return;
    }
    
    if (!key) {
      showNotification('API key is required', 'error');
      return;
    }
    
    // Validate URL format
    try {
      new URL(url);
    } catch (e) {
      showNotification('Please enter a valid URL', 'error');
      return;
    }
    
    // Generate ID from name (reuse existing logic from requestAddCustomProvider)
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    
    // Check for conflicts with built-in providers
    const builtinProviders = ['openrouter', 'openai', 'together', 'deepseek', 'glm', 'custom'];
    if (builtinProviders.includes(id)) {
      showNotification('Provider ID conflicts with built-in provider. Please choose a different name.', 'error');
      return;
    }
    
    // Check for duplicate ID
    if (state.customProviders.some(p => p.id === id)) {
      showNotification('A custom provider with this name already exists.', 'error');
      return;
    }
    
    // Check limit
    if (state.customProviders.length >= 10) {
      showNotification('Maximum of 10 custom providers reached. Delete an existing provider to add a new one.', 'error');
      return;
    }
    
    console.log('[addCustomProviderFromMain] Adding provider:', { name, url, id });
    
    // Store intended provider ID for auto-selection after save
    const intendedProviderId = id;

    // Save the provider first
    vscode.postMessage({
      type: 'saveCustomProvider',
      name: name.trim(),
      baseUrl: url.trim(),
      id
    });
    
    // Store the API key for the provider after saving
    if (key) {
      vscode.postMessage({
        type: 'storeKey',
        provider: intendedProviderId,
        key: key.trim()
      });
    }
    
    // Clear form fields after both messages have been posted
    const nameInput = document.getElementById('customProviderNameInput');
    const urlInput = document.getElementById('customUrl');
    const keyInput = document.getElementById('apiKeyInput');
    
    if (nameInput) nameInput.value = '';
    if (urlInput) urlInput.value = '';
    if (keyInput) keyInput.value = '';
    
    // After successful save, set as active provider (small delay for backend response)
    setTimeout(() => {
      state.provider = intendedProviderId;
      updateProviderDropdown();
      updateProviderUI();
    }, 300);
  }

  function handleAnthropicKeyStored(payload) {
    console.log('[handleAnthropicKeyStored] Received payload:', payload);
    
    if (payload.success) {
      // Show success feedback
      console.log('[handleAnthropicKeyStored] Anthropic key stored successfully');
      showNotification('Anthropic API key stored successfully', 'success');
      
      // Request updated keys status to refresh UI
      vscode.postMessage({ type: 'requestKeys' });
    } else {
      console.error('[handleAnthropicKeyStored] Failed to store Anthropic key:', payload.error);
      showNotification('Failed to store Anthropic API key: ' + (payload.error || 'Unknown error'), 'error');
    }
  }

  function showNotification(message, type = 'info', duration = 3000) {
    console.log(`[${type.toUpperCase()}] ${message}`);
    
    // Create or update inline notification
    let notificationEl = document.getElementById('inlineNotification');
    if (!notificationEl) {
      // Create notification element if it doesn't exist
      const container = document.querySelector('.container');
      if (container) {
        notificationEl = document.createElement('div');
        notificationEl.id = 'inlineNotification';
        notificationEl.style.cssText = `
          position: fixed;
          top: 10px;
          right: 10px;
          padding: 8px 16px;
          border-radius: 4px;
          z-index: 1000;
          transition: opacity 0.3s;
          font-size: 13px;
        `;
        container.appendChild(notificationEl);
      }
    }
    
    if (notificationEl) {
      // Set color based on type
      const colors = {
        'success': 'var(--vscode-testing-iconPassed)',
        'error': 'var(--vscode-errorForeground)',
        'info': 'var(--vscode-foreground)'
      };
      
      notificationEl.textContent = message;
      notificationEl.style.backgroundColor = 'var(--vscode-editor-background)';
      notificationEl.style.color = colors[type] || colors.info;
      notificationEl.style.border = `1px solid ${colors[type] || colors.info}`;
      notificationEl.style.opacity = '1';
      notificationEl.style.display = 'block';
      
      // Auto-hide after specified duration
      setTimeout(() => {
        notificationEl.style.opacity = '0';
        setTimeout(() => {
          notificationEl.style.display = 'none';
        }, 300);
      }, duration);
    }
  }

  function clearNotifications() {
    const notificationEl = document.getElementById('inlineNotification');
    if (notificationEl) {
      notificationEl.style.display = 'none';
    }
  }

  function updateComboSaveButton() {
    const saveBtn = document.getElementById('saveComboBtn');
    if (saveBtn) {
      const currentCount = state.customCombos ? state.customCombos.length : 0;
      if (currentCount > 0) {
        saveBtn.textContent = `+ Save Model Combo (${currentCount}/4)`;
      } else {
        saveBtn.textContent = '+ Save Model Combo';
      }
    }
  }

  function highlightNewCombo(combos) {
    if (!combos || combos.length === 0) return;
    
    // Find the newest combo (last in array)
    const newCombo = combos[combos.length - 1];
    const comboElements = document.querySelectorAll('.combo-item');
    
    comboElements.forEach(el => {
      const comboName = el.querySelector('.combo-name')?.textContent;
      if (comboName === newCombo.name) {
        // Add highlight animation
        el.style.backgroundColor = 'var(--vscode-list-hoverBackground)';
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        
        // Remove highlight after 2 seconds
        setTimeout(() => {
          el.style.backgroundColor = '';
        }, 2000);
      }
    });
  }

  function requestSaveCombo() {
    // Check if we've reached the 4-combo limit
    if (state.customCombos && state.customCombos.length >= 4) {
      showNotification('Maximum of 4 saved combos reached. Delete an existing combo to save a new one.', 'error');
      return;
    }
    
    const name = prompt('Enter a name for this model combo:');
    if (!name || !name.trim()) {
      return;
    }
    
    console.log('[requestSaveCombo] Saving combo:', name);
    
    // Clear any previous notifications
    clearNotifications();
    
    // Show saving state on button
    const saveBtn = document.getElementById('saveComboBtn');
    if (saveBtn) {
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '✓ Saving...';
      saveBtn.style.backgroundColor = 'var(--vscode-button-secondaryBackground)';
      saveBtn.disabled = true;
      
      // Set a timeout for error handling
      const timeoutId = setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.style.backgroundColor = '';
        saveBtn.disabled = false;
        showNotification('Save request timed out. Please try again.', 'error');
      }, 5000);
      
      // Store timeout ID so we can clear it on success
      window.saveComboTimeout = timeoutId;
    }
    
    vscode.postMessage({
      type: 'saveCombo',
      name: name.trim(),
      reasoningModel: state.reasoningModel,
      codingModel: state.codingModel,
      valueModel: state.valueModel
    });
  }

  function requestAddCustomProvider() {
    // Check if we've reached the 10 provider limit
    if (state.customProviders && state.customProviders.length >= 10) {
      showNotification('Maximum of 10 custom providers reached. Delete an existing provider to add a new one.', 'error');
      return;
    }
    
    const name = prompt('Enter a name for this custom provider:');
    if (!name || !name.trim()) {
      return;
    }
    
    const baseUrl = prompt('Enter the base URL (e.g., https://api.example.com/v1):');
    if (!baseUrl || !baseUrl.trim()) {
      return;
    }
    
    // Basic URL validation
    try {
      new URL(baseUrl);
    } catch (e) {
      showNotification('Please enter a valid URL', 'error');
      return;
    }
    
    // Generate ID from name
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    
    // Check for conflicts with built-in providers
    const builtinProviders = ['openrouter', 'openai', 'together', 'deepseek', 'glm', 'custom'];
    if (builtinProviders.includes(id)) {
      showNotification('Provider ID conflicts with built-in provider. Please choose a different name.', 'error');
      return;
    }
    
    // Check for duplicate ID
    if (state.customProviders.some(p => p.id === id)) {
      showNotification('A custom provider with this name already exists.', 'error');
      return;
    }
    
    console.log('[requestAddCustomProvider] Adding provider:', { name, baseUrl, id });
    
    vscode.postMessage({
      type: 'saveCustomProvider',
      name: name.trim(),
      baseUrl: baseUrl.trim(),
      id
    });
  }

  function handleCustomProvidersLoaded(payload) {
    console.log('[handleCustomProvidersLoaded] Custom providers loaded:', payload);
    
    if (payload && payload.providers) {
      state.customProviders = payload.providers;
      // Comment 3: Store endpoint kind overrides
      if (payload.endpointOverrides) {
        state.endpointOverrides = payload.endpointOverrides;
      }
      updateProviderDropdown();
      
      // Set provider value after dropdown is populated
      if (state.provider) {
        document.getElementById('providerSelect').value = state.provider;
        updateProviderUI();
      } else {
        // If no provider is selected (e.g., after new provider creation), default to the last added custom provider
        const lastCustomProvider = payload.providers[payload.providers.length - 1];
        if (lastCustomProvider) {
          state.provider = lastCustomProvider.id;
          document.getElementById('providerSelect').value = lastCustomProvider.id;
          updateProviderUI();
        }
      }
    }
  }

  function handleCustomProviderDeleted(payload) {
    console.log('[handleCustomProviderDeleted] Custom provider deleted:', payload);
    
    if (payload.providers) {
      state.customProviders = payload.providers;
      updateProviderDropdown();
      
      // If the deleted provider was currently selected, switch to default
      if (payload.deletedId && state.provider === payload.deletedId) {
        state.provider = 'openrouter';
        document.getElementById('providerSelect').value = 'openrouter';
        updateProviderUI();
        loadModels();
      }
    }
    
    showNotification('Custom provider deleted successfully', 'success');
  }

  function updateProviderDropdown() {
    const providerSelect = document.getElementById('providerSelect');
    if (!providerSelect) return;
    
    // Clear existing options except the first one
    const currentValue = providerSelect.value;
    providerSelect.innerHTML = '';
    
    // Add built-in providers
    Object.keys(providers).forEach(providerId => {
      const option = document.createElement('option');
      option.value = providerId;
      option.textContent = providers[providerId].name;
      providerSelect.appendChild(option);
    });
    
    // Add custom providers in optgroup if any exist
    if (state.customProviders && state.customProviders.length > 0) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = 'Custom Providers';
      
      state.customProviders.forEach(provider => {
        const option = document.createElement('option');
        option.value = provider.id;
        option.textContent = provider.name;
        optgroup.appendChild(option);
      });
      
      providerSelect.appendChild(optgroup);
    }
    
    // Restore selection
    if (currentValue) {
      providerSelect.value = currentValue;
    }
  }

  function deleteCustomProvider() {
    const isCustomProvider = state.customProviders.some(p => p.id === state.provider);
    if (!isCustomProvider) {
      return;
    }
    
    const provider = state.customProviders.find(p => p.id === state.provider);
    if (!provider) {
      return;
    }
    
    if (confirm(`Delete custom provider "${provider.name}"? This will also remove its stored API key.`)) {
      vscode.postMessage({
        type: 'deleteCustomProvider',
        id: provider.id
      });
    }
  }

  function handleCombosLoaded(payload) {
    console.log('[handleCombosLoaded] Combos loaded:', payload);
    
    // Clear any pending timeout
    if (window.saveComboTimeout) {
      clearTimeout(window.saveComboTimeout);
      window.saveComboTimeout = null;
    }
    
    // Show success feedback when combo is saved
    const saveBtn = document.getElementById('saveComboBtn');
    if (saveBtn && saveBtn.textContent.includes('Saving')) {
      saveBtn.textContent = '✓ Saved!';
      saveBtn.style.backgroundColor = 'var(--vscode-testing-iconPassed)';
      saveBtn.disabled = false;
      
      // Show prominent inline notification
      showNotification('Model combo saved successfully! You can now select it from the Quick Combos section.', 'success', 3000);
      
      // Update save button to show combo count
      updateComboSaveButton();
      
      setTimeout(() => {
        saveBtn.textContent = '+ Save Model Combo';
        saveBtn.style.backgroundColor = '';
      }, 3000);
    }
    
    // Store the combos for later display
    if (payload.combos) {
      state.customCombos = payload.combos;
      
      // Re-render combo display with saved combos included
      // Get current featured pairings and merge with saved combos
      const currentPayload = {
        pairings: window.lastFeaturedPairings || [],
        savedCombos: payload.combos
      };
      handlePopularModels(currentPayload);
      
      // Highlight the newly added combo if we just saved one
      if (saveBtn && saveBtn.textContent.includes('Saved')) {
        setTimeout(() => {
          highlightNewCombo(payload.combos);
        }, 100);
      }
    }
  }

  function handleComboDeleted(payload) {
    console.log('[handleComboDeleted] Combo deleted:', payload);
    
    // Clear any existing notifications
    clearNotifications();
    
    // Update state with new combos
    if (payload.combos) {
      state.customCombos = payload.combos;
      
      // Re-render combo display
      const currentPayload = {
        pairings: window.lastFeaturedPairings || [],
        savedCombos: payload.combos
      };
      handlePopularModels(currentPayload);
    }
    
    // Show success notification
    showNotification('Model combo deleted successfully', 'success');
  }

  function handleKeysLoaded(keys) {
    console.log('[handleKeysLoaded] Keys status received:', keys);
    console.log('[handleKeysLoaded] Current provider in state:', state.provider);
    console.log('[handleKeysLoaded] Key status for current provider:', keys[state.provider]);
    
    // Update UI to show if key is stored
    const input = document.getElementById('apiKeyInput');
    const helpDiv = document.getElementById('providerHelp');
    const storeBtn = document.getElementById('storeKeyBtn');
    
    // Check if current provider has a stored key
    const hasKey = !!(keys && keys[state.provider]);
    console.log('[handleKeysLoaded] Provider', state.provider, 'has key:', hasKey);
    
    if (hasKey) {
      // Key is stored
      input.placeholder = '••••••••••••••••';
      input.value = '';
      storeBtn.textContent = 'Update Key';
      
      // Hide "Get API Key" link and show status
      if (helpDiv) {
        helpDiv.innerHTML = '<span style="color: var(--vscode-testing-iconPassed);">✓ API Key stored</span>';
      }
    } else {
      // No key stored
      input.placeholder = 'Enter your API key';
      storeBtn.textContent = 'Store Key';
      
      // Show "Get API Key" link for built-in providers
      const providerInfo = providers[state.provider];
      if (providerInfo && providerInfo.helpUrl && helpDiv) {
        helpDiv.innerHTML = `<a href="${providerInfo.helpUrl}" target="_blank">Get API Key →</a>`;
      } else if (helpDiv) {
        // For custom providers or providers without help URL, show generic message
        const isCustomProvider = state.customProviders.some(p => p.id === state.provider);
        if (isCustomProvider) {
          helpDiv.innerHTML = '<span style="color: var(--vscode-descriptionForeground);">Custom provider - enter API key</span>';
        } else {
          helpDiv.innerHTML = '';
        }
      }
    }
    
    // Update Anthropic key input
    const anthropicInput = document.getElementById('anthropicKeyInput');
    const anthropicStoreBtn = document.getElementById('storeAnthropicKeyBtn');
    
    if (keys.anthropic && anthropicInput && anthropicStoreBtn) {
      anthropicInput.placeholder = '••••••••••••••••';
      anthropicInput.value = '';
      anthropicStoreBtn.textContent = 'Update Key';
    } else if (anthropicInput && anthropicStoreBtn) {
      anthropicInput.placeholder = 'sk-ant-...';
      anthropicStoreBtn.textContent = 'Store Key';
    }
    
    // Log the complete state for debugging
    console.log('[handleKeysLoaded] Final UI state - Provider:', state.provider, 'Has key:', hasKey, 'Button text:', storeBtn?.textContent);
  }

  // Two Model Mode
  function onTwoModelToggle(e) {
    const newValue = e.target.checked;
    console.log('[onTwoModelToggle] Toggling two-model mode from', state.twoModelMode, 'to', newValue);
    state.twoModelMode = newValue;
    updateTwoModelUI();
    saveState();
    
    // Notify backend to update twoModelMode config
    console.log('[onTwoModelToggle] Sending toggleTwoModelMode message:', state.twoModelMode);
    vscode.postMessage({ type: 'toggleTwoModelMode', enabled: state.twoModelMode });
  }

  function updateTwoModelUI() {
    console.log('[updateTwoModelUI] Updating UI, twoModelMode:', state.twoModelMode);
    const modelList = document.getElementById('modelListContainer');
    const saveComboBtn = document.getElementById('saveComboBtn');

    // Show/hide save combo button
    updateSaveComboButton();

    // Re-render model list to show/hide secondary buttons
    console.log('[updateTwoModelUI] Calling renderModelList()');
    renderModelList();
  }

  function updateSaveComboButton() {
    const saveComboBtn = document.getElementById('saveComboBtn');
    if (!saveComboBtn) return;

    // Show button only if two-model mode is on and all three models are selected
    if (state.twoModelMode && state.reasoningModel && state.codingModel && state.valueModel) {
      saveComboBtn.classList.remove('hidden');
        } else {
      saveComboBtn.classList.add('hidden');
    }
  }

  // Model Selection
  function setModelFromList(modelId, type) {
    // Comment 3: Initialize provider entry in webview before writing to modelsByProvider when selecting from list
    if (!state.modelsByProvider[state.provider]) {
      state.modelsByProvider[state.provider] = { reasoning: '', completion: '', value: '' };
      console.log(`[setModelFromList] Initialized modelsByProvider entry for provider: ${state.provider}`);
    }
    
    // Comment 3: Normalize existing map before updating
    const normalized = normalizeProviderMap(state.modelsByProvider[state.provider], state.provider);
    
    if (type === 'reasoning') {
      state.reasoningModel = modelId;
      normalized.reasoning = modelId;
    } else if (type === 'coding') {
      state.codingModel = modelId;
      // Comment 3: Map 'coding' to 'completion' canonical key
      normalized.completion = modelId;
    } else if (type === 'value') {
      state.valueModel = modelId;
      normalized.value = modelId;
    }
    
    // Comment 3: Save normalized map back (ensures canonical keys only)
    state.modelsByProvider[state.provider] = normalized;
    
    // Comment 6: Add targeted logs around save round-trip to verify persistence and provider alignment
    console.log(`[setModelFromList] Save round-trip - state.provider: ${state.provider}, models: { reasoning: ${state.reasoningModel}, coding: ${state.codingModel}, value: ${state.valueModel} }`);
    
    // Comment 12: Set flag with provider tracking to prevent unnecessary model reloads during save round-trip
    state.inSaveOperation = true;
    state.inSaveProvider = state.provider;
    console.log(`[setModelFromList] Setting inSaveOperation=true for provider: ${state.provider} to prevent reload during save`);
    
    // Comment 4: Include providerId in saveModels message to avoid ambiguity and races
    // Comment 5: Send 'completion' instead of 'coding' (canonical storage)
    vscode.postMessage({
      type: 'saveModels',
      providerId: state.provider,
      reasoning: state.reasoningModel,
      completion: state.codingModel,
      value: state.valueModel
    });
    
    updateSaveComboButton();
    updateSelectedModelsDisplay();
    saveState();
    // Immediately re-render model list to update highlighting - state is already updated synchronously above
    renderModelList();
    // handleModelsSaved will also call renderModelList() as a safety net after backend confirmation
  }

  function updateSelectedModelsDisplay() {
    const reasoningDisplay = document.getElementById('reasoningModelDisplay');
    const codingDisplay = document.getElementById('codingModelDisplay');
    const valueDisplay = document.getElementById('valueModelDisplay');
    
    if (reasoningDisplay) {
      if (state.reasoningModel) {
        const modelName = state.reasoningModel.split('/').pop() || state.reasoningModel;
        reasoningDisplay.innerHTML = `<strong>Reasoning:</strong> ${escapeHtml(modelName)}`;
        } else {
        reasoningDisplay.innerHTML = '<em>No model(s) selected for this provider</em>';
      }
    }
    
    if (codingDisplay) {
      if (state.twoModelMode && state.codingModel) {
        const modelName = state.codingModel.split('/').pop() || state.codingModel;
        codingDisplay.innerHTML = `<strong>Coding:</strong> ${escapeHtml(modelName)}`;
        codingDisplay.style.display = 'block';
      } else {
        if (state.twoModelMode) {
          codingDisplay.innerHTML = '<em>No model(s) selected for this provider</em>';
        } else {
          codingDisplay.innerHTML = '';
        }
        codingDisplay.style.display = 'none';
      }
    }
    
    if (valueDisplay) {
      if (state.twoModelMode && state.valueModel) {
        const modelName = state.valueModel.split('/').pop() || state.valueModel;
        valueDisplay.innerHTML = `<strong>Value:</strong> ${escapeHtml(modelName)}`;
        valueDisplay.style.display = 'block';
      } else {
        if (state.twoModelMode) {
          valueDisplay.innerHTML = '<em>No model(s) selected for this provider</em>';
        } else {
          valueDisplay.innerHTML = '';
        }
        valueDisplay.style.display = 'none';
      }
    }
  }

  // Model Loading
  async function loadModels() {
    // Check cache first
    if (state.modelsCache[state.provider]) {
      state.models = state.modelsCache[state.provider];
      renderModelList();
      return;
    }
    
    // Check if custom provider without URL
    if (state.provider === 'custom') {
      const customUrl = document.getElementById('customUrl')?.value;
      if (!customUrl || !customUrl.trim()) {
        // Clear cached models for custom provider
        state.modelsCache[state.provider] = [];
        
        const container = document.getElementById('modelListContainer');
        if (container) {
          container.innerHTML = `
            <div class="empty-state">
              <p>Enter custom endpoint URL to load models, or enter model names manually:</p>
              <input type="text" id="manualModelInput" placeholder="e.g., gpt-4, claude-3-opus" style="width: 100%; margin-top: 8px; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border);" />
              <button id="addManualModelBtn" style="margin-top: 8px; padding: 6px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer;">Add Model</button>
            </div>
          `;
          
          // Add event listener for manual model entry
          const addBtn = container.querySelector('#addManualModelBtn');
          const input = container.querySelector('#manualModelInput');
          
          if (addBtn && input) {
            addBtn.addEventListener('click', () => {
              const modelNames = input.value.split(',').map(m => m.trim()).filter(m => m);
              if (modelNames.length > 0) {
                // Create model objects
                const newModels = modelNames.map(name => ({
                  id: name,
                  name: name,
                  provider: 'custom'
                }));
                
                // Add to state.models
                state.models = [...state.models, ...newModels];
                
                // Render the updated list
                renderModelList();
                
                // Clear input
                input.value = '';
              }
            });
            
            input.addEventListener('keypress', (e) => {
              if (e.key === 'Enter') {
                addBtn.click();
              }
            });
          }
        }
        return;
      }
    }
    
    // Show loading state
    const container = document.getElementById('modelListContainer');
    if (container) {
      container.innerHTML = '<div class="loading-container"><span class="loading-spinner"></span>Loading models...</div>';
    }

    try {
      // Comment 4: Generate sequence token for race protection
      state.requestTokenCounter++;
      const requestToken = `token-${state.requestTokenCounter}`;
      state.currentRequestToken = requestToken;
      
      // Comment 6: Include trace ID in logs (DEBUG mode only)
      const traceInfo = state.currentTraceId ? ` [Trace ${state.currentTraceId}]` : '';
      console.log(`[loadModels] Requesting models for provider: ${state.provider}, sequence token: ${requestToken}${traceInfo}`);
      
      // Request models from backend with token
      vscode.postMessage({ 
        type: 'requestModels', 
        provider: state.provider,
        token: requestToken // Include token for response matching
      });
    } catch (error) {
      console.error('Failed to load models:', error);
      if (container) {
        container.innerHTML = `
          <div class="empty-state">
            <p>Failed to load models</p>
            <p class="text-muted">${error.message}</p>
          </div>
        `;
      }
    }
  }

  // Phase 5: Use debounced render to prevent flicker during rapid typing
  function onModelSearch(e) {
    debouncedRenderModelList(e.target.value.toLowerCase());
  }

  function renderModelList(searchTerm = '') {
    const container = document.getElementById('modelListContainer');
    if (!container) return;

    if (state.models.length === 0) {
      container.innerHTML = '<div class="empty-state">No model(s) selected for this provider.</div>';
      // Comment 3: Clear last filtered IDs and selection tracking when no models
      state.lastFilteredIds = null;
      state.lastSelectedModels = { reasoning: '', coding: '', value: '' };
      return;
    }

    // Filter models
    let filtered = state.models;
    if (searchTerm) {
      filtered = state.models.filter(m => 
        m.name.toLowerCase().includes(searchTerm) ||
        m.id.toLowerCase().includes(searchTerm)
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = '<div class="empty-state">No models match your search</div>';
      // Comment 3: Update filtered IDs even for empty results
      state.lastFilteredIds = [];
      // Don't reset selection tracking on empty search - selections are still valid
      return;
    }

    // Comment 3: Performance optimization - compute filtered IDs and check if changed
    const filteredIds = filtered.map(m => m.id).sort();
    
    // Compare with previous filtered IDs to avoid unnecessary DOM work
    // IMPORTANT: Also check if twoModelMode or selected models changed - UI needs update even if IDs unchanged
    const twoModelModeChanged = state.lastTwoModelMode !== state.twoModelMode;
    const selectionsChanged = 
      state.lastSelectedModels.reasoning !== state.reasoningModel ||
      state.lastSelectedModels.coding !== state.codingModel ||
      state.lastSelectedModels.value !== state.valueModel;
    
    if (!twoModelModeChanged && !selectionsChanged && state.lastFilteredIds && 
        state.lastFilteredIds.length === filteredIds.length &&
        state.lastFilteredIds.every((id, index) => id === filteredIds[index])) {
      // Filtered results, twoModelMode, and selections unchanged - skip DOM update
      console.log('[Comment 3] Skipping render - filtered IDs, twoModelMode, and selections unchanged');
      return;
    }
    
    // Update tracked filtered IDs, twoModelMode, and selections
    state.lastFilteredIds = filteredIds;
    state.lastTwoModelMode = state.twoModelMode;
    state.lastSelectedModels = {
      reasoning: state.reasoningModel,
      coding: state.codingModel,
      value: state.valueModel
    };
    console.log(`[Comment 3] Rendering ${filtered.length} models (filtered from ${state.models.length})`);

    // Phase 5: Mark container for event delegation setup
    if (!container.dataset.delegationSetup) {
      // Phase 5: Event delegation - ONE listener for all model buttons
      container.addEventListener('click', (e) => {
        const btn = e.target.closest('.model-btn');
        if (btn) {
          const modelId = btn.dataset.model;
          const type = btn.dataset.type;
          if (modelId && type) {
            setModelFromList(modelId, type);
          }
        }
      });
      container.dataset.delegationSetup = 'true';
      console.log('[Phase 5] Event delegation setup for model buttons');
    }

    // Render model items
    console.log('[renderModelList] Rendering models - twoModelMode:', state.twoModelMode, 'filtered count:', filtered.length);
    console.log('[renderModelList] Current selections - reasoning:', state.reasoningModel, 'coding:', state.codingModel, 'value:', state.valueModel);
    container.innerHTML = filtered.map(model => {
      const isReasoning = model.id === state.reasoningModel;
      const isCoding = model.id === state.codingModel;
      const isValue = model.id === state.valueModel;
      const isFree = model.pricing?.prompt === '0' && model.pricing?.completion === '0';
      
      let itemClass = 'model-item';
      if (isReasoning) itemClass += ' selected-reasoning';
      if (isCoding) itemClass += ' selected-coding';
      if (isValue) itemClass += ' selected-value';

      return `
        <div class="${itemClass}">
          <div class="model-info">
            <div class="model-name">${escapeHtml(model.name)}</div>
            <div class="model-meta">
              ${model.context_length ? `${formatNumber(model.context_length)} tokens` : ''}
              ${isFree ? ' • Free' : ''}
            </div>
          </div>
          <div class="model-actions">
            <button class="model-btn ${isReasoning ? 'reasoning-selected' : ''}" 
                    data-model="${escapeHtml(model.id)}" 
                    data-type="reasoning">
              ${isReasoning ? '✓ Reasoning' : 'Reasoning'}
            </button>
            ${state.twoModelMode ? `
              <button class="model-btn ${isCoding ? 'coding-selected' : ''}" 
                      data-model="${escapeHtml(model.id)}" 
                      data-type="coding">
                ${isCoding ? '✓ Coding' : 'Coding'}
              </button>
              <button class="model-btn ${isValue ? 'value-selected' : ''}" 
                      data-model="${escapeHtml(model.id)}" 
                      data-type="value">
                ${isValue ? '✓ Value' : 'Value'}
              </button>
            ` : ''}
          </div>
        </div>
      `;
    }).join('');
    
    // Phase 5: No individual button listeners needed - using event delegation above
  }

  // Popular Combos - Now handles both featured and saved combos
  function handlePopularModels(payload) {
    const container = document.getElementById('combosGrid');
    if (!container) return;

    const featuredPairings = payload.pairings || [];
    const savedCombos = payload.savedCombos || [];
        
    if (featuredPairings.length === 0 && savedCombos.length === 0) {
      container.innerHTML = '<div class="empty-state">No combos available</div>';
      return;
    }
    
    // Combine featured and saved combos
    const allCombos = [
      ...featuredPairings.map(combo => ({ ...combo, isSaved: false })),
      ...savedCombos.map((combo, index) => ({ ...combo, isSaved: true, savedIndex: index }))
    ];
    
    container.innerHTML = allCombos.map(combo => {
      const baseClass = combo.isSaved ? 'combo-btn user-saved' : 'combo-btn';
      const deleteBtn = combo.isSaved ? `<span class="combo-delete-btn" role="button" tabindex="0" data-index="${combo.savedIndex}">×</span>` : '';
      
      // Create tooltip with all three models
      const tooltip = combo.value 
        ? `Reasoning: ${combo.reasoning}\nCoding: ${combo.completion}\nValue: ${combo.value}`
        : `Reasoning: ${combo.reasoning}\nCoding: ${combo.completion}`;
      
      return `
        <button class="${baseClass}" 
                data-reasoning="${escapeHtml(combo.reasoning)}" 
                data-completion="${escapeHtml(combo.completion)}"
                data-value="${escapeHtml(combo.value || '')}"
                title="${escapeHtml(tooltip)}">
          ${deleteBtn}${escapeHtml(combo.name)}
        </button>
      `;
    }).join('');

    // Add click handlers for combo buttons
    container.querySelectorAll('.combo-btn:not(.user-saved)').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const reasoning = e.currentTarget.dataset.reasoning;
        const completion = e.currentTarget.dataset.completion;
        const value = e.currentTarget.dataset.value || completion;
        applyCombo(reasoning, completion, value);
      });
    });
    
    // Add click handlers for user-saved combo buttons (excluding delete button clicks)
    container.querySelectorAll('.combo-btn.user-saved').forEach(btn => {
      btn.addEventListener('click', (e) => {
        // Ignore clicks on delete button
        if (e.target.classList.contains('combo-delete-btn')) {
          return;
        }
        
        const reasoning = e.currentTarget.dataset.reasoning;
        const completion = e.currentTarget.dataset.completion;
        const value = e.currentTarget.dataset.value || completion;
        applyCombo(reasoning, completion, value);
      });
    });
    
    // Add click handlers for delete buttons (now spans with role="button")
    container.querySelectorAll('.combo-delete-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const index = parseInt(e.currentTarget.dataset.index);
        if (!isNaN(index)) {
          vscode.postMessage({
            type: 'deleteCombo',
            index: index
          });
        }
      });
      
      // Add keyboard support for accessibility
      btn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          const index = parseInt(e.currentTarget.dataset.index);
          if (!isNaN(index)) {
            vscode.postMessage({
              type: 'deleteCombo',
              index: index
            });
          }
        }
      });
    });
  }

  function applyCombo(reasoning, coding, value) {
    // Enable two-model mode
    state.twoModelMode = true;
    document.getElementById('twoModelToggle').checked = true;
    updateTwoModelUI();

    // Set models
    state.reasoningModel = reasoning;
    state.codingModel = coding;
    state.valueModel = value;

    // Comment 3: Normalize before saving to provider-specific storage
    if (!state.modelsByProvider[state.provider]) {
      state.modelsByProvider[state.provider] = { reasoning: '', completion: '', value: '' };
    }
    const normalized = normalizeProviderMap({ reasoning, completion: coding, value }, state.provider);
    state.modelsByProvider[state.provider] = normalized;

    // Save
    saveState();
    renderModelList();

    // Notify backend that two-model mode is enabled
    vscode.postMessage({ type: 'toggleTwoModelMode', enabled: true });

    // Comment 5: Send 'completion' instead of 'coding' (canonical storage)
    vscode.postMessage({
      type: 'saveModels',
      providerId: state.provider,
      reasoning: reasoning,
      completion: coding,
      value: value
    });
  }

  function onPortChange(e) {
    const port = e.target.value;
    vscode.postMessage({ type: 'updatePort', port: parseInt(port, 10) });
  }

  /**
   * Request the extension host to start the local proxy using the current UI configuration.
   *
   * Sends a message to start the proxy with the current provider, selected primary/secondary models,
   * two-model mode flag, and configured port.
   */
  function startProxy() {
    // Validate that required models are selected for the current provider
    if (!state.reasoningModel || state.reasoningModel.trim() === '') {
      const errorMsg = `No models selected for ${state.provider}. Please select models from the list or enter them manually before starting the proxy.`;
      showNotification(errorMsg, 'error', 5000); // Longer duration for prominence
      return;
    }
    
    if (state.twoModelMode && (!state.codingModel || state.codingModel.trim() === '')) {
      const errorMsg = `No coding model selected for ${state.provider} in two-model mode. Please select a model before starting the proxy.`;
      showNotification(errorMsg, 'error', 5000);
      return;
    }
    
    if (state.twoModelMode && (!state.valueModel || state.valueModel.trim() === '')) {
      const errorMsg = `No value model selected for ${state.provider} in two-model mode. Please select a model before starting the proxy.`;
      showNotification(errorMsg, 'error', 5000);
      return;
    }
    
    // Log diagnostic info before starting proxy
    console.log('[startProxy] Starting proxy with config:', {
      twoModelMode: state.twoModelMode,
      reasoningModel: state.reasoningModel,
      codingModel: state.codingModel,
      valueModel: state.valueModel,
      provider: state.provider,
      port: state.port
    });
    vscode.postMessage({ type: 'startProxy' });
  }

  /**
   * Stops the running proxy.
   *
   * Sends a message to the extension host to stop the proxy server.
   */
  function stopProxy() {
    vscode.postMessage({ type: 'stopProxy' });
  }

  /**
   * Update internal proxy state and reflect the current proxy status in the UI.
   *
   * Sets state.proxyRunning and state.port from the provided payload,
   * then updates the status text and the visibility/labels of the start/stop buttons accordingly.
   *
   * @param {Object} status - Status payload from the backend.
   * @param {boolean} [status.running] - `true` if the proxy is currently running.
   * @param {number} [status.port] - Port number the proxy is using.
   */
  function updateStatus(status) {
    state.proxyRunning = status.running || false;
    state.port = status.port || 3000;

    const statusText = document.getElementById('statusText');
    const startBtn = document.getElementById('startProxyBtn');
    const stopBtn = document.getElementById('stopProxyBtn');

    if (statusText) {
      if (status.running) {
        statusText.textContent = `Running on port ${status.port}`;
        statusText.className = 'status-running';
      } else {
        statusText.textContent = 'Idle';
        statusText.className = 'status-stopped';
      }
    }

    if (startBtn && stopBtn) {
      if (status.running) {
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        stopBtn.textContent = 'Stop Proxy';
      } else {
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
      }
    }
  }

  function updateCacheDisplay(config) {
    // Get the static cache container in Advanced Settings
    const cacheContainer = document.getElementById('anthropicCacheContainer');
    
    if (!cacheContainer) {
      console.warn('Anthropic cache container not found');
      return;
    }
    
    // Update content based on cache information
    if (config.cacheAgeDays !== undefined) {
      const cacheAgeText = config.cacheAgeDays === 0 
        ? 'today' 
        : config.cacheAgeDays === 1 
          ? 'yesterday' 
          : `${config.cacheAgeDays} days ago`;
      
      const staleWarning = config.cacheStale 
        ? '<span style="color: var(--vscode-warningForeground); margin-left: 4px;">⚠️ Cache is stale</span>' 
        : '';
      
      // Show container when we have cache data
      cacheContainer.style.display = 'block';
      
      let cacheContent = `
        <fieldset style="border: 1px solid var(--vscode-input-border); padding: 8px; border-radius: 4px;">
          <legend style="font-size: 11px; font-weight: bold;">Anthropic Defaults</legend>
          <div style="display: flex; justify-content: space-between; align-items: center; font-size: 11px;">
            <div>Last refreshed ${cacheAgeText} ${staleWarning}</div>
            <button id="refreshCacheBtn" class="btn-primary" style="font-size: 11px; padding: 2px 8px;">Refresh Now</button>
          </div>
      `;
      
      // Show cached model IDs if available
      if (config.cachedDefaults) {
        const defaults = config.cachedDefaults;
        
        // Safely extract model names with null checks
        const getShortModelId = (value) => {
          if (!value || typeof value !== 'string') return 'Unknown';
          return value.split('-').slice(-2).join('-').slice(0, 8);
        };
        
        const opusId = getShortModelId(defaults.opus);
        const sonnetId = getShortModelId(defaults.sonnet);
        const haikuId = getShortModelId(defaults.haiku);
        
        cacheContent += `
          <div style="margin-top: 4px; font-size: 10px; opacity: 0.8;">
            Cached: Opus: ${opusId} • Sonnet: ${sonnetId} • Haiku: ${haikuId}
          </div>
        `;
      }
      
      cacheContent += '</fieldset>';
      cacheContainer.innerHTML = cacheContent;
      
      // Add click handler for refresh button
      const refreshBtn = document.getElementById('refreshCacheBtn');
      if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
          refreshBtn.textContent = 'Refreshing...';
          refreshBtn.disabled = true;
          
          vscode.postMessage({ type: 'refreshAnthropicDefaults' });
          
          // Listen for config response to restore button state
          const configListener = (event) => {
            if (event.data && event.data.type === 'config') {
              refreshBtn.textContent = 'Refresh Cache';
              refreshBtn.disabled = false;
              window.removeEventListener('message', configListener);
            }
          };
          window.addEventListener('message', configListener);
        });
      }
    } else {
      // Hide container when no cache data is available
      cacheContainer.style.display = 'none';
    }
  }

  function handleConfigLoaded(config) {
    console.log('[handleConfigLoaded] Received config:', config);
    
    // Comment 19: Load feature flags from config
    if (config.featureFlags) {
      state.featureFlags = {
        ...state.featureFlags,
        ...config.featureFlags
      };
      console.log('[handleConfigLoaded] Feature flags loaded:', state.featureFlags);
    }
    
    // Comment 2: Calculate effective provider FIRST before comparison
    // This is critical for custom providers where config.provider='custom' but state.provider='custom-provider-id'
    let effectiveProvider = 'openrouter'; // default fallback
    if (config.provider) {
      // Compute effective provider: if provider is 'custom' and we have selectedCustomProviderId, use that
      if (config.provider === 'custom' && config.selectedCustomProviderId) {
        effectiveProvider = config.selectedCustomProviderId;
      } else {
        effectiveProvider = config.provider;
      }
      console.log(`[handleConfigLoaded] Effective provider resolution: config.provider=${config.provider}, selectedCustomProviderId=${config.selectedCustomProviderId} => effectiveProvider=${effectiveProvider}`);
    }
    
    // Comment 5: Compare using effective provider to decide if we should clear cache
    if (effectiveProvider !== state.provider) {
      console.log('[handleConfigLoaded] Provider changed from', state.provider, 'to', effectiveProvider, '- clearing cache');
      // Comment 5: Clear only the old provider's cache, preserve others
      const oldProvider = state.provider;
      delete state.modelsCache[oldProvider];
      console.log(`[handleConfigLoaded] Cleared cache for provider: ${oldProvider}`);
      state.models = [];
      // Comment 3: Reset filtered IDs when clearing models
      state.lastFilteredIds = null;
      // Comment 5: Reset sequence token counter on provider change
      state.requestTokenCounter = 0;
      state.currentRequestToken = null;
      // Comment 6: Generate trace ID for provider flow (DEBUG mode only)
      const debugCheckbox = document.getElementById('debugCheckbox');
      const debug = debugCheckbox && debugCheckbox.checked;
      if (debug) {
        state.currentTraceId = `trace-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`;
        console.log(`[Trace ${state.currentTraceId}] Provider changed via config: ${oldProvider} → ${effectiveProvider}`);
      } else {
        state.currentTraceId = null;
      }
    } else {
      console.log('[handleConfigLoaded] Provider unchanged - preserving cache');
    }
    
    // Set state.provider before reading or writing modelsByProvider
    state.provider = effectiveProvider;
    console.log(`[handleConfigLoaded] Set state.provider to effectiveProvider: ${state.provider}`);
    
    // Handle cache age display
    updateCacheDisplay(config);
    
    // Note: provider dropdown value will be set after custom providers are loaded
    updateProviderUI();

    if (config.port) {
        state.port = config.port;
        document.getElementById('portInput').value = config.port;
    }

    // Set customBaseUrl input value if present
    if (config.customBaseUrl) {
      const customUrlInput = document.getElementById('customUrl');
      if (customUrlInput) {
        customUrlInput.value = config.customBaseUrl;
      }
    }

    // Read modelSelectionsByProvider from the payload
    if (config.modelSelectionsByProvider) {
      state.modelsByProvider = config.modelSelectionsByProvider;
      // Ensure built-in providers have entries (normalized to canonical keys)
      ['openrouter', 'openai', 'together', 'deepseek', 'glm', 'custom'].forEach(provider => {
        if (!state.modelsByProvider[provider]) {
          state.modelsByProvider[provider] = { reasoning: '', completion: '', value: '' };
        } else {
          // Comment 3: Normalize existing entries to ensure canonical keys
          state.modelsByProvider[provider] = normalizeProviderMap(state.modelsByProvider[provider], provider);
        }
      });
    }
    
    // Comment 6: Log incoming config for save round-trip verification
    console.log(`[handleConfigLoaded] Config round-trip - state.provider: ${state.provider}, incoming config.modelSelectionsByProvider[${state.provider}]:`, JSON.stringify(config.modelSelectionsByProvider?.[state.provider] || null));
    
    // Only seed modelsByProvider for the current provider if no entry exists
    if (!state.modelsByProvider[state.provider]) {
      state.modelsByProvider[state.provider] = { reasoning: '', completion: '', value: '' };
    } else {
      // Comment 3: Normalize existing entry to ensure canonical keys
      state.modelsByProvider[state.provider] = normalizeProviderMap(state.modelsByProvider[state.provider], state.provider);
    }
    
    // Set models from provider-specific storage, with validation
    if (state.modelsByProvider[state.provider]) {
      // Comment 3: Normalize provider map before reading
      const normalized = normalizeProviderMap(state.modelsByProvider[state.provider], state.provider);
      state.reasoningModel = normalized.reasoning;
      state.codingModel = normalized.completion;
      state.valueModel = normalized.value;
      
      // Validation: check if all models are empty for this provider
      if (!state.reasoningModel && !state.codingModel && !state.valueModel) {
        console.log(`[handleConfigLoaded] No models found for provider ${state.provider} in modelSelectionsByProvider`);
        console.log(`[handleConfigLoaded] Provider entry exists but models are empty - may indicate a save failure`);
      }
    } else {
      state.reasoningModel = '';
      state.codingModel = '';
      state.valueModel = '';
      console.log(`[handleConfigLoaded] No provider entry found for ${state.provider} in modelSelectionsByProvider`);
    }
    
    // Comment 1: Add fallback to legacy keys when provider entries are empty
    if (!state.reasoningModel || !state.codingModel || !state.valueModel) {
      console.log(`[handleConfigLoaded] Applying fallback to legacy keys - missing: reasoning=${!state.reasoningModel}, coding=${!state.codingModel}, value=${!state.valueModel}`);
      if (!state.reasoningModel && config.reasoningModel) {
        state.reasoningModel = config.reasoningModel;
        console.log(`[handleConfigLoaded] Fallback: set reasoningModel from legacy key: ${state.reasoningModel}`);
      }
      if (!state.codingModel && config.completionModel) {
        state.codingModel = config.completionModel;
        console.log(`[handleConfigLoaded] Fallback: set codingModel from legacy key: ${state.codingModel}`);
      }
      if (!state.valueModel && config.valueModel) {
        state.valueModel = config.valueModel;
        console.log(`[handleConfigLoaded] Fallback: set valueModel from legacy key: ${state.valueModel}`);
      }
      // Update display after applying fallback values
      updateSelectedModelsDisplay();
    }
    
    // Auto-hydrate provider map after fallback (preferred, webview)
    // Only auto-hydrate once per provider to prevent loops
    // Comment 4: Gate pre-apply hydration with feature flag
    if (state.featureFlags.enablePreApplyHydration &&
        !config.modelSelectionsByProvider?.[state.provider]?.reasoning && 
        (state.reasoningModel || state.codingModel || state.valueModel) &&
        !state.autoHydratedProviders.has(state.provider)) {
      state.autoHydratedProviders.add(state.provider);
      console.log(`[handleConfigLoaded] Auto-hydrating provider map for ${state.provider} (first time only)`);
      // Comment 5: Send 'completion' instead of 'coding' (canonical storage)
      vscode.postMessage({
        type: 'saveModels',
        providerId: state.provider,
        reasoning: state.reasoningModel || '',
        completion: state.codingModel || '',
        value: state.valueModel || ''
      });
      console.log('[handleConfigLoaded] Hydrated provider map from legacy keys via saveModels');
    } else if (state.featureFlags.enablePreApplyHydration && state.autoHydratedProviders.has(state.provider)) {
      console.log(`[handleConfigLoaded] Skipping auto-hydration - provider ${state.provider} already hydrated`);
    }
    
    // Comment 6: Log final state after fallback for save round-trip verification
    console.log(`[handleConfigLoaded] Final state after fallback - state.provider: ${state.provider}, final models: { reasoning: ${state.reasoningModel}, coding: ${state.codingModel}, value: ${state.valueModel} }`);

    // Debug: log the full modelSelectionsByProvider for inspection
    console.log(`[handleConfigLoaded] Full modelsByProvider object:`, JSON.stringify(state.modelsByProvider));
    console.log(`[handleConfigLoaded] Current provider: ${state.provider}`);
    console.log(`[handleConfigLoaded] Model selections: reasoning=${state.reasoningModel}, coding=${state.codingModel}, value=${state.valueModel}`);
    
    console.log('[handleConfigLoaded] Updated model state from provider-specific storage:', {
      provider: state.provider,
      reasoningModel: state.reasoningModel,
      codingModel: state.codingModel,
      valueModel: state.valueModel,
      fromConfig: true
    });

    // Check if two-model mode should be enabled
    // Only trigger UI update if mode actually changed to prevent redundant renders
    const previousTwoModelMode = state.twoModelMode;
    if (config.twoModelMode !== undefined) {
      state.twoModelMode = config.twoModelMode;
      document.getElementById('twoModelToggle').checked = config.twoModelMode;
      if (state.twoModelMode !== previousTwoModelMode) {
        console.log(`[handleConfigLoaded] Two-model mode changed from ${previousTwoModelMode} to ${state.twoModelMode}`);
        updateTwoModelUI();
      }
    } else if (config.reasoningModel && config.completionModel && 
        config.reasoningModel !== config.completionModel) {
      state.twoModelMode = true;
      document.getElementById('twoModelToggle').checked = true;
      if (state.twoModelMode !== previousTwoModelMode) {
        console.log(`[handleConfigLoaded] Two-model mode auto-enabled (was ${previousTwoModelMode})`);
        updateTwoModelUI();
      }
    }

    // Set debug checkbox state
    if (config.debug !== undefined) {
      document.getElementById('debugCheckbox').checked = config.debug;
    }

    // Update selected models display
    updateSelectedModelsDisplay();

    // Comment 5: Guard against config-induced reset loops by deferring model reload until after state merge
    // Only call loadModels() if state.models.length === 0 or if state.provider changed
    // Also skip if we're in the middle of a save operation to prevent flashing
    const previousProvider = state.previousProvider || '';
    const providerChanged = state.provider !== previousProvider;
    const noModelsLoaded = state.models.length === 0;
    
    console.log(`[handleConfigLoaded] Model reload guard - providerChanged: ${providerChanged}, noModelsLoaded: ${noModelsLoaded}, inSaveOperation: ${state.inSaveOperation}, previousProvider: ${previousProvider}, currentProvider: ${state.provider}`);
    
    if (state.inSaveOperation) {
      console.log(`[handleConfigLoaded] Skipping model reload - currently in save operation`);
    } else if (providerChanged || noModelsLoaded) {
      // Defer loadModels() with short timeout to reduce races where immediate re-render overrides selected model highlights
      setTimeout(() => {
        console.log(`[handleConfigLoaded] Triggering model reload (providerChanged=${providerChanged}, noModelsLoaded=${noModelsLoaded})`);
        loadModels();
      }, 150); // 150ms delay to allow state merge to complete
    } else {
      console.log(`[handleConfigLoaded] Skipping model reload - provider unchanged and models already loaded`);
    }
    
    // Store current provider for next comparison
    state.previousProvider = state.provider;
  }

  function handleModelsLoaded(payload) {
    if (!payload || !Array.isArray(payload.models)) {
      console.log('[handleModelsLoaded] Invalid payload received');
      return;
    }
    
    if (payload.models.length === 0) {
      console.log('[handleModelsLoaded] Empty models array received');
      return;
    }
    
    // Comment 4: Validate provider and sequence token to prevent race conditions
    // Use the provider from the payload, not the current state
    const provider = payload.provider || state.provider;
    const responseToken = payload.token;
    
    // Comment 6: Include trace ID in logs (DEBUG mode only)
    const traceInfo = payload.traceId ? ` [Trace ${payload.traceId}]` : (state.currentTraceId ? ` [Trace ${state.currentTraceId}]` : '');
    console.log(`[handleModelsLoaded] Received ${payload.models.length} models for provider: ${provider}, token: ${responseToken}, currentRequestToken: ${state.currentRequestToken}${traceInfo}`);
    
    // Comment 4: Sequence token validation - gate UI application on matching tokens
    // Compare sequence numbers if tokens are in seq-N format, otherwise compare strings
    if (state.featureFlags.enableTokenValidation && responseToken && state.currentRequestToken) {
      let isValid = false
      
      // Try to parse sequence numbers for better comparison
      const responseSeqMatch = responseToken.match(/^(?:seq-|token-)(\d+)$/)
      const currentSeqMatch = state.currentRequestToken.match(/^(?:seq-|token-)(\d+)$/)
      
      if (responseSeqMatch && currentSeqMatch) {
        const responseSeq = parseInt(responseSeqMatch[1], 10)
        const currentSeq = parseInt(currentSeqMatch[1], 10)
        isValid = responseSeq >= currentSeq // Accept equal or newer tokens
      } else {
        // Fallback to string comparison
        isValid = responseToken === state.currentRequestToken
      }
      
      if (!isValid) {
        console.log(`[handleModelsLoaded] IGNORING late response - sequence token mismatch (expected: ${state.currentRequestToken}, got: ${responseToken})`);
        return;
      }
    }
    
    // Comment 5: Cache under the provider the backend says these belong to (isolated per-provider cache)
    state.modelsCache[provider] = payload.models;
    console.log(`[handleModelsLoaded] Cached ${payload.models.length} models for provider: ${provider}`);
    
    // Comment 5: Provider validation - only render if this response is for the currently selected provider
    if (provider !== state.provider) {
      console.log(`[handleModelsLoaded] IGNORING cross-provider response - stashed ${payload.models.length} models for ${provider}, current provider is ${state.provider}`);
      return;
    }
    
    console.log(`[handleModelsLoaded] ✓ Validation passed - rendering ${payload.models.length} models for current provider: ${provider}`);
    state.models = payload.models;
    renderModelList();
    
    // Update save combo button visibility after models are loaded
    updateSaveComboButton();
  }

  function handleModelsError(payload) {
    // Comment 1: Ensure payload is structured (should always be object now)
    const structuredPayload = typeof payload === 'string' 
      ? { provider: state.provider, error: payload, errorType: 'generic' }
      : payload;
    
    // Comment 2: Add error to telemetry buffer first
    addErrorToBuffer({
      type: 'modelsError',
      provider: structuredPayload.provider || 'unknown',
      error: structuredPayload.error || 'Unknown error',
      errorType: structuredPayload.errorType || 'unknown',
      token: structuredPayload.token || null,
      traceId: structuredPayload.traceId || null
    });
    
    // Comment 11: Only render errors for the currently selected provider
    const errorProvider = structuredPayload.provider || state.provider;
    if (errorProvider !== state.provider) {
      console.log(`[handleModelsError] Ignoring error for ${errorProvider}, current provider is ${state.provider}`);
      return;
    }
    
    console.log(`[handleModelsError] Rendering error for provider: ${errorProvider}`);
    
    const container = document.getElementById('modelListContainer');
    if (!container) return;
    
    // Get provider-specific placeholder examples
    const providerExamples = {
      'openrouter': 'anthropic/claude-3-opus, openai/gpt-4-turbo, meta-llama/llama-3.1-70b-instruct',
      'openai': 'gpt-4, gpt-4-turbo, gpt-3.5-turbo',
      'together': 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo, mistralai/Mixtral-8x7B-Instruct-v0.1, Qwen/Qwen2.5-72B-Instruct-Turbo',
      'deepseek': 'deepseek-chat, deepseek-coder',
      'glm': 'glm-4-plus, glm-4',
      'custom': 'gpt-4, claude-3-opus, llama-3'
    };
    
    // Comment 11: Show dedicated hint using errorProvider, not state.provider
    let dedicatedHint = '';
    if (errorProvider === 'together' && structuredPayload.error && (structuredPayload.error.includes('401') || structuredPayload.error.includes('403'))) {
      dedicatedHint = `
        <div class="manual-entry-hint" style="background: var(--vscode-inputValidation-warningBackground); padding: 8px; border-radius: 4px; margin-bottom: 12px;">
          <p class="manual-entry-hint-title">🔑 Together AI Authentication Issue</p>
          <p>• Verify your API key at <a href="https://api.together.xyz/settings/api-keys" target="_blank">api.together.xyz/settings/api-keys</a></p>
          <p>• Ensure the key is active and has credits available</p>
          <p>• Some keys may be restricted to specific models - check your account settings</p>
        </div>
      `;
    }
    
    // Comment 11: Use errorProvider for all UI hint selections
    const example = providerExamples[errorProvider] || 'gpt-4, claude-3-opus';
    
    // Show error with manual entry option for all providers
    container.innerHTML = `
      <div class="empty-state">
        <p class="empty-state-error">${escapeHtml(structuredPayload.error)}</p>
        ${dedicatedHint}
        
        <div class="manual-entry-section">
          <h4 class="manual-entry-header">Manual Model Entry</h4>
          <p class="manual-entry-description">Enter model IDs for ${providers[state.provider]?.name || state.provider} (comma-separated):</p>
          
          <input 
            type="text" 
            id="manualModelInput" 
            class="manual-entry-input"
            placeholder="e.g., ${example}" 
          />
          
          <div class="manual-entry-actions">
            <button id="addManualModelBtn" class="manual-entry-btn manual-entry-btn-primary">Add Models</button>
            <button id="retryModelsBtn" class="manual-entry-btn manual-entry-btn-secondary">Retry Loading</button>
          </div>
          
          <div class="manual-entry-hint">
            <p class="manual-entry-hint-title">💡 Common models for ${providers[state.provider]?.name || state.provider}:</p>
            <div class="manual-entry-example">${example}</div>
          </div>
        </div>
      </div>
    `;
    
    // Add event listeners for manual entry
    const addBtn = container.querySelector('#addManualModelBtn');
    const retryBtn = container.querySelector('#retryModelsBtn');
    const input = container.querySelector('#manualModelInput');
    
    if (addBtn && input) {
      const addModels = () => {
        const modelNames = input.value.split(',').map(m => m.trim()).filter(m => m);
        if (modelNames.length > 0) {
          // Validate model IDs (basic validation)
          const validModels = modelNames.filter(name => name.length > 0 && !name.includes(' '));
          const invalidModels = modelNames.filter(name => (name.length === 0) || name.includes(' '));
          
          if (invalidModels.length > 0) {
            showNotification(`Invalid model names: ${invalidModels.join(', ')}`, 'error');
            return;
          }
          
          const newModels = validModels.map(name => ({
            id: name,
            name: name,
            provider: state.provider
          }));
          
          state.models = [...state.models, ...newModels];
          state.modelsCache[state.provider] = state.models;
          renderModelList();
          input.value = '';
          showNotification(`Added ${validModels.length} models successfully`, 'success');
        }
      };
      
      addBtn.addEventListener('click', addModels);
      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') addModels();
      });
      
      // Focus input for better UX
      setTimeout(() => input.focus(), 100);
    }
    
    // Add retry functionality
    if (retryBtn) {
      retryBtn.addEventListener('click', () => {
        loadModels();
      });
    }
  }

  // Utilities
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function formatNumber(num) {
    return new Intl.NumberFormat().format(num);
  }

  function showError(message) {
    // Comment 1: Handle structured error payload
    const structuredPayload = typeof message === 'string' 
      ? { provider: state.provider, error: message, errorType: 'generic' }
      : message;
    
    console.error('Error:', structuredPayload.error);
    
    // Comment 2: Add to error buffer for telemetry
    addErrorToBuffer({
      type: 'proxyError',
      provider: structuredPayload.provider || state.provider,
      error: structuredPayload.error || 'Unknown error',
      errorType: structuredPayload.errorType || 'generic',
      traceId: structuredPayload.traceId || null
    });
    
    // Could add a toast notification here with structuredPayload.error
  }
})();