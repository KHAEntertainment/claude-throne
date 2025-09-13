import * as vscode from 'vscode'
import { SecretsService } from './services/Secrets'
import { ProxyManager } from './services/ProxyManager'
import { PanelViewProvider } from './views/PanelViewProvider'

let proxy: ProxyManager | null = null

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Claude-Throne')
  const secrets = new SecretsService(context.secrets)
  proxy = new ProxyManager(context, log, secrets)

  // Register the sidebar/activity bar panel view
  const panelProvider = new PanelViewProvider(context, secrets, proxy, log)
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeThrone.panel', panelProvider),
    vscode.window.registerWebviewViewProvider('claudeThrone.activity', panelProvider)
  )

  // Commands
  const openPanel = vscode.commands.registerCommand('claudeThrone.openPanel', async () => {
    // Try Panel view first, fall back to Activity Bar view
    if (!(await tryOpenView('claudeThrone.panel'))) {
      if (!(await tryOpenView('claudeThrone.activity'))) {
        await panelProvider.reveal()
      }
    }
  })

  const revertApply = vscode.commands.registerCommand('claudeThrone.revertApply', async () => {
    // Remove base URL overrides from known extension settings
    const candidates: { section: string; key: string }[] = [
      { section: 'anthropic', key: 'baseUrl' },
      { section: 'claude', key: 'baseUrl' },
      { section: 'claudeCode', key: 'baseUrl' },
      { section: 'claude-code', key: 'baseUrl' },
      { section: 'claude', key: 'apiBaseUrl' },
      { section: 'claudeCode', key: 'apiBaseUrl' },
    ]
    const removed: string[] = []
    for (const c of candidates) {
      try {
        const s = vscode.workspace.getConfiguration(c.section)
        const current = s.get(c.key)
        if (current !== undefined) {
          await s.update(c.key, undefined, vscode.ConfigurationTarget.Workspace)
          removed.push(`${c.section}.${c.key}`)
        }
      } catch {}
    }

    // Remove ANTHROPIC_BASE_URL from terminal env
    const termKeys = [
      'terminal.integrated.env.osx',
      'terminal.integrated.env.linux',
      'terminal.integrated.env.windows',
    ]
    let termTouched = 0
    for (const key of termKeys) {
      try {
        const cfg = vscode.workspace.getConfiguration()
        const cur = (cfg.get<Record<string, string>>(key) || {})
        if ('ANTHROPIC_BASE_URL' in cur) {
          const next = { ...cur }
          delete next['ANTHROPIC_BASE_URL']
          const hasAny = Object.keys(next).length > 0
          await cfg.update(key, hasAny ? next : undefined, vscode.ConfigurationTarget.Workspace)
          termTouched++
        }
      } catch {}
    }

    const parts: string[] = []
    if (removed.length) parts.push(`extensions: ${removed.join(', ')}`)
    if (termTouched) parts.push(`terminal env: ${termTouched} target(s)`)
    if (parts.length) {
      vscode.window.showInformationMessage(`Reverted Claude overrides (${parts.join(' | ')}). Open a new terminal for env changes to take effect.`)
    } else {
      vscode.window.showInformationMessage('No Claude overrides were found to revert.')
    }
  })

  const storeOpenRouterKey = vscode.commands.registerCommand('claudeThrone.storeOpenRouterKey', async () => {
    await storeKey('openrouter', secrets)
  })
  const storeOpenAIKey = vscode.commands.registerCommand('claudeThrone.storeOpenAIKey', async () => {
    await storeKey('openai', secrets)
  })
  const storeTogetherKey = vscode.commands.registerCommand('claudeThrone.storeTogetherKey', async () => {
    await storeKey('together', secrets)
  })
  const storeGrokKey = vscode.commands.registerCommand('claudeThrone.storeGrokKey', async () => {
    await storeKey('grok', secrets)
  })
  const storeCustomKey = vscode.commands.registerCommand('claudeThrone.storeCustomKey', async () => {
    await storeKey('custom', secrets)
  })
  const storeAnyKey = vscode.commands.registerCommand('claudeThrone.storeAnyKey', async () => {
    const pick = await vscode.window.showQuickPick([
      { label: 'OpenRouter', id: 'openrouter' },
      { label: 'OpenAI', id: 'openai' },
      { label: 'Together', id: 'together' },
      { label: 'Grok', id: 'grok' },
      { label: 'Custom', id: 'custom' },
    ], { title: 'Choose Provider', canPickMany: false })
    if (!pick) return
    await storeKey(pick.id as any, secrets)
  })

  const startProxy = vscode.commands.registerCommand('claudeThrone.startProxy', async () => {
    try {
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const provider = cfg.get<'openrouter' | 'openai' | 'together' | 'grok' | 'custom'>('provider', 'openrouter')
      const customBaseUrl = cfg.get<string>('customBaseUrl', '')
      const port = cfg.get<number>('proxy.port', 3000)
      const debug = cfg.get<boolean>('proxy.debug', false)
      const reasoningModel = cfg.get<string>('reasoningModel')
      const completionModel = cfg.get<string>('completionModel')
      await proxy!.start({ provider, customBaseUrl, port, debug, reasoningModel, completionModel })
      vscode.window.showInformationMessage(`Claude-Throne: proxy started on port ${port}`)

      const auto = cfg.get<boolean>('autoApply', true)
      if (auto) {
        await vscode.commands.executeCommand('claudeThrone.applyToClaudeCode')
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to start proxy: ${err?.message || err}`)
      log.appendLine(`[extension] start proxy error: ${err?.stack || err}`)
    }
  })

  const stopProxy = vscode.commands.registerCommand('claudeThrone.stopProxy', async () => {
    try {
      const ok = await proxy!.stop()
      vscode.window.showInformationMessage(`Claude-Throne: proxy stopped${ok ? '' : ' (not running)'}`)

      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const auto = cfg.get<boolean>('autoApply', true)
      if (auto) {
        await vscode.commands.executeCommand('claudeThrone.revertApply')
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to stop proxy: ${err?.message || err}`)
      log.appendLine(`[extension] stop proxy error: ${err?.stack || err}`)
    }
  })

  const status = vscode.commands.registerCommand('claudeThrone.status', async () => {
    const s = proxy!.getStatus()
    vscode.window.showInformationMessage(`Claude-Throne: proxy ${s.running ? 'running' : 'stopped'}${s.port ? ' on ' + s.port : ''}`)
  })

  const applyToClaudeCode = vscode.commands.registerCommand('claudeThrone.applyToClaudeCode', async () => {
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    const port = cfg.get<number>('proxy.port', 3000)
    const baseUrl = `http://127.0.0.1:${port}`

    // 1) Try to apply to known Claude/Anthropic extension settings
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
        await s.update(c.key, baseUrl, vscode.ConfigurationTarget.Workspace)
        applied.push(`${c.section}.${c.key}`)
      } catch {}
    }

    // 2) Apply to VS Code integrated terminal env for CLI usage (claude/claude-code)
    const termKeys = [
      'terminal.integrated.env.osx',
      'terminal.integrated.env.linux',
      'terminal.integrated.env.windows',
    ]
    const termApplied: string[] = []
    for (const key of termKeys) {
      try {
        const current = vscode.workspace.getConfiguration().get<Record<string, string>>(key) || {}
        if (current['ANTHROPIC_BASE_URL'] === baseUrl) {
          termApplied.push(key)
          continue
        }
        const updated = { ...current, ANTHROPIC_BASE_URL: baseUrl }
        await vscode.workspace.getConfiguration().update(key, updated, vscode.ConfigurationTarget.Workspace)
        termApplied.push(key)
      } catch {}
    }

    const parts: string[] = []
    if (applied.length) parts.push(`extensions: ${applied.join(', ')}`)
    if (termApplied.length) parts.push(`terminal env (new terminals): ${termApplied.length} target(s)`)

    if (parts.length) {
      vscode.window.showInformationMessage(`Applied base URL ${baseUrl} to ${parts.join(' | ')}. Open a new terminal for env changes to take effect.`)
    } else {
      vscode.window.showWarningMessage(`No Claude Code settings detected. Set base URL to ${baseUrl} in the Claude/Anthropic extension or export ANTHROPIC_BASE_URL in your shell.`)
    }
  })

  context.subscriptions.push(
    openPanel,
    storeOpenRouterKey,
    storeOpenAIKey,
    storeTogetherKey,
    storeGrokKey,
    storeCustomKey,
    storeAnyKey,
    startProxy,
    stopProxy,
    status,
    applyToClaudeCode,
    revertApply,
    log,
  )
  log.appendLine('Claude-Throne extension activated')
}

async function tryOpenView(viewId: string): Promise<boolean> {
  try {
    await vscode.commands.executeCommand('workbench.view.openView', viewId, true)
    return true
  } catch {
    return false
  }
}

async function storeKey(provider: 'openrouter' | 'openai' | 'together' | 'grok' | 'custom', secrets: SecretsService) {
  const titles: Record<typeof provider, string> = {
    openrouter: 'OpenRouter API Key',
    openai: 'OpenAI API Key',
    together: 'Together API Key',
    grok: 'Grok API Key',
    custom: 'Custom Provider API Key',
  } as any
  const key = await vscode.window.showInputBox({
    title: `Enter ${titles[provider]}`,
    prompt: 'Your key will be stored securely in your OS keychain via VS Code SecretStorage',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => v && v.trim().length > 0 ? undefined : 'Key is required'
  })
  if (!key) return
  await secrets.setProviderKey(provider, key)
  vscode.window.showInformationMessage(`${titles[provider]} stored successfully`)
}

export function deactivate() {
  try { proxy?.stop() } catch {}
}

