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

  const startProxy = vscode.commands.registerCommand('claudeThrone.startProxy', async () => {
    try {
      const info = await ensureSecretsd()
      log.appendLine(`[extension] secretsd ready at ${info.url}`)
      // Default config until UI is wired: provider openrouter, default port 3000
      const status = await secretsd!.startProxy({ provider: 'openrouter', port: 3000, debug: false })
      vscode.window.showInformationMessage(`Claude-Throne: proxy ${status.running ? 'running' : 'not running'} on port ${status.port}`)
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to start proxy: ${err?.message || err}`)
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
    }
  })

  context.subscriptions.push(openConfig, startProxy, stopProxy, status, log)

  log.appendLine('Claude-Throne extension activated')
}

export function deactivate() {
  // Process cleanup is handled by SecretsDaemonManager exit handler
}

