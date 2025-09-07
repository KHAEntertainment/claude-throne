import * as vscode from 'vscode'

export class ConfigPanel {
  public static currentPanel: ConfigPanel | undefined
  private readonly panel: vscode.WebviewPanel

  private constructor(panel: vscode.WebviewPanel) {
    this.panel = panel
  }

  public static show(context: vscode.ExtensionContext) {
    // If we already have a panel, reveal it
    if (ConfigPanel.currentPanel) {
      ConfigPanel.currentPanel.panel.reveal(vscode.ViewColumn.One)
      return
    }

    const panel = vscode.window.createWebviewPanel(
      'claudeThroneConfig',
      'Claude-Throne Configuration',
      vscode.ViewColumn.One,
      {
        enableScripts: false,
        retainContextWhenHidden: true
      }
    )

    panel.webview.html = this.getHtml()

    ConfigPanel.currentPanel = new ConfigPanel(panel)

    panel.onDidDispose(() => {
      ConfigPanel.currentPanel = undefined
    })
  }

  private static getHtml(): string {
    // Lightweight placeholder UI — we will replace with React webview later
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Claude-Throne</title>
<style>
  :root {
    --hive-gold: #FFD700;
    --hive-dark-gold: #B8860B;
    --hive-bg: #1a1a1a;
    --hive-text: #e0e0e0;
    --hive-muted: #b0b0b0;
    --hive-accent: #4CAF50;
  }
  body {
    margin: 0;
    padding: 0;
    background: var(--hive-bg);
    color: var(--hive-text);
    font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;
  }
  .header {
    padding: 20px;
    background: linear-gradient(135deg, var(--hive-gold), var(--hive-dark-gold));
    color: #000;
  }
  .header h1 { margin: 0; font-size: 18px; }
  .container { padding: 16px 20px 40px; }
  .card {
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 8px;
    padding: 16px;
    margin-bottom: 16px;
  }
  .muted { color: var(--hive-muted); font-size: 12px; }
  .btn {
    display: inline-block;
    background: linear-gradient(135deg, var(--hive-gold), var(--hive-dark-gold));
    color: #000;
    padding: 8px 14px;
    border-radius: 6px;
    text-decoration: none;
    font-weight: 600;
  }
</style>
</head>
<body>
  <div class="header">
    <h1>👑 Claude-Throne — Configuration (Alpha)</h1>
    <div class="muted">The Hive themed UI — webview foundation</div>
  </div>
  <div class="container">
    <div class="card">
      <h3>Status</h3>
      <p>Use the Command Palette to start the Secrets Daemon and Proxy:</p>
      <ul>
        <li><b>Claude Throne: Start Proxy</b> — starts the Secrets Daemon (ct-secretsd)</li>
        <li><b>Claude Throne: Stop Proxy</b> — stops the Secrets Daemon</li>
        <li><b>Claude Throne: Show Status</b> — shows daemon URL</li>
      </ul>
      <p class="muted">A full React UI with providers, keys, models, and status will appear here in the next step.</p>
    </div>
    <div class="card">
      <h3>Next Up</h3>
      <p>Provider connectivity checks, secure key storage, and proxy lifecycle controls from this panel.</p>
      <a class="btn" href="#" onclick="return false;">Coming Soon</a>
    </div>
  </div>
</body>
</html>`
  }
}

