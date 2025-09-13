import { request } from 'undici'

export async function validateOpenRouter(key: string): Promise<boolean> {
  const res = await request('https://openrouter.ai/api/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
  })
  return res.statusCode === 200
}

export async function validateOpenAI(key: string, baseUrl = 'https://api.openai.com/v1'): Promise<boolean> {
  const res = await request(`${baseUrl.replace(/\/$/, '')}/models`, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
  })
  return res.statusCode === 200
}

export async function validateTogether(key: string): Promise<boolean> {
  const res = await request('https://api.together.xyz/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
  })
  return res.statusCode === 200
}

export async function validateGrok(key: string): Promise<boolean> {
  const res = await request('https://api.x.ai/v1/models', {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
  })
  return res.statusCode === 200
}

export async function validateCustom(key: string, baseUrl: string): Promise<boolean> {
  const url = `${baseUrl.replace(/\/$/, '')}/models`
  const res = await request(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${key}` },
  })
  return res.statusCode === 200
}

