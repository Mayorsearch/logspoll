export function safeReturnTo(value: string | null): string {
  if (value && (/^\/(?:marketplace|cart|checkout)$/.test(value) || /^\/products\/[a-z0-9-]+$/.test(value))) return value
  if (value === '/admin' || value === '/admin/settings/supplier-api') return value
  return value && /^\/dashboard(?:\/[a-z-]+)?$/.test(value) ? value : '/dashboard'
}
