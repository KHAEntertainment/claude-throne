import { request } from 'undici'
import { getModelsEndpointForBase } from './endpoints'

export type ProviderId = 'openrouter' | 'openai' | 'together' | 'deepseek' | 'glm' | 'custom' | string

/**
 * Fetches a JSON model list from the given URL with provider-aware timeouts, exponential backoff retries, and an overall time budget.
 *
 * @param url - The endpoint to fetch model information from.
 * @param headers - HTTP headers to include with the request (e.g., Authorization).
 * @param maxRetries - Maximum number of retry attempts on transient failures (default: 3).
 * @param provider - Optional provider identifier used for provider-specific timeout heuristics and error messages.
 * @param startTime - Optional epoch millis marking the operation start; used to enforce the overall budget when retrying.
 * @param budgetMs - Optional overall time budget in milliseconds for the entire operation (default: 50000).
 * @returns The parsed JSON response body returned by the endpoint.
 * @throws Error with property `errorType === 'timeout'` when the overall budget is exceeded or when a final timeout occurs.
 * @throws Error for non-200 HTTP responses; messages include the status code and may include a short response snippet.
 */
async function fetchModelsWithRetry(
  url: string, 
  headers: Record<string, string>, 
  maxRetries: number = 3,
  provider?: string,
  startTime?: number,
  budgetMs?: number
): Promise<any> {
  const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true'
  
  // Comment 3: Default budget if not provided (50 seconds)
  const overallBudgetMs = budgetMs ?? 50000
  const fetchStartTime = startTime ?? Date.now()
  
  // Comment 2: Provider-specific timeouts (10-20s range)
  let timeoutMs = 15000 // 15 seconds default
  if (url.includes('openrouter.ai')) {
    timeoutMs = 15000
  } else if (url.includes('api.openai.com')) {
    timeoutMs = 10000
  } else if (url.includes('api.together.xyz')) {
    timeoutMs = 15000
  } else if (url.includes('api.deepseek.com')) {
    timeoutMs = 20000
  } else if (url.includes('api.z.ai')) {
    timeoutMs = 20000
  }
  
  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    // Comment 3: Check overall budget before attempting request
    const elapsedMs = Date.now() - fetchStartTime
    if (elapsedMs >= overallBudgetMs) {
      const budgetSeconds = Math.round(overallBudgetMs / 1000)
      const error = new Error(`Model list request exceeded overall budget of ${budgetSeconds} seconds`)
      ;(error as any).errorType = 'timeout'
      throw error
    }
    
    // Comment 3: Adjust per-request timeout to fit within remaining budget
    const remainingBudgetMs = overallBudgetMs - elapsedMs
    const adjustedTimeoutMs = Math.min(timeoutMs, remainingBudgetMs)
    
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), adjustedTimeoutMs)
    
    try {
      if (DEBUG && attempt > 1) {
        console.log(`[Models] Retry attempt ${attempt}/${maxRetries + 1} for ${url} (elapsed: ${Math.round(elapsedMs / 1000)}s, remaining budget: ${Math.round(remainingBudgetMs / 1000)}s)`)
      }
      
      const res = await request(url, { 
        method: 'GET', 
        headers,
        signal: controller.signal as any
      })
      
      clearTimeout(timeoutId)
      
      // Comment 2: Classify errors by status and implement retry for 429/5xx
      if (res.statusCode === 429) {
        // Rate limited - retry with exponential backoff
        if (attempt <= maxRetries) {
          // Comment 3: Check budget before retrying
          const currentElapsed = Date.now() - fetchStartTime
          if (currentElapsed >= overallBudgetMs) {
            const budgetSeconds = Math.round(overallBudgetMs / 1000)
            const error = new Error(`Model list request exceeded overall budget of ${budgetSeconds} seconds`)
            ;(error as any).errorType = 'timeout'
            throw error
          }
          
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000) // Exponential backoff, max 10s
          // Comment 3: Ensure backoff doesn't exceed remaining budget
          const remainingBeforeBackoff = overallBudgetMs - currentElapsed
          const adjustedBackoffMs = Math.min(backoffMs, remainingBeforeBackoff)
          
          if (DEBUG) {
            console.log(`[Models] Rate limited (429), retrying after ${adjustedBackoffMs}ms (attempt ${attempt}/${maxRetries + 1})`)
          }
          clearTimeout(timeoutId)
          await new Promise(resolve => setTimeout(resolve, adjustedBackoffMs))
          continue
        }
        // Max retries reached
        throw new Error(`Model list request rate limited (429) after ${maxRetries} retries`)
      }
      
      if (res.statusCode >= 500 && res.statusCode < 600) {
        // Server error - retry with exponential backoff
        if (attempt <= maxRetries) {
          // Comment 3: Check budget before retrying
          const currentElapsed = Date.now() - fetchStartTime
          if (currentElapsed >= overallBudgetMs) {
            const budgetSeconds = Math.round(overallBudgetMs / 1000)
            const error = new Error(`Model list request exceeded overall budget of ${budgetSeconds} seconds`)
            ;(error as any).errorType = 'timeout'
            throw error
          }
          
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000) // Exponential backoff, max 10s
          // Comment 3: Ensure backoff doesn't exceed remaining budget
          const remainingBeforeBackoff = overallBudgetMs - currentElapsed
          const adjustedBackoffMs = Math.min(backoffMs, remainingBeforeBackoff)
          
          if (DEBUG) {
            console.log(`[Models] Server error (${res.statusCode}), retrying after ${adjustedBackoffMs}ms (attempt ${attempt}/${maxRetries + 1})`)
          }
          clearTimeout(timeoutId)
          await new Promise(resolve => setTimeout(resolve, adjustedBackoffMs))
          continue
        }
        // Max retries reached
        throw new Error(`Model list request failed with server error (${res.statusCode}) after ${maxRetries} retries`)
      }
      
      if (res.statusCode !== 200) {
        // Read a short slice of response body for debugging
        let errorSnippet = ''
        try {
          const bodyText = await res.body.text()
          errorSnippet = bodyText.slice(0, 500)
          if (errorSnippet.length === 500) errorSnippet += '...'
        } catch {
          // If reading body fails, continue without snippet
        }
        
        // Provider-specific error handling
        if ((res.statusCode === 401 || res.statusCode === 403) && url.includes('together.xyz')) {
          throw new Error(`Together AI authentication failed (${res.statusCode}). Please check your API key and ensure it has the required permissions.`)
        }
        
        const errorMsg = errorSnippet 
          ? `Model list failed (${res.statusCode}): ${errorSnippet}`
          : `Model list failed (${res.statusCode})`
          
        // Log attempted URL and status code/body snippet for debugging
        if (DEBUG) {
          console.log(`[Models] Request failed for URL: ${url}`)
          console.log(`[Models] Status code: ${res.statusCode}`)
          if (errorSnippet) {
            console.log(`[Models] Response snippet: ${errorSnippet}`)
          }
        }
        
        throw new Error(errorMsg)
      }

      return await res.body.json()
    } catch (err: any) {
      clearTimeout(timeoutId)
      
      // Comment 3: If budget exceeded, surface timeout classification
      const currentElapsed = Date.now() - fetchStartTime
      if (currentElapsed >= overallBudgetMs) {
        const budgetSeconds = Math.round(overallBudgetMs / 1000)
        const error = new Error(`Model list request exceeded overall budget of ${budgetSeconds} seconds`)
        ;(error as any).errorType = 'timeout'
        throw error
      }
      
      // Comment 2: Handle timeout errors
      if (err.name === 'AbortError' || err.code === 'UND_ERR_ABORTED') {
        const timeoutSeconds = Math.round(adjustedTimeoutMs / 1000)
        if (attempt <= maxRetries) {
          // Comment 3: Check budget before retrying
          if (currentElapsed >= overallBudgetMs) {
            const budgetSeconds = Math.round(overallBudgetMs / 1000)
            const error = new Error(`Model list request exceeded overall budget of ${budgetSeconds} seconds`)
            ;(error as any).errorType = 'timeout'
            throw error
          }
          
          // Wait before retry with exponential backoff
          const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
          // Comment 3: Ensure backoff doesn't exceed remaining budget
          const remainingBeforeBackoff = overallBudgetMs - currentElapsed
          const adjustedBackoffMs = Math.min(backoffMs, remainingBeforeBackoff)
          
          if (DEBUG) {
            console.log(`[Models] Timeout after ${timeoutSeconds}s, retrying after ${adjustedBackoffMs}ms (attempt ${attempt}/${maxRetries + 1})`)
          }
          await new Promise(resolve => setTimeout(resolve, adjustedBackoffMs))
          continue
        }
        // Comment 3: Surface timeout classification when max retries reached
        const error = new Error(`Model list request timed out after ${timeoutSeconds} seconds`)
        ;(error as any).errorType = 'timeout'
        throw error
      }
      
      // Comment 2: Retry transient network errors
      if (attempt <= maxRetries && (err.code === 'ECONNRESET' || err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND')) {
        // Comment 3: Check budget before retrying
        if (currentElapsed >= overallBudgetMs) {
          const budgetSeconds = Math.round(overallBudgetMs / 1000)
          const error = new Error(`Model list request exceeded overall budget of ${budgetSeconds} seconds`)
          ;(error as any).errorType = 'timeout'
          throw error
        }
        
        // Network errors worth retrying with exponential backoff
        const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
        // Comment 3: Ensure backoff doesn't exceed remaining budget
        const remainingBeforeBackoff = overallBudgetMs - currentElapsed
        const adjustedBackoffMs = Math.min(backoffMs, remainingBeforeBackoff)
        
        if (DEBUG) {
          console.log(`[Models] Network error (${err.code}), retrying after ${adjustedBackoffMs}ms (attempt ${attempt}/${maxRetries + 1})`)
        }
        await new Promise(resolve => setTimeout(resolve, adjustedBackoffMs))
        continue
      }
      
      throw err
    }
  }
  
  // Should never reach here, but TypeScript needs it
  throw new Error('Max retries exceeded')
}

