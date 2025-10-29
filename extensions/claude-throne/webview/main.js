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
    // Provider-specific model storage
    // Comment 3: Normalize terminology - use 'completion' key internally for provider-scoped coding model values
    modelsByProvider: {
      openrouter: { reasoning: '', completion: '', coding: '', value: '' },
      openai: { reasoning: '', completion: '', coding: '', value: '' },
      together: { reasoning: '', completion: '', coding: '', value: '' },
      deepseek: { reasoning: '', completion: '', coding: '', value: '' },
      glm: { reasoning: '', completion: '', coding: '', value: '' },
      custom: { reasoning: '', completion: '', coding: '', value: '' }
    },
    proxyRunning: false,
    port: 3000,
    customCombos: [],
    workspaceCombos: [],
    inSaveOperation: false, // Track when we're in the middle of a save to prevent unnecessary reloads
    autoHydratedProviders: new Set(), // Track which providers have been auto-hydrated to prevent loops
    // Phase 2: Request token for race protection
    requestTokenCounter: 0, // Incrementing counter for sequence tokens
    currentRequestToken: null // Token of the most recent model loading request
  };

  // Phase 3: Helper function to get coding model with deprecation warning
  function getCodingModelFromProvider(providerModels, providerName) {
    const completion = providerModels.completion;
    const coding = providerModels.coding;
    
    // Phase 3: Emit deprecation warning if using legacy 'coding' key
    if (!completion && coding) {
      console.warn(`[DEPRECATION] Provider '${providerName}' uses legacy 'coding' key. This key is deprecated and will be removed in a future version. Use 'completion' instead.`);
      console.warn(`[DEPRECATION] Migration: The next save operation will automatically migrate to 'completion' key.`);
    }
    
    // Return completion first, fallback to coding
    return completion || coding || '';
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
    const message = event.data;
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
      case 'proxyError':
        showError(message.payload);
        break;
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
      case 'modelsSaved':
        handleModelsSaved(message.payload);
        break;
      default:
        console.log('[handleMessage] Unknown message type:', message.type);
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
    
    // Clear the save operation flag regardless of success/failure
    state.inSaveOperation = false;
    console.log('[handleModelsSaved] Cleared inSaveOperation flag');
    
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
    // Save current models for the old provider
    if (state.provider && state.modelsByProvider[state.provider]) {
      state.modelsByProvider[state.provider].reasoning = state.reasoningModel;
      // Comment 1: Standardize on 'completion' key for provider-scoped coding model values
      state.modelsByProvider[state.provider].completion = state.codingModel;
      // Also set .coding for backward compatibility
      state.modelsByProvider[state.provider].coding = state.codingModel;
      state.modelsByProvider[state.provider].value = state.valueModel;
    }
    
    // Capture old provider and delete its cache before changing
    const oldProvider = state.provider;
    delete state.modelsCache[oldProvider];
    
    const newProvider = e.target.value;
    state.provider = newProvider;
    state.models = [];
    
    // Reset models and clear the visual list before loading
    renderModelList();
    
    // Initialize models storage for custom provider if needed
    if (!state.modelsByProvider[newProvider]) {
      // Comment 3: Normalize terminology - use 'completion' key internally for provider-scoped coding model values
      state.modelsByProvider[newProvider] = { reasoning: '', completion: '', coding: '', value: '' };
    }
    
    // Restore models for the new provider
    if (state.modelsByProvider[newProvider]) {
      state.reasoningModel = state.modelsByProvider[newProvider].reasoning || '';
      // Phase 3: Use helper function with deprecation warning
      state.codingModel = getCodingModelFromProvider(state.modelsByProvider[newProvider], newProvider);
      state.valueModel = state.modelsByProvider[newProvider].value || '';
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
      
      // If it's a saved custom provider, populate its URL
      if (isCustomProvider) {
        const customProvider = state.customProviders.find(p => p.id === state.provider);
        if (customProvider && document.getElementById('customUrl')) {
          document.getElementById('customUrl').value = customProvider.baseUrl;
        }
      }
    } else {
      customSection?.classList.remove('visible');
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
      // For one-off custom provider
      helpDiv.innerHTML = 'Custom = one‑off URL below. Saved Custom Providers appear in this list when created.';
    } else if (isCustomProvider && helpDiv) {
      // For saved custom providers
      helpDiv.innerHTML = 'This is a saved custom provider. URL and key are stored for reuse.';
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
    
    vscode.postMessage({
      type: 'saveCustomProvider',
      name: name.trim(),
      baseUrl: url.trim(),
      id
    });
    
    // Store intended provider ID for auto-selection after save
    const intendedProviderId = id;
    
    vscode.postMessage({
      type: 'saveCustomProvider',
      name: name.trim(),
      baseUrl: url.trim(),
      id
    });
    
    // Clear form fields after submission
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
    
    if (payload.providers) {
      state.customProviders = payload.providers;
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
    state.twoModelMode = e.target.checked;
    updateTwoModelUI();
    saveState();
    
    // Notify backend to update twoModelMode config
    console.log('[onTwoModelToggle] Sending toggleTwoModelMode message:', state.twoModelMode);
    vscode.postMessage({ type: 'toggleTwoModelMode', enabled: state.twoModelMode });
  }

  function updateTwoModelUI() {
    const modelList = document.getElementById('modelListContainer');
    const saveComboBtn = document.getElementById('saveComboBtn');

    // Show/hide save combo button
    updateSaveComboButton();

    // Re-render model list to show/hide secondary buttons
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
      // Comment 3: Normalize terminology - use 'completion' key internally for provider-scoped coding model values
      state.modelsByProvider[state.provider] = { reasoning: '', completion: '', coding: '', value: '' };
      console.log(`[setModelFromList] Initialized modelsByProvider entry for provider: ${state.provider}`);
    }
    
    if (type === 'reasoning') {
      state.reasoningModel = modelId;
      // Save to provider-specific storage
      state.modelsByProvider[state.provider].reasoning = modelId;
    } else if (type === 'coding') {
      state.codingModel = modelId;
      // Comment 1: Standardize on 'completion' key for provider-scoped coding model values
      state.modelsByProvider[state.provider].completion = modelId;
      // Also set .coding for backward compatibility
      state.modelsByProvider[state.provider].coding = modelId;
    } else if (type === 'value') {
      state.valueModel = modelId;
      // Save to provider-specific storage
      state.modelsByProvider[state.provider].value = modelId;
    }
    
    // Comment 6: Add targeted logs around save round-trip to verify persistence and provider alignment
    console.log(`[setModelFromList] Save round-trip - state.provider: ${state.provider}, models: { reasoning: ${state.reasoningModel}, coding: ${state.codingModel}, value: ${state.valueModel} }`);
    
    // Set flag to prevent unnecessary model reloads during save round-trip
    state.inSaveOperation = true;
    console.log('[setModelFromList] Setting inSaveOperation=true to prevent reload during save');
    
    // Comment 4: Include providerId in saveModels message to avoid ambiguity and races
    vscode.postMessage({
      type: 'saveModels',
      providerId: state.provider,
      reasoning: state.reasoningModel,
      coding: state.codingModel,
      value: state.valueModel
    });
    
    updateSaveComboButton();
    updateSelectedModelsDisplay();
    saveState();
    // Remove immediate renderModelList() - let handleModelsSaved trigger re-render after confirmation
    // renderModelList(); // REMOVED: Prevents race condition with extension state
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
      // Phase 2: Generate sequence token for race protection
      state.requestTokenCounter++;
      const requestToken = `token-${state.requestTokenCounter}`;
      state.currentRequestToken = requestToken;
      
      console.log(`[loadModels] Requesting models for provider: ${state.provider}, token: ${requestToken}`);
      
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

  function onModelSearch(e) {
    renderModelList(e.target.value.toLowerCase());
  }

  function renderModelList(searchTerm = '') {
    const container = document.getElementById('modelListContainer');
    if (!container) return;

    if (state.models.length === 0) {
      container.innerHTML = '<div class="empty-state">No model(s) selected for this provider.</div>';
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
      return;
    }

    // Render model items
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

    // Add click handlers to buttons
    container.querySelectorAll('.model-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const modelId = e.currentTarget.dataset.model;
        const type = e.currentTarget.dataset.type;
        setModelFromList(modelId, type);
      });
    });
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

    // Comment 1: Standardize on 'completion' key for provider-scoped coding model values
    // Save to provider-specific storage
    if (!state.modelsByProvider[state.provider]) {
      // Comment 3: Normalize terminology - use 'completion' key internally for provider-scoped coding model values
      state.modelsByProvider[state.provider] = { reasoning: '', completion: '', coding: '', value: '' };
    }
    state.modelsByProvider[state.provider].reasoning = reasoning;
    state.modelsByProvider[state.provider].completion = coding;
    state.modelsByProvider[state.provider].coding = coding; // backward compatibility
    state.modelsByProvider[state.provider].value = value;

    // Save
    saveState();
    renderModelList();

    // Notify backend that two-model mode is enabled
    vscode.postMessage({ type: 'toggleTwoModelMode', enabled: true });

    vscode.postMessage({
      type: 'saveModels',
      providerId: state.provider,
      reasoning: reasoning,
      coding: coding,
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
          
          // Listen for config update to restore button
          const originalHandleConfig = window.handleConfigLoaded;
          window.handleConfigLoaded = function(newConfig) {
            originalHandleConfig.call(this, newConfig);
            window.handleConfigLoaded = originalHandleConfig; // Restore original handler
          };
        });
      }
    } else {
      // Hide container when no cache data is available
      cacheContainer.style.display = 'none';
    }
  }

  function handleConfigLoaded(config) {
    console.log('[handleConfigLoaded] Received config:', config);
    
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
    
    // NOW compare using effective provider to decide if we should clear models
    if (effectiveProvider !== state.provider) {
      console.log('[handleConfigLoaded] Provider changed from', state.provider, 'to', effectiveProvider, '- clearing cache');
      state.models = [];
      state.modelsCache = {};
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
      // Ensure built-in providers have entries
      ['openrouter', 'openai', 'together', 'deepseek', 'glm', 'custom'].forEach(provider => {
        if (!state.modelsByProvider[provider]) {
          // Comment 3: Normalize terminology - use 'completion' key internally for provider-scoped coding model values
          state.modelsByProvider[provider] = { reasoning: '', completion: '', coding: '', value: '' };
        }
      });
    }
    
    // Comment 6: Log incoming config for save round-trip verification
    console.log(`[handleConfigLoaded] Config round-trip - state.provider: ${state.provider}, incoming config.modelSelectionsByProvider[${state.provider}]:`, JSON.stringify(config.modelSelectionsByProvider?.[state.provider] || null));
    
    // Only seed modelsByProvider for the current provider if no entry exists
    if (!state.modelsByProvider[state.provider]) {
      // Comment 3: Normalize terminology - use 'completion' key internally for provider-scoped coding model values
      state.modelsByProvider[state.provider] = { reasoning: '', completion: '', coding: '', value: '' };
    }
    
    // Set models from provider-specific storage, with validation
    if (state.modelsByProvider[state.provider]) {
      const providerModels = state.modelsByProvider[state.provider];
      state.reasoningModel = providerModels.reasoning || '';
      // Phase 3: Use helper function with deprecation warning
      state.codingModel = getCodingModelFromProvider(providerModels, state.provider);
      state.valueModel = providerModels.value || '';
      
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
    if (!config.modelSelectionsByProvider?.[state.provider]?.reasoning && 
        (state.reasoningModel || state.codingModel || state.valueModel) &&
        !state.autoHydratedProviders.has(state.provider)) {
      state.autoHydratedProviders.add(state.provider);
      console.log(`[handleConfigLoaded] Auto-hydrating provider map for ${state.provider} (first time only)`);
      vscode.postMessage({
        type: 'saveModels',
        providerId: state.provider,
        reasoning: state.reasoningModel || '',
        coding: state.codingModel || '',
        value: state.valueModel || ''
      });
      console.log('[handleConfigLoaded] Hydrated provider map from legacy keys via saveModels');
    } else if (state.autoHydratedProviders.has(state.provider)) {
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
    
    // Phase 2: Validate provider and token to prevent race conditions
    // Use the provider from the payload, not the current state
    const provider = payload.provider || state.provider;
    const responseToken = payload.token;
    
    console.log(`[handleModelsLoaded] Received ${payload.models.length} models for provider: ${provider}, token: ${responseToken}, currentRequestToken: ${state.currentRequestToken}`);
    
    // Phase 2: Token validation - ignore late responses with mismatched tokens
    if (responseToken && state.currentRequestToken && responseToken !== state.currentRequestToken) {
      console.log(`[handleModelsLoaded] IGNORING late response - token mismatch (expected: ${state.currentRequestToken}, got: ${responseToken})`);
      return;
    }
    
    // Always cache under the provider the backend says these belong to
    state.modelsCache[provider] = payload.models;
    
    // Phase 2: Provider validation - only render if this response is for the currently selected provider
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
    // Only render errors for the currently selected provider
    const errorProvider = payload.provider || state.provider;
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
    
    // Show dedicated hint for Together AI when 401/403 is encountered
    let dedicatedHint = '';
    if (state.provider === 'together' && payload.error && (payload.error.includes('401') || payload.error.includes('403'))) {
      dedicatedHint = `
        <div class="manual-entry-hint" style="background: var(--vscode-inputValidation-warningBackground); padding: 8px; border-radius: 4px; margin-bottom: 12px;">
          <p class="manual-entry-hint-title">🔑 Together AI Authentication Issue</p>
          <p>• Verify your API key at <a href="https://api.together.xyz/settings/api-keys" target="_blank">api.together.xyz/settings/api-keys</a></p>
          <p>• Ensure the key is active and has credits available</p>
          <p>• Some keys may be restricted to specific models - check your account settings</p>
        </div>
      `;
    }
    
    const example = providerExamples[state.provider] || 'gpt-4, claude-3-opus';
    
    // Show error with manual entry option for all providers
    container.innerHTML = `
      <div class="empty-state">
        <p class="empty-state-error">${escapeHtml(payload.error)}</p>
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
    console.error('Error:', message);
    // Could add a toast notification here
  }
})();