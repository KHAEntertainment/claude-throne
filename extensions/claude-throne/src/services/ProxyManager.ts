import * as vscode from 'vscode'
import * as cp from 'node:child_process'
import * as path from 'node:path'
import { SecretsService } from './Secrets'

export interface ProxyStartOptions {
  provider: 'openrouter' | 'openai' | 'together' | 'grok' | 'custom'
  customBaseUrl?: string
  port: number
  debug?: boolean
  reasoningModel?: string
  completionModel?: string
}

export interface ProxyStatus { running: boolean; port?: number; pid?: number }

import * as http from 'http';

export class ProxyManager {
  private proc: cp.ChildProcess | null = null;
  private currentPort: number | undefined;
  private onStatusChangedEmitter = new vscode.EventEmitter<ProxyStatus>();
  public onStatusChanged = this.onStatusChangedEmitter.event;
  private healthCheckTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly log: vscode.OutputChannel,
    private readonly secrets: SecretsService,
  ) {}

  public getStatus(): ProxyStatus {
    return { running: !!this.proc && !this.proc.killed, port: this.currentPort, pid: this.proc?.pid };
  }

  public async checkHealth(): Promise<boolean> {
    if (!this.currentPort || !this.proc || this.proc.killed) {
      return false;
    }

    return new Promise(resolve => {
      const req = http.get(`http://127.0.0.1:${this.currentPort}/health`, res => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const json = JSON.parse(data);
              resolve(json && json.status === 'healthy');
            } catch {
              resolve(false);
            }
          } else {
            resolve(false);
          }
        });
      });
      req.on('error', () => resolve(false));
      req.setTimeout(2000, () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  private async checkStaleInstance(port: number): Promise<boolean> {
    return new Promise(resolve => {
        const req = http.get(`http://127.0.0.1:${port}/healthz`, res => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                // Check if response is 200 and has expected health check shape
                if (res.statusCode === 200) {
                    try {
                        const json = JSON.parse(data);
                        // If we get a valid health check response, consider it a stale proxy
                        resolve(json && json.status === 'ok');
                    } catch {
                        // If we can't parse JSON, treat as non-health check response
                        resolve(false);
                    }
                } else {
                    resolve(false);
                }
            });
        });
        req.on('error', () => resolve(false));
        req.setTimeout(1000, () => {
            req.destroy();
            resolve(false);
        });
    });
  }

  async start(opts: ProxyStartOptions): Promise<void> {
    if (this.proc && !this.proc.killed) {
      this.log.appendLine('[proxy] already running');
      return;
    }

    const isStale = await this.checkStaleInstance(opts.port);
    if (isStale) {
        const choice = await vscode.window.showWarningMessage(
            `Another process is already running on port ${opts.port}.`,
            'Start Anyway',
            'Cancel'
        );
        if (choice !== 'Start Anyway') {
            return;
        }
    }

    const startTime = Date.now()
    const nodeBin = process.execPath;
    const entry = this.ctx.asAbsolutePath(path.join('bundled', 'proxy', 'index.cjs'))

    // Build provider env
    const env = await this.buildEnvForProvider(opts)
    
    // Log configuration for diagnostics
    this.log.appendLine(`[ProxyManager] Starting proxy with configuration:`)
    this.log.appendLine(`[ProxyManager] - Provider: ${opts.provider}`)
    this.log.appendLine(`[ProxyManager] - Port: ${opts.port}`)
    this.log.appendLine(`[ProxyManager] - Debug: ${opts.debug || false}`)
    this.log.appendLine(`[ProxyManager] - Reasoning Model: ${opts.reasoningModel || 'not set'}`)
    this.log.appendLine(`[ProxyManager] - Completion Model: ${opts.completionModel || 'not set'}`)
    this.log.appendLine(`[ProxyManager] - Custom Base URL: ${opts.customBaseUrl || 'none'}`)
    
    // Log environment variable keys (without exposing sensitive values)
    const envKeys = Object.keys(env).filter(k => k.includes('API_KEY') || k.includes('MODEL') || k.includes('BASE_URL'))
    this.log.appendLine(`[ProxyManager] - Environment variables set: ${envKeys.join(', ')}`)

    this.log.appendLine(`[proxy] starting via ${nodeBin} ${entry} on port ${opts.port}`)
    this.proc = cp.spawn(nodeBin, [entry, '--port', String(opts.port)], {
      env,
      stdio: 'pipe',
      detached: false,
    })
    
    const pid = this.proc.pid
    this.log.appendLine(`[ProxyManager] Proxy process spawned with PID: ${pid}`)

    let firstOutput = true
    this.proc.stdout?.on('data', (b) => {
      const output = b.toString().trimEnd()
      if (firstOutput) {
        const elapsed = Date.now() - startTime
        this.log.appendLine(`[ProxyManager] First stdout received after ${elapsed}ms`)
        firstOutput = false
      }
      this.log.appendLine(`[proxy] ${output}`)
    })
    
    this.proc.stderr?.on('data', (b) => this.log.appendLine(`[proxy:err] ${b.toString().trimEnd()}`))
    
    this.proc.on('exit', (code, signal) => {
      this.log.appendLine(`[proxy] exited code=${code} signal=${signal}`)
      this.proc = null
      this.currentPort = undefined
    })

    this.currentPort = opts.port
    
    // Wait for proxy to be ready
    let retries = 0
    const maxRetries = 10
    while (retries < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, 500))
      if (await this.checkHealth()) {
        const readyElapsed = Date.now() - startTime
        this.log.appendLine(`[ProxyManager] Proxy ready after ${readyElapsed}ms`)
        
        // Start periodic health checks
        this.startHealthMonitoring()
        return
      }
      retries++
    }
    
    // If we get here, proxy didn't start properly
    const failedElapsed = Date.now() - startTime
    this.log.appendLine(`[ProxyManager] Proxy failed to start after ${failedElapsed}ms`)
    throw new Error('Proxy started but health check failed. Check the output for errors.')
  }

  private startHealthMonitoring() {
    this.stopHealthMonitoring()
    
    // Check health every 30 seconds
    this.healthCheckTimer = setInterval(async () => {
      const isHealthy = await this.checkHealth()
      if (!isHealthy && this.proc && !this.proc.killed) {
        this.log.appendLine('[ProxyManager] Health check failed - proxy may have crashed')
        this.onStatusChangedEmitter.fire({ running: false })
      }
    }, 30000)
  }

  private stopHealthMonitoring() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer)
      this.healthCheckTimer = null
    }
  }

  async stop(): Promise<boolean> {
    this.stopHealthMonitoring()
    if (!this.proc) return false
    try {
      this.proc.kill('SIGTERM')
      this.proc = null
      return true
    } catch {
      return false
    }
  }

  private async buildEnvForProvider(opts: ProxyStartOptions): Promise<NodeJS.ProcessEnv> {
    const base: NodeJS.ProcessEnv = { ...process.env }
    base.PORT = String(opts.port)
    if (opts.debug) base.DEBUG = '1'
    if (opts.reasoningModel) base.REASONING_MODEL = opts.reasoningModel
    if (opts.completionModel) base.COMPLETION_MODEL = opts.completionModel

    const setBaseUrl = (url: string) => {
      base.ANTHROPIC_PROXY_BASE_URL = url
    }

    switch (opts.provider) {
      case 'openrouter': {
        const key = await this.secrets.getProviderKey('openrouter')
        if (!key) throw new Error('OpenRouter API key not set. Run: Claude Throne: Store OpenRouter API Key')
        base.OPENROUTER_API_KEY = key
        setBaseUrl('https://openrouter.ai/api')
        break
      }
      case 'openai': {
        const key = await this.secrets.getProviderKey('openai')
        if (!key) throw new Error('OpenAI API key not set')
        base.OPENAI_API_KEY = key
        setBaseUrl('https://api.openai.com')
        break
      }
      case 'together': {
        const key = await this.secrets.getProviderKey('together')
        if (!key) throw new Error('Together API key not set')
        base.TOGETHER_API_KEY = key
        setBaseUrl('https://api.together.xyz')
        break
      }
      case 'grok': {
        const key = await this.secrets.getProviderKey('grok')
        if (!key) throw new Error('Grok API key not set')
        base.GROQ_API_KEY = key
        setBaseUrl('https://api.groq.com/openai')
        break
      }
      case 'custom': {
        const baseUrl = (opts.customBaseUrl || '').trim()
        if (!baseUrl) throw new Error('Custom base URL is empty; set claudeThrone.customBaseUrl')
        setBaseUrl(baseUrl)
        const key = await this.secrets.getProviderKey('custom')
        if (!key) throw new Error('Custom API key not set')
        // The proxy resolves API key with CUSTOM_API_KEY / API_KEY first for custom URL
        base.API_KEY = key
        break
      }
    }

    return base
  }
}

