import { request } from 'undici'

export type ProviderId = 'openrouter' | 'openai' | 'together' | 'grok' | 'custom'

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

  const res = await request(url, { method: 'GET', headers })
  if (res.statusCode !== 200) {
    throw new Error(`Model list failed (${res.statusCode})`)
  }

  const data = await res.body.json()
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
}

