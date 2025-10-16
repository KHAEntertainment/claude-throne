import * as vscode from 'vscode'
import { SecretsService } from '../services/Secrets'
import { ProxyManager } from '../services/ProxyManager'
import { listModels, type ProviderId } from '../services/Models'

export class PanelViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView
  private currentProvider: string = 'openrouter'

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly secrets: SecretsService,
    private readonly proxy: ProxyManager | null,
    private readonly log: vscode.OutputChannel,
  ) {}

  async reveal() {
    if (this.view) {
      this.view.show?.(true)
      return
    }
    try {
      await vscode.commands.executeCommand('workbench.view.openView', 'claudeThrone.panel', true)
    } catch {
      vscode.window.showInformationMessage('Open the Claude Throne view from the Panel (bottom) — it is movable like Output/Terminal.')
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
            await this.postModels()
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
            
          case 'openSettings':
            await vscode.commands.executeCommand('workbench.action.openSettings', 'claudeThrone')
            break
            
          case 'saveModels':
            await this.handleSaveModels(msg.reasoning, msg.completion)
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
            await vscode.env.openExternal(vscode.Uri.parse(msg.url))
            break
            
          default:
            this.log.appendLine(`⚠️ Unknown message type: ${msg.type}`)
        }
      } catch (err: any) {
        this.log.appendLine(`❌ Error handling message: ${err?.message || String(err)}`)
        vscode.window.showErrorMessage(err?.message || String(err))
        this.view?.webview.postMessage({ 
          type: 'error', 
          payload: err?.message || String(err)
        })
      }
    })

    this.log.appendLine('⏳ Waiting for webview to signal it is ready...')
  }

  private postStatus() {
    const s = this.proxy?.getStatus() || { running: false }
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const reasoningModel = String(cfg.get('reasoningModel') || '')
    const completionModel = String(cfg.get('completionModel') || '')
    this.view?.webview.postMessage({ type: 'status', payload: { ...s, reasoningModel, completionModel } })
  }

  private async postKeys() {
    const providers = ['openrouter','openai','together','groq','custom']
    const map: Record<string, boolean> = {}
    for (const p of providers) {
      try {
        const k = await this.secrets.getProviderKey(p)
        map[p] = !!(k && k.trim())
      } catch {
        map[p] = false
      }
    }
    this.log.appendLine(`📤 Sending keys status to webview: ${JSON.stringify(map)}`)
    this.view?.webview.postMessage({ type: 'keys', payload: map })
  }

  private postConfig() {
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const config = {
      provider: 'openrouter',
      customUrl: '',
      reasoningModel: String(cfg.get('reasoningModel') || ''),
      completionModel: String(cfg.get('completionModel') || ''),
      twoModelMode: Boolean(cfg.get('twoModelMode')),
      autoApply: Boolean(cfg.get('autoApply')),
      customEndpointKind: String(cfg.get('customEndpointKind') || 'auto')
    }
    this.view?.webview.postMessage({ type: 'config', payload: config })
  }

  private async postModels() {
    // Send available models if we have them cached
    // Otherwise, the webview will request them via listPublicModels
    this.view?.webview.postMessage({ type: 'models', payload: [] })
  }

  private async handleListModels(freeOnly: boolean) {
    const provider = this.currentProvider || 'openrouter'
    this.log.appendLine(`📋 Loading models for provider: ${provider}`)
    
    try {
      // Get API key for the provider
      const apiKey = await this.secrets.getProviderKey(provider) || ''
      this.log.appendLine(`🔑 API key ${apiKey ? 'found' : 'NOT found'} for ${provider}`)
      
      // Get base URL for custom providers
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      let baseUrl = 'https://openrouter.ai/api'
      
      if (provider === 'custom') {
        // For custom provider, we'd need to get the custom URL
        // For now, use OpenRouter as default
      } else if (provider === 'openai') {
        baseUrl = 'https://api.openai.com/v1'
      } else if (provider === 'together') {
        baseUrl = 'https://api.together.xyz/v1'
      } else if (provider === 'groq' || provider === 'grok') {
        baseUrl = 'https://api.groq.com/openai/v1'
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
      
      this.log.appendLine(`📤 Sending ${models.length} models to webview`)
      this.view?.webview.postMessage({ 
        type: 'models', 
        payload: {
          models,
          provider,
          freeOnly
        }
      })
    } catch (err) {
      this.log.appendLine(`❌ Failed to load models: ${err}`)
      this.view?.webview.postMessage({ 
        type: 'error', 
        payload: `Failed to load models: ${err}`
      })
    }
  }

  private async postPopularModels() {
    // Try to load popular pairings from models configuration
    try {
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const reasoningModel = cfg.get<string>('reasoningModel')
      const completionModel = cfg.get<string>('completionModel')
      
      // Load featured combinations from our data
      const fs = await import('fs')
      const pairingsPath = vscode.Uri.joinPath(this.ctx.extensionUri, 'webview', 'data', 'model-pairings.json')
      const pairingsContent = fs.readFileSync(pairingsPath.fsPath, 'utf8')
      const pairingsData = JSON.parse(pairingsContent)
      
      this.view?.webview.postMessage({ 
        type: 'popularModels', 
        payload: {
          pairings: pairingsData.featured_pairings,
          currentReasoning: reasoningModel,
          currentCompletion: completionModel
        }
      })
    } catch (err) {
      console.error('Failed to load popular models:', err)
      this.view?.webview.postMessage({ 
        type: 'popularModels', 
        payload: { pairings: [] }
      })
    }
  }

  private async handleUpdateProvider(provider: string) {
    // Store current provider for model loading
    this.currentProvider = provider
    try {
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      await cfg.update('customEndpointKind', provider === 'custom' ? 'openai' : 'auto')
    } catch (err) {
      console.error('Failed to update provider config:', err)
    }
    
    // Reload models for new provider
    this.handleListModels(false)
    this.postPopularModels()
  }

  private async handleUpdateCustomUrl(url: string) {
    // Update custom base URL
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    // This sets the environment variable indirectly via settings
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

  private async handleStartProxy() {
    try {
      if (!this.proxy) {
        throw new Error('ProxyManager not available')
      }
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const port = cfg.get<number>('proxy.port', 3000)
      const debug = cfg.get<boolean>('proxy.debug', false)
      
      const reasoningModel = cfg.get<string>('reasoningModel')
      const completionModel = cfg.get<string>('completionModel')
      
      await this.proxy.start({
        provider: this.currentProvider as any,
        port,
        debug,
        reasoningModel,
        completionModel
      })
      
      vscode.window.showInformationMessage(`Proxy started on port ${port}`)
      this.postStatus()
      
      // Auto-apply to Claude Code if enabled
      const autoApply = cfg.get<boolean>('autoApply', true)
      if (autoApply) {
        await vscode.commands.executeCommand('claudeThrone.applyToClaudeCode')
      }
    } catch (err) {
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
      this.postStatus()
    } catch (err) {
      console.error('Failed to stop proxy:', err)
    }
  }

  private async handleSaveModels(reasoning: string, completion: string) {
    try {
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      await cfg.update('reasoningModel', reasoning)
      await cfg.update('completionModel', completion)
    } catch (err) {
      console.error('Failed to save models:', err)
    }
  }

  private async handleFilterModels(filter: any) {
    // Handle model filtering based on search and sort parameters
    // Implementation depends on existing model data
  }

  private async handleSetModelFromList(modelId: string, modelType: 'primary' | 'secondary') {
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    if (modelType === 'primary') {
      await cfg.update('reasoningModel', modelId)
    } else if (modelType === 'secondary') {
      await cfg.update('completionModel', modelId)
    }
    this.postConfig()
  }

  private async handleToggleTwoModelMode(enabled: boolean) {
    // Store the two-model mode preference
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    await cfg.update('twoModelMode', enabled)
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
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${this.view!.webview.cspSource}; script-src 'nonce-${nonce}' ${this.view!.webview.cspSource}; connect-src https://openrouter.ai;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Claude Throne</title>
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div class="container">
    <header class="header">
      <h1 class="header-title">Claude Throne</h1>
      <p class="header-subtitle">Configure and launch your local proxy for AI code completion.</p>
    </header>

    <main class="main-content">
      <div class="content-grid">
        <!-- Provider Configuration Card -->
        <div class="card">
          <h2 class="card-title">Provider</h2>
          
          <div class="form-group">
            <label class="form-label" for="providerSelect">Provider</label>
            <select class="form-select" id="providerSelect">
              <option value="openrouter">OpenRouter</option>
              <option value="openai">OpenAI</option>
              <option value="together">Together AI</option>
              <option value="grok">Grok</option>
              <option value="custom">Custom Provider</option>
            </select>
            <div id="providerHelp" class="provider-help"></div>
          </div>

          <div id="customUrlSection" class="custom-url-section">
            <div class="form-group">
              <label class="form-label" for="customUrl">Custom Endpoint URL</label>
              <input class="form-input" type="text" id="customUrl" placeholder="https://api.example.com/v1">
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
              <label for="twoModelToggle">Use two models (reasoning + execution)</label>
            </div>
            
            <div id="selectedModelsDisplay" class="selected-models-display" style="margin-top: 12px; font-size: 11px; color: var(--vscode-descriptionForeground);">
              <div id="primaryModelDisplay" style="margin-bottom: 4px;"></div>
              <div id="secondaryModelDisplay"></div>
            </div>
          </div>
        </div>

        <!-- Popular Combos Card (OpenRouter only) -->
        <div id="popularCombosCard" class="card popular-combos-card">
          <div class="combos-header">
            <h2 class="card-title">Popular Combos</h2>
            <button class="btn-save-combo hidden" id="saveComboBtn" title="Save current model selection">+ Save</button>
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
        <a href="https://github.com/KHAEntertainment/claude-throne" class="repo-link" id="repoLink" title="View on GitHub">GitHub ↗</a>
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
      console.log('[BOOTSTRAP] Starting Claude Throne webview...');
      
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
