import * as vscode from 'vscode'
import { SecretsService } from '../services/Secrets'
import { ProxyManager } from '../services/ProxyManager'
import { listModels, type ProviderId } from '../services/Models'
import { isAnthropicEndpoint, type CustomEndpointKind } from '../services/endpoints'

export class PanelViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private currentProvider: string = 'openrouter' // Runtime source of truth for current provider selection
  private modelsCache: Map<string, { models: any[], timestamp: number }> = new Map()

  /**
   * Phase 3: Helper to get completion model with deprecation warning
   * Reads from 'completion' key first, falls back to legacy 'coding' key
   * Emits deprecation warning when falling back to 'coding'
   */
  private getCodingModelFromProvider(providerModels: any, providerId: string): string {
    const completion = providerModels?.completion
    const coding = providerModels?.coding
    
    // Phase 3: Emit deprecation warning if using legacy 'coding' key
    if (!completion && coding) {
      this.log.appendLine(`[DEPRECATION] Provider '${providerId}' uses legacy 'coding' key. Migrating to 'completion' on next save.`)
    }
    
    return completion || coding || ''
  }

  /**
   * Helper getter for accessing current provider for runtime operations.
   * Returns this.currentProvider (runtime state) for UI/actions,
   * and config.get('provider') (persistent state) only for persistence operations.
   */
  private get runtimeProvider(): string {
    return this.currentProvider
  }

  /**
   * Helper getter for accessing persistent provider config from VS Code settings.
   * Use this only when you need to read/write the actual configuration value.
   */
  private get configProvider(): string {
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    return cfg.get<string>('provider', 'openrouter')
  }

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly secrets: SecretsService,
    private readonly proxy: ProxyManager | null,
    private readonly log: vscode.OutputChannel,
  ) {
    // Initialize provider from configuration
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const provider = cfg.get<string>('provider', 'openrouter')
    const selectedCustomProviderId = cfg.get<string>('selectedCustomProviderId', '')
    
    // If provider is 'custom' and we have a selectedCustomProviderId, use that as the current provider
    if (provider === 'custom' && selectedCustomProviderId) {
      this.currentProvider = selectedCustomProviderId
    } else {
      this.currentProvider = provider
    }
  }

  async reveal() {
    if (this.view) {
      this.view.show?.(true)
      return
    }
    try {
      await vscode.commands.executeCommand('workbench.view.openView', 'claudeThrone.panel', true)
    } catch {
      vscode.window.showInformationMessage('Open the Thronekeeper view from the Panel (bottom) — it is movable like Output/Terminal.')
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.log.appendLine('🎨 Resolving webview view...')
    this.view = webviewView
    webviewView.webview.options = { enableScripts: true }
    this.log.appendLine('📝 Generating webview HTML...')
    webviewView.webview.html = this.getHtml()
    this.log.appendLine('✅ Webview HTML loaded')

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      this.log.appendLine(`📨 Received message from webview: ${msg.type}`)
      try {
        switch (msg.type) {
          case 'webviewReady':
            this.log.appendLine('✅ Webview reports it is ready!')
            // Send initial data now that webview is ready
            this.postStatus()
            await this.postKeys()
            this.postConfig()
            this.postModels()
            await this.postPopularModels()
            await this.postCustomProviders()
            // Refresh keys after custom providers are loaded to include custom provider keys
            await this.postKeys()
            break
          case 'requestStatus':
            this.postStatus()
            break
          case 'requestKeys':
            await this.postKeys()
            break
          case 'requestConfig':
            this.postConfig()
            break
          case 'requestModels':
            // Phase 2: Pass through token for race protection
            await this.handleListModels(false, msg.token)
            break
          case 'listPublicModels':
            await this.handleListModels(false, msg.token)
            break
          case 'listFreeModels':
            await this.handleListModels(true, msg.token)
            break
          case 'requestPopularModels':
            await this.postPopularModels()
            break
          case 'updateProvider':
            await this.handleUpdateProvider(msg.provider)
            break
          case 'updateCustomBaseUrl':
            await this.handleUpdateCustomUrl(msg.url)
            if (this.currentProvider === 'custom') {
              if (msg.url && msg.url.trim()) {
                await this.handleListModels(false)
              } else {
                this.postModels()
              }
            }
            break
          case 'storeKey':
            await this.handleStoreKey(msg.provider, msg.key)
            break
          case 'startProxy':
            await this.handleStartProxy()
            break
          case 'stopProxy':
            await this.handleStopProxy()
            break
          case 'revertApply':
            await this.handleRevertApply()
            break
          case 'openSettings':
            await vscode.commands.executeCommand('workbench.action.openSettings', 'claudeThrone')
            break
          case 'saveModels':
            // Use providerId from message, not runtimeProvider, to ensure correct provider is used
            await this.handleSaveModels({providerId: msg.providerId, reasoning: msg.reasoning, coding: msg.coding, value: msg.value})
            break
          case 'setModelFromList':
            await this.handleSetModelFromList(msg.modelId, msg.modelType)
            break
          case 'toggleTwoModelMode':
            await this.handleToggleTwoModelMode(msg.enabled)
            break
          case 'filterModels':
            await this.handleFilterModels(msg.filter)
            break
          case 'openExternal':
            vscode.env.openExternal(vscode.Uri.parse(msg.url))
            break
          case 'updatePort':
            await this.handleUpdatePort(msg.port)
            break
          case 'saveCombo':
            await this.handleSaveCombo(msg.name, msg.reasoningModel, msg.codingModel, msg.valueModel)
            break
          case 'deleteCombo':
            await this.handleDeleteCombo(msg.index)
            break
          case 'saveCustomProvider':
            await this.handleSaveCustomProvider(msg.name, msg.baseUrl, msg.id)
            break
          case 'deleteCustomProvider':
            await this.handleDeleteCustomProvider(msg.id)
            break
          case 'requestCustomProviders':
            await this.postCustomProviders()
            break
          case 'storeAnthropicKey':
            await this.handleStoreAnthropicKey(msg.key)
            break
          case 'refreshAnthropicDefaults':
            try {
              await vscode.commands.executeCommand('claudeThrone.refreshAnthropicDefaults')
              this.postConfig()
            } catch (err) {
              this.log.appendLine(`❌ Error refreshing Anthropic defaults: ${err}`)
              vscode.window.showErrorMessage(`Error refreshing Anthropic defaults: ${err}`)
            }
            break
          case 'updateDebug':
            await this.handleUpdateDebug(msg.enabled)
            break
          default:
            this.log.appendLine(`Unknown message type received: ${msg.type}`)
        }
      } catch (err) {
        this.log.appendLine(`❌ Error handling message: ${err}`)
        vscode.window.showErrorMessage(`Error in Thronekeeper: ${err}`)
      }
    });
    this.log.appendLine('⏳ Waiting for webview to signal it is ready...')
  }

  private async postStatus() {
    const s = this.proxy?.getStatus() || { running: false }
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    
    // Read from provider-specific configuration with fallback to global keys
    const modelSelectionsByProvider = cfg.get<any>('modelSelectionsByProvider', {})
    let reasoningModel = ''
    let completionModel = ''
    let valueModel = ''
    
    if (modelSelectionsByProvider[this.runtimeProvider]) {
      reasoningModel = String(modelSelectionsByProvider[this.runtimeProvider].reasoning || '')
      completionModel = String(modelSelectionsByProvider[this.runtimeProvider].completion || '')
      valueModel = String(modelSelectionsByProvider[this.runtimeProvider].value || '')
    }
    
    // Fallback to global keys if provider-specific not found
    if (!reasoningModel) reasoningModel = String(cfg.get('reasoningModel') || '')
    if (!completionModel) completionModel = String(cfg.get('completionModel') || '')
    if (!valueModel) valueModel = String(cfg.get('valueModel') || '')
    
    this.view?.webview.postMessage({ 
      type: 'status', 
      payload: { 
        ...s, 
        reasoningModel, 
        completionModel, 
        valueModel
      } 
    })
  }

  private async postKeys() {
    try {
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const customProviders = cfg.get<any[]>('customProviders', [])

      // Start with built-in providers
      const providerIds = ['openrouter','openai','together','deepseek','glm']
      
      // Add all saved custom providers by ID
      for (const cp of customProviders) {
        if (cp?.id && cp.id.trim()) {
          providerIds.push(cp.id)
        }
      }

      const keyStatus: Record<string, boolean> = {}
      
      // Check each provider's key status
      for (const id of providerIds) {
        try {
          const val = await this.secrets.getProviderKey(id)
          keyStatus[id] = !!(val && val.trim())
        } catch (err) {
          keyStatus[id] = false
          this.log.appendLine(`[postKeys] ERROR checking key for ${id}: ${err}`)
        }
      }
      
      // Check Anthropic key
      try {
        const anthropicKey = await this.secrets.getAnthropicKey()
        keyStatus.anthropic = !!(anthropicKey && anthropicKey.trim())
      } catch (err) {
        keyStatus.anthropic = false
        this.log.appendLine(`[postKeys] ERROR checking Anthropic key: ${err}`)
      }

      this.log.appendLine(`[postKeys] keyStatus for providers: ${JSON.stringify(keyStatus)}`)
      this.log.appendLine(`[postKeys] runtimeProvider=${this.runtimeProvider}, configProvider=${this.configProvider}`)
      
      // Send keysLoaded message for consistency
      this.view?.webview.postMessage({ 
        type: 'keysLoaded', 
        payload: { keyStatus } 
      })
      
      // Also send legacy 'keys' message for backward compatibility
      this.view?.webview.postMessage({ 
        type: 'keys', 
        payload: keyStatus 
      })
      
    } catch (err) {
      this.log.appendLine(`[postKeys] ERROR: ${err}`)
      // Send empty status on error
      this.view?.webview.postMessage({ 
        type: 'keysLoaded', 
        payload: { keyStatus: {} } 
      })
    }
  }

  public postConfig() {
    if (!this.view) return;
    const config = vscode.workspace.getConfiguration('claudeThrone');
    // Note: config.get('provider') returns the persistent value from settings,
    // which may differ from runtimeProvider when using saved custom providers
    const provider = config.get('provider');
    const selectedCustomProviderId = config.get('selectedCustomProviderId', '');
    const reasoningModel = config.get('reasoningModel');
    const completionModel = config.get('completionModel');
    const valueModel = config.get('valueModel');
    const twoModelMode = config.get('twoModelMode', false);
    const port = config.get('proxy.port');
    const customBaseUrl = config.get('customBaseUrl', '');
    const debug = config.get('proxy.debug', false);
    const modelSelectionsByProvider = config.get('modelSelectionsByProvider', {});
    
    // Add cache age information
    const cachedTimestamp = config.get<number>('anthropicDefaultsTimestamp', 0);
    const cachedDefaults = config.get<any>('anthropicDefaults', null);
    let cacheAgeDays = 0;
    let cacheStale = false;
    
    if (cachedTimestamp > 0) {
      const cacheAge = Date.now() - cachedTimestamp;
      cacheAgeDays = Math.floor(cacheAge / (24 * 60 * 60 * 1000));
      cacheStale = cacheAgeDays >= 7;
    }
    
    this.log.appendLine(`[postConfig] Sending config to webview: twoModelMode=${twoModelMode}, debug=${debug}, cacheAge=${cacheAgeDays} days`);
    
    this.view.webview.postMessage({
      type: 'config',
      payload: { 
        provider, 
        selectedCustomProviderId, 
        twoModelMode, 
        port, 
        customBaseUrl, 
        debug,
        cacheAgeDays,
        cacheStale,
        cachedDefaults,
        modelSelectionsByProvider,
        // Comment 2: Add legacy model keys to payload for webview fallback
        reasoningModel,
        completionModel,
        valueModel
      }
    });
  }

  private async postModels() {
    // Use runtimeProvider for UI operations
    const provider = this.runtimeProvider || 'openrouter'
    const CACHE_TTL_MS = 5 * 60 * 1000
    const cached = this.modelsCache.get(provider)
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      this.view?.webview.postMessage({ 
        type: 'models', 
        payload: { models: cached.models, provider } 
      })
    } else {
      this.view?.webview.postMessage({ type: 'models', payload: { models: [], provider } })
    }
  }

  private async handleListModels(freeOnly: boolean, requestToken?: string) {
    // Use runtimeProvider for UI operations - this represents the actual provider being used
    const provider = this.runtimeProvider || 'openrouter'
    this.log.appendLine(`📋 Loading models for provider: ${provider}${requestToken ? `, token: ${requestToken}` : ''}`)
    
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    
    if (provider === 'custom') {
      const baseUrl = cfg.get<string>('customBaseUrl', '')
      if (!baseUrl || !baseUrl.trim()) {
        this.view?.webview.postMessage({ 
          type: 'models', 
          payload: { models: [], provider, token: requestToken } 
        })
        return
      }
      
      // Check if this custom provider has an anthropic endpoint
      const endpointKind = cfg.get<CustomEndpointKind>('customEndpointKind', 'auto');
      const isAnthropic = isAnthropicEndpoint(baseUrl);
      
      if ((endpointKind === 'anthropic' && isAnthropic) || (endpointKind === 'auto' && isAnthropic)) {
        // Bypass model loading for anthropic endpoints - use native model discovery
        this.view?.webview.postMessage({ 
          type: 'models', 
          payload: { 
            models: [{
              id: 'claude-3-5-sonnet-20241022',
              name: 'Claude 3.5 Sonnet (Native)',
              description: 'Anthropic native endpoint - models managed by Claude',
              provider: provider
            }],
            provider,
            token: requestToken
          }
        })
        return;
      }
    }
    
    const CACHE_TTL_MS = 5 * 60 * 1000
    const cached = this.modelsCache.get(provider)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      this.log.appendLine(`📦 Using cached models for ${provider}`)
      this.view?.webview.postMessage({ 
        type: 'models', 
        payload: {
          models: cached.models,
          provider,
          freeOnly,
          token: requestToken
        }
      })
      return
    }
    
    try {
      // Get API key for the provider
      const apiKey = await this.secrets.getProviderKey(provider) || ''
      this.log.appendLine(`🔑 API key ${apiKey ? 'found' : 'NOT found'} for ${provider}`)
      
      // Get base URL for model listing
      // Check if this is a saved custom provider first
      const customProviders = cfg.get<any[]>('customProviders', [])
      const customProvider = customProviders.find(p => p.id === provider)
      
      let baseUrl = 'https://openrouter.ai/api'
      
      if (customProvider) {
        // This is a saved custom provider - use the base URL directly
        baseUrl = customProvider.baseUrl
      } else if (provider === 'custom') {
        baseUrl = cfg.get<string>('customBaseUrl', '')
      } else if (provider === 'openai') {
        baseUrl = 'https://api.openai.com/v1'
      } else if (provider === 'together') {
        baseUrl = 'https://api.together.xyz/v1'
      } else if (provider === 'deepseek') {
        baseUrl = 'https://api.deepseek.com/v1'
      } else if (provider === 'glm') {
        baseUrl = 'https://api.z.ai/api/paas/v4'
      }
      
      this.log.appendLine(`🌐 Fetching models from: ${baseUrl}`)
      const modelIds = await listModels(provider as ProviderId, baseUrl, apiKey)
      this.log.appendLine(`✅ Received ${modelIds.length} models from API`)
      
      // Convert to the format expected by the webview
      const models = modelIds.map(id => ({
        id,
        name: id.split('/').pop() || id,
        description: '',
        provider
      }))
      
      this.modelsCache.set(provider, { models, timestamp: Date.now() })
      
      this.log.appendLine(`📤 Sending ${models.length} models to webview`)
      this.view?.webview.postMessage({ 
        type: 'models', 
        payload: {
          models,
          provider,
          freeOnly,
          token: requestToken
        }
      })
    } catch (err: any) {
      this.log.appendLine(`❌ Failed to load models: ${err}`)
      
      // Send specific error for timeout or connection issues
      let errorMessage = `Failed to load models: ${err}`
      let errorType = 'generic'
      
      if (err.message?.includes('timed out')) {
        errorType = 'timeout'
        errorMessage = 'Model list request timed out. You can enter model IDs manually.'
      } else if (err.message?.includes('ECONNREFUSED') || err.message?.includes('ENOTFOUND')) {
        errorType = 'connection'
        errorMessage = 'Could not connect to the API endpoint. Please check your URL and enter model IDs manually.'
      }
      
      this.view?.webview.postMessage({ 
        type: 'modelsError', 
        payload: {
          provider,
          error: errorMessage,
          errorType,
          canManuallyEnter: true // Enable manual entry for all providers on errors
        }
      })
    }
  }

  private async postCustomProviders() {
    try {
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const customProviders = cfg.get<any[]>('customProviders', [])
      
      // Validate each provider has required fields
      const validProviders = customProviders.filter(provider => {
        return provider && 
               typeof provider.name === 'string' && provider.name.trim() &&
               typeof provider.baseUrl === 'string' && provider.baseUrl.trim() &&
               typeof provider.id === 'string' && provider.id.trim()
      })
      
      this.view?.webview.postMessage({ 
        type: 'customProvidersLoaded', 
        payload: { providers: validProviders } 
      })
    } catch (err) {
      this.log.appendLine(`Failed to load custom providers: ${err}`)
    }
  }

  private async postPopularModels() {
    // Try to load popular pairings from models configuration
    try {
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const reasoningModel = cfg.get<string>('reasoningModel')
      const completionModel = cfg.get<string>('completionModel')
      
      // Load featured combinations from our data
      const { promises: fs } = await import('fs')
      const pairingsPath = vscode.Uri.joinPath(this.ctx.extensionUri, 'webview', 'data', 'model-pairings.json')
      const pairingsContent = await fs.readFile(pairingsPath.fsPath, 'utf8')
      const pairingsData = JSON.parse(pairingsContent)
      
      // Load saved combos from config with validation
      const rawSavedCombos = cfg.get<any[]>('savedCombos', [])
      const savedCombos = rawSavedCombos.filter(combo => {
        // Validate that combo has required string fields
        return combo && 
               typeof combo.name === 'string' && combo.name.trim() &&
               typeof combo.reasoning === 'string' && combo.reasoning.trim() &&
               typeof combo.completion === 'string' && combo.completion.trim() &&
               (typeof combo.value === 'string' && combo.value.trim() || true); // value is optional
      }).map(combo => {
        // Normalize older two-field combos by setting value = completion for compatibility
        return {
          ...combo,
          value: combo.value || combo.completion
        };
      })
      
      this.view?.webview.postMessage({ 
        type: 'popularModels', 
        payload: {
          pairings: pairingsData.featured_pairings,
          savedCombos: savedCombos,
          currentReasoning: reasoningModel,
          currentCompletion: completionModel
        }
      })
    } catch (err) {
      console.error('Failed to load popular models:', err)
      this.view?.webview.postMessage({ 
        type: 'popularModels', 
        payload: { pairings: [], savedCombos: [] }
      })
    }
  }

  private async handleUpdateProvider(provider: string) {
    // Capture the old provider first, then clear its cache before changing
    const oldProvider = this.currentProvider
    this.modelsCache.delete(oldProvider)
    
    // Store current provider for model loading
    this.currentProvider = provider
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    
    // Clear the webview with an empty list immediately after switching to prevent stale renders
    this.view?.webview.postMessage({ 
      type: 'models', 
      payload: { models: [], provider } 
    })
    
    try {
      // Check if this is a custom provider
      const customProviders = cfg.get<any[]>('customProviders', [])
      const customProvider = customProviders.find(p => p.id === provider)
      
      if (customProvider) {
        // This is a saved custom provider - set provider to 'custom' and save the custom provider ID
        await cfg.update('provider', 'custom', vscode.ConfigurationTarget.Workspace)
        await cfg.update('selectedCustomProviderId', provider, vscode.ConfigurationTarget.Workspace)
        await cfg.update('customBaseUrl', customProvider.baseUrl, vscode.ConfigurationTarget.Workspace)
        await cfg.update('customEndpointKind', 'openai')
      } else {
        // Built-in provider - clear selectedCustomProviderId
        await cfg.update('provider', provider, vscode.ConfigurationTarget.Workspace)
        await cfg.update('selectedCustomProviderId', '', vscode.ConfigurationTarget.Workspace)
        await cfg.update('customEndpointKind', provider === 'custom' ? 'openai' : 'auto')
      }
    } catch (err) {
      console.error('Failed to update provider config:', err)
    }
    
    // Reload models for new provider
    if (provider === 'custom') {
      const customBaseUrl = cfg.get<string>('customBaseUrl', '')
      if (!customBaseUrl || !customBaseUrl.trim()) {
        this.postModels()
      } else {
        this.handleListModels(false)
      }
    } else {
      // Check if it's a saved custom provider
      const customProviders = cfg.get<any[]>('customProviders', [])
      const customProvider = customProviders.find(p => p.id === provider)
      
      if (customProvider) {
        this.handleListModels(false)
      } else {
        this.handleListModels(false)
      }
    }
    this.postPopularModels()
  }

  private async handleUpdateCustomUrl(url: string) {
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    await cfg.update('customBaseUrl', url, vscode.ConfigurationTarget.Workspace)
  }

  private async handleUpdatePort(port: number) {
    await vscode.workspace.getConfiguration('claudeThrone').update('proxy.port', port, vscode.ConfigurationTarget.Workspace)
    this.postConfig()
  }

  private async handleSaveCombo(name: string, reasoningModel: string, codingModel: string, valueModel: string) {
    try {
      const config = vscode.workspace.getConfiguration('claudeThrone')
      const savedCombos = config.get<any[]>('savedCombos', [])
      
      // Check if we've reached the 4-combo limit
      if (savedCombos.length >= 4) {
        vscode.window.showErrorMessage('Maximum of 4 saved combos reached. Delete an existing combo first.')
        return
      }
      
      const newCombo = {
        name,
        reasoning: reasoningModel,
        completion: codingModel,
        value: valueModel
      }
      
      const updatedCombos = [...savedCombos, newCombo]
      await config.update('savedCombos', updatedCombos, vscode.ConfigurationTarget.Workspace)
      
      vscode.window.showInformationMessage('Model combo saved successfully')
      this.view?.webview.postMessage({ 
        type: 'combosLoaded', 
        payload: { combos: updatedCombos } 
      })
    } catch (err) {
      this.log.appendLine(`❌ Failed to save combo: ${err}`)
      vscode.window.showErrorMessage(`Failed to save combo: ${err}`)
    }
  }

  private async handleSaveCustomProvider(name: string, baseUrl: string, id: string) {
    try {
      // Validate inputs
      if (!name || !name.trim()) {
        vscode.window.showErrorMessage('Provider name is required')
        return
      }
      
      if (!baseUrl || !baseUrl.trim()) {
        vscode.window.showErrorMessage('Base URL is required')
        return
      }
      
      if (!id || !id.trim()) {
        vscode.window.showErrorMessage('Provider ID is required')
        return
      }
      
      // Validate URL format
      try {
        new URL(baseUrl.trim())
      } catch (e) {
        vscode.window.showErrorMessage('Please enter a valid URL')
        return
      }
      
      // Check for conflicts with built-in providers
      const builtinProviders = ['openrouter', 'openai', 'together', 'deepseek', 'glm', 'custom']
      if (builtinProviders.includes(id.trim())) {
        vscode.window.showErrorMessage('Provider ID conflicts with built-in provider. Please choose a different name.')
        return
      }
      
      const config = vscode.workspace.getConfiguration('claudeThrone')
      const customProviders = config.get<any[]>('customProviders', [])
      
      // Check limit (10 providers)
      if (customProviders.length >= 10) {
        vscode.window.showErrorMessage('Maximum of 10 custom providers reached. Delete an existing provider first.')
        return
      }
      
      // Check for duplicate ID
      if (customProviders.some(p => p.id === id.trim())) {
        vscode.window.showErrorMessage('A custom provider with this name already exists.')
        return
      }
      
      const newProvider = {
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        id: id.trim()
      }
      
      const updatedProviders = [...customProviders, newProvider]
      await config.update('customProviders', updatedProviders, vscode.ConfigurationTarget.Workspace)
      
      vscode.window.showInformationMessage('Custom provider saved successfully')
      
      this.view?.webview.postMessage({ 
        type: 'customProvidersLoaded', 
        payload: { providers: updatedProviders } 
      })
      
      this.log.appendLine(`✅ Saved custom provider: ${name} (${id})`)
    } catch (err) {
      this.log.appendLine(`❌ Failed to save custom provider: ${err}`)
      vscode.window.showErrorMessage(`Failed to save custom provider: ${err}`)
    }
  }

  private async handleDeleteCustomProvider(id: string) {
    try {
      if (!id || !id.trim()) {
        this.log.appendLine(`❌ Invalid custom provider ID: ${id}`)
        vscode.window.showErrorMessage('Invalid provider ID')
        return
      }
      
      const config = vscode.workspace.getConfiguration('claudeThrone')
      const customProviders = config.get<any[]>('customProviders', [])
      
      const index = customProviders.findIndex(p => p.id === id.trim())
      if (index < 0) {
        this.log.appendLine(`❌ Custom provider not found: ${id}`)
        vscode.window.showErrorMessage('Custom provider not found')
        return
      }
      
      const provider = customProviders[index]
      const updatedProviders = [...customProviders]
      updatedProviders.splice(index, 1)
      
      // Delete the stored API key for this provider
      try {
        await this.secrets.deleteProviderKey(id.trim())
        this.log.appendLine(`✅ Deleted API key for custom provider: ${id}`)
      } catch (keyErr) {
        this.log.appendLine(`⚠️ Failed to delete API key for provider ${id}: ${keyErr}`)
        // Continue with provider deletion even if key deletion fails
      }
      
      await config.update('customProviders', updatedProviders, vscode.ConfigurationTarget.Workspace)
      
      // If deleted provider was currently selected, switch to default
      if (this.currentProvider === id.trim()) {
        this.currentProvider = 'openrouter'
        await config.update('provider', 'openrouter', vscode.ConfigurationTarget.Workspace)
        await config.update('selectedCustomProviderId', '', vscode.ConfigurationTarget.Workspace)
        this.postConfig()
        this.handleListModels(false)
      }
      
      // Refresh key status map
      await this.postKeys()
      
      vscode.window.showInformationMessage('Custom provider deleted successfully')
      
      this.view?.webview.postMessage({ 
        type: 'customProviderDeleted', 
        payload: { providers: updatedProviders, deletedId: id.trim() } 
      })
      
      this.log.appendLine(`✅ Deleted custom provider: ${provider.name} (${id})`)
    } catch (err) {
      this.log.appendLine(`❌ Failed to delete custom provider: ${err}`)
      vscode.window.showErrorMessage(`Failed to delete custom provider: ${err}`)
    }
  }

  private async handleDeleteCombo(index: number) {
    try {
      // Validate index
      if (typeof index !== 'number' || index < 0) {
        this.log.appendLine(`❌ Invalid combo index: ${index}`)
        vscode.window.showErrorMessage('Invalid combo index')
        return
      }
      
      const config = vscode.workspace.getConfiguration('claudeThrone')
      const savedCombos = config.get<any[]>('savedCombos', [])
      
      // Check if index is within bounds
      if (index >= savedCombos.length) {
        this.log.appendLine(`❌ Combo index ${index} out of bounds for array of length ${savedCombos.length}`)
        vscode.window.showErrorMessage('Combo not found')
        return
      }
      
      // Remove combo at specified index
      const updatedCombos = [...savedCombos]
      updatedCombos.splice(index, 1)
      
      // Update config
      await config.update('savedCombos', updatedCombos, vscode.ConfigurationTarget.Workspace)
      
      this.log.appendLine(`✅ Deleted combo at index ${index}`)
      vscode.window.showInformationMessage('Model combo deleted successfully')
      
      // Send updated combo list back to webview
      this.view?.webview.postMessage({ 
        type: 'comboDeleted', 
        payload: { combos: updatedCombos } 
      })
    } catch (err) {
      this.log.appendLine(`❌ Failed to delete combo: ${err}`)
      vscode.window.showErrorMessage(`Failed to delete combo: ${err}`)
    }
  }

  private async handleStoreKey(provider: string, key: string) {
    this.log.appendLine(`🔑 Storing key for provider: ${provider} (length: ${key?.length})`)
    try {
      await this.secrets.setProviderKey(provider, key)
      this.log.appendLine('✅ Key stored successfully in system keychain')
      await this.postKeys()
      
      // Show VS Code notification
      vscode.window.showInformationMessage(`API key for ${provider} stored successfully`)
      
      this.log.appendLine('📤 Sending keyStored confirmation to webview')
      const message = { 
        type: 'keyStored', 
        payload: { provider, success: true }
      }
      this.log.appendLine(`📤 Message content: ${JSON.stringify(message)}`)
      this.view?.webview.postMessage(message)
      this.log.appendLine('📤 Message sent via postMessage')
      
      // If this was the first key, try to load models
      if (key && key.trim()) {
        this.log.appendLine('📋 Triggering model list load...')
        this.handleListModels(false)
        this.postPopularModels()
      }
    } catch (err) {
      this.log.appendLine(`❌ Failed to store key: ${err}`)
      vscode.window.showErrorMessage(`Failed to store API key: ${err}`)
      this.view?.webview.postMessage({ 
        type: 'keyStored', 
        payload: { provider, success: false, error: String(err) }
      })
    }
  }

  private async handleStoreAnthropicKey(key: string) {
    try {
      if (!key || !key.trim()) {
        throw new Error('Anthropic API key cannot be empty')
      }

      this.log.appendLine(`🔐 Storing Anthropic API key...`)
      
      // Store the key using secrets service
      await this.secrets.setAnthropicKey(key.trim())
      
      // Show VS Code notification
      vscode.window.showInformationMessage('Anthropic API key stored. Fetching latest models...')
      
      // Refresh defaults without prompting user - handle potential settings conflicts
      try {
        await vscode.commands.executeCommand('claudeThrone.refreshAnthropicDefaults')
      } catch (refreshErr: any) {
        this.log.appendLine(`⚠️ Could not refresh Anthropic defaults: ${refreshErr}`)
        
        // Check if it's a settings conflict error
        if (refreshErr.message?.includes('unsaved changes') || refreshErr.message?.includes('CodeExpectedError')) {
          vscode.window.showInformationMessage(
            'Anthropic API key stored. To update model defaults, please save your VS Code settings and run "Thronekeeper: Refresh Anthropic Defaults".'
          )
        } else {
          vscode.window.showWarningMessage(
            `Anthropic API key stored, but could not refresh defaults: ${refreshErr.message}`
          )
        }
      }
      
      // Send success message to webview
      this.view?.webview.postMessage({ 
        type: 'anthropicKeyStored', 
        payload: { success: true }
      })
      
      this.log.appendLine('✅ Anthropic API key stored successfully')
    } catch (err) {
      this.log.appendLine(`❌ Failed to store Anthropic key: ${err}`)
      vscode.window.showErrorMessage(`Failed to store Anthropic API key: ${err}`)
      this.view?.webview.postMessage({ 
        type: 'anthropicKeyStored', 
        payload: { success: false, error: String(err) }
      })
    }
  }

  private async handleStartProxy() {
    try {
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      
      let customBaseUrl = undefined
      let customProviderId = undefined
      
      // Use runtimeProvider to determine which custom provider configuration to load
      const customProviders = cfg.get<any[]>('customProviders', [])
      const customProvider = customProviders.find(p => p.id === this.runtimeProvider)
      
      if (customProvider) {
        // Validate customBaseUrl and provider label for saved custom providers
        customBaseUrl = customProvider.baseUrl
        customProviderId = this.runtimeProvider
        this.log.appendLine(`[handleStartProxy] Using saved custom provider: ${customProvider.name} (${customProviderId})`)
      } else if (this.runtimeProvider === 'custom') {
        // For generic custom provider, get URL from config
        customBaseUrl = cfg.get<string>('customBaseUrl', '')
        const selectedCustomProviderId = cfg.get<string>('selectedCustomProviderId', '')
        if (selectedCustomProviderId) {
          customProviderId = selectedCustomProviderId
        }
        this.log.appendLine(`[handleStartProxy] Using generic custom provider with URL: ${customBaseUrl}`)
      }
      
      // All providers (including Deepseek, GLM, and custom Anthropic endpoints) now route through the proxy
      // The proxy handles authentication and forwards requests to the appropriate provider URL
      
      if (!this.proxy) {
        throw new Error('ProxyManager not available')
      }
      const startTime = Date.now()
      const port = cfg.get<number>('proxy.port', 3000)
      const debug = cfg.get<boolean>('proxy.debug', false)
      const twoModelMode = cfg.get<boolean>('twoModelMode', false)
      
      // Read models from provider-specific configuration with detailed logging
      const modelSelectionsByProvider = cfg.get<any>('modelSelectionsByProvider', {})
      let reasoningModel = ''
      let completionModel = ''
      let valueModel = ''
      
      this.log.appendLine(`[handleStartProxy] Reading models for provider: ${this.runtimeProvider}`)
      this.log.appendLine(`[handleStartProxy] Full modelSelectionsByProvider: ${JSON.stringify(modelSelectionsByProvider)}`)
      
      if (modelSelectionsByProvider[this.runtimeProvider]) {
        const providerModels = modelSelectionsByProvider[this.runtimeProvider]
        reasoningModel = providerModels.reasoning || ''
        // Phase 3: Use helper with deprecation warning
        completionModel = this.getCodingModelFromProvider(providerModels, this.runtimeProvider)
        valueModel = providerModels.value || ''
        
        this.log.appendLine(`[handleStartProxy] Found provider-specific models: reasoning=${reasoningModel}, completion=${completionModel}, value=${valueModel}`)
      } else {
        this.log.appendLine(`[handleStartProxy] No models found for provider ${this.runtimeProvider} in modelSelectionsByProvider`)
      }
      
      // Fallback to global keys if provider-specific not found, with explicit confirmation
      if (!reasoningModel) {
        const fallbackReasoning = cfg.get<string>('reasoningModel', '')
        if (fallbackReasoning) {
          const useFallback = await vscode.window.showWarningMessage(
            `No reasoning model selected for provider "${this.runtimeProvider}". Using global model "${fallbackReasoning}" which may be from a different provider. Continue anyway?`,
            'Continue',
            'Cancel'
          )
          
          if (useFallback !== 'Continue') {
            this.log.appendLine(`[handleStartProxy] User cancelled due to fallback requirement`)
            return
          }
          
          reasoningModel = fallbackReasoning
          this.log.appendLine(`[handleStartProxy] Falling back to global reasoningModel: ${reasoningModel}`)
          this.log.appendLine(`[handleStartProxy] WARNING: Using fallback global keys. This may indicate a configuration save issue.`)
        }
      }
      if (!completionModel) {
        const fallbackCompletion = cfg.get<string>('completionModel', '')
        if (fallbackCompletion) {
          const useFallback = await vscode.window.showWarningMessage(
            `No completion model selected for provider "${this.runtimeProvider}" in two-model mode. Using global model "${fallbackCompletion}" which may be from a different provider. Continue anyway?`,
            'Continue',
            'Cancel'
          )
          
          if (useFallback !== 'Continue') {
            this.log.appendLine(`[handleStartProxy] User cancelled due to fallback requirement`)
            return
          }
          
          completionModel = fallbackCompletion
          this.log.appendLine(`[handleStartProxy] Falling back to global completionModel: ${completionModel}`)
        }
      }
      
      if (!valueModel) {
        const fallbackValue = cfg.get<string>('valueModel', '')
        if (fallbackValue) {
          const useFallback = await vscode.window.showWarningMessage(
            `No value model selected for provider "${this.runtimeProvider}" in two-model mode. Using global model "${fallbackValue}" which may be from a different provider. Continue anyway?`,
            'Continue',
            'Cancel'
          )
          
          if (useFallback !== 'Continue') {
            this.log.appendLine(`[handleStartProxy] User cancelled due to fallback requirement`)
            return
          }
          
          valueModel = fallbackValue
          this.log.appendLine(`[handleStartProxy] Falling back to global valueModel: ${valueModel}`)
        }
      }
      
      // Log the source of each model
      const hasProviderSpecific = modelSelectionsByProvider[this.runtimeProvider] && 
                               modelSelectionsByProvider[this.runtimeProvider].reasoning
      this.log.appendLine(`[handleStartProxy] Model source - Provider-specific: ${hasProviderSpecific ? 'YES' : 'NO'}, Fallback used: ${hasProviderSpecific ? 'NO' : 'YES'}`)
      
      // Add guard: if required models are missing for the active provider, return error
      if (!reasoningModel || reasoningModel.trim() === '') {
        const errorMsg = `No reasoning model selected for provider "${this.runtimeProvider}". Please select a model before starting the proxy.`
        this.log.appendLine(`[handleStartProxy] ERROR: ${errorMsg}`)
        vscode.window.showWarningMessage(errorMsg)
        this.view?.webview.postMessage({ 
          type: 'proxyError', 
          payload: errorMsg
        })
        return
      }
      
      if (twoModelMode && (!completionModel || completionModel.trim() === '')) {
        const errorMsg = `No completion model selected for provider "${this.runtimeProvider}" in two-model mode. Please select a model before starting the proxy.`
        this.log.appendLine(`[handleStartProxy] ERROR: ${errorMsg}`)
        vscode.window.showWarningMessage(errorMsg)
        this.view?.webview.postMessage({ 
          type: 'proxyError', 
          payload: errorMsg
        })
        return
      }

      if (twoModelMode && (!valueModel || valueModel.trim() === '')) {
        const errorMsg = `No value model selected for provider "${this.runtimeProvider}" in two-model mode. Please select a model before starting the proxy.`
        this.log.appendLine(`[handleStartProxy] ERROR: ${errorMsg}`)
        vscode.window.showWarningMessage(errorMsg)
        this.view?.webview.postMessage({ 
          type: 'proxyError', 
          payload: errorMsg
        })
        return
      }
      
      // Add validation before starting proxy for stale fallback usage
      
      if (!hasProviderSpecific && reasoningModel) {
        // Check if we're using stale fallback values (e.g., GPT models for Deepseek provider)
        const isStaleCombination = 
          (this.runtimeProvider === 'deepseek' && reasoningModel.includes('gpt')) ||
          (this.runtimeProvider === 'glm' && reasoningModel.includes('gpt')) ||
          (this.runtimeProvider === 'together' && reasoningModel.includes('gpt') && !reasoningModel.includes('meta-llama')) ||
          (this.runtimeProvider === 'openrouter' && reasoningModel.startsWith('gpt-') && !completionModel)
        
        if (isStaleCombination) {
          const errorMsg = `Using stale global model "${reasoningModel}" for provider "${this.runtimeProvider}". Please re-select models for this provider.`
          this.log.appendLine(`[handleStartProxy] ERROR: ${errorMsg}`)
          vscode.window.showWarningMessage(errorMsg)
          this.view?.webview.postMessage({ 
            type: 'proxyError', 
            payload: errorMsg
          })
          return
        }
      }

      // Log model configuration
      this.log.appendLine(`[handleStartProxy] Models configured for provider "${this.runtimeProvider}":`)
      this.log.appendLine(`[handleStartProxy] - reasoningModel: ${reasoningModel}`)
      if (completionModel) {
        this.log.appendLine(`[handleStartProxy] - completionModel: ${completionModel}`)
      }
      
      // Log the final models that will be used
      const reasoningSource = hasProviderSpecific ? 'from provider-specific config' : 'from global fallback'
      const completionSource = hasProviderSpecific ? 'from provider-specific config' : 'from global fallback'
      this.log.appendLine(`[handleStartProxy] Final models for proxy start:`)
      this.log.appendLine(`[handleStartProxy] - reasoning=${reasoningModel} (${reasoningSource})`)
      if (completionModel) {
        this.log.appendLine(`[handleStartProxy] - completion=${completionModel} (${completionSource})`)
      }
      
      this.log.appendLine(`[handleStartProxy] Starting proxy: provider=${this.runtimeProvider}, port=${port}, twoModelMode=${twoModelMode}`)
      this.log.appendLine(`[handleStartProxy] Models: reasoning=${reasoningModel || 'NOT SET'}, completion=${completionModel || 'NOT SET'}`)
      if (customBaseUrl) {
        this.log.appendLine(`[handleStartProxy] Custom Base URL: ${customBaseUrl}`)
      }
      if (customProviderId) {
        this.log.appendLine(`[handleStartProxy] Custom Provider ID: ${customProviderId}`)
      }
      this.log.appendLine(`[handleStartProxy] Timestamp: ${new Date().toISOString()}`)
      
      // Hydrate global keys with current provider's models before starting
      // This ensures applyToClaudeCode reads the correct models when it runs
      this.log.appendLine(`[handleStartProxy] Hydrating global keys for ${this.runtimeProvider} before apply`)
      
      const applyScope = cfg.get<string>('applyScope', 'workspace')
      const target = applyScope === 'global' 
        ? vscode.ConfigurationTarget.Global 
        : vscode.ConfigurationTarget.Workspace
      
      try {
        await cfg.update('reasoningModel', reasoningModel, target)
        this.log.appendLine(`[handleStartProxy] Updated global reasoningModel: ${reasoningModel}`)
        
        if (twoModelMode && completionModel) {
          await cfg.update('completionModel', completionModel, target)
          this.log.appendLine(`[handleStartProxy] Updated global completionModel: ${completionModel}`)
        }
        
        if (twoModelMode && valueModel) {
          await cfg.update('valueModel', valueModel, target)
          this.log.appendLine(`[handleStartProxy] Updated global valueModel: ${valueModel}`)
        }
        
        this.log.appendLine(`[handleStartProxy] ✅ Global keys hydrated for provider ${this.runtimeProvider}`)
      } catch (err) {
        this.log.appendLine(`[handleStartProxy] ⚠️ WARNING: Failed to hydrate global keys: ${err}`)
        // Continue anyway - proxy can still start, but apply might use stale values
      }
      
      // Determine the provider to pass to proxy.start
      let proxyProvider = this.runtimeProvider
      if (customProvider) {
        // For saved custom providers, pass 'custom' as provider and customProviderId separately
        proxyProvider = 'custom'
      }
      
      await this.proxy.start({
        provider: proxyProvider,
        port,
        debug,
        reasoningModel,
        completionModel,
        ...(customBaseUrl && { customBaseUrl }),
        ...(customProviderId && { customProviderId })
      })
      
      const elapsed = Date.now() - startTime
      this.log.appendLine(`[handleStartProxy] Proxy started successfully in ${elapsed}ms`)
      
      vscode.window.showInformationMessage(`Proxy started on port ${port}`)
      this.postStatus()
      
      // Apply settings to Claude Code if autoApply is enabled
      const autoApply = cfg.get<boolean>('autoApply', true)
      if (autoApply) {
        this.log.appendLine(`[handleStartProxy] autoApply enabled, applying proxy settings to Claude Code...`)
        // Wait a moment for proxy to fully initialize and start accepting connections
        await new Promise(resolve => setTimeout(resolve, 1000))
        await vscode.commands.executeCommand('claudeThrone.applyToClaudeCode')
      } else {
        this.log.appendLine(`[handleStartProxy] autoApply disabled, skipping automatic configuration`)
        this.log.appendLine(`[handleStartProxy] Run "Claude Throne: Apply to Claude Code" command manually to configure`)
      }
    } catch (err) {
      this.log.appendLine(`[handleStartProxy] Error: ${err}`)
      console.error('Failed to start proxy:', err)
      vscode.window.showErrorMessage(`Failed to start proxy: ${err}`)
      this.view?.webview.postMessage({ 
        type: 'proxyError', 
        payload: String(err)
      })
    }
  }





  private async handleStopProxy() {
    try {
      if (!this.proxy) {
        throw new Error('ProxyManager not available')
      }
      await this.proxy.stop()
      
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const autoApply = cfg.get<boolean>('autoApply', true)
      if (autoApply) {
        await vscode.commands.executeCommand('claudeThrone.revertApply', { autoSelectFirstFolder: true })
      }
      
      // Don't clear models cache - let it expire naturally (5 minutes TTL)
      // this.modelsCache.clear()
      
      // Don't send empty models to webview - preserve current selections
      // this.view?.webview.postMessage({ type: 'models', payload: { models: [] } })
      
      // Send config without clearing models - model selections should persist in modelSelectionsByProvider
      this.postConfig()
      this.postStatus()
      
      this.log.appendLine(`[handleStopProxy] Proxy stopped, model selections preserved in modelSelectionsByProvider`)
      
      if (autoApply) {
        vscode.window.showInformationMessage('Proxy stopped and Claude Code settings reverted')
      }
    } catch (err) {
      console.error('Failed to stop proxy:', err)
      this.log.appendLine(`[handleStopProxy] Error: ${err}`)
      vscode.window.showErrorMessage(`Failed to stop proxy: ${err}`)
    }
  }

  private async handleRevertApply() {
    try {
      this.log.appendLine('[handleRevertApply] Reverting Claude Code settings to Anthropic defaults')
      await vscode.commands.executeCommand('claudeThrone.revertApply', { autoSelectFirstFolder: true })
      this.postStatus()
      vscode.window.showInformationMessage('Reverted Claude Code settings to Anthropic defaults')
    } catch (err: any) {
      this.log.appendLine(`[handleRevertApply] Error: ${err}`)
      
      // Handle specific configuration errors
      if (err?.message?.includes('not a registered configuration') || err?.name === 'CodeExpectedError') {
        const action = await vscode.window.showWarningMessage(
          'Configuration error during revert. Some settings may not be available. Try checking configuration health.',
          'Check Config Health',
          'Reload VS Code'
        );
        
        if (action === 'Check Config Health') {
          await vscode.commands.executeCommand('claudeThrone.checkConfigHealth');
        } else if (action === 'Reload VS Code') {
          vscode.commands.executeCommand('workbench.action.reloadWindow');
        }
      } else {
        vscode.window.showErrorMessage(`Failed to revert settings: ${err?.message || err}`)
      }
    }
  }

  private async handleSaveModels(data: any): Promise<void> {
    try {
      const { providerId, reasoning, coding, value } = data
      
      // Update runtime provider to match what we're saving to keep them in sync
      if (providerId && providerId !== this.currentProvider) {
        this.log.appendLine(`[handleSaveModels] Updating currentProvider from ${this.currentProvider} to ${providerId}`)
        this.currentProvider = providerId
      }
      
      // Comment 6: Add targeted logs around save round-trip to verify persistence and provider alignment
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const applyScope = cfg.get<string>('applyScope', 'workspace')
      const target = applyScope === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
      
      this.log.appendLine(`[handleSaveModels] Save round-trip - providerId: ${providerId}, target: ${vscode.ConfigurationTarget[target]}, models: { reasoning: ${reasoning}, coding: ${coding}, value: ${value} }`)

      this.log.appendLine(`[handleSaveModels] Using config target: ${vscode.ConfigurationTarget[target]} (applyScope: ${applyScope})`)
      
      // Preflight-check registration of modelSelectionsByProvider
      const insp = cfg.inspect('modelSelectionsByProvider')
      if (insp && insp.defaultValue !== undefined) {
        // Key is registered - update provider-specific configuration
        const modelSelectionsByProvider = cfg.get<any>('modelSelectionsByProvider', {})
        if (!modelSelectionsByProvider[providerId]) {
          modelSelectionsByProvider[providerId] = {}
        }
        
        modelSelectionsByProvider[providerId].reasoning = reasoning
        modelSelectionsByProvider[providerId].completion = coding
        modelSelectionsByProvider[providerId].value = value
        
        await cfg.update('modelSelectionsByProvider', modelSelectionsByProvider, target)
        this.log.appendLine(`[handleSaveModels] Successfully saved modelSelectionsByProvider for provider: ${providerId} to ${vscode.ConfigurationTarget[target]}`)
      } else {
        // Key not registered - log warning and skip provider map write
        this.log.appendLine(`[handleSaveModels] WARNING: modelSelectionsByProvider key not registered, skipping provider map write`)
        this.log.appendLine(`[handleSaveModels] INFO: Write to modelSelectionsByProvider skipped due to missing registration. Only individual keys will be updated.`)
        this.log.appendLine(`[handleSaveModels] ADVICE: Reload window or reinstall extension build to enable provider map functionality.`)
      }
      
      // Always save to individual keys for backward compatibility
      try {
        await cfg.update('reasoningModel', reasoning, target)
        this.log.appendLine(`[handleSaveModels] Successfully saved reasoningModel: ${reasoning} to ${vscode.ConfigurationTarget[target]}`)
      } catch (err: any) {
        this.log.appendLine(`[handleSaveModels] ERROR saving reasoningModel: ${err.message}`)
        vscode.window.showErrorMessage(`Failed to save reasoningModel: ${err.message}`)
      }
      
      try {
        await cfg.update('completionModel', coding, target)
        this.log.appendLine(`[handleSaveModels] Successfully saved completionModel: ${coding} to ${vscode.ConfigurationTarget[target]}`)
      } catch (err: any) {
        this.log.appendLine(`[handleSaveModels] ERROR saving completionModel: ${err.message}`)
        vscode.window.showErrorMessage(`Failed to save completionModel: ${err.message}`)
      }
      
      try {
        await cfg.update('valueModel', value, target)
        this.log.appendLine(`[handleSaveModels] Successfully saved valueModel: ${value} to ${vscode.ConfigurationTarget[target]}`)
      } catch (err: any) {
        this.log.appendLine(`[handleSaveModels] ERROR saving valueModel: ${err.message}`)
        vscode.window.showErrorMessage(`Failed to save valueModel: ${err.message}`)
      }
      
      this.log.appendLine(`[handleSaveModels] Models saved successfully for provider: ${providerId}`)
      
      // Verification: read back the saved value to confirm it was persisted
      try {
        const verification = cfg.get<any>('modelSelectionsByProvider', {})
        this.log.appendLine(`[handleSaveModels] Verification - modelSelectionsByProvider after save: ${JSON.stringify(verification)}`)
        if (verification[providerId]) {
          const saved = verification[providerId]
          if (saved.reasoning === reasoning && saved.completion === coding && saved.value === value) {
            this.log.appendLine(`[handleSaveModels] Verification passed - models correctly saved`)
          } else {
            this.log.appendLine(`[handleSaveModels] WARNING - Verification failed. Expected: reasoning=${reasoning}, coding=${coding}, value=${value}. Got: ${JSON.stringify(saved)}`)
          }
        } else {
          this.log.appendLine(`[handleSaveModels] WARNING - No saved data found for provider ${providerId} after save`)
        }
      } catch (verr: any) {
        this.log.appendLine(`[handleSaveModels] ERROR during verification: ${verr.message}`)
      }
      
      // Immediately send updated config back to webview to confirm save
      this.postConfig()
      
      // Always send modelsSaved confirmation to webview
      // This ensures handleModelsSaved() is called and UI updates correctly
      const configProvider = this.configProvider
      const runtimeProvider = this.runtimeProvider
      const scopeUsed = applyScope
      
      this.log.appendLine(`[handleSaveModels] Provider state - providerId: ${providerId}, runtimeProvider: ${runtimeProvider}, configProvider: ${configProvider}, scope: ${scopeUsed}`)
      
      // Send modelsSaved message regardless of provider type
      // Critical: Custom providers have runtimeProvider != configProvider (e.g., "moonshot" vs "custom")
      // but they still need the modelsSaved message to trigger UI updates
      this.log.appendLine(`[handleSaveModels] Sending modelsSaved confirmation to webview for provider: ${providerId}`)
      
      this.view?.webview.postMessage({
        type: 'modelsSaved',
        payload: {
          providerId: providerId,
          success: true,
          scope: scopeUsed,
          runtimeProvider,
          configProvider
        }
      })
    } catch (err) {
      this.log.appendLine(`[handleSaveModels] Unexpected error: ${err}`)
      console.error('Failed to save models:', err)
      vscode.window.showErrorMessage(`Unexpected error saving models: ${err}`)
    }
  }

  private async handleFilterModels(filter: any) {
    // Handle model filtering based on search and sort parameters
    // Implementation depends on existing model data
  }

  private async handleSetModelFromList(modelId: string, modelType: 'reasoning' | 'coding' | 'value') {
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    
    // Determine configuration target based on applyScope setting
    const applyScope = cfg.get<string>('applyScope', 'workspace')
    const target = applyScope === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace
    
    this.log.appendLine(`[handleSetModelFromList] Using config target: ${vscode.ConfigurationTarget[target]} (applyScope: ${applyScope})`)
    
    // Preflight-check registration of modelSelectionsByProvider
    const insp = cfg.inspect('modelSelectionsByProvider')
    if (insp && insp.defaultValue !== undefined) {
      // Key is registered - update provider-specific configuration
      const modelSelectionsByProvider = cfg.get<any>('modelSelectionsByProvider', {})
      if (!modelSelectionsByProvider[this.runtimeProvider]) {
        modelSelectionsByProvider[this.runtimeProvider] = {}
      }
      
      if (modelType === 'reasoning') {
        // Update both provider-specific and global configs
        modelSelectionsByProvider[this.runtimeProvider].reasoning = modelId
        await cfg.update('modelSelectionsByProvider', modelSelectionsByProvider, target)
        await cfg.update('reasoningModel', modelId, target)
        this.log.appendLine(`[handleSetModelFromList] Saved reasoning model: ${modelId} to ${vscode.ConfigurationTarget[target]}`)
      } else if (modelType === 'coding') {
        // Update both provider-specific and global configs
        modelSelectionsByProvider[this.runtimeProvider].completion = modelId
        await cfg.update('modelSelectionsByProvider', modelSelectionsByProvider, target)
        await cfg.update('completionModel', modelId, target)
        this.log.appendLine(`[handleSetModelFromList] Saved coding model: ${modelId} to ${vscode.ConfigurationTarget[target]}`)
      } else if (modelType === 'value') {
        // Update both provider-specific and global configs
        modelSelectionsByProvider[this.runtimeProvider].value = modelId
        await cfg.update('modelSelectionsByProvider', modelSelectionsByProvider, target)
        await cfg.update('valueModel', modelId, target)
        this.log.appendLine(`[handleSetModelFromList] Saved value model: ${modelId} to ${vscode.ConfigurationTarget[target]}`)
      }
    } else {
      // Key not registered - log warning and skip provider map write
      this.log.appendLine(`[handleSetModelFromList] WARNING: modelSelectionsByProvider key not registered, skipping provider map write`)
      this.log.appendLine(`[handleSetModelFromList] INFO: Write to modelSelectionsByProvider skipped due to missing registration. Only individual keys will be updated.`)
      this.log.appendLine(`[handleSetModelFromList] ADVICE: Reload window or reinstall extension build to enable provider map functionality.`)
      
      // Only update individual keys
      if (modelType === 'reasoning') {
        await cfg.update('reasoningModel', modelId, target)
        this.log.appendLine(`[handleSetModelFromList] Saved reasoning model: ${modelId} to ${vscode.ConfigurationTarget[target]}`)
      } else if (modelType === 'coding') {
        await cfg.update('completionModel', modelId, target)
        this.log.appendLine(`[handleSetModelFromList] Saved coding model: ${modelId} to ${vscode.ConfigurationTarget[target]}`)
      } else if (modelType === 'value') {
        await cfg.update('valueModel', modelId, target)
        this.log.appendLine(`[handleSetModelFromList] Saved value model: ${modelId} to ${vscode.ConfigurationTarget[target]}`)
      }
    }
    this.postConfig()
  }

  private async handleToggleTwoModelMode(enabled: boolean) {
    // Store the two-model mode preference
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const reasoningModel = cfg.get<string>('reasoningModel')
    const completionModel = cfg.get<string>('completionModel')
    
    this.log.appendLine(`[handleToggleTwoModelMode] Two-model mode ${enabled ? 'enabled' : 'disabled'}`)
    this.log.appendLine(`[handleToggleTwoModelMode] Current models: reasoning=${reasoningModel}, completion=${completionModel}`)
    
    await cfg.update('twoModelMode', enabled, vscode.ConfigurationTarget.Workspace)
    
    this.log.appendLine(`[handleToggleTwoModelMode] Config updated successfully`)
  }

  private async handleUpdateDebug(enabled: boolean) {
    this.log.appendLine(`[handleUpdateDebug] Debug ${enabled ? 'enabled' : 'disabled'}`)
    
    await vscode.workspace.getConfiguration('claudeThrone').update(
      'proxy.debug', 
      enabled, 
      vscode.ConfigurationTarget.Workspace
    )
    
    this.log.appendLine(`[handleUpdateDebug] Debug setting updated successfully`)
  }

  private getHtml(): string {
    const nonce = String(Math.random()).slice(2)
    const cssUri = this.view!.webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, 'webview', 'main.css')
    )
    const jsUri = this.view!.webview.asWebviewUri(
      vscode.Uri.joinPath(this.ctx.extensionUri, 'webview', 'main.js')
    )
    
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.view!.webview.cspSource}; script-src 'nonce-${nonce}' ${this.view!.webview.cspSource}; connect-src ${this.view!.webview.cspSource} https:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Thronekeeper</title>
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div class="container">
    <header class="header">
      <h1 class="header-title">Thronekeeper</h1>
      <p class="header-subtitle">Configure and launch your local proxy for AI code completion.</p>
    </header>

    <main class="main-content">
      <div class="content-grid">
        <!-- Provider Configuration Card -->
        <div class="card">
          <h2 class="card-title">Provider</h2>
          
          <div class="form-group">
            <select class="form-select" id="providerSelect">
              <!-- Built-in providers will be populated dynamically -->
            </select>
            <div id="providerHelp" class="provider-help"></div>
          </div>

          <div id="customProviderNameSection" class="form-group" style="display: none;">
            <label class="form-label">Provider Name</label>
            <input class="form-input" type="text" id="customProviderNameInput" placeholder="e.g., My Custom API">
            <p style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px;">This name will appear in the provider dropdown.</p>
          </div>
          
          <div id="customUrlSection" class="custom-url-section">
            <div class="form-group">
              <label class="form-label" for="customUrl">Custom Endpoint URL</label>
              <div class="input-group">
                <input class="form-input" type="text" id="customUrl" placeholder="https://api.example.com/v1">
                <button class="input-group-btn" id="deleteCustomProviderBtn" type="button" title="Delete Custom Provider" style="display: none;">
                  <span>×</span>
                </button>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="apiKeyInput">API Key</label>
            <div class="input-group">
              <input class="form-input" type="password" id="apiKeyInput" placeholder="Enter your API key">
              <button class="input-group-btn" id="showKeyBtn" type="button" title="Toggle visibility">
                <span id="keyIcon">👁</span>
              </button>
            </div>
            <button class="btn-primary" id="storeKeyBtn" type="button" style="margin-top: 8px; width: 100%;">Store Key</button>
            <div class="security-note">🔒 Keys are stored securely in your system keychain</div>
          </div>

          <div class="form-group">
            <label class="form-label">Model Selection</label>
            
            <div class="two-model-toggle">
              <input type="checkbox" id="twoModelToggle">
              <label for="twoModelToggle">Use separate models for different task types (Reasoning/Coding/Value)</label>
            </div>
            
            <div id="selectedModelsDisplay" class="selected-models-display" style="margin-top: 12px; font-size: 11px; color: var(--vscode-descriptionForeground);">
              <div id="reasoningModelDisplay" style="margin-bottom: 4px;"></div>
              <div id="codingModelDisplay" style="margin-bottom: 4px;"></div>
              <div id="valueModelDisplay"></div>
            </div>
          </div>
        </div>

        <!-- Save Combo Button -->
        <button class="btn-save-combo hidden" id="saveComboBtn" title="Save current model selection" style="margin-bottom: 16px;">+ Save Model Combo</button>

        <!-- Popular Combos Card (OpenRouter only) -->
        <div id="popularCombosCard" class="card popular-combos-card">
          <div class="combos-header">
            <h2 class="card-title">Popular Combos</h2>
          </div>
          <div id="combosGrid" class="combos-grid">
            <div class="loading-container">
              <span class="loading-spinner"></span>Loading combos...
            </div>
          </div>
        </div>

        <!-- Advanced Settings Card -->
        <details class="card advanced-settings">
          <summary>Advanced Settings</summary>
          <div class="advanced-content">
            <div class="form-group">
              <label class="form-label" for="portInput">Proxy Port</label>
              <input class="form-input" type="number" id="portInput" value="3000" min="1000" max="65535">
            </div>
            <div class="form-group">
              <label class="form-label" for="anthropicKeyInput">Anthropic API Key (Optional)</label>
              <p style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-bottom: 8px;">Used to fetch the latest Claude models when reverting to defaults. Leave empty to use cached model versions.</p>
              <div class="input-group">
                <input class="form-input" type="password" id="anthropicKeyInput" placeholder="sk-ant-...">
                <button class="input-group-btn" id="showAnthropicKeyBtn" type="button" title="Toggle visibility">
                  <span id="anthropicKeyIcon">👁</span>
                </button>
              </div>
              <button class="btn-primary" id="storeAnthropicKeyBtn" type="button" style="margin-top: 8px; width: 100%;">Store Anthropic Key</button>
              <div class="security-note">🔒 Stored securely in your system keychain</div>
              <div id="anthropicCacheContainer" class="form-group" style="display: none;"></div>
              <button class="btn-add-custom-provider" id="addCustomProviderBtn" type="button" style="display: none;">+ Add Custom Provider</button>
            </div>
            <div class="form-group">
              <label style="display: flex; align-items: center; gap: 8px; cursor: pointer;">
                <input type="checkbox" id="debugCheckbox">
                <span style="font-size: 12px;">Enable debug logging</span>
              </label>
            </div>
          </div>
        </details>

        <!-- Model List Card -->
        <div class="card model-list-card">
          <h2 class="card-title">Filter Models</h2>
          
          <div class="model-list-header">
            <input class="model-search" type="text" id="modelSearch" placeholder="Filter models...">
          </div>

          <div id="modelListContainer" class="model-list">
            <div class="loading-container">
              <span class="loading-spinner"></span>Loading models...
            </div>
          </div>
        </div>
      </div>
    </main>

    <footer class="footer">
      <div class="footer-left">
        <button class="settings-btn" id="settingsBtn" type="button" title="Open Thronekeeper Settings">⚙️</button>
        <a href="https://github.com/KHAEntertainment/thronekeeper" class="repo-link" id="repoLink" title="View on GitHub">GitHub ↗</a>
        <div class="status-text">
          Status: <strong id="statusText" class="status-stopped">Idle</strong>
        </div>
      </div>
      <div class="footer-right">
        <button class="btn-primary" id="startProxyBtn">Start Proxy</button>
        <button class="btn-primary btn-danger hidden" id="stopProxyBtn">Stop Proxy</button>
      </div>
    </footer>
  </div>

  <script nonce="${nonce}">
    // Bootstrap script - runs immediately to set up message handling
    (function() {
      console.log('[BOOTSTRAP] Starting Thronekeeper webview...');
      
      // Acquire VS Code API immediately
      const vscode = acquireVsCodeApi();
      console.log('[BOOTSTRAP] VS Code API acquired:', !!vscode);
      
      // Set up message listener BEFORE anything else
      window.addEventListener('message', (event) => {
        console.log('[BOOTSTRAP] Received message:', event.data.type, event.data);
      });
      
      // Make vscode API globally available
      window.vscodeApi = vscode;
      
      console.log('[BOOTSTRAP] Message listener registered, waiting for main script...');
    })();
  </script>
  <script nonce="${nonce}" src="${jsUri}"></script>
</body>
</html>`
  }
}
