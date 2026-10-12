import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
export interface CartItem { id: string; quantity: number }
export function parseCart(value: string | null): CartItem[] {
  try { const data: unknown = JSON.parse(value ?? '[]'); if (!Array.isArray(data)) return []; const seen = new Set<string>(); return data.slice(0, 100).flatMap(item => { if (!item || typeof item !== 'object' || !/^[a-f0-9-]{36}$/i.test(item.id) || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000 || seen.has(item.id)) return []; seen.add(item.id); return [{ id: item.id, quantity: item.quantity }] }) } catch { return [] }
}
interface CartState { items: CartItem[]; add: (id: string, quantity: number, maximum: number) => void; update: (id: string, quantity: number) => void; clear: () => void }
const Context = createContext<CartState | null>(null)
export function CartProvider({ children }: { children: ReactNode }) { const { session } = useAuth(); return <UserCart key={session?.user.id ?? 'guest'} owner={session?.user.id}>{children}</UserCart> }
function UserCart({ owner, children }: { owner?: string; children: ReactNode }) {
  const key = `logspoll-cart:${owner ?? 'guest'}`
  const [items, setItems] = useState<CartItem[]>(() => { if (!owner) return []; try { return parseCart(localStorage.getItem(key)) } catch { return [] } })
  useEffect(() => { if (owner) { try { localStorage.setItem(key, JSON.stringify(items)) } catch { /* Cart remains usable in memory. */ } } }, [items, owner, key])
  function add(id: string, quantity: number, maximum: number) { if (!owner || !Number.isInteger(quantity) || quantity < 1 || maximum < 1) return; setItems(current => { const old = current.find(item => item.id === id); const next = Math.min(1000, maximum, (old?.quantity ?? 0) + quantity); return old ? current.map(item => item.id === id ? { ...item, quantity: next } : item) : [...current, { id, quantity: next }].slice(0, 100) }) }
  function update(id: string, quantity: number) { if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1000) return; setItems(current => quantity === 0 ? current.filter(item => item.id !== id) : current.map(item => item.id === id ? { ...item, quantity } : item)) }
  return <Context.Provider value={{ items, add, update, clear: () => setItems([]) }}>{children}</Context.Provider>
}
export function useCart() { const value = useContext(Context); if (!value) throw new Error('CartProvider required'); return value }
