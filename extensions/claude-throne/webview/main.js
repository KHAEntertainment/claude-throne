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
    // Provider-specific model storage
    modelsByProvider: {
      openrouter: { reasoning: '', coding: '', value: '' },
      openai: { reasoning: '', coding: '', value: '' },
      together: { reasoning: '', coding: '', value: '' },
      deepseek: { reasoning: '', coding: '', value: '' },
      glm: { reasoning: '', coding: '', value: '' },
      custom: { reasoning: '', coding: '', value: '' }
    },
    proxyRunning: false,
    port: 3000,
    customCombos: [],
    workspaceCombos: []
  };

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

    // Two Model Toggle
    const twoModelToggle = document.getElementById('twoModelToggle');
    twoModelToggle?.addEventListener('change', onTwoModelToggle);

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

    // Save Combo Button
    const saveComboBtn = document.getElementById('saveComboBtn');
    saveComboBtn?.addEventListener('click', requestSaveCombo);

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
        handlePopularModels(message.payload);
        break;
      case 'keys':
        handleKeysLoaded(message.payload);
        break;
      case 'keyStored':
        handleKeyStored(message.payload);
        break;
      case 'proxyError':
        showError(message.payload);
        break;
      case 'modelsError':
        handleModelsError(message.payload);
        break;
      case 'combosLoaded':
        handleCombosLoaded(message.payload);
        break;
      default:
        console.log('[handleMessage] Unknown message type:', message.type);
    }
  }

  function restoreState() {
    const saved = vscode.getState();
    if (saved) {
      state = { ...state, ...saved };
      
      // Restore UI
      document.getElementById('providerSelect').value = state.provider;
      document.getElementById('twoModelToggle').checked = state.twoModelMode;
      updateTwoModelUI();
      updateProviderUI();
    }
  }

  function saveState() {
    vscode.setState(state);
  }

  // Provider handling
    function onProviderChange(e) {
    // Save current models for the old provider
    if (state.provider && state.modelsByProvider[state.provider]) {
      state.modelsByProvider[state.provider].reasoning = state.reasoningModel;
      state.modelsByProvider[state.provider].coding = state.codingModel;
      state.modelsByProvider[state.provider].value = state.valueModel;
    }
    
    // Clear the specific provider's cache before changing
    delete state.modelsCache[state.provider];
    
    const newProvider = e.target.value;
    state.provider = newProvider;
    state.models = [];
    
    // Restore models for the new provider
    if (state.modelsByProvider[newProvider]) {
      state.reasoningModel = state.modelsByProvider[newProvider].reasoning || '';
      state.codingModel = state.modelsByProvider[newProvider].coding || '';
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
    
    // Show/hide custom URL
    if (state.provider === 'custom') {
      customSection?.classList.add('visible');
    } else {
      customSection?.classList.remove('visible');
    }

    // Show/hide popular combos (OpenRouter only)
    if (state.provider === 'openrouter') {
      combosCard?.classList.add('visible');
      vscode.postMessage({ type: 'requestPopularModels' });
    } else {
      combosCard?.classList.remove('visible');
    }

    // Update help text
    const providerInfo = providers[state.provider];
    if (providerInfo && helpDiv) {
      if (providerInfo.helpUrl) {
        helpDiv.innerHTML = `<a href="${providerInfo.helpUrl}" target="_blank">Get API Key →</a>`;
      } else {
        helpDiv.innerHTML = '';
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

  function showNotification(message, type = 'info') {
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
      
      // Auto-hide after 3 seconds
      setTimeout(() => {
        notificationEl.style.opacity = '0';
        setTimeout(() => {
          notificationEl.style.display = 'none';
        }, 300);
      }, 3000);
    }
  }

  function requestSaveCombo() {
    const name = prompt('Enter a name for this model combo:');
    if (!name || !name.trim()) {
      return;
    }
    
    console.log('[requestSaveCombo] Saving combo:', name);
    
    // Show saving state on button
    const saveBtn = document.getElementById('saveComboBtn');
    if (saveBtn) {
      const originalText = saveBtn.textContent;
      saveBtn.textContent = '✓ Saving...';
      saveBtn.disabled = true;
      
      // Reset after a delay
      setTimeout(() => {
        saveBtn.textContent = originalText;
        saveBtn.disabled = false;
      }, 2000);
    }
    
    vscode.postMessage({
      type: 'saveCombo',
      name: name.trim(),
      reasoningModel: state.reasoningModel,
      codingModel: state.codingModel,
      valueModel: state.valueModel
    });
  }

  function handleCombosLoaded(payload) {
    console.log('[handleCombosLoaded] Combos loaded:', payload);
    
    // Show success feedback when combo is saved
    const saveBtn = document.getElementById('saveComboBtn');
    if (saveBtn && saveBtn.textContent.includes('Saving')) {
      saveBtn.textContent = '✓ Saved!';
      saveBtn.style.backgroundColor = 'var(--vscode-testing-iconPassed)';
      
      // Also show inline notification
      showNotification('Model combo saved successfully!', 'success');
      
      setTimeout(() => {
        saveBtn.textContent = '+ Save Model Combo';
        saveBtn.style.backgroundColor = '';
      }, 2000);
    }
    
    // Store the combos for later display
    if (payload.combos) {
      state.customCombos = payload.combos;
    }
  }

  function handleKeysLoaded(keys) {
    console.log('[handleKeysLoaded] Keys status:', keys);
    
    // Update UI to show if key is stored
    const input = document.getElementById('apiKeyInput');
    const helpDiv = document.getElementById('providerHelp');
    const storeBtn = document.getElementById('storeKeyBtn');
    
    if (keys[state.provider]) {
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
      
      // Show "Get API Key" link
      const providerInfo = providers[state.provider];
      if (providerInfo && providerInfo.helpUrl && helpDiv) {
        helpDiv.innerHTML = `<a href="${providerInfo.helpUrl}" target="_blank">Get API Key →</a>`;
      }
    }
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
    if (type === 'reasoning') {
      state.reasoningModel = modelId;
      // Save to provider-specific storage
      if (state.modelsByProvider[state.provider]) {
        state.modelsByProvider[state.provider].reasoning = modelId;
      }
    } else if (type === 'coding') {
      state.codingModel = modelId;
      // Save to provider-specific storage
      if (state.modelsByProvider[state.provider]) {
        state.modelsByProvider[state.provider].coding = modelId;
      }
    } else if (type === 'value') {
      state.valueModel = modelId;
      // Save to provider-specific storage
      if (state.modelsByProvider[state.provider]) {
        state.modelsByProvider[state.provider].value = modelId;
      }
    }
    
    vscode.postMessage({
      type: 'saveModels',
      reasoning: state.reasoningModel,
      coding: state.codingModel,
      value: state.valueModel
    });
    
    updateSaveComboButton();
    updateSelectedModelsDisplay();
    saveState();
    renderModelList();
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
        reasoningDisplay.innerHTML = '<em>No reasoning model selected</em>';
      }
    }
    
    if (codingDisplay) {
      if (state.twoModelMode && state.codingModel) {
        const modelName = state.codingModel.split('/').pop() || state.codingModel;
        codingDisplay.innerHTML = `<strong>Coding:</strong> ${escapeHtml(modelName)}`;
        codingDisplay.style.display = 'block';
            } else {
        codingDisplay.innerHTML = '';
        codingDisplay.style.display = 'none';
      }
    }
    
    if (valueDisplay) {
      if (state.twoModelMode && state.valueModel) {
        const modelName = state.valueModel.split('/').pop() || state.valueModel;
        valueDisplay.innerHTML = `<strong>Value:</strong> ${escapeHtml(modelName)}`;
        valueDisplay.style.display = 'block';
            } else {
        valueDisplay.innerHTML = '';
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
      // Request models from backend
      vscode.postMessage({ type: 'requestModels', provider: state.provider });
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
      container.innerHTML = '<div class="empty-state">No models available</div>';
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

  // Popular Combos
  function handlePopularModels(payload) {
    const container = document.getElementById('combosGrid');
    if (!container) return;

    const pairings = payload.pairings || [];
        
        if (pairings.length === 0) {
      container.innerHTML = '<div class="empty-state">No combos available</div>';
            return;
        }
        
    container.innerHTML = pairings.slice(0, 4).map(pairing => `
      <button class="combo-btn" data-reasoning="${escapeHtml(pairing.reasoning)}" data-completion="${escapeHtml(pairing.completion)}">
        ${escapeHtml(pairing.name)}
      </button>
    `).join('');

    // Add click handlers
    container.querySelectorAll('.combo-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const reasoning = e.currentTarget.dataset.reasoning;
        const completion = e.currentTarget.dataset.completion;
        applyCombo(reasoning, completion);
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

    // Save
    saveState();
    renderModelList();

    // Notify backend that two-model mode is enabled
    vscode.postMessage({ type: 'toggleTwoModelMode', enabled: true });

    vscode.postMessage({
      type: 'saveModels',
      reasoning: reasoning,
      coding: coding,
      value: value
    });
  }

  function onPortChange(e) {
    const port = e.target.value;
    vscode.postMessage({ type: 'updatePort', port: parseInt(port, 10) });
  }

  // Proxy Controls
  function startProxy() {
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

  function stopProxy() {
    vscode.postMessage({ type: 'stopProxy' });
  }



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

  function handleConfigLoaded(config) {
    console.log('[handleConfigLoaded] Received config:', config);
    
    // Clear models and cache when config is reloaded (e.g., after revert)
    state.models = [];
    state.modelsCache = {};
    
    // Update UI with config
    if (config.provider) {
      state.provider = config.provider;
      document.getElementById('providerSelect').value = config.provider;
      updateProviderUI();
    }

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

    // Always update state to match config, even if empty (prevents stale cached values)
    state.reasoningModel = config.reasoningModel || '';
    state.codingModel = config.completionModel || '';
    state.valueModel = config.valueModel || '';
    
    console.log('[handleConfigLoaded] Updated model state:', {
      reasoningModel: state.reasoningModel,
      codingModel: state.codingModel,
      valueModel: state.valueModel,
      fromConfig: true
    });

    // Check if two-model mode should be enabled
    if (config.twoModelMode !== undefined) {
      state.twoModelMode = config.twoModelMode;
      document.getElementById('twoModelToggle').checked = config.twoModelMode;
      updateTwoModelUI();
    } else if (config.reasoningModel && config.completionModel && 
        config.reasoningModel !== config.completionModel) {
      state.twoModelMode = true;
      document.getElementById('twoModelToggle').checked = true;
      updateTwoModelUI();
    }

    // Update selected models display
    updateSelectedModelsDisplay();

    // Try to load models if we have the config
    loadModels();
  }

  function handleModelsLoaded(payload) {
    if (payload.models && Array.isArray(payload.models)) {
      if (payload.models.length === 0) {
        return;
      }
      state.models = payload.models;
      state.modelsCache[state.provider] = payload.models;
      renderModelList();
      
      // Update save combo button visibility after models are loaded
      updateSaveComboButton();
    }
  }

  function handleModelsError(payload) {
    const container = document.getElementById('modelListContainer');
    if (!container) return;
    
    // Get provider-specific placeholder examples
    const providerExamples = {
      'openrouter': 'anthropic/claude-3-opus, openai/gpt-4-turbo, meta-llama/llama-3.1-70b-instruct',
      'openai': 'gpt-4, gpt-4-turbo, gpt-3.5-turbo',
      'together': 'meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo, mistralai/Mixtral-8x7B-Instruct-v0.1',
      'deepseek': 'deepseek-chat, deepseek-coder',
      'glm': 'glm-4-plus, glm-4',
      'custom': 'gpt-4, claude-3-opus, llama-3'
    };
    
    const example = providerExamples[state.provider] || 'gpt-4, claude-3-opus';
    
    // Show error with manual entry option for all providers
    container.innerHTML = `
      <div class="empty-state">
        <p style="color: var(--vscode-errorForeground); margin-bottom: 12px;">${escapeHtml(payload.error)}</p>
        <div style="margin-top: 16px; border-top: 1px solid var(--vscode-panel-border); padding-top: 16px;">
          <h4 style="margin: 0 0 8px 0; color: var(--vscode-foreground);">Manual Model Entry</h4>
          <p style="margin: 0 0 8px 0; color: var(--vscode-descriptionForeground);">Enter model IDs for ${providers[state.provider]?.name || state.provider} (comma-separated):</p>
          <input type="text" id="manualModelInput" placeholder="e.g., ${example}" style="width: 100%; margin-top: 8px; padding: 6px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-input-border); font-family: monospace; font-size: 12px;" />
          <div style="margin-top: 8px; display: flex; gap: 8px;">
            <button id="addManualModelBtn" style="padding: 6px 12px; background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; cursor: pointer;">Add Models</button>
            <button id="retryModelsBtn" style="padding: 6px 12px; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; cursor: pointer;">Retry Loading</button>
          </div>
          <div style="margin-top: 8px; font-size: 11px; color: var(--vscode-descriptionForeground);">
            <p style="margin: 4px 0;">💡 Common models for ${providers[state.provider]?.name || state.provider}:</p>
            <code style="background: var(--vscode-textBlockQuote-background); padding: 2px 4px; border-radius: 2px; display: block; margin: 4px 0; white-space: pre-wrap;">${example}</code>
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
          const invalidModels = modelNames.filter(name => !name.length > 0 || name.includes(' '));
          
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
