import * as vscode from 'vscode'
import { spawn, ChildProcessWithoutNullStreams } from 'child_process'
import * as path from 'path'
import * as net from 'net'
import { randomBytes } from 'crypto'

export interface SecretsDaemonInfo {
  host: string
  port: number
  token: string
  url: string
}

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

    // Resolve python interpreter
    const configured = pythonPath || vscode.workspace.getConfiguration('claudeThrone').get<string>('pythonInterpreterPath')
    const python = configured || 'python3'

    const backendRoot = path.resolve(context.extensionPath, '../../backends/python/ct_secretsd')

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
}

