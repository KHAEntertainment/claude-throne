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

export class ProxyManager {
  private proc: cp.ChildProcess | null = null
  private currentPort: number | undefined

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly log: vscode.OutputChannel,
    private readonly secrets: SecretsService,
  ) {}

  getStatus(): ProxyStatus {
    return { running: !!this.proc && !this.proc.killed, port: this.currentPort, pid: this.proc?.pid }
  }

  async start(opts: ProxyStartOptions): Promise<void> {
    if (this.proc && !this.proc.killed) {
      this.log.appendLine('[proxy] already running')
      return
    }

    const nodeBin = process.execPath
    const entry = this.ctx.asAbsolutePath(path.join('bundled', 'proxy', 'index.cjs'))

    // Build provider env
    const env = await this.buildEnvForProvider(opts)

    this.log.appendLine(`[proxy] starting via ${nodeBin} ${entry} on port ${opts.port}`)
    this.proc = cp.spawn(nodeBin, [entry], {
      env,
      stdio: 'pipe',
      detached: false,
    })

    this.proc.stdout?.on('data', (b) => this.log.appendLine(`[proxy] ${b.toString().trimEnd()}`))
    this.proc.stderr?.on('data', (b) => this.log.appendLine(`[proxy:err] ${b.toString().trimEnd()}`))
    this.proc.on('exit', (code, signal) => {
      this.log.appendLine(`[proxy] exited code=${code} signal=${signal}`)
      this.proc = null
      this.currentPort = undefined
    })

    this.currentPort = opts.port
  }

  async stop(): Promise<boolean> {
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

