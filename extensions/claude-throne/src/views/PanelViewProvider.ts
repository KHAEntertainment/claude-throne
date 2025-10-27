import * as vscode from 'vscode'
import { SecretsService } from '../services/Secrets'
import { ProxyManager } from '../services/ProxyManager'
import { listModels, type ProviderId } from '../services/Models'

export class PanelViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private currentProvider: string = 'openrouter'
  private modelsCache: Map<string, { models: any[], timestamp: number }> = new Map()

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
            await this.handleListModels(false)
            break
          case 'listPublicModels':
            await this.handleListModels(false)
            break
          case 'listFreeModels':
            await this.handleListModels(true)
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
            await this.handleSaveModels(msg.reasoning, msg.coding, msg.value)
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
    const reasoningModel = String(cfg.get('reasoningModel') || '')
    const completionModel = String(cfg.get('completionModel') || '')
    const valueModel = String(cfg.get('valueModel') || '')
    
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
    const providers = ['openrouter','openai','together','deepseek','glm','custom']
    const map: Record<string, boolean> = {}
    
    // Check built-in providers
    for (const p of providers) {
      try {
        const k = await this.secrets.getProviderKey(p)
        map[p] = !!(k && k.trim())
      } catch {
        map[p] = false
      }
    }
    
    // Check custom providers
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const customProviders = cfg.get<any[]>('customProviders', [])
    for (const p of customProviders) {
      if (p.id && p.id.trim()) {
        try {
          const k = await this.secrets.getProviderKey(p.id)
          map[p.id] = !!(k && k.trim())
        } catch {
          map[p.id] = false
        }
      }
    }
    
    // Check Anthropic key
    const anthropicKey = await this.secrets.getAnthropicKey()
    map.anthropic = !!(anthropicKey && anthropicKey.trim())
    
    this.log.appendLine(`📤 Sending keys status to webview: ${JSON.stringify(map)}`)
    this.view?.webview.postMessage({ type: 'keys', payload: map })
  }

  public postConfig() {
    if (!this.view) return;
    const config = vscode.workspace.getConfiguration('claudeThrone');
    const provider = config.get('provider');
    const selectedCustomProviderId = config.get('selectedCustomProviderId', '');
    const reasoningModel = config.get('reasoningModel');
    const completionModel = config.get('completionModel');
    const valueModel = config.get('valueModel');
    const twoModelMode = config.get('twoModelMode', false);
    const port = config.get('proxy.port');
    const customBaseUrl = config.get('customBaseUrl', '');
    const debug = config.get('proxy.debug', false);
    
    this.log.appendLine(`[postConfig] Sending config to webview: twoModelMode=${twoModelMode}, reasoning=${reasoningModel}, completion=${completionModel}, value=${valueModel}, debug=${debug}`);
    
    this.view.webview.postMessage({
      type: 'config',
      payload: { provider, selectedCustomProviderId, reasoningModel, completionModel, valueModel, twoModelMode, port, customBaseUrl, debug }
    });
  }

  private async postModels() {
    const provider = this.currentProvider || 'openrouter'
    const CACHE_TTL_MS = 5 * 60 * 1000
    const cached = this.modelsCache.get(provider)
    
    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
      this.view?.webview.postMessage({ 
        type: 'models', 
        payload: { models: cached.models, provider } 
      })
    } else {
      this.view?.webview.postMessage({ type: 'models', payload: { models: [] } })
    }
  }

  private async handleListModels(freeOnly: boolean) {
    const provider = this.currentProvider || 'openrouter'
    this.log.appendLine(`📋 Loading models for provider: ${provider}`)
    
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    
    if (provider === 'custom') {
      const baseUrl = cfg.get<string>('customBaseUrl', '')
      if (!baseUrl || !baseUrl.trim()) {
        this.view?.webview.postMessage({ 
          type: 'models', 
          payload: { models: [], provider } 
        })
        return
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
          freeOnly
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
        // This is a saved custom provider
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
          freeOnly
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
    // Clear the cache for the old provider before changing
    this.modelsCache.delete(this.currentProvider)
    
    // Store current provider for model loading
    this.currentProvider = provider
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    
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
      
      // Refresh defaults without prompting user
      await vscode.commands.executeCommand('claudeThrone.refreshAnthropicDefaults')
      
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
      
      // Check if this is a saved custom provider
      const customProviders = cfg.get<any[]>('customProviders', [])
      const customProvider = customProviders.find(p => p.id === this.currentProvider)
      
      if (customProvider) {
        customBaseUrl = customProvider.baseUrl
        customProviderId = this.currentProvider
      } else if (this.currentProvider === 'custom') {
        customBaseUrl = cfg.get<string>('customBaseUrl', '')
        const selectedCustomProviderId = cfg.get<string>('selectedCustomProviderId', '')
        if (selectedCustomProviderId) {
          customProviderId = selectedCustomProviderId
        }
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
      
      const reasoningModel = cfg.get<string>('reasoningModel')
      const completionModel = cfg.get<string>('completionModel')
      
      // Log model configuration (but don't block startup - proxy has fallback defaults)
      if (!reasoningModel || !completionModel) {
        this.log.appendLine(`[handleStartProxy] INFO: Models not configured, proxy will use fallback defaults`)
        this.log.appendLine(`[handleStartProxy] - reasoningModel: ${reasoningModel || 'EMPTY (will use fallback)'}`)
        this.log.appendLine(`[handleStartProxy] - completionModel: ${completionModel || 'EMPTY (will use fallback)'}`)
      }
      
      this.log.appendLine(`[handleStartProxy] Starting proxy: provider=${this.currentProvider}, port=${port}, twoModelMode=${twoModelMode}`)
      this.log.appendLine(`[handleStartProxy] Models: reasoning=${reasoningModel || 'NOT SET'}, completion=${completionModel || 'NOT SET'}`)
      if (customBaseUrl) {
        this.log.appendLine(`[handleStartProxy] Custom Base URL: ${customBaseUrl}`)
      }
      if (customProviderId) {
        this.log.appendLine(`[handleStartProxy] Custom Provider ID: ${customProviderId}`)
      }
      this.log.appendLine(`[handleStartProxy] Timestamp: ${new Date().toISOString()}`)
      
      // Determine the provider to pass to proxy.start
      let proxyProvider = this.currentProvider
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
        await vscode.commands.executeCommand('claudeThrone.revertApply')
      }
      
      // Clear caches and refresh webview config after stopping
      this.modelsCache.clear()
      this.view?.webview.postMessage({ type: 'models', payload: { models: [] } })
      this.postConfig()
      this.postStatus()
      
      if (autoApply) {
        vscode.window.showInformationMessage('Proxy stopped and Claude Code settings reverted')
      }
    } catch (err) {
      console.error('Failed to stop proxy:', err)
    }
  }

  private async handleRevertApply() {
    try {
      this.log.appendLine('[handleRevertApply] Reverting Claude Code settings to Anthropic defaults')
      await vscode.commands.executeCommand('claudeThrone.revertApply')
      this.postStatus()
      vscode.window.showInformationMessage('Reverted Claude Code settings to Anthropic defaults')
    } catch (err) {
      this.log.appendLine(`[handleRevertApply] Error: ${err}`)
      vscode.window.showErrorMessage(`Failed to revert settings: ${err}`)
    }
  }

  private async handleSaveModels(reasoning: string, coding: string, value: string) {
    try {
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const twoModelMode = cfg.get<boolean>('twoModelMode', false)
      
      this.log.appendLine(`[handleSaveModels] Saving models: reasoning=${reasoning}, coding=${coding}, value=${value}, twoModelMode=${twoModelMode}`)
      
      // Explicitly save to Workspace configuration to ensure persistence
      await cfg.update('reasoningModel', reasoning, vscode.ConfigurationTarget.Workspace)
      await cfg.update('completionModel', coding, vscode.ConfigurationTarget.Workspace)
      await cfg.update('valueModel', value, vscode.ConfigurationTarget.Workspace)
      
      this.log.appendLine(`[handleSaveModels] Models saved successfully to Workspace config`)
      
      // Immediately send updated config back to webview to confirm save
      this.postConfig()
    } catch (err) {
      this.log.appendLine(`[handleSaveModels] Error: ${err}`)
      console.error('Failed to save models:', err)
    }
  }

  private async handleFilterModels(filter: any) {
    // Handle model filtering based on search and sort parameters
    // Implementation depends on existing model data
  }

  private async handleSetModelFromList(modelId: string, modelType: 'reasoning' | 'coding' | 'value') {
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    if (modelType === 'reasoning') {
      await cfg.update('reasoningModel', modelId, vscode.ConfigurationTarget.Workspace)
      this.log.appendLine(`[handleSetModelFromList] Saved reasoning model: ${modelId}`)
    } else if (modelType === 'coding') {
      await cfg.update('completionModel', modelId, vscode.ConfigurationTarget.Workspace)
      this.log.appendLine(`[handleSetModelFromList] Saved coding model: ${modelId}`)
    } else if (modelType === 'value') {
      await cfg.update('valueModel', modelId, vscode.ConfigurationTarget.Workspace)
      this.log.appendLine(`[handleSetModelFromList] Saved value model: ${modelId}`)
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
