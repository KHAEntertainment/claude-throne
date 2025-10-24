import * as vscode from 'vscode';
import * as os from 'os';
import { request } from 'undici';
import { SecretsService } from './services/Secrets';
import { ProxyManager } from './services/ProxyManager';
import { PanelViewProvider } from './views/PanelViewProvider';
import { updateClaudeSettings } from './services/ClaudeSettings';
import { isAnthropicEndpoint } from './services/endpoints';
import { applyAnthropicUrl } from './services/AnthropicApply';

let proxy: ProxyManager | null = null;

async function fetchAnthropicDefaults(): Promise<{ opus: string; sonnet: string; haiku: string } | null> {
  try {
    const response = await request('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    });
    
    const data: any = await response.body.json();
    const models = data.data || [];
    
    // Find latest Opus model (filter by 'opus', sort descending, take first)
    const opusModels = models.filter((m: any) => m.id.includes('opus')).sort((a: any, b: any) => b.id.localeCompare(a.id));
    const opus = opusModels.length > 0 ? opusModels[0].id : 'claude-opus-4-0';
    
    // Find latest Sonnet model
    const sonnetModels = models.filter((m: any) => m.id.includes('sonnet')).sort((a: any, b: any) => b.id.localeCompare(a.id));
    const sonnet = sonnetModels.length > 0 ? sonnetModels[0].id : 'claude-sonnet-4-0';
    
    // Find latest Haiku model
    const haikuModels = models.filter((m: any) => m.id.includes('haiku')).sort((a: any, b: any) => b.id.localeCompare(a.id));
    const haiku = haikuModels.length > 0 ? haikuModels[0].id : 'claude-3-5-haiku-latest';
    
    return { opus, sonnet, haiku };
  } catch (error) {
    console.error('Failed to fetch Anthropic defaults:', error);
    // Return hardcoded fallbacks if fetch fails
    return { opus: 'claude-opus-4-0', sonnet: 'claude-sonnet-4-0', haiku: 'claude-3-5-haiku-latest' };
  }
}

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Thronekeeper')
  log.appendLine('🚀 Thronekeeper extension activating...')
  
  // Only show output channel if debug mode is enabled
  const cfg = vscode.workspace.getConfiguration('claudeThrone')
  const debug = cfg.get<boolean>('proxy.debug', false)
  if (debug) {
    log.show()
  }
  
  const secrets = new SecretsService(context.secrets)
  log.appendLine('✅ Secrets service initialized')
  
  proxy = new ProxyManager(context, log, secrets)
  log.appendLine('✅ Proxy manager initialized')

  // Cache Anthropic defaults in background
  fetchAnthropicDefaults().then(async (defaults) => {
    if (defaults) {
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      await cfg.update('anthropicDefaults', defaults, vscode.ConfigurationTarget.Global)
      log.appendLine(`✅ Cached Anthropic defaults: opus=${defaults.opus}, sonnet=${defaults.sonnet}, haiku=${defaults.haiku}`)
    }
  }).catch((err) => {
    log.appendLine(`⚠️ Failed to cache Anthropic defaults: ${err}`)
  })

  // Register the sidebar/activity bar panel view
  log.appendLine('📋 Registering webview view providers...')
  const panelProvider = new PanelViewProvider(context, secrets, proxy, log)
  log.appendLine('✅ Panel provider created')
  
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('claudeThrone.panel', panelProvider),
    vscode.window.registerWebviewViewProvider('claudeThrone.activity', panelProvider)
  )
  log.appendLine('✅ Webview providers registered')

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
    const cfg = vscode.workspace.getConfiguration('claudeThrone');
    const scopeStr = cfg.get<string>('applyScope', 'workspace');
    const scope = scopeStr === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;

    let settingsDir: string | undefined;
    if (scopeStr === 'global') {
        settingsDir = os.homedir();
    } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        settingsDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
    }

    // Get cached Anthropic defaults
    const defaults = cfg.get<any>('anthropicDefaults', null);
    
    // First remove Thronekeeper settings, then restore Anthropic defaults
    if (settingsDir) {
        // Remove Thronekeeper env vars
        await updateClaudeSettings(settingsDir, {
            ANTHROPIC_BASE_URL: null,
            ANTHROPIC_MODEL: null,
            ANTHROPIC_DEFAULT_SONNET_MODEL: null,
            ANTHROPIC_DEFAULT_OPUS_MODEL: null,
            ANTHROPIC_DEFAULT_HAIKU_MODEL: null,
        }, /*revert*/ true);
        
        // Restore Anthropic defaults if available
        if (defaults && defaults.opus && defaults.sonnet && defaults.haiku) {
            await updateClaudeSettings(settingsDir, {
                ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
                ANTHROPIC_MODEL: defaults.sonnet,
                ANTHROPIC_DEFAULT_OPUS_MODEL: defaults.opus,
                ANTHROPIC_DEFAULT_SONNET_MODEL: defaults.sonnet,
                ANTHROPIC_DEFAULT_HAIKU_MODEL: defaults.haiku
            }, /*revert*/ false);
        } else {
            // Fallback to just base URL if defaults not cached
            await updateClaudeSettings(settingsDir, {
                ANTHROPIC_BASE_URL: 'https://api.anthropic.com'
            }, /*revert*/ false);
        }
    }
    
    // NOTE: We do NOT clear reasoningModel/completionModel here anymore
    // User's saved model preferences should persist across proxy stop/start cycles
    // Only .claude/settings.json is reverted to Anthropic defaults for Claude Code CLI
    
    // Restore base URL to Anthropic defaults in extension settings
    const candidates: { section: string; key: string }[] = [
      { section: 'anthropic', key: 'baseUrl' },
      { section: 'claude', key: 'baseUrl' },
      { section: 'claudeCode', key: 'baseUrl' },
      { section: 'claude-code', key: 'baseUrl' },
      { section: 'claude', key: 'apiBaseUrl' },
      { section: 'claudeCode', key: 'apiBaseUrl' },
    ];
    const restored: string[] = [];
    for (const c of candidates) {
      try {
        const s = vscode.workspace.getConfiguration(c.section);
        const current = s.get(c.key);
        if (current !== undefined) {
          // Restore to Anthropic default instead of just removing
          await s.update(c.key, 'https://api.anthropic.com', scope);
          restored.push(`${c.section}.${c.key}`);
        }
      } catch {}
    }

    // Restore ANTHROPIC_BASE_URL to Anthropic default in terminal env
    const termKeys = [
      'terminal.integrated.env.osx',
      'terminal.integrated.env.linux',
      'terminal.integrated.env.windows',
    ];
    let termTouched = 0;
    for (const key of termKeys) {
      try {
        const cfg = vscode.workspace.getConfiguration();
        const cur = (cfg.get<Record<string, string>>(key) || {});
        if ('ANTHROPIC_BASE_URL' in cur) {
          const next = { ...cur, ANTHROPIC_BASE_URL: 'https://api.anthropic.com' };
          await cfg.update(key, next, scope);
          termTouched++;
        }
      } catch {}
    }

    const parts: string[] = []
    if (restored.length) parts.push(`extensions: ${restored.join(', ')}`)
    if (termTouched) parts.push(`terminal env: ${termTouched} target(s)`)
    if (defaults && defaults.opus && defaults.sonnet && defaults.haiku) {
      parts.push(`models: ${defaults.opus.split('-').slice(-1)[0]} (Opus), ${defaults.sonnet.split('-').slice(-1)[0]} (Sonnet), ${defaults.haiku.split('-').slice(-1)[0]} (Haiku)`)
    }
    if (parts.length) {
      vscode.window.showInformationMessage(`Restored Anthropic defaults (${parts.join(' | ')}). Open a new terminal for env changes to take effect.`)
    } else {
      vscode.window.showInformationMessage('No Claude overrides were found to restore.')
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
  const storeDeepseekKey = vscode.commands.registerCommand('claudeThrone.storeDeepseekKey', async () => {
    await storeKey('deepseek', secrets)
  })
  const storeGlmKey = vscode.commands.registerCommand('claudeThrone.storeGlmKey', async () => {
    await storeKey('glm', secrets)
  })
  const storeCustomKey = vscode.commands.registerCommand('claudeThrone.storeCustomKey', async () => {
    await storeKey('custom', secrets)
  })
  const storeAnyKey = vscode.commands.registerCommand('claudeThrone.storeAnyKey', async () => {
    const pick = await vscode.window.showQuickPick([
      { label: 'OpenRouter', id: 'openrouter' },
      { label: 'OpenAI', id: 'openai' },
      { label: 'Together', id: 'together' },
      { label: 'Deepseek', id: 'deepseek' },
      { label: 'GLM', id: 'glm' },
      { label: 'Custom', id: 'custom' },
    ], { title: 'Choose Provider', canPickMany: false })
    if (!pick) return
    await storeKey(pick.id as any, secrets)
  })

  const startProxy = vscode.commands.registerCommand('claudeThrone.startProxy', async () => {
    try {
      const startTime = Date.now()
      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const provider = cfg.get<'openrouter' | 'openai' | 'together' | 'deepseek' | 'glm' | 'custom'>('provider', 'openrouter')
      const customBaseUrl = cfg.get<string>('customBaseUrl', '')
      const port = cfg.get<number>('proxy.port', 3000)
      const debug = cfg.get<boolean>('proxy.debug', false)
      const reasoningModel = cfg.get<string>('reasoningModel')
      const completionModel = cfg.get<string>('completionModel')
      const twoModelMode = cfg.get<boolean>('twoModelMode', false)
      
      log.appendLine(`[startProxy] Starting with config: provider=${provider}, port=${port}, twoModelMode=${twoModelMode}`)
      log.appendLine(`[startProxy] Models: reasoning=${reasoningModel}, completion=${completionModel}`)
      
      // Bypass proxy for Deepseek (Anthropic-native provider)
      if (provider === 'deepseek') {
        const url = 'https://api.deepseek.com/anthropic'
        log.appendLine(`[startProxy] Deepseek is Anthropic-native, bypassing proxy and applying URL directly`)
        await applyAnthropicUrl({ url, provider: 'deepseek', secrets })
        vscode.window.showInformationMessage(`Applied Deepseek Anthropic endpoint directly: ${url}`)
        return
      }
      
      // Bypass proxy for GLM (Anthropic-native provider)
      if (provider === 'glm') {
        const url = 'https://api.z.ai/api/anthropic'
        log.appendLine(`[startProxy] GLM is Anthropic-native, bypassing proxy and applying URL directly`)
        await applyAnthropicUrl({ url, provider: 'glm', secrets })
        vscode.window.showInformationMessage(`Applied GLM Anthropic endpoint directly: ${url}`)
        return
      }
      
      await proxy!.start({ provider, customBaseUrl, port, debug, reasoningModel, completionModel })
      
      const elapsed = Date.now() - startTime
      log.appendLine(`[startProxy] Proxy started in ${elapsed}ms`)
      vscode.window.showInformationMessage(`Thronekeeper: proxy started on port ${port}`)

      const auto = cfg.get<boolean>('autoApply', false)
      if (auto) {
        // Wait for proxy to be fully ready before applying settings
        await new Promise(resolve => setTimeout(resolve, 1000))
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
      vscode.window.showInformationMessage(`Thronekeeper: proxy stopped${ok ? '' : ' (not running)'}`)

      const cfg = vscode.workspace.getConfiguration('claudeThrone')
      const auto = cfg.get<boolean>('autoApply', false)
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
    vscode.window.showInformationMessage(`Thronekeeper: proxy ${s.running ? 'running' : 'stopped'}${s.port ? ' on ' + s.port : ''}`)
  })

  const applyToClaudeCode = vscode.commands.registerCommand('claudeThrone.applyToClaudeCode', async () => {
    const cfg = vscode.workspace.getConfiguration('claudeThrone');
    const port = cfg.get<number>('proxy.port', 3000);
    const baseUrl = `http://127.0.0.1:${port}`;
    const reasoningModel = cfg.get<string>('reasoningModel');
    const completionModel = cfg.get<string>('completionModel');
    const scopeStr = cfg.get<string>('applyScope', 'workspace');
    const scope = scopeStr === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;

    const twoModelMode = cfg.get<boolean>('twoModelMode', false);
    const env: Record<string, any> = { ANTHROPIC_BASE_URL: baseUrl };

    log.appendLine(`[applyToClaudeCode] Applying config: twoModelMode=${twoModelMode}`);
    log.appendLine(`[applyToClaudeCode] Input models: reasoning='${reasoningModel || 'EMPTY'}', completion='${completionModel || 'EMPTY'}'`);
    
    if (twoModelMode && reasoningModel && completionModel) {
        // Two-model mode: use reasoning model for complex tasks, completion model for fast execution
        log.appendLine(`[applyToClaudeCode] Two-model mode enabled`);
        log.appendLine(`[applyToClaudeCode] - OPUS (complex reasoning): ${reasoningModel}`);
        log.appendLine(`[applyToClaudeCode] - SONNET (balanced tasks): ${completionModel}`);
        log.appendLine(`[applyToClaudeCode] - HAIKU (fast execution): ${completionModel}`);
        env.ANTHROPIC_MODEL = reasoningModel;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = reasoningModel;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = completionModel;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = completionModel;
    } else if (reasoningModel) {
        // Single-model mode: use reasoning model for everything
        log.appendLine(`[applyToClaudeCode] Single-model mode: using ${reasoningModel} for all roles`);
        env.ANTHROPIC_MODEL = reasoningModel;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = reasoningModel;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = reasoningModel;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = reasoningModel;
    } else {
        log.appendLine(`[applyToClaudeCode] ⚠️ WARNING: No reasoning model configured!`);
        log.appendLine(`[applyToClaudeCode] ⚠️ Models will NOT be written to .claude/settings.json`);
        log.appendLine(`[applyToClaudeCode] ⚠️ File will retain previous values or Anthropic defaults`);
    }
    
    log.appendLine(`[applyToClaudeCode] Env vars to write: ${JSON.stringify(Object.keys(env))}`);
    log.appendLine(`[applyToClaudeCode] Will write models to settings.json: ${!!reasoningModel}`);

    let settingsDir: string | undefined;
    if (scopeStr === 'global') {
        settingsDir = os.homedir();
    } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        settingsDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
    }

    if (settingsDir) {
        await updateClaudeSettings(settingsDir, env);
    }

    // 1) Try to apply to known Claude/Anthropic extension settings
    const candidates: { section: string; key: string }[] = [
      { section: 'anthropic', key: 'baseUrl' },
      { section: 'claude', key: 'baseUrl' },
      { section: 'claudeCode', key: 'baseUrl' },
      { section: 'claude-code', key: 'baseUrl' },
      { section: 'claude', key: 'apiBaseUrl' },
      { section: 'claudeCode', key: 'apiBaseUrl' },
    ];

    const applied: string[] = [];
    for (const c of candidates) {
      try {
        const s = vscode.workspace.getConfiguration(c.section);
        await s.update(c.key, baseUrl, scope);
        applied.push(`${c.section}.${c.key}`);
      } catch {}
    }

    // 2) Apply to VS Code integrated terminal env for CLI usage (claude/claude-code)
    const termKeys = [
      'terminal.integrated.env.osx',
      'terminal.integrated.env.linux',
      'terminal.integrated.env.windows',
    ];
    const termApplied: string[] = [];
    for (const key of termKeys) {
      try {
        const current = vscode.workspace.getConfiguration().get<Record<string, string>>(key) || {};
        if (current['ANTHROPIC_BASE_URL'] === baseUrl) {
          termApplied.push(key);
          continue;
        }
        const updated = { ...current, ANTHROPIC_BASE_URL: baseUrl };
        await vscode.workspace.getConfiguration().update(key, updated, scope);
        termApplied.push(key);
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
    storeDeepseekKey,
    storeGlmKey,
    storeCustomKey,
    storeAnyKey,
    startProxy,
    stopProxy,
    status,
    applyToClaudeCode,
    revertApply,
    log,
  )
  log.appendLine('✅ Thronekeeper extension fully activated and ready')
}

async function tryOpenView(viewId: string): Promise<boolean> {
  try {
    await vscode.commands.executeCommand('workbench.view.openView', viewId, true)
    return true
  } catch {
    return false
  }
}

type Provider = 'openrouter' | 'openai' | 'together' | 'deepseek' | 'glm' | 'custom'

async function storeKey(provider: Provider, secrets: SecretsService) {
  const titles: Record<Provider, string> = {
    openrouter: 'OpenRouter API Key',
    openai: 'OpenAI API Key',
    together: 'Together API Key',
    deepseek: 'Deepseek API Key',
    glm: 'GLM API Key',
    custom: 'Custom Provider API Key',
  }
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

