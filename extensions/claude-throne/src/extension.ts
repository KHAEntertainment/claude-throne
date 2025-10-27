import * as vscode from 'vscode';
import * as os from 'os';
import { request } from 'undici';
import { SecretsService } from './services/Secrets';
import { ProxyManager } from './services/ProxyManager';
import { PanelViewProvider } from './views/PanelViewProvider';
import { updateClaudeSettings } from './services/ClaudeSettings';

let proxy: ProxyManager | null = null;

/**
 * Retrieves the latest Anthropic model IDs for opus, sonnet, and haiku, falling back to hardcoded defaults when necessary.
 *
 * @param secrets - Optional SecretsService instance to retrieve Anthropic API key for authenticated requests
 * @returns An object with `opus`, `sonnet`, and `haiku` fields containing the chosen model IDs; if fetching or selection fails, returns predefined default model IDs.
 */
async function fetchAnthropicDefaults(secrets?: SecretsService): Promise<{ opus: string; sonnet: string; haiku: string }> {
  try {
    // Build headers conditionally with authentication if available
    const headers: Record<string, string> = {
      'anthropic-version': '2023-06-01',
      'Content-Type': 'application/json'
    };
    
    let isAuthenticated = false;
    if (secrets) {
      const apiKey = await secrets.getAnthropicKey();
      if (apiKey) {
        headers['x-api-key'] = apiKey;
        isAuthenticated = true;
      }
    }
    
    console.log(`[fetchAnthropicDefaults] Making ${isAuthenticated ? 'authenticated' : 'unauthenticated'} request to Anthropic API`);
    
    const response = await request('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers
    });
    
    // Handle authentication errors specifically
    if (response.statusCode === 401 || response.statusCode === 403) {
      console.log(`[fetchAnthropicDefaults] Authentication failed (${response.statusCode}), falling back to defaults`);
      if (secrets) {
        // Show user-friendly guidance
        vscode.window.showWarningMessage(
          'Anthropic API key is missing or invalid. Run "Thronekeeper: Store Anthropic API Key" to set your key and get the latest model defaults.',
          'Set API Key'
        ).then(selection => {
          if (selection === 'Set API Key') {
            vscode.commands.executeCommand('claudeThrone.storeAnthropicKey');
          }
        });
      }
      // Fall through to catch block to return defaults
      throw new Error(`Authentication failed: ${response.statusCode}`);
    }
    
    const data: any = await response.body.json();
    const models = data.data || [];
    
    // Helper to select best model: prefer -latest alias, exclude -preview and other unstable suffixes
    const selectBestModel = (filtered: any[], fallback: string): string => {
      if (filtered.length === 0) return fallback;
      
      // First, look for -latest alias (most stable and recommended)
      const latestAlias = filtered.find((m: any) => m.id.endsWith('-latest'));
      if (latestAlias) return latestAlias.id;
      
      // Filter out preview/unstable versions
      const stable = filtered.filter((m: any) => 
        !m.id.includes('-preview') && 
        !m.id.includes('-beta') && 
        !m.id.includes('-alpha')
      );
      
      // Sort stable versions descending and take first
      if (stable.length > 0) {
        stable.sort((a: any, b: any) => b.id.localeCompare(a.id));
        return stable[0].id;
      }
      
      // If no stable versions, fall back to any version (sorted)
      filtered.sort((a: any, b: any) => b.id.localeCompare(a.id));
      return filtered[0].id;
    };
    
    // Find latest Opus model
    const opusModels = models.filter((m: any) => m.id.includes('opus'));
    const opus = selectBestModel(opusModels, 'claude-opus-4-0');
    
    // Find latest Sonnet model
    const sonnetModels = models.filter((m: any) => m.id.includes('sonnet'));
    const sonnet = selectBestModel(sonnetModels, 'claude-sonnet-4-0');
    
    // Find latest Haiku model
    const haikuModels = models.filter((m: any) => m.id.includes('haiku'));
    const haiku = selectBestModel(haikuModels, 'claude-3-5-haiku-latest');
    
    return { opus, sonnet, haiku };
  } catch (error) {
    const authStatus = secrets ? (await secrets.getAnthropicKey() ? 'authenticated' : 'unauthenticated') : 'no secrets service';
    console.error(`[fetchAnthropicDefaults] Failed to fetch (${authStatus}):`, error);
    // Return hardcoded fallbacks if fetch fails
    return { opus: 'claude-opus-4-0', sonnet: 'claude-sonnet-4-0', haiku: 'claude-3-5-haiku-latest' };
  }
}

