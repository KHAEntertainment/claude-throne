import * as vscode from 'vscode'
import * as os from 'os'
import { updateClaudeSettings } from './ClaudeSettings'
import { SecretsService } from './Secrets'

export interface ApplyOptions {
  url: string
  provider?: string
  secrets?: SecretsService
  scope?: vscode.ConfigurationTarget
}

export async function applyAnthropicUrl(options: ApplyOptions): Promise<void> {
  const { url, provider, secrets } = options
  const cfg = vscode.workspace.getConfiguration('claudeThrone')
  const scopeStr = cfg.get<string>('applyScope', 'workspace')
  const scope = options.scope || (scopeStr === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace)
  
  const env: Record<string, any> = { ANTHROPIC_BASE_URL: url }
  
  // Apply model configuration
  const twoModelMode = cfg.get<boolean>('twoModelMode', false)
  const reasoningModel = cfg.get<string>('reasoningModel')
  const completionModel = cfg.get<string>('completionModel')
  
  if (reasoningModel) {
    if (twoModelMode && completionModel) {
      env.ANTHROPIC_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = completionModel
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = completionModel
    } else {
      env.ANTHROPIC_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = reasoningModel
    }
  }
  
  // Apply API key for Anthropic-native providers (deepseek/glm)
  if (provider && secrets) {
    const apiKey = await secrets.getProviderKey(provider)
    if (apiKey) {
      env.ANTHROPIC_API_KEY = apiKey
    }
  }
  
  // Update .claude/settings.json
  let settingsDir: string | undefined
  if (scopeStr === 'global') {
    settingsDir = os.homedir()
  } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
    settingsDir = vscode.workspace.workspaceFolders[0].uri.fsPath
  }
  
  if (settingsDir) {
    await updateClaudeSettings(settingsDir, env)
  }
  
  // Apply to known Claude/Anthropic extension settings
  const candidates: { section: string; key: string }[] = [
    { section: 'anthropic', key: 'baseUrl' },
    { section: 'claude', key: 'baseUrl' },
    { section: 'claudeCode', key: 'baseUrl' },
    { section: 'claude-code', key: 'baseUrl' },
    { section: 'claude', key: 'apiBaseUrl' },
    { section: 'claudeCode', key: 'apiBaseUrl' },
  ]
  
  for (const c of candidates) {
    try {
      const s = vscode.workspace.getConfiguration(c.section)
      await s.update(c.key, url, scope)
    } catch {}
  }
  
  // Apply to VS Code integrated terminal env for CLI usage
  const termKeys = [
    'terminal.integrated.env.osx',
    'terminal.integrated.env.linux',
    'terminal.integrated.env.windows',
  ]
  
  for (const key of termKeys) {
    try {
      const current = vscode.workspace.getConfiguration().get<Record<string, string>>(key) || {}
      if (current['ANTHROPIC_BASE_URL'] === url) {
        continue
      }
      const updated = { ...current, ANTHROPIC_BASE_URL: url }
      await vscode.workspace.getConfiguration().update(key, updated, scope)
    } catch {}
  }
}
