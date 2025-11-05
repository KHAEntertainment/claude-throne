import * as vscode from 'vscode'
import { SecretsService } from '../services/Secrets'
import { ProxyManager } from '../services/ProxyManager'
import { listModels, type ProviderId } from '../services/Models'
// Comment 2: Import schema validation for runtime message validation
import { safeValidateMessage, normalizeMessageType, type ExtensionToWebviewMessage } from '../schemas/messages'

export class PanelViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private currentProvider: string = 'openrouter' // Runtime source of truth for current provider selection
  private modelsCache: Map<string, { models: any[], timestamp: number }> = new Map()
  // Comment 4: Sequence token tracking for race protection
  private sequenceTokenCounter: number = 0
  private currentSequenceToken: number | null = null
  // Comment 6: Trace ID for provider flows (DEBUG mode only)
  private currentTraceId: string | null = null

  /**
   * Determines the appropriate ConfigurationTarget based on applyScope setting and workspace availability.
   * Falls back to Global if workspace is requested but no workspace is open.
   */
  private getConfigurationTarget(applyScope: string = 'workspace'): vscode.ConfigurationTarget {
    if (applyScope === 'global') {
      return vscode.ConfigurationTarget.Global
    }
    // Check if workspace is available before using Workspace target
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      return vscode.ConfigurationTarget.Workspace
    }
    // Fall back to Global if no workspace is open
    this.log.appendLine('[getConfigurationTarget] No workspace open, falling back to Global settings')
    return vscode.ConfigurationTarget.Global
  }

  /**
   * Comment 3: Normalize provider map to canonical keys { reasoning, completion, value }
   * Remaps any incoming provider model objects to the canonical format
   * Adds runtime assertion in development to fail fast if unexpected keys are present
   */
  private normalizeProviderMap(providerModels: any, providerId: string): {
    reasoning: string
    completion: string
    value: string
  } {
    if (!providerModels || typeof providerModels !== 'object') {
      return { reasoning: '', completion: '', value: '' }
    }
    
    // Comment 3: Runtime assertion in development to fail fast if unexpected keys are present
    const canonicalKeys = ['reasoning', 'completion', 'value']
    const legacyKeys = ['coding'] // Legacy key that we still accept but normalize
    const allowedKeys = [...canonicalKeys, ...legacyKeys]
    const unexpectedKeys = Object.keys(providerModels).filter(
      key => !allowedKeys.includes(key) && providerModels[key] !== undefined && providerModels[key] !== null
    )
    
    if (unexpectedKeys.length > 0 && process.env.NODE_ENV !== 'production') {
      const warning = `[Provider Map Validation] Provider '${providerId}' has unexpected keys: ${unexpectedKeys.join(', ')}. Expected only: ${canonicalKeys.join(', ')}`
      this.log.appendLine(warning)
      console.warn(warning)
    }
    
    // Normalize to canonical keys
    const normalized = {
      reasoning: String(providerModels.reasoning || ''),
      completion: String(providerModels.completion || providerModels.coding || ''), // Fallback to legacy 'coding'
      value: String(providerModels.value || '')
    }
    
    // Emit deprecation warning if using legacy 'coding' key
    if (!providerModels.completion && providerModels.coding) {
      this.log.appendLine(`[DEPRECATION] Provider '${providerId}' uses legacy 'coding' key. Migrating to 'completion' on next save.`)
    }
    
    return normalized
  }

  /**
   * Phase 3: Helper to get completion model with deprecation warning
   * Reads from 'completion' key first, falls back to legacy 'coding' key
   * Emits deprecation warning when falling back to 'coding'
   * @deprecated Use normalizeProviderMap instead for full normalization
   */
  private getCodingModelFromProvider(providerModels: any, providerId: string): string {
    const normalized = this.normalizeProviderMap(providerModels, providerId)
    return normalized.completion
  }

  /**
   * Phase 4: Hydrate global keys from provider-specific configuration
   * This ensures applyToClaudeCode reads the correct models for the active provider
   * 
   * @param providerId - Active provider ID
   * @param reasoningModel - Reasoning model to hydrate
   * @param completionModel - Completion model to hydrate
   * @param valueModel - Value model to hydrate
   * @param twoModelMode - Whether three-model mode is enabled
   * @returns Success status
   */
  private async hydrateGlobalKeysFromProvider(
    providerId: string,
    reasoningModel: string,
    completionModel: string,
    valueModel: string,
    twoModelMode: boolean
  ): Promise<boolean> {
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const applyScope = cfg.get<string>('applyScope', 'workspace')
    const target = this.getConfigurationTarget(applyScope)

    this.log.appendLine(`[hydrateGlobalKeys] BEFORE hydration for provider '${providerId}':`)
    this.log.appendLine(`[hydrateGlobalKeys]   - target: ${vscode.ConfigurationTarget[target]} (${applyScope})`)
    this.log.appendLine(`[hydrateGlobalKeys]   - reasoning: ${cfg.get('reasoningModel') || 'NOT SET'} → ${reasoningModel}`)
    this.log.appendLine(`[hydrateGlobalKeys]   - completion: ${cfg.get('completionModel') || 'NOT SET'} → ${completionModel || 'N/A'}`)
    this.log.appendLine(`[hydrateGlobalKeys]   - value: ${cfg.get('valueModel') || 'NOT SET'} → ${valueModel || 'N/A'}`)

    try {
      // Phase 4: Atomic hydration - update all keys or none
      await cfg.update('reasoningModel', reasoningModel, target)
      this.log.appendLine(`[hydrateGlobalKeys] ✅ Updated reasoningModel: ${reasoningModel}`)
      
      // Comment 4: Always update completion/value when non-empty, independent of twoModelMode
      if (completionModel) {
        await cfg.update('completionModel', completionModel, target)
        this.log.appendLine(`[hydrateGlobalKeys] ✅ Updated completionModel: ${completionModel}`)
      }
      
      if (valueModel) {
        await cfg.update('valueModel', valueModel, target)
        this.log.appendLine(`[hydrateGlobalKeys] ✅ Updated valueModel: ${valueModel}`)
      }
      
      this.log.appendLine(`[hydrateGlobalKeys] AFTER hydration - verification:`)
      this.log.appendLine(`[hydrateGlobalKeys]   - reasoning: ${cfg.get('reasoningModel')}`)
      if (twoModelMode) {
        this.log.appendLine(`[hydrateGlobalKeys]   - completion: ${cfg.get('completionModel')}`)
        this.log.appendLine(`[hydrateGlobalKeys]   - value: ${cfg.get('valueModel')}`)
      }
      
      this.log.appendLine(`[hydrateGlobalKeys] ✅ Global keys successfully hydrated for provider '${providerId}'`)
      return true
    } catch (err) {
      this.log.appendLine(`[hydrateGlobalKeys] ❌ ERROR: Failed to hydrate global keys: ${err}`)
      this.log.appendLine(`[hydrateGlobalKeys] WARNING: Proxy will start, but applyToClaudeCode may use stale values`)
      return false
    }
  }

  /**
   * Comment 2: Safe message posting with schema validation
   * Validates messages against ExtensionToWebviewMessageSchema before sending
   * 
   * @param message - Message to validate and post
   * @returns true if posted successfully, false if validation failed
   */
  private post(message: unknown): boolean {
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const featureFlags = cfg.get<any>('featureFlags', {})
    const enableValidation = (featureFlags.enableSchemaValidation !== false && featureFlags.enableSchemaValidation !== undefined) ? true : false // Default to enabled
    
    if (!enableValidation) {
      // Feature flag disabled - bypass validation
      this.view?.webview.postMessage(message)
      return true
    }
    
    // Validate message against schema
    const validated = safeValidateMessage(message, 'toWebview', (msg) => {
      this.log.appendLine(`[Schema Validation] ${msg}`)
    })
    
    if (validated === null) {
      this.log.appendLine(`[Schema Validation] REJECTED invalid message: ${JSON.stringify(message)}`)
      return false
    }
    
    // Validation passed - send message
    this.view?.webview.postMessage(validated)
    return true
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
      await vscode.commands.executeCommand('workbench.view.openView', 'claudeThrone.activity', true)
    } catch {
      vscode.window.showInformationMessage('Open the Thronekeeper view from the Activity Bar sidebar.')
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
      
      // Comment 8: Validate incoming messages against schemas
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const featureFlags = cfg.get<any>('featureFlags', {})
      const enableValidation = (featureFlags.enableSchemaValidation !== false && featureFlags.enableSchemaValidation !== undefined) ? true : false
      
      if (enableValidation) {
        // Comment 3: Normalize legacy message types before validation
        const normalized = normalizeMessageType(msg)
        
        const validated = safeValidateMessage(normalized, 'toExtension', (validationMsg) => {
          this.log.appendLine(`[Schema Validation] ${validationMsg}`)
        })
        
        if (validated === null) {
          this.log.appendLine(`[Schema Validation] REJECTED invalid message from webview: ${JSON.stringify(msg)}`)
          return // Don't process invalid messages
        }
        
        // Use validated message
        msg = validated as any
      }
      
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
            // Route Anthropic keys to dedicated handler, other providers to generic handler
            if (msg.provider === 'anthropic') {
              await this.handleStoreAnthropicKey(msg.key)
            } else {
              await this.handleStoreKey(msg.provider, msg.key)
              // Comment 1: After storing keys, refresh keys status and re-run model list
              await this.postKeys()
              await this.handleListModels(false)
            }
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
            // Comment 5: Accept 'completion' instead of 'coding' (canonical key)
            await this.handleSaveModels({providerId: msg.providerId, reasoning: msg.reasoning, completion: msg.completion, value: msg.value})
            break
          case 'setModelFromList':
            await this.handleSetModelFromList(msg.modelId, msg.modelType)
            break
          case 'toggleThreeModelMode':
            // Comment 3: Handle canonical toggleThreeModelMode message
            await this.handleToggleTwoModelMode(msg.enabled)
            break
          case 'toggleTwoModelMode':
            // Comment 3: Handle legacy toggleTwoModelMode message for backward compatibility
            this.log.appendLine('[Deprecation] toggleTwoModelMode is deprecated, use toggleThreeModelMode')
            await this.handleToggleTwoModelMode(msg.enabled)
            break
          case 'toggleOpusPlan':
            await this.handleOpusPlanToggle(msg.enabled)
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
            await this.handleSaveCombo(msg.name, msg.reasoningModel, msg.codingModel, msg.valueModel, msg.providerId)
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
          case 'updateEndpointKind':
            // Comment 3: Handle endpoint kind update for custom provider
            await this.handleUpdateEndpointKind(msg.baseUrl, msg.endpointKind)
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
      // Comment 3: Normalize provider map before reading
      const normalized = this.normalizeProviderMap(modelSelectionsByProvider[this.runtimeProvider], this.runtimeProvider)
      reasoningModel = normalized.reasoning
      completionModel = normalized.completion
      valueModel = normalized.value
    }
    
    // Fallback to global keys if provider-specific not found
    if (!reasoningModel) reasoningModel = String(cfg.get('reasoningModel') || '')
    if (!completionModel) completionModel = String(cfg.get('completionModel') || '')
    if (!valueModel) valueModel = String(cfg.get('valueModel') || '')
    
    this.post({ 
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
      
      // Send keysLoaded message (canonical format)
      this.post({ 
        type: 'keysLoaded', 
        payload: { keyStatus } 
      })
      
    } catch (err) {
      this.log.appendLine(`[postKeys] ERROR: ${err}`)
      // Send empty status on error
      this.post({ 
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
    const opusPlanMode = config.get<boolean>('opusPlanMode', false);
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
    
    // Comment 19: Read feature flags to send to webview
    const featureFlags = config.get<any>('featureFlags', {
      enableSchemaValidation: true,
      enableTokenValidation: true,
      enableKeyNormalization: true,
      enablePreApplyHydration: true
    });
    
    this.post({
      type: 'config',
      payload: { 
        provider, 
        selectedCustomProviderId, 
        twoModelMode, 
        opusPlanMode,
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
        valueModel,
        // Comment 19: Send feature flags to webview
        featureFlags
      }
    });
  }

  private async postModels() {
    // Use runtimeProvider for UI operations
    const provider = this.runtimeProvider || 'openrouter'
    const CACHE_TTL_MS = 5 * 60 * 1000
    const cached = this.modelsCache.get(provider)
    
    // Comment 2: Generate sequence token for postModels to ensure validation uniform
    this.sequenceTokenCounter++
    const sequenceToken = `seq-${this.sequenceTokenCounter}`
    this.currentSequenceToken = this.sequenceTokenCounter
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      this.post({ 
        type: 'models', 
        payload: { models: cached.models, provider, token: sequenceToken } 
      })
    } else {
      this.post({ type: 'models', payload: { models: [], provider, token: sequenceToken } })
    }
  }

  private async handleListModels(freeOnly: boolean, requestToken?: string) {
    // Use runtimeProvider for UI operations - this represents the actual provider being used
    const provider = this.runtimeProvider || 'openrouter'
    
    // Comment 4: Generate sequence token if not provided, increment counter
    let sequenceToken: string
    if (requestToken) {
      sequenceToken = requestToken
      // Extract sequence number from requestToken to keep currentSequenceToken in sync
      const requestSequenceNum = requestToken.startsWith('seq-') 
        ? parseInt(requestToken.replace('seq-', ''), 10) 
        : null
      this.currentSequenceToken = requestSequenceNum !== null ? requestSequenceNum : this.sequenceTokenCounter
    } else {
      this.sequenceTokenCounter++
      sequenceToken = `seq-${this.sequenceTokenCounter}`
      this.currentSequenceToken = this.sequenceTokenCounter
    }
    
    // Comment 6: Include trace ID in logs (DEBUG mode only)
    const traceInfo = this.currentTraceId ? ` [Trace ${this.currentTraceId}]` : ''
    this.log.appendLine(`📋 Loading models for provider: ${provider}, sequence token: ${sequenceToken}${traceInfo}`)
    
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const debugMode = cfg.get<boolean>('proxy.debug', false)

    // Removed bypass for Deepseek/GLM to allow dynamic model fetching

    let manualCustomBaseUrl: string | undefined

    if (provider === 'custom') {
      manualCustomBaseUrl = cfg.get<string>('customBaseUrl', '')
      if (!manualCustomBaseUrl || !manualCustomBaseUrl.trim()) {
        // Note: Manual model entry for custom providers without URLs is handled entirely
        // in the webview (webview/main.js loadModels()). Backend sends empty list to trigger
        // manual entry UI; cache persistence happens in the webview after user input.
        // Comment 2: Use sequenceToken instead of requestToken for consistent validation
        this.post({
          type: 'models',
          payload: { models: [], provider, token: sequenceToken }
        })
        return
      }
      if (debugMode) {
        this.log.appendLine(`[PanelViewProvider] Custom provider base URL detected: ${manualCustomBaseUrl} (Anthropic-style endpoints will fetch models normally)`)
      }
    }
    
    const CACHE_TTL_MS = 5 * 60 * 1000
    const cached = this.modelsCache.get(provider)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      this.log.appendLine(`📦 Using cached models for ${provider}`)
      // Comment 2: Use sequenceToken instead of requestToken for consistent validation
      this.post({ 
        type: 'models', 
        payload: {
          models: cached.models,
          provider,
          freeOnly,
          token: sequenceToken
        }
      })
      return
    }
    
    let baseUrl = 'https://openrouter.ai/api'

    try {
      // Get API key for the provider
      const apiKey = await this.secrets.getProviderKey(provider) || ''
      this.log.appendLine(`🔑 API key ${apiKey ? 'found' : 'NOT found'} for ${provider}`)
      
      // Get base URL for model listing
      // Check if this is a saved custom provider first
      const customProviders = cfg.get<any[]>('customProviders', [])
      const customProvider = customProviders.find(p => p.id === provider)
      
      if (customProvider) {
        // This is a saved custom provider - use the base URL directly
        baseUrl = customProvider.baseUrl
      } else if (provider === 'custom') {
        baseUrl = manualCustomBaseUrl || ''
      } else if (provider === 'openai') {
        baseUrl = 'https://api.openai.com/v1'
      } else if (provider === 'together') {
        baseUrl = 'https://api.together.xyz/v1'
      } else if (provider === 'deepseek') {
        baseUrl = 'https://api.deepseek.com/v1'
      } else if (provider === 'glm') {
        baseUrl = 'https://api.z.ai/api/paas/v4'
      }
      
      if (debugMode) {
        this.log.appendLine(`[PanelViewProvider] Attempting to fetch models from base URL: ${baseUrl} (will resolve to models endpoint)`)
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
      
      // Comment 4: Check if this response is still valid (sequence token hasn't advanced)
      const responseSequenceNum = sequenceToken.startsWith('seq-') 
        ? parseInt(sequenceToken.replace('seq-', ''), 10) 
        : null
      
      if (responseSequenceNum !== null && this.currentSequenceToken !== null && responseSequenceNum < this.currentSequenceToken) {
        this.log.appendLine(`[handleListModels] DISCARDING late response - sequence token ${sequenceToken} is older than current ${this.currentSequenceToken}`)
        return // Discard late response
      }
      
      this.modelsCache.set(provider, { models, timestamp: Date.now() })
      
      this.log.appendLine(`📤 Sending ${models.length} models to webview with sequence token: ${sequenceToken}`)
      this.post({ 
        type: 'models', 
        payload: {
          models,
          provider,
          freeOnly,
          token: sequenceToken // Comment 4: Include sequence token for validation
        }
      })
    } catch (err: any) {
      this.log.appendLine(`❌ Failed to load models: ${err}`)
      
      // Comment 2: Classify errors by type and set appropriate errorType
      // Comment 3: Check for errorType from Models.ts first (timeout classification)
      let errorMessage = `Failed to load models: ${err.message || err}`
      let errorType = err.errorType || 'generic'
      
      const errorStr = String(err.message || err).toLowerCase()
      
      // Comment 3: If errorType already set (e.g., from Models.ts timeout), use it; otherwise classify
      if (errorType === 'generic') {
        // Handle missing/invalid authorization keys with a friendly prompt
        if (
          errorStr.includes('401') ||
          errorStr.includes('403') ||
          errorStr.includes('unauthorized') ||
          errorStr.includes('forbidden') ||
          errorStr.includes('authorization token missing')
        ) {
          errorType = 'unauthorized'
          errorMessage = 'Enter an API key to see models.'
        } else 
        if (errorStr.includes('timed out') || errorStr.includes('timeout') || err.name === 'AbortError') {
          errorType = 'timeout'
          errorMessage = 'Model list request timed out. You can enter model IDs manually.'
        } else if (errorStr.includes('404')) {
          errorType = 'not_found'
          const attemptedUrl = err?.attemptedUrl || err?.modelsEndpointUrl || baseUrl || 'the configured endpoint'
          errorMessage = `Model list endpoint returned 404 for ${attemptedUrl}. The provider may not support model listing at this URL. Please verify your base URL is correct or enter model IDs manually.`
        } else if (errorStr.includes('429') || errorStr.includes('rate limit')) {
          errorType = 'rate_limited'
          errorMessage = 'Rate limited by API. Please try again in a moment or enter model IDs manually.'
        } else if (errorStr.includes('50') || errorStr.includes('server error')) {
          errorType = 'upstream_error'
          errorMessage = 'API server error. Please try again or enter model IDs manually.'
        } else if (errorStr.includes('econnrefused') || errorStr.includes('enotfound') || errorStr.includes('econnreset')) {
          errorType = 'connection'
          errorMessage = 'Could not connect to the API endpoint. Please check your URL and enter model IDs manually.'
        }
      } else if (errorType === 'timeout') {
        // Comment 3: Use error message from Models.ts if it's a timeout
        errorMessage = err.message || 'Model list request timed out. You can enter model IDs manually.'
      }
      
      // Comment 6: Include trace ID in error payload (DEBUG mode only)
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const debug = cfg.get<boolean>('proxy.debug', false)
      
      this.post({ 
        type: 'modelsError', 
        payload: {
          provider,
          error: errorMessage,
          errorType,
          canManuallyEnter: true, // Enable manual entry for all providers on errors
          token: sequenceToken, // Include sequence token for error tracking
          ...(debug && this.currentTraceId ? { traceId: this.currentTraceId } : {}) // Comment 6: Add trace ID in DEBUG mode
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
      
      // Comment 3: Include endpoint kind overrides in payload
      const endpointOverrides = cfg.get<Record<string, string>>('customEndpointOverrides', {})
      
      this.post({ 
        type: 'customProvidersLoaded', 
        payload: { 
          providers: validProviders,
          endpointOverrides // Comment 3: Send endpoint kind overrides to webview
        } 
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
      
      // Load saved combos from per-provider storage with validation
      const savedCombosByProvider = cfg.get<Record<string, any[]>>('savedCombosByProvider', {})
      const providerCombos = savedCombosByProvider[this.currentProvider] || []
      const savedCombos = providerCombos.filter(combo => {
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
      
      // Merge featured pairings with provider-specific combos
      const featuredPairings = pairingsData.featured_pairings || []
      const providerSpecificCombos = (pairingsData.provider_combos && pairingsData.provider_combos[this.currentProvider]) || []
      const allFeaturedPairings = [...featuredPairings, ...providerSpecificCombos]
      
      this.post({ 
        type: 'popularModels', 
        payload: {
          pairings: allFeaturedPairings,
          savedCombos: savedCombos,
          currentReasoning: reasoningModel,
          currentCompletion: completionModel
        }
      })
    } catch (err) {
      console.error('Failed to load popular models:', err)
      this.post({ 
        type: 'popularModels', 
        payload: { pairings: [], savedCombos: [] }
      })
    }
  }

  private async handleUpdateProvider(provider: string) {
    // Comment 5: Capture the old provider first, then clear its cache before changing
    const oldProvider = this.currentProvider
    this.modelsCache.delete(oldProvider)
    this.log.appendLine(`[handleUpdateProvider] Cleared cache for previous provider: ${oldProvider}`)
    
    // Comment 5: Reset sequence token counter on provider switch to ensure clean state
    this.sequenceTokenCounter = 0
    this.currentSequenceToken = null
    
    // Comment 6: Generate trace ID for provider flow (DEBUG mode only)
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const debug = cfg.get<boolean>('proxy.debug', false)
    if (debug) {
      this.currentTraceId = `trace-${Date.now().toString(36)}-${Math.random().toString(36).substr(2, 5)}`
      this.log.appendLine(`[Trace ${this.currentTraceId}] Provider switch: ${oldProvider} → ${provider}`)
    } else {
      this.currentTraceId = null
    }
    
    // Store current provider for model loading
    this.currentProvider = provider
    
    // Comment 2: Generate sequence token for immediate empty list after provider switch
    this.sequenceTokenCounter++
    const sequenceToken = `seq-${this.sequenceTokenCounter}`
    this.currentSequenceToken = this.sequenceTokenCounter
    
    // Clear the webview with an empty list immediately after switching to prevent stale renders
    this.post({ 
      type: 'models', 
      payload: { models: [], provider, token: sequenceToken } 
    })
    
    try {
      // Check if this is a custom provider
      const customProviders = cfg.get<any[]>('customProviders', [])
      const customProvider = customProviders.find(p => p.id === provider)
      
      const target = this.getConfigurationTarget(cfg.get<string>('applyScope', 'workspace'))
      if (customProvider) {
        // This is a saved custom provider - set provider to 'custom' and save the custom provider ID
        await cfg.update('provider', 'custom', target)
        await cfg.update('selectedCustomProviderId', provider, target)
        await cfg.update('customBaseUrl', customProvider.baseUrl, target)
        await cfg.update('customEndpointKind', 'openai', target)
      } else {
        // Built-in provider - clear selectedCustomProviderId
        await cfg.update('provider', provider, target)
        await cfg.update('selectedCustomProviderId', '', target)
        await cfg.update('customEndpointKind', provider === 'custom' ? 'openai' : 'auto', target)
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
    const target = this.getConfigurationTarget(cfg.get<string>('applyScope', 'workspace'))
    await cfg.update('customBaseUrl', url, target)
  }

  private async handleUpdatePort(port: number) {
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const target = this.getConfigurationTarget(cfg.get<string>('applyScope', 'workspace'))
    await cfg.update('proxy.port', port, target)
    this.postConfig()
  }

  private async handleSaveCombo(name: string, reasoningModel: string, codingModel: string, valueModel: string, providerId?: string) {
    try {
      // Use providerId from message to avoid race conditions with this.currentProvider
      const effectiveProviderId = providerId || this.currentProvider
      
      // Log for debugging if providerId doesn't match current provider (potential race condition detected)
      if (providerId && providerId !== this.currentProvider) {
        this.log.appendLine(`[handleSaveCombo] Provider mismatch detected: message providerId=${providerId}, currentProvider=${this.currentProvider}. Using providerId from message.`)
      }
      
      const config = vscode.workspace.getConfiguration('claudeThrone')
      const savedCombosByProvider = config.get<Record<string, any[]>>('savedCombosByProvider', {})
      const providerCombos = savedCombosByProvider[this.currentProvider] || []
      
      // Check if we've reached the 4-combo limit per provider
      if (providerCombos.length >= 4) {
        vscode.window.showErrorMessage(`Maximum of 4 saved combos reached for ${this.currentProvider}. Delete an existing combo first.`)
        return
      }
      
      const newCombo = {
        name,
        reasoning: reasoningModel,
        completion: codingModel,
        value: valueModel
      }
      
      const updatedProviderCombos = [...providerCombos, newCombo]
      const updatedCombosByProvider = {...savedCombosByProvider, [this.currentProvider]: updatedProviderCombos}
      // Comment 1: Always use Global target for savedCombosByProvider (application-scoped setting)
      const target = vscode.ConfigurationTarget.Global
      await config.update('savedCombosByProvider', updatedCombosByProvider, target)
      
      this.log.appendLine(`✅ Saved combo "${name}" for provider: ${effectiveProviderId}`)
      vscode.window.showInformationMessage('Model combo saved successfully')
      this.post({ 
        type: 'combosLoaded', 
        payload: { combos: updatedProviderCombos } 
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
      const target = this.getConfigurationTarget(config.get<string>('applyScope', 'workspace'))
      await config.update('customProviders', updatedProviders, target)
      
      vscode.window.showInformationMessage('Custom provider saved successfully')
      
      this.post({ 
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
      
      const target = this.getConfigurationTarget(config.get<string>('applyScope', 'workspace'))
      await config.update('customProviders', updatedProviders, target)
      
      // If deleted provider was currently selected, switch to default
      if (this.currentProvider === id.trim()) {
        this.currentProvider = 'openrouter'
        await config.update('provider', 'openrouter', target)
        await config.update('selectedCustomProviderId', '', target)
        this.postConfig()
        this.handleListModels(false)
      }
      
      // Refresh key status map
      await this.postKeys()
      
      vscode.window.showInformationMessage('Custom provider deleted successfully')
      
      this.post({ 
        type: 'customProvidersLoaded', 
        payload: { providers: updatedProviders, deletedId: id.trim() } 
      })
      
      this.log.appendLine(`✅ Deleted custom provider: ${provider.name} (${id})`)
    } catch (err) {
      this.log.appendLine(`❌ Failed to delete custom provider: ${err}`)
      vscode.window.showErrorMessage(`Failed to delete custom provider: ${err}`)
    }
  }

  // Comment 3: Handle endpoint kind update for custom provider
  private async handleUpdateEndpointKind(baseUrl: string, endpointKind: string) {
    try {
      const normalizedUrl = baseUrl.replace(/\/+$/, '')
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const currentOverrides = cfg.get<Record<string, string>>('customEndpointOverrides', {})
      
      // Update the override map
      const updatedOverrides = { ...currentOverrides }
      if (endpointKind === 'auto' || !endpointKind) {
        // Remove override if set to auto
        delete updatedOverrides[normalizedUrl]
      } else {
        // Set override (normalize to 'openai' or 'anthropic')
        const normalizedKind = endpointKind.toLowerCase()
        if (normalizedKind === 'openai' || normalizedKind === 'openai-compatible') {
          updatedOverrides[normalizedUrl] = 'openai'
        } else if (normalizedKind === 'anthropic' || normalizedKind === 'anthropic-native') {
          updatedOverrides[normalizedUrl] = 'anthropic'
        } else {
          this.log.appendLine(`⚠️ Invalid endpoint kind: ${endpointKind}`)
          return
        }
      }
      
      const target = this.getConfigurationTarget(cfg.get<string>('applyScope', 'workspace'))
      await cfg.update('customEndpointOverrides', updatedOverrides, target)
      this.log.appendLine(`✅ Updated endpoint kind for ${normalizedUrl}: ${endpointKind || 'auto'}`)
      
      // Notify webview of the update
      this.post({ 
        type: 'endpointKindUpdated', 
        payload: { baseUrl: normalizedUrl, endpointKind: endpointKind || 'auto' } 
      })
    } catch (err) {
      this.log.appendLine(`❌ Failed to update endpoint kind: ${err}`)
      vscode.window.showErrorMessage(`Failed to update endpoint kind: ${err}`)
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
      const savedCombosByProvider = config.get<Record<string, any[]>>('savedCombosByProvider', {})
      const providerCombos = savedCombosByProvider[this.currentProvider] || []
      
      // Check if index is within bounds
      if (index >= providerCombos.length) {
        this.log.appendLine(`❌ Combo index ${index} out of bounds for array of length ${providerCombos.length}`)
        vscode.window.showErrorMessage('Combo not found')
        return
      }
      
      // Remove combo at specified index
      const updatedProviderCombos = [...providerCombos]
      updatedProviderCombos.splice(index, 1)
      
      // Update config
      const updatedCombosByProvider = {...savedCombosByProvider, [this.currentProvider]: updatedProviderCombos}
      // Comment 1: Always use Global target for savedCombosByProvider (application-scoped setting)
      const target = vscode.ConfigurationTarget.Global
      await config.update('savedCombosByProvider', updatedCombosByProvider, target)
      
      this.log.appendLine(`✅ Deleted combo at index ${index}`)
      vscode.window.showInformationMessage('Model combo deleted successfully')
      
      // Send updated combo list back to webview
      this.post({ 
        type: 'combosLoaded', 
        payload: { combos: updatedProviderCombos, deletedId: String(index) } 
      })
    } catch (err) {
      this.log.appendLine(`❌ Failed to delete combo: ${err}`)
      vscode.window.showErrorMessage(`Failed to delete combo: ${err}`)
    }
  }

  private async handleStoreKey(provider: string, key: string) {
    // Comment 1: Normalize provider ID to ensure correct secret lookup
    // Built-ins: openrouter, openai, together, deepseek, glm - lowercase these
    // Custom providers: preserve their exact casing as stored
    const trimmedProvider = provider.trim()
    const lowercased = trimmedProvider.toLowerCase()
    const validBuiltIns = ['openrouter', 'openai', 'together', 'deepseek', 'glm']
    
    // For built-ins, use lowercase; for custom providers, preserve casing
    const normalizedProvider = validBuiltIns.includes(lowercased) ? lowercased : trimmedProvider
    
    // Verify provider ID matches expected format
    if (!validBuiltIns.includes(lowercased) && lowercased !== 'custom') {
      // Check if it's a custom provider ID (preserve casing in lookup)
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const customProviders = cfg.get<any[]>('customProviders', [])
      const customProvider = customProviders.find(p => p.id === trimmedProvider)
      
      if (!customProvider) {
        const errorMsg = `Invalid provider ID: ${provider}. Expected one of: ${validBuiltIns.join(', ')}, custom, or a saved custom provider ID.`
        this.log.appendLine(`❌ ${errorMsg}`)
        vscode.window.showErrorMessage(errorMsg)
        this.post({ 
          type: 'keyStored', 
          payload: { provider, success: false, error: errorMsg }
        })
        return
      }
    }
    
    this.log.appendLine(`🔑 Storing key for provider: ${normalizedProvider} (length: ${key?.length})`)
    try {
      // Comment 1: Use normalized provider ID for storage (lowercase for built-ins, exact casing for custom)
      await this.secrets.setProviderKey(normalizedProvider, key)
      this.log.appendLine(`✅ Key stored successfully in system keychain for provider: ${normalizedProvider}`)
      
      // Show VS Code notification
      vscode.window.showInformationMessage(`API key for ${normalizedProvider} stored successfully`)
      
      this.log.appendLine('📤 Sending keyStored confirmation to webview')
      const message = { 
        type: 'keyStored', 
        payload: { provider: normalizedProvider, success: true }
      }
      this.log.appendLine(`📤 Message content: ${JSON.stringify(message)}`)
      this.post(message)
      this.log.appendLine('📤 Message sent via post()')
    } catch (err) {
      this.log.appendLine(`❌ Failed to store key: ${err}`)
      vscode.window.showErrorMessage(`Failed to store API key: ${err}`)
      this.post({ 
        type: 'keyStored', 
        payload: { provider: normalizedProvider, success: false, error: String(err) }
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
      this.post({ 
        type: 'keyStored', 
        payload: { provider: 'anthropic', success: true }
      })
      
      this.log.appendLine('✅ Anthropic API key stored successfully')
    } catch (err) {
      this.log.appendLine(`❌ Failed to store Anthropic key: ${err}`)
      vscode.window.showErrorMessage(`Failed to store Anthropic API key: ${err}`)
      this.post({ 
        type: 'keyStored', 
        payload: { provider: 'anthropic', success: false, error: String(err) }
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
        // Comment 3: Normalize provider map before reading
        const normalized = this.normalizeProviderMap(modelSelectionsByProvider[this.runtimeProvider], this.runtimeProvider)
        reasoningModel = normalized.reasoning
        completionModel = normalized.completion
        valueModel = normalized.value
        
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
            `No completion model selected for provider "${this.runtimeProvider}" in three-model mode. Using global model "${fallbackCompletion}" which may be from a different provider. Continue anyway?`,
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
            `No value model selected for provider "${this.runtimeProvider}" in three-model mode. Using global model "${fallbackValue}" which may be from a different provider. Continue anyway?`,
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
      
      // Comment 9: Post configWarning when fallback occurs
      if (!hasProviderSpecific && reasoningModel) {
        this.post({
          type: 'configWarning',
          payload: {
            provider: this.runtimeProvider,
            message: `No models saved for provider "${this.runtimeProvider}". Using global fallback. Please select and save models for this provider.`,
            hasProviderSpecific: false,
            fallbackUsed: true
          }
        })
      }
      
      // Add guard: if required models are missing for the active provider, return error
      if (!reasoningModel || reasoningModel.trim() === '') {
        const errorMsg = `No reasoning model selected for provider "${this.runtimeProvider}". Please select a model before starting the proxy.`
        this.log.appendLine(`[handleStartProxy] ERROR: ${errorMsg}`)
        vscode.window.showWarningMessage(errorMsg)
        this.post({ 
          type: 'proxyError', 
          payload: {
            provider: this.runtimeProvider || 'openrouter',
            error: errorMsg,
            errorType: 'config'
          }
        })
        return
      }
      
      if (twoModelMode && (!completionModel || completionModel.trim() === '')) {
        const errorMsg = `No completion model selected for provider "${this.runtimeProvider}" in three-model mode. Please select a model before starting the proxy.`
        this.log.appendLine(`[handleStartProxy] ERROR: ${errorMsg}`)
        vscode.window.showWarningMessage(errorMsg)
        this.post({ 
          type: 'proxyError', 
          payload: {
            provider: this.runtimeProvider || 'openrouter',
            error: errorMsg,
            errorType: 'config'
          }
        })
        return
      }

      if (twoModelMode && (!valueModel || valueModel.trim() === '')) {
        const errorMsg = `No value model selected for provider "${this.runtimeProvider}" in three-model mode. Please select a model before starting the proxy.`
        this.log.appendLine(`[handleStartProxy] ERROR: ${errorMsg}`)
        vscode.window.showWarningMessage(errorMsg)
        this.post({ 
          type: 'proxyError', 
          payload: {
            provider: this.runtimeProvider || 'openrouter',
            error: errorMsg,
            errorType: 'config'
          }
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
          this.post({ 
            type: 'proxyError', 
            payload: {
              provider: this.runtimeProvider || 'openrouter',
              error: errorMsg,
              errorType: 'stale-models'
            }
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
      
      // Phase 4: Hydrate global keys BEFORE proxy start
      // This ensures applyToClaudeCode reads the correct models when it runs
      this.log.appendLine(`[handleStartProxy] Phase 4: Hydrating global keys before proxy start...`)
      const hydrationSuccess = await this.hydrateGlobalKeysFromProvider(
        this.runtimeProvider,
        reasoningModel,
        completionModel,
        valueModel,
        twoModelMode
      )
      
      if (!hydrationSuccess) {
        this.log.appendLine(`[handleStartProxy] WARNING: Hydration failed, but continuing with proxy start`)
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
      
      // Comment 2: Map error to specific errorType (timeout, rate_limited, upstream_error, etc.)
      let errorType = 'startup'
      const errorStr = String(err).toLowerCase()
      if (errorStr.includes('eaddrinuse') || errorStr.includes('port')) {
        errorType = 'port-in-use'
      } else if (errorStr.includes('permission') || errorStr.includes('eacces')) {
        errorType = 'permission'
      } else if (errorStr.includes('timeout') || errorStr.includes('timed out') || errorStr.includes('abort')) {
        errorType = 'timeout'
      } else if (errorStr.includes('429') || errorStr.includes('rate limit')) {
        errorType = 'rate_limited'
      } else if (errorStr.includes('50') || errorStr.includes('server error')) {
        errorType = 'upstream_error'
      } else if (errorStr.includes('econnrefused') || errorStr.includes('enotfound')) {
        errorType = 'connection'
      }
      
      // Comment 6: Include trace ID in error payload (DEBUG mode only)
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const debug = cfg.get<boolean>('proxy.debug', false)
      
      this.post({ 
        type: 'proxyError', 
        payload: {
          provider: this.runtimeProvider || 'openrouter',
          error: String(err),
          errorType,
          ...(debug && this.currentTraceId ? { traceId: this.currentTraceId } : {}) // Comment 6: Add trace ID in DEBUG mode
        }
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
      // Comment 2: Would use this.post() but currently commented out
      // this.post({ type: 'models', payload: { models: [] } })
      
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
      // Comment 5: Accept 'completion' as canonical key (remove legacy 'coding' support)
      const { providerId, reasoning, completion, value } = data
      
      // Update runtime provider to match what we're saving to keep them in sync
      if (providerId && providerId !== this.currentProvider) {
        this.log.appendLine(`[handleSaveModels] Updating currentProvider from ${this.currentProvider} to ${providerId}`)
        this.currentProvider = providerId
      }
      
      // Comment 6: Add targeted logs around save round-trip to verify persistence and provider alignment
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const applyScope = cfg.get<string>('applyScope', 'workspace')
      const target = this.getConfigurationTarget(applyScope)
      
      this.log.appendLine(`[handleSaveModels] Save round-trip - providerId: ${providerId}, target: ${vscode.ConfigurationTarget[target]}, models: { reasoning: ${reasoning}, completion: ${completion}, value: ${value} }`)

      this.log.appendLine(`[handleSaveModels] Using config target: ${vscode.ConfigurationTarget[target]} (applyScope: ${applyScope})`)
      
      // Preflight-check registration of modelSelectionsByProvider
      const insp = cfg.inspect('modelSelectionsByProvider')
      if (insp && insp.defaultValue !== undefined) {
        // Key is registered - update provider-specific configuration
        const modelSelectionsByProvider = cfg.get<any>('modelSelectionsByProvider', {})
        if (!modelSelectionsByProvider[providerId]) {
          modelSelectionsByProvider[providerId] = {}
        }
        
        // Comment 3: Normalize before persisting - ensure canonical keys only
        const toSave = { reasoning, completion, value }
        const normalized = this.normalizeProviderMap(toSave, providerId)
        
        modelSelectionsByProvider[providerId].reasoning = normalized.reasoning
        modelSelectionsByProvider[providerId].completion = normalized.completion
        modelSelectionsByProvider[providerId].value = normalized.value
        
        // Comment 3: Migration - remove legacy 'coding' key if it exists
        if (modelSelectionsByProvider[providerId].coding !== undefined) {
          delete modelSelectionsByProvider[providerId].coding
          this.log.appendLine(`[handleSaveModels] Removed legacy 'coding' key from provider ${providerId}`)
        }
        
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
        await cfg.update('completionModel', completion, target)
        this.log.appendLine(`[handleSaveModels] Successfully saved completionModel: ${completion} to ${vscode.ConfigurationTarget[target]}`)
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
          // Comment 5: Verify using 'completion' key (legacy 'coding' should be removed)
          if (saved.reasoning === reasoning && saved.completion === completion && saved.value === value) {
            this.log.appendLine(`[handleSaveModels] Verification passed - models correctly saved`)
            // Verify legacy 'coding' key was removed
            if (saved.coding !== undefined) {
              this.log.appendLine(`[handleSaveModels] WARNING - Legacy 'coding' key still present after save`)
            }
          } else {
            this.log.appendLine(`[handleSaveModels] WARNING - Verification failed. Expected: reasoning=${reasoning}, completion=${completion}, value=${value}. Got: ${JSON.stringify(saved)}`)
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
      
      this.post({
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
    const target = this.getConfigurationTarget(applyScope)
    
    this.log.appendLine(`[handleSetModelFromList] Using config target: ${vscode.ConfigurationTarget[target]} (applyScope: ${applyScope})`)
    
    // Preflight-check registration of modelSelectionsByProvider
    const insp = cfg.inspect('modelSelectionsByProvider')
    if (insp && insp.defaultValue !== undefined) {
      // Key is registered - update provider-specific configuration
      const modelSelectionsByProvider = cfg.get<any>('modelSelectionsByProvider', {})
      if (!modelSelectionsByProvider[this.runtimeProvider]) {
        modelSelectionsByProvider[this.runtimeProvider] = {}
      }
      
      // Comment 3: Normalize existing map before updating
      const existingNormalized = this.normalizeProviderMap(modelSelectionsByProvider[this.runtimeProvider], this.runtimeProvider)
      
      if (modelType === 'reasoning') {
        // Update both provider-specific and global configs
        existingNormalized.reasoning = modelId
        modelSelectionsByProvider[this.runtimeProvider] = existingNormalized
        await cfg.update('modelSelectionsByProvider', modelSelectionsByProvider, target)
        await cfg.update('reasoningModel', modelId, target)
        this.log.appendLine(`[handleSetModelFromList] Saved reasoning model: ${modelId} to ${vscode.ConfigurationTarget[target]}`)
      } else if (modelType === 'coding') {
        // Comment 3: Map 'coding' to 'completion' canonical key
        existingNormalized.completion = modelId
        modelSelectionsByProvider[this.runtimeProvider] = existingNormalized
        await cfg.update('modelSelectionsByProvider', modelSelectionsByProvider, target)
        await cfg.update('completionModel', modelId, target)
        this.log.appendLine(`[handleSetModelFromList] Saved coding model: ${modelId} to ${vscode.ConfigurationTarget[target]}`)
      } else if (modelType === 'value') {
        // Update both provider-specific and global configs
        existingNormalized.value = modelId
        modelSelectionsByProvider[this.runtimeProvider] = existingNormalized
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
    // Store the three-model mode preference
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const reasoningModel = cfg.get<string>('reasoningModel')
    const completionModel = cfg.get<string>('completionModel')
    
    this.log.appendLine(`[handleToggleTwoModelMode] Two-model mode ${enabled ? 'enabled' : 'disabled'}`)
    this.log.appendLine(`[handleToggleTwoModelMode] Current models: reasoning=${reasoningModel}, completion=${completionModel}`)
    
    const applyScope = cfg.get<string>('applyScope', 'workspace')
    const target = this.getConfigurationTarget(applyScope)
    await cfg.update('twoModelMode', enabled, target)
    
    // Clear OpusPlan mode when three-model mode is disabled to avoid inconsistent config
    if (!enabled) {
      const currentOpusPlanMode = cfg.get<boolean>('opusPlanMode', false)
      if (currentOpusPlanMode) {
        await cfg.update('opusPlanMode', false, target)
        this.log.appendLine(`[handleToggleTwoModelMode] Forced clear of opusPlanMode (was enabled, now disabled because three-model mode is off)`)
      }
    }
    
    this.log.appendLine(`[handleToggleTwoModelMode] Config updated successfully`)
    // Post config update to webview to ensure state synchronization
    this.postConfig()
  }

  private async handleOpusPlanToggle(enabled: boolean) {
    this.log.appendLine(`[PanelViewProvider] OpusPlan mode ${enabled ? 'enabled' : 'disabled'}`)
    
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const applyScope = cfg.get<string>('applyScope', 'workspace')
    const target = this.getConfigurationTarget(applyScope)
    await cfg.update('opusPlanMode', enabled, target)
    
    this.postConfig()
  }

  private async handleUpdateDebug(enabled: boolean) {
    this.log.appendLine(`[handleUpdateDebug] Debug ${enabled ? 'enabled' : 'disabled'}`)
    
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const applyScope = cfg.get<string>('applyScope', 'workspace')
    const target = this.getConfigurationTarget(applyScope)
    await cfg.update('proxy.debug', enabled, target)
    
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
            <!-- Comment 3: Endpoint kind selector for custom providers with detection source badge -->
            <div class="form-group" id="endpointKindSection" style="display: none;">
              <label class="form-label" for="endpointKindSelect" style="display: flex; align-items: center; gap: 8px;">
                Endpoint Type
                <span id="detectionSourceBadge" style="font-size: 10px; padding: 2px 6px; border-radius: 3px; background: var(--vscode-badge-background); color: var(--vscode-badge-foreground); display: none;"></span>
              </label>
              <select class="form-input" id="endpointKindSelect">
                <option value="auto">Auto-detect (recommended)</option>
                <option value="openai">OpenAI-compatible</option>
                <option value="anthropic">Anthropic-native</option>
              </select>
              <p style="font-size: 11px; color: var(--vscode-descriptionForeground); margin-top: 4px;">
                Select endpoint type to avoid 401/404 errors. Auto-detect probes the endpoint on first request.
              </p>
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
              <input type="checkbox" id="threeModelToggle">
              <label for="threeModelToggle">Use three models for different task types (Reasoning/Completion/Value)</label>
            </div>
            
            <div class="two-model-toggle" style="margin-left: 20px; margin-top: 8px;">
              <input type="checkbox" id="opusPlanCheckbox">
              <label for="opusPlanCheckbox">Enable OpusPlan Mode</label>
              <div style="margin-left: 20px; margin-top: 4px; font-size: 11px; color: var(--vscode-descriptionForeground);">
                Automatically assigns your selected reasoning model for planning tasks and your completion model for coding/execution
              </div>
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

        <!-- Quick Combos Card -->
        <div id="quickCombosCard" class="card quick-combos-card">
          <div class="combos-header">
            <h2 class="card-title">Quick Combos</h2>
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
          <h2 class="card-title" id="modelListTitle">Filter Models</h2>
          
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
        <button class="settings-btn" id="settingsBtn" type="button" title="Open Thronekeeper Settings">⚙️</button><span class="version-text" style="font-size: 10px; color: var(--vscode-descriptionForeground); margin-left: 4px;">v${this.ctx.extension.packageJSON.version}</span>
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