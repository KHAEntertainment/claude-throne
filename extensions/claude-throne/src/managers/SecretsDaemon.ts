import * as vscode from 'vscode'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import * as path from 'path'
import * as net from 'net'
import * as fs from 'fs'
import { randomBytes } from 'crypto'

export interface SecretsDaemonInfo {
  host: string
  port: number
  token: string
  url: string
}

export interface StartProxyConfig {
  provider: 'openrouter' | 'openai' | 'together' | 'groq' | 'custom'
  custom_url?: string
  reasoning_model?: string
  execution_model?: string
  port?: number
  debug?: boolean
}

export interface ProxyStatus { running: boolean; port?: number; pid?: number }

export class SecretsDaemonManager {
  private proc: ChildProcessWithoutNullStreams | null = null
  private info: SecretsDaemonInfo | null = null
  private output: vscode.OutputChannel

  constructor(output: vscode.OutputChannel) {
    this.output = output
  }

  get isRunning(): boolean {
    return !!this.proc && !this.proc.killed
  }

  get infoSafe(): SecretsDaemonInfo | null {
    return this.info
  }

  async start(context: vscode.ExtensionContext, pythonPath?: string): Promise<SecretsDaemonInfo> {
    if (this.isRunning && this.info) return this.info

    const host = '127.0.0.1'
    const port = await this.getFreePort()
    const token = this.generateToken()

    // Resolve backend path with multiple strategies
    const backendRoot = await this.resolveBackendPath(context)
    
    // Resolve python interpreter - try to find one that works
    const python = await this.resolvePython(backendRoot, pythonPath)

    // Validate backend path exists (expect ct_secretsd package dir)
    if (!fs.existsSync(backendRoot) || !fs.existsSync(path.join(backendRoot, 'ct_secretsd'))) {
      this.output.appendLine(`[secretsd] backend not found at ${backendRoot}`)
      this.output.appendLine(`[secretsd] Please either:`)
      this.output.appendLine(`[secretsd]   1. Set 'claudeThrone.backendPath' in settings`)
      this.output.appendLine(`[secretsd]   2. Ensure the backend exists at workspace/backends/python/ct_secretsd`)
      this.output.appendLine(`[secretsd]   3. Install dependencies: pip install fastapi uvicorn keyring httpx cryptography`)
      throw new Error(`Backend path not found: ${backendRoot}`)
    }

    this.output.appendLine(`[secretsd] launching via ${python} at ${backendRoot} on ${host}:${port}`)

    this.proc = spawn(python, [
      '-m', 'ct_secretsd',
      '--host', host,
      '--port', String(port),
      '--auth-token', token,
      '--text-logs'
    ], {
      cwd: backendRoot,
      env: process.env,
      stdio: 'pipe'
    })

    this.proc.stdout.on('data', (d: Buffer) => {
      const line = d.toString()
      // Redact token if it ever appears (defense-in-depth)
      this.output.appendLine(`[secretsd] ${line.split(token).join('<redacted>')}`)
    })
    this.proc.stderr.on('data', (d: Buffer) => {
      const line = d.toString()
      this.output.appendLine(`[secretsd:err] ${line.split(token).join('<redacted>')}`)
    })
    this.proc.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.output.appendLine(`[secretsd] exited code=${code} signal=${signal}`)
      this.proc = null
      this.info = null
    })

    const url = `http://${host}:${port}`
    this.info = { host, port, token, url }

    // Wait for readiness
    await this.waitForHealth(url)
    this.output.appendLine(`[secretsd] ready at ${url}`)
    return this.info
  }

  async stop(): Promise<void> {
    if (!this.proc) return
    this.output.appendLine('[secretsd] stopping...')
    try {
      this.proc.kill('SIGINT')
    } catch {}
    this.proc = null
    this.info = null
  }

  private authHeaders(): Record<string, string> {
    if (!this.info) throw new Error('secrets daemon not running')
    return {
      'Authorization': `Bearer ${this.info.token}`,
      'Content-Type': 'application/json'
    }
  }

  async getProxyStatus(): Promise<ProxyStatus> {
    if (!this.info) throw new Error('secrets daemon not running')
    const res = await fetch(`${this.info.url}/proxy/status`, { headers: this.authHeaders() })
    if (!res.ok) throw new Error(`status failed: ${res.status}`)
    return res.json()
  }

  async startProxy(cfg: StartProxyConfig): Promise<ProxyStatus> {
    if (!this.info) throw new Error('secrets daemon not running')
    const res = await fetch(`${this.info.url}/proxy/start`, {
      method: 'POST',
      headers: this.authHeaders(),
      body: JSON.stringify(cfg)
    })
    if (!res.ok) {
      const msg = await res.text()
      throw new Error(`start proxy failed: ${res.status} ${msg}`)
    }
    return res.json()
  }

  async saveProviderKey(providerId: string, apiKey: string): Promise<void> {
    if (!this.info) throw new Error('secrets daemon not running')
    const res = await fetch(`${this.info.url}/secrets/provider/${providerId}`, {
      method: 'PUT',
      headers: this.authHeaders(),
      body: JSON.stringify({ api_key: apiKey })
    })
    if (!res.ok) {
      const msg = await res.text()
      throw new Error(`save key failed: ${res.status} ${msg}`)
    }
  }

  async stopProxy(): Promise<boolean> {
    if (!this.info) throw new Error('secrets daemon not running')
    const res = await fetch(`${this.info.url}/proxy/stop`, { method: 'POST', headers: this.authHeaders() })
    if (!res.ok) throw new Error(`stop proxy failed: ${res.status}`)
    const data = await res.json()
    return Boolean(data?.success)
  }

  private async waitForHealth(url: string, timeoutMs = 10000): Promise<void> {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${url}/health`, { method: 'GET' })
        if (res.ok) return
      } catch {}
      await new Promise(r => setTimeout(r, 200))
    }
    throw new Error('secretsd did not become healthy in time')
  }

  private async getFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer()
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (typeof address === 'object' && address && 'port' in address) {
          const port = address.port
          server.close(() => resolve(port))
        } else {
          server.close(() => reject(new Error('Could not determine free port')))
        }
      })
      server.on('error', reject)
    })
  }

  private generateToken(): string {
    return randomBytes(32).toString('base64url')
  }

  private async resolveBackendPath(context: vscode.ExtensionContext): Promise<string> {
    // Strategy 1: Use explicitly configured path
    const configuredBackend = vscode.workspace.getConfiguration('claudeThrone').get<string>('backendPath')?.trim()
    if (configuredBackend && fs.existsSync(configuredBackend)) {
      this.output.appendLine(`[secretsd] Using configured backend path: ${configuredBackend}`)
      return configuredBackend
    }

    // Strategy 2: Check common container paths
    const containerPaths = [
      '/workspaces/claude-throne/backends/python/ct_secretsd',
      '/workspace/claude-throne/backends/python/ct_secretsd',
      '/workspaces/mighty-morphin-claude/backends/python/ct_secretsd',
      '/app/backends/python/ct_secretsd',
      '/home/node/backends/python/ct_secretsd'
    ]
    
    for (const containerPath of containerPaths) {
      if (fs.existsSync(containerPath) && fs.existsSync(path.join(containerPath, 'ct_secretsd'))) {
        this.output.appendLine(`[secretsd] Found backend in container at: ${containerPath}`)
        return containerPath
      }
    }

    // Strategy 3: Check workspace folders
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        const possiblePaths = [
          path.join(folder.uri.fsPath, 'backends/python/ct_secretsd'),
          path.join(folder.uri.fsPath, 'backends', 'python', 'ct_secretsd'),
          path.join(folder.uri.fsPath, '..', 'backends/python/ct_secretsd')  // parent dir
        ]
        
        for (const wsPath of possiblePaths) {
          if (fs.existsSync(wsPath) && fs.existsSync(path.join(wsPath, 'ct_secretsd'))) {
            this.output.appendLine(`[secretsd] Found backend in workspace at: ${wsPath}`)
            return wsPath
          }
        }
      }
    }

    // Strategy 4: Check relative to extension installation
    const extensionRelativePaths = [
      path.resolve(context.extensionPath, '../../backends/python/ct_secretsd'),
      path.resolve(context.extensionPath, '../../../backends/python/ct_secretsd'),
      path.resolve(context.extensionPath, 'backends/python/ct_secretsd')
    ]
    
    for (const extPath of extensionRelativePaths) {
      if (fs.existsSync(extPath) && fs.existsSync(path.join(extPath, 'ct_secretsd'))) {
        this.output.appendLine(`[secretsd] Found backend relative to extension at: ${extPath}`)
        return extPath
      }
    }

    // Strategy 5: Try to find it anywhere in common development locations
    const homedir = process.env.HOME || process.env.USERPROFILE
    if (homedir) {
      const devPaths = [
        path.join(homedir, 'Documents/Scripting Projects/claude-throne/backends/python/ct_secretsd'),
        path.join(homedir, 'projects/claude-throne/backends/python/ct_secretsd'),
        path.join(homedir, 'dev/claude-throne/backends/python/ct_secretsd'),
        path.join(homedir, 'workspace/claude-throne/backends/python/ct_secretsd')
      ]
      
      for (const devPath of devPaths) {
        if (fs.existsSync(devPath) && fs.existsSync(path.join(devPath, 'ct_secretsd'))) {
          this.output.appendLine(`[secretsd] Found backend in development directory at: ${devPath}`)
          return devPath
        }
      }
    }

    // Fallback: return the most likely path even if it doesn't exist
    const fallback = workspaceFolders?.[0]?.uri.fsPath 
      ? path.join(workspaceFolders[0].uri.fsPath, 'backends/python/ct_secretsd')
      : '/workspaces/claude-throne/backends/python/ct_secretsd'
    
    this.output.appendLine(`[secretsd] No backend found, using fallback: ${fallback}`)
    return fallback
  }

  private async resolvePython(backendRoot: string, pythonPath?: string): Promise<string> {
    // Check configured path first
    const configured = pythonPath || vscode.workspace.getConfiguration('claudeThrone').get<string>('pythonInterpreterPath')
    if (configured) {
      this.output.appendLine(`[secretsd] Using configured Python: ${configured}`)
      return configured
    }

    // Check for virtual environment in backend
    const venvPythonPaths = [
      path.join(backendRoot, 'venv/bin/python3'),
      path.join(backendRoot, 'venv/bin/python'),
      path.join(backendRoot, '.venv/bin/python3'),
      path.join(backendRoot, '.venv/bin/python'),
      path.join(backendRoot, 'env/bin/python3'),
      path.join(backendRoot, 'env/bin/python')
    ]

    for (const venvPath of venvPythonPaths) {
      if (fs.existsSync(venvPath)) {
        this.output.appendLine(`[secretsd] Found venv Python at: ${venvPath}`)
        return venvPath
      }
    }

    // Try system Python paths
    const systemPaths = ['python3', 'python', '/usr/bin/python3', '/usr/local/bin/python3']
    for (const sysPython of systemPaths) {
      try {
        const { promisify } = require('util')
        const exec = promisify(require('child_process').exec)
        await exec(`${sysPython} --version`)
        this.output.appendLine(`[secretsd] Using system Python: ${sysPython}`)
        return sysPython
      } catch {}
    }

    // Default fallback
    this.output.appendLine(`[secretsd] Using default Python: python3`)
    return 'python3'
  }
}

