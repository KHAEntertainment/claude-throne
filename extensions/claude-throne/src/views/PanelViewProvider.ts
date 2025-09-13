import * as vscode from 'vscode'

import { SecretsService } from '../services/Secrets'
import { ProxyManager } from '../services/ProxyManager'

export class PanelViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView

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
    this.view = webviewView
    webviewView.webview.options = { enableScripts: true }
    webviewView.webview.html = this.getHtml()

    webviewView.webview.onDidReceiveMessage(async (msg) => {
      try {
        switch (msg.type) {
          case 'storeKey': {
            const provider = String(msg.provider || 'openrouter')
            const key = await vscode.window.showInputBox({
              title: `Enter ${provider} API Key`,
              password: true,
              ignoreFocusOut: true,
              validateInput: (v) => v && v.trim().length > 0 ? undefined : 'Key is required'
            })
            if (key) {
              await this.secrets.setProviderKey(provider, key)
              vscode.window.showInformationMessage(`${provider} API key stored`)
              await this.postKeys()
            }
            break
          }
          case 'detectEndpoint': {
            const url = String(msg.url || '')
            const result = await this.detectEndpoint(url)
            this.view?.webview.postMessage({ type: 'endpointDetection', payload: result })
            break
          }
          case 'applyDirectBaseUrl': {
            const url = String(msg.url || '')
            await this.applyDirectBaseUrl(url)
            break
          }
          case 'startProxy': {
            await vscode.commands.executeCommand('claudeThrone.startProxy')
            this.postStatus()
            break
          }
          case 'stopProxy': {
            await vscode.commands.executeCommand('claudeThrone.stopProxy')
            this.postStatus()
            break
          }
          case 'applyClaudeCode': {
            await vscode.commands.executeCommand('claudeThrone.applyToClaudeCode')
            break
          }
          case 'revertClaudeCode': {
            await vscode.commands.executeCommand('claudeThrone.revertApply')
            break
          }
          case 'listModels': {
            await this.handleListModels()
            break
          }
          case 'saveModels': {
            await this.handleSaveModels(msg.reasoning, msg.completion)
            break
          }
          case 'updateProvider': {
            const provider = String(msg.provider || 'openrouter')
            const cfg = vscode.workspace.getConfiguration('claudeThrone')
            await cfg.update('provider', provider, vscode.ConfigurationTarget.Workspace)
            vscode.window.showInformationMessage(`Provider set to ${provider}`)
            await this.handleListModels()
            await this.postKeys()
            break
          }
          case 'updateCustomBaseUrl': {
            const url = String(msg.url || '')
            const cfg = vscode.workspace.getConfiguration('claudeThrone')
            await cfg.update('customBaseUrl', url, vscode.ConfigurationTarget.Workspace)
            vscode.window.showInformationMessage('Custom base URL updated')
            break
          }
          case 'openSettings': {
            // Open the extension page via marketplace search (works in VS Code/Cursor)
            try {
              await vscode.commands.executeCommand('workbench.extensions.search', '@ext:thehive.claude-throne')
            } catch {
              // Fallback to settings filter
              await vscode.commands.executeCommand('workbench.action.openSettings', 'claudeThrone')
            }
            break
          }
          case 'requestKeys': {
            await this.postKeys()
            break
          }
        }
      } catch (err: any) {
        vscode.window.showErrorMessage(err?.message || String(err))
      }
    })

    this.postStatus()
    this.postKeys()
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
    this.view?.webview.postMessage({ type: 'keys', payload: map })
  }

  private async handleListModels() {
    try {
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const provider = String(cfg.get('provider', 'openrouter')) as any
      const baseUrl = provider === 'custom' ? String(cfg.get('customBaseUrl', '') || '') : (
        provider === 'openrouter' ? 'https://openrouter.ai/api/v1' :
        provider === 'openai' ? 'https://api.openai.com/v1' :
        provider === 'together' ? 'https://api.together.xyz/v1' :
        provider === 'groq' ? 'https://api.groq.com/openai/v1' : ''
      )
      const key = await this.secrets.getProviderKey(provider)
      if (!key) throw new Error('Provider API key not set')
      const { listModels } = await import('../services/Models')
      const rawBase = provider === 'openrouter' ? 'https://openrouter.ai/api' : baseUrl
      const list = await listModels(provider, rawBase, key)
      const reasoningModel = String(cfg.get('reasoningModel'))
      const completionModel = String(cfg.get('completionModel'))
      this.view?.webview.postMessage({ type: 'models', payload: { list, reasoningModel, completionModel } })
    } catch (err: any) {
      this.view?.webview.postMessage({ type: 'modelsError', payload: { error: err?.message || String(err) } })
    }
  }

  private async handleSaveModels(reasoning: string, completion: string) {
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    await cfg.update('reasoningModel', reasoning, vscode.ConfigurationTarget.Workspace)
    await cfg.update('completionModel', completion, vscode.ConfigurationTarget.Workspace)
    vscode.window.showInformationMessage('Saved model selections.')
  }

  private classifyExistsStatus(code: number): boolean {
    // Route exists if server returns any of the following for an unauthenticated POST
    return [200, 201, 202, 204, 400, 401, 403, 405, 415, 422].includes(code)
  }

  private async probe(url: string): Promise<number | null> {
    try {
      const controller = new AbortController()
      const t = setTimeout(() => controller.abort(), 5000)
      const res = await fetch(url, { method: 'POST', body: '{}', headers: { 'Content-Type': 'application/json' }, signal: controller.signal })
      clearTimeout(t)
      return res.status
    } catch {
      return null
    }
  }

  private normalizeBase(u: string): string {
    return (u || '').replace(/\/$/, '')
  }

  private async detectEndpoint(url: string): Promise<{ kind: 'openai' | 'anthropic' | 'unknown'; confidence: number; details: any }> {
    const base = this.normalizeBase(url)
    const candidates = {
      openai1: `${base}/v1/chat/completions`,
      openai2: `${base}/chat/completions`,
      anthropic1: `${base}/v1/messages`,
      anthropic2: `${base}/messages`,
    }
    const [o1, o2, a1, a2] = await Promise.all([
      this.probe(candidates.openai1),
      this.probe(candidates.openai2),
      this.probe(candidates.anthropic1),
      this.probe(candidates.anthropic2),
    ])
    const openaiExists = [o1, o2].some(s => s != null && this.classifyExistsStatus(s!))
    const anthropicExists = [a1, a2].some(s => s != null && this.classifyExistsStatus(s!))

    // Heuristics
    const hostHint = (() => {
      try { return new URL(base).host.toLowerCase() } catch { return '' }
    })()
    let hintOpenAI = /(openai\.com|openrouter\.ai|together\.(ai|xyz)|x\.ai)/.test(hostHint)
    let hintAnthropic = /anthropic/.test(base) || /\/v1\/messages\b/.test(base)

    if (openaiExists && !anthropicExists) return { kind: 'openai', confidence: 0.9, details: { o1, o2, a1, a2 } }
    if (anthropicExists && !openaiExists) return { kind: 'anthropic', confidence: 0.9, details: { o1, o2, a1, a2 } }
    if (openaiExists && anthropicExists) return { kind: 'unknown', confidence: 0.4, details: { o1, o2, a1, a2 } }
    if (hintOpenAI && !hintAnthropic) return { kind: 'openai', confidence: 0.6, details: { o1, o2, a1, a2 } }
    if (hintAnthropic && !hintOpenAI) return { kind: 'anthropic', confidence: 0.6, details: { o1, o2, a1, a2 } }
    return { kind: 'unknown', confidence: 0.1, details: { o1, o2, a1, a2 } }
  }

  private async applyDirectBaseUrl(baseUrl: string) {
    const url = this.normalizeBase(baseUrl)
    const candidates: { section: string; key: string }[] = [
      { section: 'anthropic', key: 'baseUrl' },
      { section: 'claude', key: 'baseUrl' },
      { section: 'claudeCode', key: 'baseUrl' },
      { section: 'claude-code', key: 'baseUrl' },
      { section: 'claude', key: 'apiBaseUrl' },
      { section: 'claudeCode', key: 'apiBaseUrl' },
    ]
    const applied: string[] = []
    for (const c of candidates) {
      try {
        const s = vscode.workspace.getConfiguration(c.section)
        await s.update(c.key, url, vscode.ConfigurationTarget.Workspace)
        applied.push(`${c.section}.${c.key}`)
      } catch {}
    }
    const termKeys = [
      'terminal.integrated.env.osx',
      'terminal.integrated.env.linux',
      'terminal.integrated.env.windows',
    ]
    const termApplied: string[] = []
    for (const key of termKeys) {
      try {
        const current = vscode.workspace.getConfiguration().get<Record<string, string>>(key) || {}
        const updated = { ...current, ANTHROPIC_BASE_URL: url }
        await vscode.workspace.getConfiguration().update(key, updated, vscode.ConfigurationTarget.Workspace)
        termApplied.push(key)
      } catch {}
    }
    const parts: string[] = []
    if (applied.length) parts.push(`extensions: ${applied.join(', ')}`)
    if (termApplied.length) parts.push(`terminal env (new terminals): ${termApplied.length} target(s)`)
    vscode.window.showInformationMessage(`Applied direct base URL ${url} to ${parts.join(' | ')}`)
  }

  private getHtml(): string {
    const nonce = String(Math.random()).slice(2)
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const provider = String(cfg.get('provider', 'openrouter'))
    const customBaseUrl = String(cfg.get('customBaseUrl', '') || '')
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Claude Throne</title>
  <style>
    :root {
      --bg: #1e1e1e;
      --panel: #252526;
      --right: #1e1e1e;
      --fg: #d4d4d4;
      --muted: #8c8c8c;
      --primary: #0e639c;
      --border: #3c3c3c;
      --ok: #1c4b31;
      --ok-border: #28a745;
      --warn: #4d2f2f;
      --warn-border: #dc3545;
      --info: #113a5f;
      --info-border: #3794ff;
    }
    body { font-family: var(--vscode-font-family); background: var(--bg); color: var(--fg); margin: 0; }
    .container { display: flex; height: 100vh; }
    .left { flex: 1; padding: 16px 24px; background: var(--panel); display: flex; flex-direction: column; }
    .right { flex: 1; background: var(--right); display: flex; align-items: center; justify-content: center; color: var(--muted); }
    .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    h3 { margin: 0; font-size: 20px; }
    .gear { border: 1px solid var(--border); background: #2d2d2d; color: var(--fg); border-radius: 4px; padding: 4px; cursor: pointer; }
    .statusLine { display: flex; align-items: center; gap: 8px; margin: 8px 0 12px; }
    .badge { background: var(--primary); color: #fff; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
    .hr { border: 0; border-top: 1px solid var(--border); margin: 12px 0; }
    label { font-size: 12px; color: var(--muted); display: block; margin-bottom: 6px; }
    select, input[type="text"] { width: 100%; background: #3c3c3c; border: 1px solid var(--border); color: var(--fg); padding: 8px 10px; border-radius: 4px; }
    .row { margin-bottom: 14px; }
    .key-status { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; border-radius: 4px; font-size: 13px; }
    .key-set { background: var(--ok); border: 1px solid var(--ok-border); }
    .key-not-set { background: var(--warn); border: 1px solid var(--warn-border); }
    .key-status .text { flex: 1; }
    .key-status .actions { display: flex; gap: 8px; }
    .btnRow { display: flex; gap: 16px; }
    button { padding: 10px 16px; border-radius: 4px; border: 1px solid var(--border); background: #2d2d2d; color: var(--fg); cursor: pointer; }
    .mini { padding: 6px 10px; font-size: 12px; }
    .primary { background: #ffffff; color: #1e1e1e; }
    .stop { background: var(--primary); color: #ffffff; border-color: var(--primary); }
    .muted { font-size: 12px; color: var(--muted); margin-top: auto; padding-top: 16px; border-top: 1px solid var(--border); }
    .banner { border: 1px solid var(--info-border); background: var(--info); padding: 8px 12px; border-radius: 6px; margin-bottom: 10px; }
    .banner.anthropic { border-color: #e6a700; background: #4a3a12; }
  </style>
</head>
<body>
  <div class="container">
    <div class="left">
      <div class="header">
        <h3>Claude Throne</h3>
        <button id="openSettings" class="gear" title="Open Settings" aria-label="Open Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.06-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.027 7.027 0 0 0-1.63-.94l-.36-2.54A.5.5 0 0 0 14.3 1h-3.6a.5.5 0 0 0-.49.41l-.36 2.54c-.58.22-1.12.53-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.3 7.47a.5.5 0 0 0 .12.64l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94L2.42 13.15a.5.5 0 0 0-.12.64l1.92 3.32c.14.24.43.34.69.22l2.39-.96c.5.4 1.05.72 1.63.94l.36 2.54c.06.24.25.41.49.41h3.6c.24 0 .44-.17.49-.41l.36-2.54c.58-.22 1.12-.53 1.63-.94l2.39.96c.26.11.55.02.69-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"/></svg>
        </button>
      </div>

      <div class="statusLine" id="status"><span class="badge">UNKNOWN</span> Proxy: unknown</div>
      <div class="row"><span>Currently on the Throne: <a id="currentModel" href="#">None</a></span></div>
      <hr class="hr" />

      <div class="row">
        <label for="provider">Provider</label>
        <select id="provider">
          <option value="openrouter" ${provider==='openrouter'?'selected':''}>OpenRouter</option>
          <option value="openai" ${provider==='openai'?'selected':''}>OpenAI</option>
          <option value="together" ${provider==='together'?'selected':''}>Together</option>
          <option value="groq" ${provider==='groq'?'selected':''}>Grok</option>
          <option value="custom" ${provider==='custom'?'selected':''}>Custom</option>
        </select>
      </div>

      <div id="keyStatus" class="row"></div>

      <div id="customUrlRow" class="row" ${provider==='custom'?'':'style="display:none"'}>
        <label for="customBaseUrl">Custom Provider Base URL</label>
        <input type="text" id="customBaseUrl" placeholder="https://your.provider/v1" value="${customBaseUrl.replace(/"/g, '&quot;')}">
        <div style="display:flex; gap:8px; margin-top:8px;">
          <button id="saveCustomUrl">Save Base URL</button>
          <button id="testEndpoint">Test Endpoint</button>
          <button id="bypassApply" disabled>Bypass and Apply</button>
        </div>
        <div id="endpointBanner" class="banner" style="display:none"></div>
      </div>

      <div class="row">
        <label for="reasoningInput">Reasoning Model</label>
        <input type="text" id="reasoningInput" placeholder="Type reasoning model name..." list="modelsList" />
      </div>
      <div class="row">
        <label for="completionInput">Completion Model</label>
        <input type="text" id="completionInput" placeholder="Type completion model name..." list="modelsList" />
      </div>
      <datalist id="modelsList"></datalist>

      <div class="btnRow">
        <button id="stop" class="stop">Stop Proxy</button>
        <button id="apply" class="primary">Apply to Claude Code</button>
      </div>

      <div class="muted">Configure provider, custom URL, and models here. Port, debug, and auto-apply live in Settings (search: @ext:thehive.claude-throne). Keys are stored securely.</div>
    </div>
    <div class="right">
      <div>
        <div style="text-align:center">Extended functionality<br/>coming soon</div>
      </div>
    </div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi()
    const $ = (id) => document.getElementById(id)

    const providerEl = $('provider')
    const customUrlRow = $('customUrlRow')
    const customBaseUrlEl = $('customBaseUrl')
    const modelsListEl = $('modelsList')
    const reasoningEl = $('reasoningInput')
    const completionEl = $('completionInput')
    const keyStatusEl = $('keyStatus')
    const currentModelEl = $('currentModel')
    const testEndpointBtn = $('testEndpoint')
    const bypassApplyBtn = $('bypassApply')
    const endpointBanner = $('endpointBanner')

    let keysMap = {}

    function renderKeyStatus() {
      const p = providerEl.value
      const has = !!keysMap[p]
      if (has) {
        keyStatusEl.innerHTML = '<div class="key-status key-set">\n          <div class="text">API Key Securely Stored.</div>\n          <div class="actions">\n            <button id="updateKeyBtn" class="mini">Click here to Update It</button>\n          </div>\n        </div>'
        const btn = document.getElementById('updateKeyBtn')
        if (btn) btn.addEventListener('click', (e) => {
          e.preventDefault()
          vscode.postMessage({ type: 'storeKey', provider: p })
        })
      } else {
        keyStatusEl.innerHTML = '<div class="key-status key-not-set">\n          <div class="text">No API Key stored.</div>\n          <div class="actions">\n            <button id="addKeyBtn" class="mini">Add API Key</button>\n          </div>\n        </div>'
        const btn = document.getElementById('addKeyBtn')
        if (btn) btn.addEventListener('click', (e) => {
          e.preventDefault()
          vscode.postMessage({ type: 'storeKey', provider: p })
        })
      }
    }

    // Buttons
    $('openSettings').addEventListener('click', () => vscode.postMessage({ type: 'openSettings' }))
    $('stop').addEventListener('click', () => vscode.postMessage({ type: 'stopProxy' }))
    $('apply').addEventListener('click', () => {
      vscode.postMessage({ type: 'applyClaudeCode' })
      const btn = $('apply')
      const old = btn.textContent
      btn.textContent = 'Successfully Applied'
      const oldClass = btn.className
      btn.className = 'primary'
      setTimeout(() => { btn.textContent = old; btn.className = oldClass }, 1800)
    })

    providerEl.addEventListener('change', () => {
      const provider = providerEl.value
      const isCustom = provider === 'custom'
      customUrlRow.style.display = isCustom ? '' : 'none'
      if (!isCustom) {
        // Reset detection UI when leaving custom
        endpointBanner.style.display = 'none'
        bypassApplyBtn.disabled = true
      }
      vscode.postMessage({ type: 'updateProvider', provider })
      vscode.postMessage({ type: 'requestKeys' })
    })

    $('saveCustomUrl').addEventListener('click', () => {
      const url = customBaseUrlEl.value.trim()
      vscode.postMessage({ type: 'updateCustomBaseUrl', url })
    })

    testEndpointBtn.addEventListener('click', () => {
      const url = customBaseUrlEl.value.trim()
      endpointBanner.style.display = 'block'
      endpointBanner.textContent = 'Detecting endpoint type...'
      vscode.postMessage({ type: 'detectEndpoint', url })
    })

    bypassApplyBtn.addEventListener('click', () => {
      const url = customBaseUrlEl.value.trim()
      vscode.postMessage({ type: 'applyDirectBaseUrl', url })
    })

    // Autosave model choices on change
    function saveModelsDebounced() {
      clearTimeout(saveModelsDebounced._t)
      saveModelsDebounced._t = setTimeout(() => {
        const reasoning = reasoningEl.value.trim()
        const completion = completionEl.value.trim()
        vscode.postMessage({ type: 'saveModels', reasoning, completion })
      }, 400)
    }
    reasoningEl.addEventListener('change', saveModelsDebounced)
    completionEl.addEventListener('change', saveModelsDebounced)

    function setModels(list, selectedReasoning, selectedCompletion) {
      modelsListEl.innerHTML = ''
      for (const id of list) {
        const opt = document.createElement('option')
        opt.value = id
        modelsListEl.appendChild(opt)
      }
      if (selectedReasoning) reasoningEl.value = selectedReasoning
      if (selectedCompletion) completionEl.value = selectedCompletion
      // Also reflect in header line
      const cm = selectedCompletion || selectedReasoning || 'None'
      currentModelEl.textContent = cm
    }

    window.addEventListener('message', (event) => {
      const { type, payload } = event.data || {}
      if (type === 'status') {
        const s = payload || { running: false }
        const badge = s.running ? 'ACTIVE' : 'STOPPED'
        const badgeEl = '<span class="badge">' + badge + '</span>'
        $('status').innerHTML = badgeEl + ' ' + (s.running ? ('Proxy: running' + (s.port ? ' on ' + s.port : '')) : 'Proxy: stopped')
        const cm = (s.completionModel && s.completionModel.trim()) ? s.completionModel : (s.reasoningModel || 'None')
        currentModelEl.textContent = cm
      } else if (type === 'models') {
        setModels(payload.list || [], payload.reasoningModel, payload.completionModel)
      } else if (type === 'modelsError') {
        setModels([], null, null)
      } else if (type === 'keys') {
        keysMap = payload || {}
        renderKeyStatus()
      } else if (type === 'endpointDetection') {
        const { kind, confidence } = payload || { kind: 'unknown', confidence: 0 }
        if (kind === 'anthropic') {
          endpointBanner.className = 'banner anthropic'
          endpointBanner.style.display = 'block'
          endpointBanner.textContent = 'Detected Anthropic-style endpoint (confidence ' + Math.round(confidence*100) + '%). You can bypass the proxy and apply directly to Claude Code.'
          bypassApplyBtn.disabled = false
        } else if (kind === 'openai') {
          endpointBanner.className = 'banner'
          endpointBanner.style.display = 'block'
          endpointBanner.textContent = 'Detected OpenAI-style endpoint (confidence ' + Math.round(confidence*100) + '%). This will work via the proxy.'
          bypassApplyBtn.disabled = true
        } else {
          endpointBanner.className = 'banner'
          endpointBanner.style.display = 'block'
          endpointBanner.textContent = 'Could not determine endpoint type with confidence. You may still try bypass if you know it\'s Anthropic-style.'
          bypassApplyBtn.disabled = false
        }
      }
    })

    // Initial requests
    vscode.postMessage({ type: 'listModels' })
    vscode.postMessage({ type: 'requestKeys' })
  </script>
</body>
</html>`
  }
}

