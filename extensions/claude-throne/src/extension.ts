import * as vscode from 'vscode'

export function activate(context: vscode.ExtensionContext) {
  const log = vscode.window.createOutputChannel('Claude-Throne')

  const openConfig = vscode.commands.registerCommand('claudeThrone.openConfig', async () => {
    vscode.window.showInformationMessage('Claude-Throne configuration UI coming soon.')
  })

  const startProxy = vscode.commands.registerCommand('claudeThrone.startProxy', async () => {
    vscode.window.showInformationMessage('Starting Claude-Throne proxy (placeholder).')
  })

  const stopProxy = vscode.commands.registerCommand('claudeThrone.stopProxy', async () => {
    vscode.window.showInformationMessage('Stopping Claude-Throne proxy (placeholder).')
  })

  const status = vscode.commands.registerCommand('claudeThrone.status', async () => {
    vscode.window.showInformationMessage('Claude-Throne status: (placeholder).')
  })

  context.subscriptions.push(openConfig, startProxy, stopProxy, status)

  log.appendLine('Claude-Throne extension activated')
}

export function deactivate() {}

