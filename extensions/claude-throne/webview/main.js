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
    primaryModel: '',
    secondaryModel: '',
    models: [],
    modelsCache: {},
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
        grok: {
      name: 'Grok (Groq)',
            description: 'Ultra-fast inference for open models',
      helpUrl: 'https://console.groq.com/keys',
      apiPrefix: 'groq/'
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
    state.provider = e.target.value;
    state.models = [];
    state.primaryModel = '';
    state.secondaryModel = '';
    
    updateProviderUI();
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
    // For now, just log it - we could add a toast notification later
    console.log(`[${type.toUpperCase()}] ${message}`);
  }

  function requestSaveCombo() {
    const name = prompt('Enter a name for this model combo:');
    if (!name || !name.trim()) {
      return;
    }
    
    console.log('[requestSaveCombo] Saving combo:', name);
    vscode.postMessage({
      type: 'saveCombo',
      name: name.trim(),
      primaryModel: state.primaryModel,
      secondaryModel: state.secondaryModel
    });
  }

  function handleCombosLoaded(payload) {
    console.log('[handleCombosLoaded] TODO: Implement combos display');
    // TODO: Display user-saved combos + featured combos
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
  }

  function updateTwoModelUI() {
    const secondarySection = document.getElementById('secondaryModelSection');
    const modelList = document.getElementById('modelListContainer');
    const saveComboBtn = document.getElementById('saveComboBtn');
    
    if (state.twoModelMode) {
      secondarySection?.classList.add('visible');
    } else {
      secondarySection?.classList.remove('visible');
    }

    // Show/hide save combo button
    updateSaveComboButton();

    // Re-render model list to show/hide secondary buttons
    renderModelList();
  }

  function updateSaveComboButton() {
    const saveComboBtn = document.getElementById('saveComboBtn');
    if (!saveComboBtn) return;

    // Show button only if two-model mode is on and both models are selected
    if (state.twoModelMode && state.primaryModel && state.secondaryModel) {
      saveComboBtn.classList.remove('hidden');
        } else {
      saveComboBtn.classList.add('hidden');
    }
  }

  // Model Selection
  function setModelFromList(modelId, type) {
    if (type === 'primary') {
      state.primaryModel = modelId;
      vscode.postMessage({
        type: 'saveModels',
        reasoning: modelId,
        completion: state.secondaryModel || modelId
      });
    } else if (type === 'secondary') {
      state.secondaryModel = modelId;
      vscode.postMessage({
        type: 'saveModels',
        reasoning: state.primaryModel,
        completion: modelId
      });
    }
    
    updateSaveComboButton();
    updateSelectedModelsDisplay();
    saveState();
    renderModelList();
  }

  function updateSelectedModelsDisplay() {
    const primaryDisplay = document.getElementById('primaryModelDisplay');
    const secondaryDisplay = document.getElementById('secondaryModelDisplay');
    
    if (primaryDisplay) {
      if (state.primaryModel) {
        const modelName = state.primaryModel.split('/').pop() || state.primaryModel;
        primaryDisplay.innerHTML = `<strong>Primary:</strong> ${escapeHtml(modelName)}`;
        } else {
        primaryDisplay.innerHTML = '<em>No primary model selected</em>';
      }
    }
    
    if (secondaryDisplay) {
      if (state.twoModelMode && state.secondaryModel) {
        const modelName = state.secondaryModel.split('/').pop() || state.secondaryModel;
        secondaryDisplay.innerHTML = `<strong>Secondary:</strong> ${escapeHtml(modelName)}`;
        secondaryDisplay.style.display = 'block';
            } else {
        secondaryDisplay.innerHTML = '';
        secondaryDisplay.style.display = 'none';
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
        const container = document.getElementById('modelListContainer');
        if (container) {
          container.innerHTML = '<div class="empty-state">Enter custom endpoint URL to load models</div>';
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
      const isPrimary = model.id === state.primaryModel;
      const isSecondary = model.id === state.secondaryModel;
      const isFree = model.pricing?.prompt === '0' && model.pricing?.completion === '0';
      
      let itemClass = 'model-item';
      if (isPrimary) itemClass += ' selected-primary';
      else if (isSecondary) itemClass += ' selected-secondary';

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
            <button class="model-btn ${isPrimary ? 'primary-selected' : ''}" 
                    data-model="${escapeHtml(model.id)}" 
                    data-type="primary">
              ${isPrimary ? '✓ Primary' : 'Primary'}
            </button>
            ${state.twoModelMode ? `
              <button class="model-btn ${isSecondary ? 'secondary-selected' : ''}" 
                      data-model="${escapeHtml(model.id)}" 
                      data-type="secondary">
                ${isSecondary ? '✓ Secondary' : 'Secondary'}
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

  function applyCombo(reasoning, completion) {
    // Enable two-model mode
    state.twoModelMode = true;
    document.getElementById('twoModelToggle').checked = true;
    updateTwoModelUI();

    // Set models
    state.primaryModel = reasoning;
    state.secondaryModel = completion;
    
    document.getElementById('primaryModel').value = reasoning;
    document.getElementById('secondaryModel').value = completion;

    // Save
    saveState();
    renderModelList();

    vscode.postMessage({
      type: 'saveModels',
      reasoning: reasoning,
      completion: completion
    });
  }

  function onPortChange(e) {
    const port = e.target.value;
    vscode.postMessage({ type: 'updatePort', port: parseInt(port, 10) });
  }

  // Proxy Controls
  function startProxy() {
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
      } else {
        startBtn.classList.remove('hidden');
        stopBtn.classList.add('hidden');
      }
    }
  }

  function handleConfigLoaded(config) {
    console.log('[handleConfigLoaded] Received config:', config);
    
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

    if (config.reasoningModel) {
      state.primaryModel = config.reasoningModel;
    }

    if (config.completionModel) {
      state.secondaryModel = config.completionModel;
    }

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
