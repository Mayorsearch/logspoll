export interface CartItem {
  id: string
  quantity: number
}

export function parseCart(value: string | null): CartItem[] {
  try {
    const data: unknown = JSON.parse(value ?? '[]')
    if (!Array.isArray(data)) return []
    const seen = new Set<string>()
    return data.slice(0, 100).flatMap(item => {
      if (
        !item ||
        typeof item !== 'object' ||
        !/^[a-f0-9-]{36}$/i.test((item as any).id) ||
        !Number.isSafeInteger((item as any).quantity) ||
        (item as any).quantity < 1 ||
        (item as any).quantity > 1000 ||
        seen.has((item as any).id)
      ) {
        return []
      }
      seen.add((item as any).id)
      return [{ id: (item as any).id, quantity: (item as any).quantity }]
    })
  } catch {
    return []
  }
}

