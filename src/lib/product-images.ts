// Shared by the server mapper and browser renderer. Never accept embedded credentials.
export function safeProductImage(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2000 || /ypg_[a-fA-F0-9]{48}/.test(value)) return null
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.port || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|\[)/i.test(url.hostname)) return null
    // Only public image transformation parameters; signed/private URL tokens stay server-side.
    for (const [key, entry] of url.searchParams) if (!['w', 'h', 'width', 'height', 'q', 'quality', 'format', 'fit', 'auto'].includes(key) || !/^[a-zA-Z0-9,._-]{1,40}$/.test(entry)) return null
    return url.href
  } catch { return null }
}

export function productImages(item: Record<string, unknown>): string[] {
  const values: unknown[] = [item.image_url, item.image]
  if (Array.isArray(item.images)) values.push(...item.images)
  if (Array.isArray(item.image_urls)) values.push(...item.image_urls)
  const urls = values.map(value => safeProductImage(value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).url : value)).filter((value): value is string => Boolean(value))
  return [...new Set(urls)]
}
