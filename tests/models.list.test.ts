import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'

// Mock undici.request with controllable responses
const makeResponse = (status: number, bodyObj?: any) => {
  return {
    statusCode: status,
    body: {
      async json() { return bodyObj },
      async text() { return bodyObj ? JSON.stringify(bodyObj) : '' }
    }
  } as any
}

describe('Models.list: normalization and error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('normalizes OpenAI-style data[] for Deepseek', async () => {
    const mockRequest = vi.fn()
    vi.doMock('undici', () => ({ request: mockRequest }))
    
    const { listModels } = await import('../extensions/claude-throne/src/services/Models')
    
    mockRequest.mockImplementation(async (url: string, opts: any) => {
      expect(url).toBe('https://api.deepseek.com/v1/models')
      expect(opts?.headers?.Authorization).toMatch(/^Bearer KEY/)
      return makeResponse(200, { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-coder' }] })
    })
    
    const ids = await listModels('deepseek', 'https://api.deepseek.com/v1', 'KEY')
    expect(ids).toEqual(['deepseek-chat', 'deepseek-coder'])
  })

  it('normalizes OpenAI-style data[] for GLM', async () => {
    const mockRequest = vi.fn()
    vi.doMock('undici', () => ({ request: mockRequest }))
    
    const { listModels } = await import('../extensions/claude-throne/src/services/Models')
    
    mockRequest.mockImplementation(async (url: string, opts: any) => {
      expect(url).toBe('https://api.z.ai/api/paas/v4/models')
      expect(opts?.headers?.Authorization).toMatch(/^Bearer KEY/)
      return makeResponse(200, { data: [{ id: 'glm-4' }, { id: 'glm-4-plus' }] })
    })
    
    const ids = await listModels('glm', 'https://api.z.ai/api/paas/v4', 'KEY')
    expect(ids).toEqual(['glm-4', 'glm-4-plus'])
  })

  it('produces friendly message for Together AI 401/403', async () => {
    const mockRequest = vi.fn()
    vi.doMock('undici', () => ({ request: mockRequest }))
    
    const { listModels } = await import('../extensions/claude-throne/src/services/Models')
    
    mockRequest.mockImplementation(async () => makeResponse(401, { error: { code: '1001', message: 'Authorization Token Missing' } }))
    
    const error = await listModels('together', 'https://api.together.xyz/v1', 'INVALID_KEY')
      .catch(err => err)
    expect(error.message).toContain('Together AI authentication failed')
    expect(error.message).toContain('Please check your API key')
    expect(error.modelsEndpointUrl).toBe('https://api.together.xyz/v1/models')
  })

  it('propagates 401/403 with modelsEndpointUrl attached for GLM', async () => {
    const mockRequest = vi.fn()
    vi.doMock('undici', () => ({ request: mockRequest }))
    
    const { listModels } = await import('../extensions/claude-throne/src/services/Models')
    
    mockRequest.mockImplementation(async () => makeResponse(401, { error: { code: '1001', message: 'Authorization Token Missing' } }))
    
    await expect(listModels('glm', 'https://api.z.ai/api/paas/v4', ''))
      .rejects.toMatchObject({ modelsEndpointUrl: 'https://api.z.ai/api/paas/v4/models' })
  })

  it('propagates 404 and includes modelsEndpointUrl', async () => {
    const mockRequest = vi.fn()
    vi.doMock('undici', () => ({ request: mockRequest }))
    
    const { listModels } = await import('../extensions/claude-throne/src/services/Models')
    
    mockRequest.mockImplementation(async () => makeResponse(404, { error: 'not found' }))
    
    await expect(listModels('deepseek', 'https://api.deepseek.com/v1', 'KEY'))
      .rejects.toMatchObject({ modelsEndpointUrl: 'https://api.deepseek.com/v1/models' })
  })

  it('retries on 429 and succeeds on next attempt within budget', async () => {
    vi.useFakeTimers()
    const mockRequest = vi.fn()
    vi.doMock('undici', () => ({ request: mockRequest }))
    
    const { listModels } = await import('../extensions/claude-throne/src/services/Models')
    
    mockRequest.mockImplementation(async (url: string, opts: any) => {
      if (mockRequest.mock.calls.length === 1) {
        return makeResponse(429, { error: 'rate limit' })
      } else {
        return makeResponse(200, { data: [{ id: 'glm-4' }] })
      }
    })
    
    const promise = listModels('glm', 'https://api.z.ai/api/paas/v4', 'KEY')
    await vi.advanceTimersByTimeAsync(1000)
    const ids = await promise
    expect(ids).toEqual(['glm-4'])
    expect(mockRequest).toHaveBeenCalledTimes(2)
  })

  it('retries on 5xx (502) and succeeds on second attempt with backoff', async () => {
    vi.useFakeTimers()
    const mockRequest = vi.fn()
    vi.doMock('undici', () => ({ request: mockRequest }))
    
    const { listModels } = await import('../extensions/claude-throne/src/services/Models')
    
    mockRequest.mockImplementation(async (url: string, opts: any) => {
      if (mockRequest.mock.calls.length === 1) {
        return makeResponse(502, { error: 'bad gateway' })
      } else {
        return makeResponse(200, { data: [{ id: 'deepseek-chat' }, { id: 'deepseek-coder' }] })
      }
    })
    
    const promise = listModels('deepseek', 'https://api.deepseek.com/v1', 'KEY')
    // First attempt happens immediately, 502 triggers 1s backoff
    await vi.advanceTimersByTimeAsync(1000)
    const ids = await promise
    expect(ids).toEqual(['deepseek-chat', 'deepseek-coder'])
    expect(mockRequest).toHaveBeenCalledTimes(2)
  })

  it('classifies timeout when request exceeds per-request timeout', async () => {
    vi.useFakeTimers()
    const mockRequest = vi.fn()
    vi.doMock('undici', () => ({ request: mockRequest }))
    
    const { listModels } = await import('../extensions/claude-throne/src/services/Models')
    
    mockRequest.mockImplementation(async (url: string, opts: any) => new Promise((_, reject) => {
      opts?.signal?.addEventListener('abort', () => {
        const err: any = new Error('aborted')
        err.name = 'AbortError'
        err.code = 'UND_ERR_ABORTED'
        reject(err)
      })
    }))
    
    const promise = listModels('deepseek', 'https://api.deepseek.com/v1', 'KEY')
    await vi.advanceTimersByTimeAsync(20000)
    await expect(promise).rejects.toMatchObject({ errorType: 'timeout' })
  })
})
