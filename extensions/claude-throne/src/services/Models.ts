import { request } from 'undici'

export type ProviderId = 'openrouter' | 'openai' | 'together' | 'deepseek' | 'glm' | 'custom' | string

async function fetchModelsWithRetry(url: string, headers: Record<string, string>, maxRetries: number = 2): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    const controller = new AbortController()
    
    // Provider-specific timeouts
    let timeoutMs = 15000 // 15 seconds default
    if (url.includes('openrouter.ai')) {
      timeoutMs = 15000
    } else if (url.includes('api.openai.com')) {
      timeoutMs = 10000
    } else if (url.includes('api.together.xyz')) {
      timeoutMs = 15000
    }
    
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
    
    try {
      const res = await request(url, { 
        method: 'GET', 
        headers,
        signal: controller.signal as any
      })
      
      clearTimeout(timeoutId)
      
      if (res.statusCode !== 200) {
        throw new Error(`Model list failed (${res.statusCode})`)
      }

      return await res.body.json()
    } catch (err: any) {
      clearTimeout(timeoutId)
      
      if (err.name === 'AbortError' || err.code === 'UND_ERR_ABORTED') {
        const timeoutSeconds = Math.round(timeoutMs / 1000)
        if (attempt <= maxRetries) {
          // Wait before retry with exponential backoff
          const delayMs = attempt * 1000
          await new Promise(resolve => setTimeout(resolve, delayMs))
          continue
        }
        throw new Error(`Model list request timed out after ${timeoutSeconds} seconds`)
      }
      
      if (attempt <= maxRetries && (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')) {
        // Network errors worth retrying
        const delayMs = attempt * 1000
        await new Promise(resolve => setTimeout(resolve, delayMs))
        continue
      }
      
      throw err
    }
  }
}

export async function listModels(provider: ProviderId, baseUrl: string, apiKey: string): Promise<string[]> {
  if (provider === 'custom' && (!baseUrl || !baseUrl.trim())) {
    throw new Error('Custom provider requires a base URL')
  }

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  // normalize base URL
  const base = baseUrl.replace(/\/$/, '')
  const url = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/models'
    : `${base}/models`

  try {
    const data = await fetchModelsWithRetry(url, headers)
    
    // Try OpenAI-like shape first
    if (Array.isArray((data as any).data)) {
      return (data as any).data
        .map((m: any) => m?.id)
        .filter((id: any) => typeof id === 'string')
    }
    // Try OpenRouter shape { data: [{ id }]} already handled above; some variants are { models: [] }
    if (Array.isArray((data as any).models)) {
      return (data as any).models
        .map((m: any) => m?.id)
        .filter((id: any) => typeof id === 'string')
    }
    // Fallback try common fields
    const arr = Array.isArray(data) ? data : []
    return arr.map((m: any) => m?.id).filter((id: any) => typeof id === 'string')
  } catch (err: any) {
    throw err
  }
}