/**
 * Initialize and register Thronekeeper extension services, views, and commands.
 *
 * Sets up the output channel (shown when debug is enabled), initializes secrets and proxy managers,
 * caches Anthropic model defaults, registers webview view providers, and registers commands for:
 * storing provider keys, starting/stopping the local proxy, applying/reverting Anthropic/Claude settings,
 * and reporting proxy status. Subscribes created disposables to the provided extension context.
 *
 * @param context - The VS Code extension context used to register subscriptions and persist state
 */
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
  fetchAnthropicDefaults(secrets).then(async (defaults) => {
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    await cfg.update('anthropicDefaults', defaults, vscode.ConfigurationTarget.Global)
    log.appendLine(`✅ Cached Anthropic defaults: opus=${defaults.opus}, sonnet=${defaults.sonnet}, haiku=${defaults.haiku}`)
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
        // Multi-root workspace support: allow user to select target folder
        if (vscode.workspace.workspaceFolders.length > 1) {
            const items = vscode.workspace.workspaceFolders.map(folder => ({
                label: folder.name,
                description: folder.uri.fsPath,
                folder: folder
            }));
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select workspace folder to revert Claude Code settings',
                ignoreFocusOut: true
            });
            if (!selected) {
                return; // User cancelled
            }
            settingsDir = selected.folder.uri.fsPath;
        } else {
            settingsDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
    }

    // Try to fetch fresh defaults from API (if key is available)
    log.appendLine('[revertApply] Attempting to fetch fresh Anthropic model defaults...');
    let defaults = await fetchAnthropicDefaults(secrets);
    let usedFreshDefaults = true;
    
    if (defaults.opus && defaults.sonnet && defaults.haiku) {
      log.appendLine(`[revertApply] ✅ Fetched fresh defaults: opus=${defaults.opus}, sonnet=${defaults.sonnet}, haiku=${defaults.haiku}`);
      // Update cache with fresh values
      await cfg.update('anthropicDefaults', defaults, vscode.ConfigurationTarget.Global);
    } else {
      // Should not happen since fetchAnthropicDefaults always returns defaults, but keep fallback logic
      log.appendLine('[revertApply] ⚠️ Unexpected: defaults missing fields, falling back to cached values');
      usedFreshDefaults = false;
      const cached = cfg.get<any>('anthropicDefaults', null);
      if (cached) defaults = cached;
    }
    
    // Single atomic operation: remove Thronekeeper overrides and restore Anthropic defaults
    if (settingsDir) {
        const restoreEnv: Record<string, any> = {
            // Always set base URL to Anthropic
            ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
        };
        
        // If we have cached defaults, restore model settings
        if (defaults?.opus && defaults?.sonnet && defaults?.haiku) {
            restoreEnv.ANTHROPIC_MODEL = defaults.sonnet;
            restoreEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = defaults.opus;
            restoreEnv.ANTHROPIC_DEFAULT_SONNET_MODEL = defaults.sonnet;
            restoreEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = defaults.haiku;
        } else {
            // No cached defaults: explicitly remove model env vars
            // (Claude Code will use its own defaults)
            restoreEnv.ANTHROPIC_MODEL = null;
            restoreEnv.ANTHROPIC_DEFAULT_OPUS_MODEL = null;
            restoreEnv.ANTHROPIC_DEFAULT_SONNET_MODEL = null;
            restoreEnv.ANTHROPIC_DEFAULT_HAIKU_MODEL = null;
        }
        
        // Single call: atomic update
        await updateClaudeSettings(settingsDir, restoreEnv, /*revert*/ false);
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

    // Handle terminal env vars based on applyToTerminal setting
    const applyToTerminal = cfg.get<boolean>('applyToTerminal', false);
    let termTouched = 0;
    const termKeys = [
      'terminal.integrated.env.osx',
      'terminal.integrated.env.linux',
      'terminal.integrated.env.windows',
    ];
    
    if (applyToTerminal) {
      // applyToTerminal is enabled: restore ANTHROPIC_BASE_URL to Anthropic default
      for (const key of termKeys) {
        try {
          const wsConfig = vscode.workspace.getConfiguration();
          const cur = (wsConfig.get<Record<string, string>>(key) || {});
          if ('ANTHROPIC_BASE_URL' in cur) {
            const next = { ...cur, ANTHROPIC_BASE_URL: 'https://api.anthropic.com' };
            await wsConfig.update(key, next, scope);
            termTouched++;
          }
        } catch {}
      }
    } else {
      // applyToTerminal is disabled: clean up any stale ANTHROPIC_* vars
      // (they may have been left by old versions or manual edits)
      log.appendLine('[revertApply] applyToTerminal=false, cleaning any stale terminal env vars...');
      for (const key of termKeys) {
        try {
          const wsConfig = vscode.workspace.getConfiguration();
          const cur = wsConfig.get<Record<string, string>>(key);
          
          // If ANTHROPIC_* vars exist, remove them
          if (cur && (cur.ANTHROPIC_BASE_URL || cur.ANTHROPIC_MODEL)) {
            const cleaned = { ...cur };
            delete cleaned.ANTHROPIC_BASE_URL;
            delete cleaned.ANTHROPIC_MODEL;
            delete cleaned.ANTHROPIC_DEFAULT_OPUS_MODEL;
            delete cleaned.ANTHROPIC_DEFAULT_SONNET_MODEL;
            delete cleaned.ANTHROPIC_DEFAULT_HAIKU_MODEL;
            
            // Only update if we actually removed something
            if (Object.keys(cleaned).length !== Object.keys(cur).length) {
              await wsConfig.update(key, Object.keys(cleaned).length > 0 ? cleaned : undefined, scope);
              termTouched++;
              log.appendLine(`[revertApply] Cleaned stale ANTHROPIC_* vars from ${key}`);
            }
          }
        } catch (err) {
          log.appendLine(`[revertApply] Failed to clean ${key}: ${err}`);
        }
      }
    }

    const parts: string[] = []
    if (restored.length) parts.push(`extensions: ${restored.join(', ')}`)
    if (termTouched) parts.push(`terminal env: ${termTouched} target(s)`)
    if (defaults && defaults.opus && defaults.sonnet && defaults.haiku) {
      const source = usedFreshDefaults ? 'fetched latest from API' : 'cached';
      parts.push(`models (${source}): ${defaults.opus.split('-').slice(-1)[0]} (Opus), ${defaults.sonnet.split('-').slice(-1)[0]} (Sonnet), ${defaults.haiku.split('-').slice(-1)[0]} (Haiku)`)
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

  const storeAnthropicKey = vscode.commands.registerCommand('claudeThrone.storeAnthropicKey', async () => {
    await storeAnthropicKeyHelper(secrets)
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
      
      // All providers (including Deepseek, GLM, and custom Anthropic endpoints) now route through the proxy
      // The proxy handles authentication and forwards requests to the appropriate provider URL
      
      await proxy!.start({ provider, customBaseUrl, port, debug, reasoningModel, completionModel })
      
      const elapsed = Date.now() - startTime
      log.appendLine(`[startProxy] Proxy started in ${elapsed}ms`)
      vscode.window.showInformationMessage(`Thronekeeper: proxy started on port ${port}`)

      const auto = cfg.get<boolean>('autoApply', true)
      if (auto) {
        log.appendLine('[startProxy] autoApply enabled, applying settings to Claude Code...')
        // Wait for proxy to be fully ready before applying settings
        await new Promise(resolve => setTimeout(resolve, 1000))
        await vscode.commands.executeCommand('claudeThrone.applyToClaudeCode')
      } else {
        log.appendLine('[startProxy] autoApply disabled, configuration must be applied manually')
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
    vscode.window.showInformationMessage(`Thronekeeper: proxy ${s.running ? 'running' : 'stopped'}${s.port ? ' on ' + s.port : ''}`)
  })

  const applyToClaudeCode = vscode.commands.registerCommand('claudeThrone.applyToClaudeCode', async () => {
    const cfg = vscode.workspace.getConfiguration('claudeThrone');
    const port = cfg.get<number>('proxy.port', 3000);
    const baseUrl = `http://127.0.0.1:${port}`;
    const reasoningModel = cfg.get<string>('reasoningModel');
    const completionModel = cfg.get<string>('completionModel');
    const valueModel = cfg.get<string>('valueModel');
    const scopeStr = cfg.get<string>('applyScope', 'workspace');
    const scope = scopeStr === 'global' ? vscode.ConfigurationTarget.Global : vscode.ConfigurationTarget.Workspace;

    const twoModelMode = cfg.get<boolean>('twoModelMode', false);
    const env: Record<string, any> = { ANTHROPIC_BASE_URL: baseUrl };

    log.appendLine(`[applyToClaudeCode] Scope: ${scopeStr}`);
    log.appendLine(`[applyToClaudeCode] Applying config: twoModelMode=${twoModelMode}`);
    log.appendLine(`[applyToClaudeCode] Input models: reasoning='${reasoningModel || 'EMPTY'}', coding='${completionModel || 'EMPTY'}', value='${valueModel || 'EMPTY'}'`);
    
    // Fallback: If reasoningModel is empty but completionModel is set, use completionModel for all defaults
    let effectiveReasoningModel = reasoningModel;
    let effectiveCompletionModel = completionModel;
    let effectiveValueModel = valueModel;
    
    if (!effectiveReasoningModel && effectiveCompletionModel) {
      log.appendLine(`[applyToClaudeCode] Fallback: reasoningModel empty, using completionModel='${effectiveCompletionModel}' for all tiers`);
      effectiveReasoningModel = effectiveCompletionModel;
    }
    
    if (twoModelMode && effectiveReasoningModel && effectiveCompletionModel && effectiveValueModel) {
        // Three-model mode: use specific models for each task type
        log.appendLine(`[applyToClaudeCode] Three-model mode enabled`);
        log.appendLine(`[applyToClaudeCode] - OPUS (complex reasoning): ${effectiveReasoningModel}`);
        log.appendLine(`[applyToClaudeCode] - SONNET (balanced coding): ${effectiveCompletionModel}`);
        log.appendLine(`[applyToClaudeCode] - HAIKU (fast value): ${effectiveValueModel}`);
        env.ANTHROPIC_MODEL = effectiveReasoningModel;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = effectiveReasoningModel;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = effectiveCompletionModel;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = effectiveValueModel;
    } else if (twoModelMode && effectiveReasoningModel && effectiveCompletionModel && !effectiveValueModel) {
        // Legacy two-model mode: fallback for partial configuration
        log.appendLine(`[applyToClaudeCode] Two-model mode (legacy): using reasoning for Opus, completion for Sonnet/Haiku`);
        log.appendLine(`[applyToClaudeCode] - OPUS (complex reasoning): ${effectiveReasoningModel}`);
        log.appendLine(`[applyToClaudeCode] - SONNET (balanced coding): ${effectiveCompletionModel}`);
        log.appendLine(`[applyToClaudeCode] - HAIKU (fast value): ${effectiveCompletionModel}`);
        env.ANTHROPIC_MODEL = effectiveReasoningModel;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = effectiveReasoningModel;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = effectiveCompletionModel;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = effectiveCompletionModel;
    } else if (effectiveReasoningModel) {
        // Single-model mode: use reasoning model for everything
        log.appendLine(`[applyToClaudeCode] Single-model mode: using ${effectiveReasoningModel} for all tiers (Opus/Sonnet/Haiku)`);
        env.ANTHROPIC_MODEL = effectiveReasoningModel;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = effectiveReasoningModel;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = effectiveReasoningModel;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = effectiveReasoningModel;
    } else {
        // No models configured at all - explicitly remove model env vars to prevent stale values
        log.appendLine(`[applyToClaudeCode] ⚠️ WARNING: No models configured!`);
        log.appendLine(`[applyToClaudeCode] ⚠️ Explicitly removing model env vars to prevent stale values`);
        env.ANTHROPIC_MODEL = null;
        env.ANTHROPIC_DEFAULT_OPUS_MODEL = null;
        env.ANTHROPIC_DEFAULT_SONNET_MODEL = null;
        env.ANTHROPIC_DEFAULT_HAIKU_MODEL = null;
    }
    
    log.appendLine(`[applyToClaudeCode] Env vars to write: ${JSON.stringify(Object.keys(env))}`);
    log.appendLine(`[applyToClaudeCode] Will write models to settings.json: ${!!reasoningModel}`);

    let settingsDir: string | undefined;
    if (scopeStr === 'global') {
        settingsDir = os.homedir();
    } else if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
        // Multi-root workspace support: allow user to select target folder
        if (vscode.workspace.workspaceFolders.length > 1) {
            const items = vscode.workspace.workspaceFolders.map(folder => ({
                label: folder.name,
                description: folder.uri.fsPath,
                folder: folder
            }));
            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: 'Select workspace folder to apply Claude Code settings',
                ignoreFocusOut: true
            });
            if (!selected) {
                log.appendLine('[applyToClaudeCode] User cancelled workspace folder selection');
                return; // User cancelled
            }
            settingsDir = selected.folder.uri.fsPath;
            log.appendLine(`[applyToClaudeCode] Selected workspace folder: ${settingsDir}`);
        } else {
            settingsDir = vscode.workspace.workspaceFolders[0].uri.fsPath;
        }
    }

    if (settingsDir) {
        log.appendLine(`[applyToClaudeCode] Settings directory: ${settingsDir}`);
        const settingsPath = require('path').join(settingsDir, '.claude', 'settings.json');
        log.appendLine(`[applyToClaudeCode] Target path: ${settingsPath}`);
        log.appendLine(`[applyToClaudeCode] Environment variables: ${JSON.stringify(env, null, 2)}`);
        try {
            await updateClaudeSettings(settingsDir, env);
            log.appendLine('[applyToClaudeCode] ✅ Successfully wrote .claude/settings.json');
        } catch (err) {
            log.appendLine(`[applyToClaudeCode] ❌ ERROR writing settings: ${err}`);
            throw err;
        }
    } else {
        log.appendLine('[applyToClaudeCode] ⚠️ WARNING: No settings directory found (no workspace open?)');
    }

    // 1) Try to apply to known Claude/Anthropic extension settings (if enabled)
    const applyToExtensions = cfg.get<boolean>('applyToExtensions', false);
    const applied: string[] = [];
    
    if (applyToExtensions) {
      log.appendLine('[applyToClaudeCode] applyToExtensions=true, writing to other extension settings...');
      const candidates: { section: string; key: string }[] = [
        { section: 'anthropic', key: 'baseUrl' },
        { section: 'claude', key: 'baseUrl' },
        { section: 'claudeCode', key: 'baseUrl' },
        { section: 'claude-code', key: 'baseUrl' },
        { section: 'claude', key: 'apiBaseUrl' },
        { section: 'claudeCode', key: 'apiBaseUrl' },
      ];

      for (const c of candidates) {
        try {
          const s = vscode.workspace.getConfiguration(c.section);
          await s.update(c.key, baseUrl, scope);
          applied.push(`${c.section}.${c.key}`);
        } catch {}
      }
      log.appendLine(`[applyToClaudeCode] Updated ${applied.length} extension setting(s)`);
    } else {
      log.appendLine('[applyToClaudeCode] applyToExtensions=false, skipping other extension settings');
    }

    // 2) Apply to VS Code integrated terminal env for CLI usage (claude/claude-code)
    // This is now OPTIONAL and disabled by default (controlled by applyToTerminal setting)
    const applyToTerminal = cfg.get<boolean>('applyToTerminal', false);
    const termApplied: string[] = [];
    if (applyToTerminal) {
      log.appendLine('[applyToClaudeCode] applyToTerminal=true, writing terminal env vars...');
      const termKeys = [
        'terminal.integrated.env.osx',
        'terminal.integrated.env.linux',
        'terminal.integrated.env.windows',
      ];
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
      log.appendLine(`[applyToClaudeCode] Terminal env vars written to ${termApplied.length} platform(s)`);
    } else {
      log.appendLine('[applyToClaudeCode] applyToTerminal=false, skipping terminal env vars');
    }

    const parts: string[] = []
    if (settingsDir) parts.push('.claude/settings.json')
    if (applied.length) parts.push(`extensions: ${applied.join(', ')}`)
    if (termApplied.length) parts.push(`terminal env (new terminals): ${termApplied.length} target(s)`)

    log.appendLine(`[applyToClaudeCode] Summary: Applied to ${parts.join(', ')}`);

    if (parts.length) {
      const message = `Applied proxy configuration to Claude Code (${parts.join(', ')}). ${termApplied.length > 0 ? 'Open a new terminal for env changes.' : 'Restart Claude Code or open a new chat to use the proxy.'}`;
      vscode.window.showInformationMessage(message);
      log.appendLine(`[applyToClaudeCode] ✅ ${message}`);
    } else {
      const warning = `No Claude Code settings detected. Set base URL to ${baseUrl} in the Claude/Anthropic extension or export ANTHROPIC_BASE_URL in your shell.`;
      vscode.window.showWarningMessage(warning);
      log.appendLine(`[applyToClaudeCode] ⚠️ WARNING: ${warning}`);
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
    storeAnthropicKey,
    startProxy,
    stopProxy,
    status,
    applyToClaudeCode,
    revertApply,
    log,
  )
  log.appendLine('✅ Thronekeeper extension fully activated and ready')
}

/**
 * Attempts to open a VS Code view by its view ID.
 *
 * @param viewId - The identifier of the view to open (e.g., the view's registered ID)
 * @returns `true` if the view was opened successfully, `false` otherwise.
 */
async function tryOpenView(viewId: string): Promise<boolean> {
  try {
    await vscode.commands.executeCommand('workbench.view.openView', viewId, true)
    return true
  } catch {
    return false
  }
}

type Provider = 'openrouter' | 'openai' | 'together' | 'deepseek' | 'glm' | 'custom'

/**
 * Prompts the user to enter an Anthropic API key and saves it securely, then fetches and caches latest model defaults.
 *
 * The prompt uses a masked input and validates only that the key is non-empty (accepts any format).
 * Shows an optional warning if the key doesn't start with 'sk-' but still accepts it.
 * On success, immediately fetches latest models from Anthropic API and caches them, showing the user the discovered versions.
 *
 * @param secrets - The SecretsService instance to store the API key securely
 */
async function storeAnthropicKeyHelper(secrets: SecretsService) {
  const key = await vscode.window.showInputBox({
    title: 'Enter Anthropic API Key',
    prompt: 'Used to fetch latest model defaults from Anthropic API. Optional - extension works without it.',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => {
      // Only check for non-empty input; accept any format
      if (!v || v.trim().length === 0) return 'Key is required';
      return undefined;
    }
  });
  
  if (!key) return; // User cancelled
  
  // Optional non-blocking warning for unusual key formats
  if (!key.startsWith('sk-')) {
    vscode.window.showWarningMessage('Key does not start with "sk-"; please verify it is correct');
  }
  
  try {
    // Store the key
    await secrets.setAnthropicKey(key);
    vscode.window.showInformationMessage('Anthropic API key stored securely. Fetching latest model defaults...');
    
    // Immediately fetch fresh defaults
    const defaults = await fetchAnthropicDefaults(secrets);
    
    if (defaults) {
      // Update cached defaults
      const cfg = vscode.workspace.getConfiguration('claudeThrone');
      await cfg.update('anthropicDefaults', defaults, vscode.ConfigurationTarget.Global);
      
      // Show success with discovered versions
      vscode.window.showInformationMessage(
        `Updated Anthropic defaults: Opus=${defaults.opus}, Sonnet=${defaults.sonnet}, Haiku=${defaults.haiku}`
      );
    } else {
      vscode.window.showWarningMessage('Anthropic API key stored, but failed to fetch model defaults. Will use cached values.');
    }
  } catch (err: any) {
    vscode.window.showErrorMessage(`Failed to store Anthropic API key: ${err?.message || err}`);
  }
}

/**
 * Prompts the user to enter an API key for the specified provider and saves it securely in the extension's secret storage.
 *
 * The prompt uses a masked input and validates that a non-empty key is provided. On success, a confirmation message is shown.
 *
 * @param provider - The provider identifier whose API key will be stored (e.g., `openrouter`, `openai`, `together`, `deepseek`, `glm`, `custom`)
 */
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

