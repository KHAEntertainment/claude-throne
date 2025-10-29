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

/**
 * @deprecated This function is deprecated and should not be used.
 * 
 * All Anthropic-native providers (Deepseek, GLM, custom Anthropic endpoints) should now route
 * through the proxy instead of being applied directly. The proxy handles authentication by
 * injecting API keys and forwards requests to the provider's URL stored in ANTHROPIC_PROXY_BASE_URL.
 * 
 * This function was previously used to bypass the proxy and configure Claude Code to connect
 * directly to Anthropic-native provider URLs, but this approach prevented the proxy from
 * managing authentication and caused API key injection failures.
 * 
 * Use the standard proxy workflow instead:
 * 1. Start the proxy with the provider configuration
 * 2. The proxy will listen on localhost and inject authentication headers
 * 3. Use applyToClaudeCode command to configure Claude Code to point at the proxy URL
 */
export async function applyAnthropicUrl(options: ApplyOptions): Promise<void> {
  // Comment 10: Gate deprecated function with feature flag
  const cfg = vscode.workspace.getConfiguration('claudeThrone')
  const featureFlags = cfg.get<any>('featureFlags', {})
  const enableAnthropicDirectApply = featureFlags.enableAnthropicDirectApply === true
  
  if (!enableAnthropicDirectApply) {
    const errorMsg = 'applyAnthropicUrl is deprecated and disabled by default. ' +
      'Use proxy-based apply instead. ' +
      'To enable temporarily, set claudeThrone.featureFlags.enableAnthropicDirectApply = true'
    console.warn(`[DEPRECATED] ${errorMsg}`)
    throw new Error(errorMsg)
  }
  
  const { url, provider, secrets } = options
  const scopeStr = cfg.get<string>('applyScope', 'workspace')
  const scope = options.scope || (scopeStr === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace)
  
  const env: Record<string, any> = { ANTHROPIC_BASE_URL: url }
  
  // Apply model configuration
  const twoModelMode = cfg.get<boolean>('twoModelMode', false)
  const reasoningModel = cfg.get<string>('reasoningModel')
  const completionModel = cfg.get<string>('completionModel')
  const valueModel = cfg.get<string>('valueModel')
  
  if (reasoningModel) {
    if (twoModelMode && reasoningModel && completionModel && valueModel) {
      // Three-model mode: use specific models for each task type
      env.ANTHROPIC_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = completionModel
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = valueModel
    } else if (twoModelMode && reasoningModel && completionModel && !valueModel) {
      // Legacy two-model mode: fallback for partial configuration
      env.ANTHROPIC_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = completionModel
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = completionModel
    } else {
      // Single-model mode: use reasoning model for everything
      env.ANTHROPIC_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = reasoningModel
    }
  }
  
  // NOTE: We no longer set ANTHROPIC_API_KEY for any providers
  // The proxy now handles all API key injection to avoid OAuth conflicts
  
  // Update .claude/settings.json
  let settingsDir: string | undefined
  if (scope === vscode.ConfigurationTarget.Global) {
    settingsDir = os.homedir()
  } else if (scope === vscode.ConfigurationTarget.Workspace && vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
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
      const updated = { ...current, ...env }
      await vscode.workspace.getConfiguration().update(key, updated, scope)
    } catch {}
  }
}
