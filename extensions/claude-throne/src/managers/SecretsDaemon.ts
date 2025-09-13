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

    // Validate backend path exists - check for the Python module structure
    const moduleCheck = path.join(backendRoot, 'ct_secretsd', '__main__.py')
    const directCheck = path.join(backendRoot, '__main__.py')
    
    if (!fs.existsSync(backendRoot) || (!fs.existsSync(moduleCheck) && !fs.existsSync(directCheck))) {
      this.output.appendLine(`[secretsd] Backend module not found at ${backendRoot}`)
      this.output.appendLine(`[secretsd] Please either:`)
      this.output.appendLine(`[secretsd]   1. Set 'claudeThrone.backendPath' in settings`)
      this.output.appendLine(`[secretsd]   2. Ensure the backend exists at workspace/backends/python/ct_secretsd`)
      this.output.appendLine(`[secretsd]   3. Install dependencies: pip install fastapi uvicorn keyring httpx cryptography`)
      throw new Error(`Backend module not found: ${backendRoot}`)
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
    const TARGET_DIR = 'ct_secretsd'  // What we're looking for
    const BACKEND_PATTERN = path.join('backends', 'python', TARGET_DIR)
    
    this.output.appendLine(`[secretsd] Starting dynamic backend search...`)
    this.output.appendLine(`[secretsd] Environment: ${process.platform}, Node: ${process.version}`)
    this.output.appendLine(`[secretsd] Extension path: ${context.extensionPath}`)
    
    // Log workspace information for debugging
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (workspaceFolders) {
      this.output.appendLine(`[secretsd] Workspace folders: ${workspaceFolders.map(f => f.uri.fsPath).join(', ')}`)
    }
    
    // Strategy 1: Use explicitly configured path (absolute or relative to workspace)
    const configuredBackend = vscode.workspace.getConfiguration('claudeThrone').get<string>('backendPath')?.trim()
    if (configuredBackend) {
      // Try as absolute path first
      if (fs.existsSync(configuredBackend)) {
        this.output.appendLine(`[secretsd] Using configured backend path: ${configuredBackend}`)
        return configuredBackend
      }
      
      // Try relative to workspace folders
      const workspaceFolders = vscode.workspace.workspaceFolders
      if (workspaceFolders) {
        for (const folder of workspaceFolders) {
          const relativePath = path.join(folder.uri.fsPath, configuredBackend)
          if (fs.existsSync(relativePath)) {
            this.output.appendLine(`[secretsd] Using configured relative backend path: ${relativePath}`)
            return relativePath
          }
        }
      }
    }

    // Strategy 2: Search workspace folders and their parents recursively
    if (workspaceFolders) {
      for (const folder of workspaceFolders) {
        // Build comprehensive search paths based on workspace structure
        const workspaceName = path.basename(folder.uri.fsPath)
        const searchPaths = [
          folder.uri.fsPath,  // Current workspace folder
          path.dirname(folder.uri.fsPath),  // Parent of workspace
          path.dirname(path.dirname(folder.uri.fsPath))  // Grandparent
        ]
        
        // If workspace has a variant name (like mighty-morphin-claude), also check for claude-throne
        if (workspaceName.includes('claude') || workspaceName.includes('throne')) {
          const parentDir = path.dirname(folder.uri.fsPath)
          searchPaths.push(
            path.join(parentDir, 'claude-throne'),
            path.join(parentDir, 'mighty-morphin-claude'),
            path.join(parentDir, 'claude-throne-main')
          )
        }
        
        for (const searchBase of searchPaths) {
          // Look for the standard backend pattern
          const standardPath = path.join(searchBase, BACKEND_PATTERN)
          if (fs.existsSync(standardPath)) {
            this.output.appendLine(`[secretsd] Found backend in workspace hierarchy: ${standardPath}`)
            return standardPath
          }
          
          // Also check if ct_secretsd exists directly in common locations
          const directPaths = [
            path.join(searchBase, TARGET_DIR),
            path.join(searchBase, 'backend', TARGET_DIR),
            path.join(searchBase, 'backends', TARGET_DIR),
            path.join(searchBase, 'python', TARGET_DIR)
          ]
          
          for (const directPath of directPaths) {
            // Check both nested module structure and direct module
            const hasNestedModule = fs.existsSync(path.join(directPath, 'ct_secretsd', '__main__.py'))
            const hasDirectModule = fs.existsSync(path.join(directPath, '__main__.py'))
            
            if (fs.existsSync(directPath) && (hasNestedModule || hasDirectModule)) {
              this.output.appendLine(`[secretsd] Found backend at: ${directPath}`)
              return directPath
            }
          }
        }
      }
    }

    // Strategy 3: Search relative to extension installation location
    // This handles cases where extension is installed globally or in unusual locations
    const extensionSearchPaths = [
      context.extensionPath,  // Extension root
      path.dirname(context.extensionPath),  // Parent of extension
      path.dirname(path.dirname(context.extensionPath)),  // Grandparent
      path.dirname(path.dirname(path.dirname(context.extensionPath)))  // Great-grandparent
    ]
    
    for (const searchBase of extensionSearchPaths) {
      const standardPath = path.join(searchBase, BACKEND_PATTERN)
      if (fs.existsSync(standardPath)) {
        this.output.appendLine(`[secretsd] Found backend relative to extension: ${standardPath}`)
        return standardPath
      }
    }

    // Strategy 4: Check common container/devcontainer paths
    // These are absolute paths commonly used in containers
    const containerPaths = [
      '/workspaces',
      '/workspace',
      '/app',
      '/home/node',
      '/home/vscode',
      '/home/user'
    ]
    
    for (const containerBase of containerPaths) {
      // Try to find any folder that might contain our backend
      if (fs.existsSync(containerBase)) {
        try {
          const entries = fs.readdirSync(containerBase)
          for (const entry of entries) {
            // Check both the exact project name and common variations
            const projectVariations = [
              BACKEND_PATTERN,  // Standard path
              path.join('claude-throne', BACKEND_PATTERN),  // Nested in claude-throne
              path.join('mighty-morphin-claude', BACKEND_PATTERN),  // Alternative name
            ]
            
            for (const variation of projectVariations) {
              const possibleProjectPath = path.join(containerBase, entry, variation)
              if (fs.existsSync(possibleProjectPath)) {
                // Verify it's a valid backend module
                const hasNestedModule = fs.existsSync(path.join(possibleProjectPath, 'ct_secretsd', '__main__.py'))
                const hasDirectModule = fs.existsSync(path.join(possibleProjectPath, '__main__.py'))
                
                if (hasNestedModule || hasDirectModule) {
                  this.output.appendLine(`[secretsd] Found backend in container: ${possibleProjectPath}`)
                  return possibleProjectPath
                }
              }
            }
          }
        } catch {}
      }
    }

    // Strategy 5: Search in user's home directory for common project locations
    const homedir = process.env.HOME || process.env.USERPROFILE
    if (homedir) {
      // Common development directory patterns
      const devDirPatterns = [
        'Documents/Scripting Projects',
        'Documents/Projects',
        'Documents/Code',
        'projects',
        'Projects',
        'dev',
        'Development',
        'code',
        'Code',
        'workspace',
        'Workspace',
        'repos',
        'github',
        'git'
      ]
      
      for (const pattern of devDirPatterns) {
        const devDir = path.join(homedir, pattern)
        if (fs.existsSync(devDir)) {
          try {
            // Look for claude-throne or similar project folders
            const entries = fs.readdirSync(devDir)
            for (const entry of entries) {
              if (entry.toLowerCase().includes('claude') || entry.toLowerCase().includes('throne')) {
                const possiblePath = path.join(devDir, entry, BACKEND_PATTERN)
                if (fs.existsSync(possiblePath)) {
                  this.output.appendLine(`[secretsd] Found backend in home directory: ${possiblePath}`)
                  return possiblePath
                }
              }
            }
          } catch {}
        }
      }
    }

    // Strategy 6: Use find/where command as last resort (platform-specific)
    try {
      const { promisify } = require('util')
      const exec = promisify(require('child_process').exec)
      
      // Determine the appropriate search command based on platform
      const isWindows = process.platform === 'win32'
      let searchCmd: string
      
      if (isWindows) {
        // Windows: search in common locations
        searchCmd = `where /r "${homedir}" ct_secretsd 2>nul`
      } else {
        // Unix-like: use find with timeout to avoid hanging
        const searchLocations = [
          homedir,
          '/workspaces',
          '/workspace',
          workspaceFolders?.[0]?.uri.fsPath
        ].filter(Boolean).slice(0, 2)  // Limit to avoid long searches
        
        searchCmd = `find ${searchLocations.join(' ')} -type d -name "ct_secretsd" -path "*/backends/python/*" 2>/dev/null | head -1`
      }
      
      const { stdout } = await exec(searchCmd, { timeout: 3000 })  // 3 second timeout
      const foundPath = stdout.trim().split('\n')[0]
      if (foundPath && fs.existsSync(foundPath)) {
        this.output.appendLine(`[secretsd] Found backend via system search: ${foundPath}`)
        return foundPath
      }
    } catch {
      // System search failed, continue to fallback
    }

    // Final fallback: Create the expected path structure for user guidance
    const fallbackBase = workspaceFolders?.[0]?.uri.fsPath || homedir || '/workspace'
    const fallback = path.join(fallbackBase, BACKEND_PATTERN)
    
    this.output.appendLine(`[secretsd] Backend not found after exhaustive search`)
    this.output.appendLine(`[secretsd] Expected location: ${fallback}`)
    
    // Check if we're in a container environment
    const isContainer = context.extensionPath.includes('/home/node/.') || 
                       context.extensionPath.includes('/home/vscode/.') ||
                       fallbackBase.startsWith('/workspace')
    
    if (isContainer) {
      this.output.appendLine(`[secretsd] Detected container environment. To fix:`)
      this.output.appendLine(`[secretsd]   1. Copy backend from host: cp -r ~/Documents/Scripting\\ Projects/claude-throne/backends ${fallbackBase}/`)
      this.output.appendLine(`[secretsd]   2. Or mount it in devcontainer.json: "mounts": ["source=~/Documents/Scripting Projects/claude-throne/backends,target=${fallbackBase}/backends,type=bind"]`)
      this.output.appendLine(`[secretsd]   3. Or clone the full repo in the container: git clone <repo-url> ${fallbackBase}`)
    } else {
      this.output.appendLine(`[secretsd] To fix this, either:`)
      this.output.appendLine(`[secretsd]   1. Place the backend at: ${fallback}`)
      this.output.appendLine(`[secretsd]   2. Set 'claudeThrone.backendPath' in VS Code settings to the actual location`)
      this.output.appendLine(`[secretsd]   3. Run 'Claude Throne: Setup Backend' command to install dependencies`)
    }
    
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