/**
 * Fetches model entries from the provider's models endpoint and returns a normalized list of model IDs.
 *
 * Attempts provider-specific endpoint resolution and authentication, normalizes several common response shapes
 * (e.g., `{ data: [...] }`, `{ models: [...] }`, or an array of model objects) and returns an array of model `id` values.
 *
 * @param provider - Identifier for the provider (e.g., "openai", "openrouter", "together", "custom", or other provider string)
 * @param baseUrl - Base URL for the provider; required when `provider` is "custom"
 * @param apiKey - API key or token to include in the Authorization header when needed
 * @returns An array of model IDs extracted from the provider response
 * @throws Error if `provider` is "custom" and `baseUrl` is missing or empty
 * @throws Error if Together AI is targeted but `apiKey` is not provided
 * @throws Error with `errorType === "timeout"` when the overall fetch budget or request timeout is exceeded
 */
export async function listModels(provider: ProviderId, baseUrl: string, apiKey: string): Promise<string[]> {
  if (provider === 'custom' && (!baseUrl || !baseUrl.trim())) {
    throw new Error('Custom provider requires a base URL')
  }

  // Comment 3: Track start time for overall budget tracking
  const startTime = Date.now()
  // Comment 3: Overall budget (50 seconds) - can be adjusted between 45-60s
  const overallBudgetMs = 50000
  const DEBUG = process.env.DEBUG === '1' || process.env.DEBUG === 'true'

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`
  
  // Log attempted URL for debugging
  console.log(`[Models] Listing models for provider: ${provider}`)
  console.log(`[Models] Base URL: ${baseUrl}`)
  console.log(`[Models] API key provided: ${apiKey ? 'YES' : 'NO'}`)

  // normalize base URL - use proper endpoint for Anthropic-style providers
  const base = baseUrl.replace(/\/$/, '')
  let url = provider === 'openrouter'
    ? 'https://openrouter.ai/api/v1/models'
    : getModelsEndpointForBase(base)
    
  // Provider-specific logic for TogetherAI
  if (provider === 'together' || (provider === 'custom' && url.includes('together.xyz'))) {
    if (!apiKey) {
      throw new Error('API key required for Together AI. Please set your API key in the provider settings.')
    }
    // Ensure proper Authorization header for TogetherAI
    headers.Authorization = `Bearer ${apiKey}`
    url = 'https://api.together.xyz/v1/models'
  }

  if (DEBUG) {
    console.log(`[Models] Resolved models endpoint: ${url} (from baseUrl: ${baseUrl})`)
  }
  console.log(`[Models] Fetching models from: ${url}`)
  console.log(`[Models] Authorization header: ${headers.Authorization ? 'PRESENT' : 'MISSING'}`)

  try {
    // Comment 3: Pass start time and budget to retry function
    const data = await fetchModelsWithRetry(url, headers, 3, provider, startTime, overallBudgetMs)
    
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
    console.error(`[Models] Failed to fetch from ${url} (provider: ${provider}, baseUrl: ${baseUrl}): ${err?.message || err}`)
    console.error(err)
    if (err && typeof err === 'object') {
      ;(err as any).modelsEndpointUrl = url
      ;(err as any).attemptedUrl = (err as any).attemptedUrl || url
      ;(err as any).baseUrl = (err as any).baseUrl || baseUrl
    }
    // Comment 3: Preserve timeout classification when rethrowing
    if ((err as any).errorType === 'timeout') {
      ;(err as any).errorType = 'timeout'
    }
    throw err
  }
}
