import * as vscode from 'vscode'
import * as cp from 'node:child_process'
import * as path from 'node:path'
import { SecretsService } from './Secrets'

export interface ProxyStartOptions {
  provider: 'openrouter' | 'openai' | 'together' | 'deepseek' | 'glm' | 'custom'
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
      req.setTimeout(500, () => { // Reduced from 2000ms for faster response
        req.destroy();
        resolve(false);
      });
    });
  }

  private async waitForPort(port: number, timeout: number = 3000): Promise<boolean> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const isListening = await new Promise<boolean>(resolve => {
        const testReq = http.get(`http://127.0.0.1:${port}/healthz`, res => {
          resolve(res.statusCode === 200);
        });
        testReq.on('error', () => resolve(false));
        testReq.setTimeout(100, () => {
          testReq.destroy();
          resolve(false);
        });
      });
      
      if (isListening) {
        return true;
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return false;
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
        req.setTimeout(500, () => { // Reduced from 1000ms for faster check
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

    // Read saved models from VS Code configuration if not explicitly provided
    const cfg = vscode.workspace.getConfiguration('claudeThrone')
    if (!opts.reasoningModel) {
      const savedReasoningModel = cfg.get<string>('reasoningModel')
      if (savedReasoningModel) {
        opts.reasoningModel = savedReasoningModel
        this.log.appendLine(`[ProxyManager] Loaded saved reasoning model from config: ${savedReasoningModel}`)
      }
    }
    if (!opts.completionModel) {
      const savedCompletionModel = cfg.get<string>('completionModel')
      if (savedCompletionModel) {
        opts.completionModel = savedCompletionModel
        this.log.appendLine(`[ProxyManager] Loaded saved completion model from config: ${savedCompletionModel}`)
      }
    }

    // Build provider env
    const env = await this.buildEnvForProvider(opts)
    
    // Log configuration for diagnostics
    this.log.appendLine(`[ProxyManager] Starting proxy with configuration:`)
    this.log.appendLine(`[ProxyManager] - Provider: ${opts.provider}`)
    this.log.appendLine(`[ProxyManager] - Port: ${opts.port}`)
    this.log.appendLine(`[ProxyManager] - Debug: ${opts.debug || false}`)
    this.log.appendLine(`[ProxyManager] - Reasoning Model: ${opts.reasoningModel || 'not set'} ${opts.reasoningModel && cfg.get<string>('reasoningModel') === opts.reasoningModel ? '(from config)' : ''}`)
    this.log.appendLine(`[ProxyManager] - Completion Model: ${opts.completionModel || 'not set'} ${opts.completionModel && cfg.get<string>('completionModel') === opts.completionModel ? '(from config)' : ''}`)
    this.log.appendLine(`[ProxyManager] - Custom Base URL: ${opts.customBaseUrl || 'none'}`)
    
    // Log Anthropic-native provider mode
    if (opts.provider === 'deepseek' || opts.provider === 'glm') {
      this.log.appendLine(`[ProxyManager] Anthropic-native provider detected: ${opts.provider}`)
      this.log.appendLine(`[ProxyManager] Proxy will inject x-api-key header and forward to provider endpoint`)
      this.log.appendLine(`[ProxyManager] Provider endpoint: ${opts.provider === 'deepseek' ? 'https://api.deepseek.com/anthropic' : 'https://api.z.ai/api/anthropic'}`)
    }
    
    // Log environment variable keys (without exposing sensitive values)
    const envKeys = Object.keys(env).filter(k => k.includes('API_KEY') || k.includes('MODEL') || k.includes('BASE_URL'))
    this.log.appendLine(`[ProxyManager] - Environment variables set: ${envKeys.join(', ')}`)

    this.log.appendLine(`[proxy] starting via ${nodeBin} ${entry} on port ${opts.port}`)
    // Explicitly add ZAI_API_KEY to environment if it exists
    const proxyEnv = { ...env }
    if (process.env.ZAI_API_KEY) {
      proxyEnv.ZAI_API_KEY = process.env.ZAI_API_KEY
    }
    
    this.proc = cp.spawn(nodeBin, [entry, '--port', String(opts.port)], {
      env: proxyEnv,
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
    
    // Check if we should skip health check for faster startup
    const healthCfg = vscode.workspace.getConfiguration('claudeThrone')
    const skipHealthCheck = healthCfg.get<boolean>('proxy.skipHealthCheck', false)
    
    if (skipHealthCheck) {
      this.log.appendLine('[ProxyManager] Skipping detailed health check (fast mode enabled)')
      // But still verify the port is at least listening
      const isListening = await this.waitForPort(opts.port, 2000)
      if (!isListening) {
        this.log.appendLine(`[ProxyManager] Warning: Port ${opts.port} is not responding after 2 seconds`)
        throw new Error(`Proxy started but port ${opts.port} is not listening`)
      }
      this.log.appendLine('[ProxyManager] Port is listening, proxy ready')
      return
    }
    
    // Try health check immediately first (no delay)
    if (await this.checkHealth()) {
      const readyElapsed = Date.now() - startTime
      this.log.appendLine(`[ProxyManager] Proxy ready immediately (${readyElapsed}ms)`)
      this.startHealthMonitoring()
      return
    }
    
    // Only retry with delays if the immediate check failed
    let retries = 0
    const maxRetries = 10
    const retryDelay = 200 // Reduced from 500ms
    
    while (retries < maxRetries) {
      await new Promise(resolve => setTimeout(resolve, retryDelay))
      if (await this.checkHealth()) {
        const readyElapsed = Date.now() - startTime
        this.log.appendLine(`[ProxyManager] Proxy ready after ${readyElapsed}ms`)
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
    base.FORCE_PROVIDER = opts.provider
    if (opts.debug) base.DEBUG = '1'
    // Only set model env vars if they have actual values (don't override with empty strings)
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
      case 'deepseek': {
        const key = await this.secrets.getProviderKey('deepseek')
        if (!key) throw new Error('Deepseek API key not set')
        base.DEEPSEEK_API_KEY = key
        setBaseUrl('https://api.deepseek.com/anthropic')
        break
      }
      case 'glm': {
        const key = await this.secrets.getProviderKey('glm')
        if (!key) throw new Error('GLM API key not set')
        base.ZAI_API_KEY = key
        setBaseUrl('https://api.z.ai/api/anthropic')
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
