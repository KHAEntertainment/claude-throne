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
 * Configures Claude/Anthropic extension settings and the VS Code terminal environment to point at a direct Anthropic provider URL.
 *
 * This function is deprecated: direct provider configuration bypasses the proxy and prevents centralized API key injection. Execution is gated by the `claudeThrone.featureFlags.enableAnthropicDirectApply` feature flag and will throw if the flag is not enabled. Use the proxy-based workflow instead.
 *
 * @deprecated Use the proxy-based apply flow instead of configuring provider URLs directly.
 * @param options - Configuration options containing the provider URL and optional helpers
 * @param options.url - The Anthropic provider base URL to apply to settings and terminal environments
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
  const opusPlanMode = cfg.get<boolean>('opusPlanMode', false)
  const reasoningModel = cfg.get<string>('reasoningModel')
  const completionModel = cfg.get<string>('completionModel')
  const valueModel = cfg.get<string>('valueModel')
  const apiTimeoutMs = cfg.get<number>('claudeCode.apiTimeoutMs', 3000000)
  const disableNonessentialTraffic = cfg.get<boolean>('claudeCode.disableNonessentialTraffic', false)
  
  if (reasoningModel) {
    if (twoModelMode && reasoningModel && completionModel && valueModel) {
      // Three-model mode (current): use specific models for reasoning, completion, and value tasks
      // OpusPlan mode: Use 'opusplan' model identifier while respecting user's tier mappings
      env.ANTHROPIC_MODEL = (opusPlanMode && twoModelMode) ? 'opusplan' : reasoningModel
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = completionModel
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = valueModel
    } else if (twoModelMode && reasoningModel && completionModel && !valueModel) {
      // Legacy two-model mode (deprecated): fallback when only reasoning and completion are configured, uses completion for value
      env.ANTHROPIC_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = completionModel
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = completionModel
    } else {
      // Single-model mode (fallback): use reasoning model for all task types when three-model mode is disabled
      env.ANTHROPIC_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = reasoningModel
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = reasoningModel
    }
  }
  
  // Add Claude Code environment variables
  env.API_TIMEOUT_MS = apiTimeoutMs
  if (disableNonessentialTraffic) {
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
  } else {
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = null
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
  
  // Create sanitized env for terminal (strings only, no null values)
  const envForTerminal = Object.fromEntries(
    Object.entries(env).filter(([_, v]) => v !== null).map(([k, v]) => [k, String(v)])
  )
  
  for (const key of termKeys) {
    try {
      const current = vscode.workspace.getConfiguration().get<Record<string, string>>(key) || {}
      const updated = { ...current, ...envForTerminal }
      // Remove keys that were set to null in env
      for (const envKey of Object.keys(env)) {
        if (env[envKey] === null) {
          delete updated[envKey]
        }
      }
      await vscode.workspace.getConfiguration().update(key, updated, scope)
    } catch {}
  }
}