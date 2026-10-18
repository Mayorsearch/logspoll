import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { type CartItem, parseCart } from './cart-state'
export { type CartItem, parseCart } from './cart-state'

interface CartState {
  items: CartItem[]
  add: (id: string, quantity: number, maximum: number) => void
  update: (id: string, quantity: number) => void
  remove: (id: string) => void
  clear: () => void
}

const Context = createContext<CartState | null>(null)

export function CartProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  return (
    <UserCart key={session?.user.id ?? 'guest'} owner={session?.user.id}>
      {children}
    </UserCart>
  )
}

function UserCart({ owner, children }: { owner?: string; children: ReactNode }) {
  const storageKey = `logspoll-cart:${owner ?? 'guest'}`
  const [items, setItems] = useState<CartItem[]>(() => {
    try {
      if (owner) {
        const userSaved = localStorage.getItem(storageKey)
        if (userSaved) {
          const parsed = parseCart(userSaved)
          if (parsed.length > 0) return parsed
        }
        // If user cart is empty, migrate guest cart if present
        const guestSaved = localStorage.getItem('logspoll-cart:guest')
        if (guestSaved) {
          const guestParsed = parseCart(guestSaved)
          if (guestParsed.length > 0) {
            try {
              localStorage.removeItem('logspoll-cart:guest')
            } catch {}
            return guestParsed
          }
        }
      }
      return parseCart(localStorage.getItem(storageKey))
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(items))
    } catch {
      // Cart remains usable in memory
    }
  }, [items, storageKey])

  function add(id: string, quantity: number, maximum: number) {
    if (!Number.isInteger(quantity) || quantity < 1 || maximum < 1) return
    setItems(current => {
      const old = current.find(item => item.id === id)
      const next = Math.min(1000, maximum, (old?.quantity ?? 0) + quantity)
      return old
        ? current.map(item => (item.id === id ? { ...item, quantity: next } : item))
        : [...current, { id, quantity: next }].slice(0, 100)
    })
  }

  function update(id: string, quantity: number) {
    if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 1000) return
    setItems(current =>
      quantity === 0
        ? current.filter(item => item.id !== id)
        : current.map(item => (item.id === id ? { ...item, quantity } : item))
    )
  }

  function remove(id: string) {
    setItems(current => current.filter(item => item.id !== id))
  }

  function clear() {
    setItems([])
    try {
      localStorage.removeItem(storageKey)
    } catch {}
  }

  return (
    <Context.Provider value={{ items, add, update, remove, clear }}>
      {children}
    </Context.Provider>
  )
}

export function useCart() {
  const value = useContext(Context)
  if (!value) throw new Error('CartProvider required')
  return value
}
