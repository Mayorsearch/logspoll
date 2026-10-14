export const cloudflareMode = true
export interface CloudflareUser { id: string; email: string; name: string; role: string }
export async function cloudflareRequest<T>(path: string, body?: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', cache: 'no-store',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error(`Account service returned an unexpected response (HTTP ${response.status}). Saved progress is retained; retry or check backend logs.`)
  const data = await response.json().catch(() => null)
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Account service returned an invalid response. Please retry.')
  if (!response.ok) throw new Error(typeof data.message === 'string' ? data.message : typeof data.error === 'string' ? data.error : 'Account operation unavailable. Please retry.')
  return data as T
}
export async function cloudflareAuth(action: string, body: Record<string, unknown>) {
  const result = await cloudflareRequest(`/api/auth/${action}`, body)
  window.dispatchEvent(new Event('logspoll-auth-change'))
  return result
}
