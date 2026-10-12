export function safeReturnTo(value: string | null): string {
  if (value && (/^\/(?:marketplace|cart|checkout)$/.test(value) || /^\/products\/[a-z0-9-]+$/.test(value))) return value
  if (value === '/admin' || value === '/admin/settings/supplier-api') return value
  return value && /^\/dashboard(?:\/[a-z-]+)?$/.test(value) ? value : '/dashboard'
}

export function publicConfigError(url: string, key: string): string | null {
  if (!url || !key) return 'Account access is not configured yet. Please try again later.'
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname))) throw new Error()
    if (key.startsWith('sb_publishable_')) return null
    const payload = JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.role === 'anon') return null
  } catch { /* Fail closed for malformed configuration. */ }
  return 'Account configuration is invalid. A public Supabase URL and publishable key are required.'
}
