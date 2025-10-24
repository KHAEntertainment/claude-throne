import { request } from 'undici'

export type ProviderId = 'openrouter' | 'openai' | 'together' | 'deepseek' | 'glm' | 'custom'

/**
 * Fetches available model IDs from the specified provider.
 *
 * @param provider - Provider identifier (e.g., 'openrouter', 'openai', 'together', 'deepseek', 'glm', 'custom'). When `'custom'`, a non-empty `baseUrl` is required.
 * @param baseUrl - Base URL of the provider's API; required and must be non-empty when `provider` is `'custom'`.
 * @param apiKey - Optional API key sent in the `Authorization` header as a Bearer token.
 * @returns An array of model `id` strings available from the provider.
 * @throws Error('Custom provider requires a base URL') - If `provider` is `'custom'` and `baseUrl` is missing or empty.
 * @throws Error('Model list failed (<statusCode>)') - If the HTTP response status is not 200.
 * @throws Error('Model list request timed out after 5 seconds') - If the request is aborted due to the 5-second timeout.
 */
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

  // Add timeout using AbortController
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
  
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
  } catch (err: any) {
    clearTimeout(timeoutId)
    
    if (err.name === 'AbortError' || err.code === 'UND_ERR_ABORTED') {
      throw new Error('Model list request timed out after 5 seconds')
    }
    throw err
  }
}
