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
      vscode.window.showInformationMessage(`Claude-Throne: secrets daemon ready at ${info.url}`)
      log.appendLine(`[extension] secretsd token set; use Authorization: Bearer <redacted> for API calls`)
      // TODO: Next step: call secretsd to test providers and start the proxy via Python
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to start secrets daemon: ${err?.message || err}`)
    }
  })

  const stopProxy = vscode.commands.registerCommand('claudeThrone.stopProxy', async () => {
    try {
      if (secretsd) {
        await secretsd.stop()
        vscode.window.showInformationMessage('Claude-Throne: secrets daemon stopped')
      } else {
        vscode.window.showInformationMessage('Claude-Throne: nothing to stop')
      }
    } catch (err: any) {
      vscode.window.showErrorMessage(`Failed to stop: ${err?.message || err}`)
    }
  })

  const status = vscode.commands.registerCommand('claudeThrone.status', async () => {
    if (secretsd?.infoSafe) {
      vscode.window.showInformationMessage(`Claude-Throne: secrets daemon at ${secretsd.infoSafe.url}`)
    } else {
      vscode.window.showInformationMessage('Claude-Throne: secrets daemon not running')
    }
  })

  context.subscriptions.push(openConfig, startProxy, stopProxy, status, log)

  log.appendLine('Claude-Throne extension activated')
}

export function deactivate() {
  // Process cleanup is handled by SecretsDaemonManager exit handler
}

