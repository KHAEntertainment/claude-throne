import * as vscode from 'vscode'
import { SecretsDaemonManager } from './managers/SecretsDaemon'
import { ConfigPanel } from './panels/ConfigPanel'

let secretsd: SecretsDaemonManager | null = null

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Claude-Throne')

  const ensureSecretsd = async () => {
    if (!secretsd) secretsd = new SecretsDaemonManager(log)
    const info = await secretsd.start(context)
    return info
  }

  const openConfig = vscode.commands.registerCommand('claudeThrone.openConfig', async () => {
    ConfigPanel.show(context)
  })

  const storeOpenRouterKey = vscode.commands.registerCommand('claudeThrone.storeOpenRouterKey', async () => {
    try {
      const info = await ensureSecretsd()
      const key = await vscode.window.showInputBox({
        title: 'Enter OpenRouter API Key',
        prompt: 'Your key will be stored securely (keyring or encrypted file fallback)',
        password: true,
        ignoreFocusOut: true,
        validateInput: (v) => v && v.trim().length > 0 ? undefined : 'Key is required'
      })
      if (!key) return
      await secretsd!.saveProviderKey('openrouter', key)
      vscode.window.showInformationMessage('OpenRouter API key stored successfully')
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to store key: ${err?.message || err}`)
      log.appendLine(`[extension] store key error: ${err?.stack || err}`)
    }
  })

  const startProxy = vscode.commands.registerCommand('claudeThrone.startProxy', async () => {
    try {
      const info = await ensureSecretsd()
      log.appendLine(`[extension] secretsd ready at ${info.url}`)
      // Default config until UI is wired: provider openrouter, default port 3000
      const status = await secretsd!.startProxy({ provider: 'openrouter', port: 3000, debug: false })
      vscode.window.showInformationMessage(`Claude-Throne: proxy ${status.running ? 'running' : 'not running'} on port ${status.port}`)
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to start proxy: ${err?.message || err}`)
      log.appendLine(`[extension] start proxy error: ${err?.stack || err}`)
    }
  })

  const stopProxy = vscode.commands.registerCommand('claudeThrone.stopProxy', async () => {
    try {
      if (!secretsd) {
        vscode.window.showInformationMessage('Claude-Throne: secrets daemon not running')
        return
      }
      const ok = await secretsd.stopProxy()
      vscode.window.showInformationMessage(`Claude-Throne: proxy stopped${ok ? '' : ' (no-op)'}`)
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to stop proxy: ${err?.message || err}`)
      log.appendLine(`[extension] stop proxy error: ${err?.stack || err}`)
    }
  })

  const status = vscode.commands.registerCommand('claudeThrone.status', async () => {
    if (!secretsd?.infoSafe) {
      vscode.window.showInformationMessage('Claude-Throne: secrets daemon not running')
      return
    }
    try {
      const s = await secretsd.getProxyStatus()
      vscode.window.showInformationMessage(`Claude-Throne: proxy ${s.running ? 'running' : 'stopped'}${s.port ? ' on ' + s.port : ''}`)
    } catch (err: any) {
      vscode.window.showErrorMessage(`Status error: ${err?.message || err}`)
      log.appendLine(`[extension] status error: ${err?.stack || err}`)
    }
  })

  const diagnose = vscode.commands.registerCommand('claudeThrone.diagnose', async () => {
    log.show()
    log.appendLine('\n=== Claude Throne Diagnostic Report ===')
    log.appendLine(`Extension Path: ${context.extensionPath}`)
    log.appendLine(`Workspace: ${vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || 'No workspace'}`)
    log.appendLine(`Platform: ${process.platform}`)
    log.appendLine(`VS Code Version: ${vscode.version}`)
    log.appendLine(`Is Container: ${process.env.REMOTE_CONTAINERS || process.env.CODESPACES ? 'Yes' : 'No'}`)
    
    // Check backend path resolution
    log.appendLine('\n--- Backend Path Resolution ---')
    const mgr = new SecretsDaemonManager(log)
    try {
      await mgr.start(context)
      log.appendLine('✅ Backend started successfully!')
    } catch (err: any) {
      log.appendLine(`❌ Backend start failed: ${err.message}`)
    }
    
    // Check Python
    log.appendLine('\n--- Python Check ---')
    const { exec } = require('child_process')
    const { promisify } = require('util')
    const execAsync = promisify(exec)
    
    for (const py of ['python3', 'python', '/usr/bin/python3']) {
      try {
        const { stdout } = await execAsync(`${py} --version`)
        log.appendLine(`✅ ${py}: ${stdout.trim()}`)
        
        // Check if dependencies are installed
        try {
          await execAsync(`${py} -c "import fastapi, uvicorn, keyring, httpx"`)
          log.appendLine(`  ✅ Dependencies installed for ${py}`)
        } catch {
          log.appendLine(`  ❌ Missing dependencies for ${py}`)
        }
      } catch {
        log.appendLine(`❌ ${py}: Not found`)
      }
    }
    
    log.appendLine('\n=== End Diagnostic Report ===')
    vscode.window.showInformationMessage('Diagnostic report written to output channel')
  })

  const setupBackend = vscode.commands.registerCommand('claudeThrone.setupBackend', async () => {
    const terminal = vscode.window.createTerminal('Claude Throne Setup')
    terminal.show()
    
    // Detect if we're in a container
    const isContainer = process.env.REMOTE_CONTAINERS || process.env.CODESPACES
    
    if (isContainer) {
      terminal.sendText('# Setting up Claude Throne backend in container...')
      terminal.sendText('cd /workspaces/claude-throne/backends/python/ct_secretsd 2>/dev/null || cd /workspace/claude-throne/backends/python/ct_secretsd 2>/dev/null || cd backends/python/ct_secretsd')
      terminal.sendText('pip install fastapi uvicorn keyring httpx cryptography python-multipart')
    } else {
      terminal.sendText('# Setting up Claude Throne backend...')
      
      // Try to find backend path
      const wf = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath
      const backendPath = wf ? `${wf}/backends/python/ct_secretsd` : 'backends/python/ct_secretsd'
      
      terminal.sendText(`cd "${backendPath}"`)
      terminal.sendText('# Creating virtual environment...')
      terminal.sendText('python3 -m venv venv')
      terminal.sendText('source venv/bin/activate')
      terminal.sendText('pip install --upgrade pip')
      terminal.sendText('pip install fastapi uvicorn keyring httpx cryptography python-multipart')
      terminal.sendText('pip install -e .')
      terminal.sendText('echo "✅ Setup complete! The extension will use this virtual environment."')
    }
    
    vscode.window.showInformationMessage('Running backend setup in terminal...')
  })

  context.subscriptions.push(openConfig, storeOpenRouterKey, startProxy, stopProxy, status, diagnose, setupBackend, log)

  log.appendLine('Claude-Throne extension activated')
}

export function deactivate() {
  // Process cleanup is handled by SecretsDaemonManager exit handler
}

