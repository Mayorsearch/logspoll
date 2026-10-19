import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'

interface DashboardContextType {
  theme: 'light' | 'dark'
  toggleTheme: () => void
  hideBalance: boolean
  toggleHideBalance: () => void
  walletBalanceMinor: number | null
  setWalletBalanceMinor: (v: number | null) => void
  refreshWallet: () => Promise<void>
  toastMessage: string | null
  showToast: (msg: string) => void
}

const DashboardContext = createContext<DashboardContextType | null>(null)

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('lp-mobile-theme') || localStorage.getItem('logspoll-site-theme')
      if (saved === 'dark' || saved === 'light') return saved
      if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark'
      }
    } catch {
      // Storage unavailable
    }
    return 'light'
  })

  const [hideBalance, setHideBalance] = useState<boolean>(() => {
    try {
      return localStorage.getItem('lp-mobile-hidebalance') === 'true'
    } catch {
      return false
    }
  })

  const [walletBalanceMinor, setWalletBalanceMinor] = useState<number | null>(null)
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg)
    const timer = setTimeout(() => {
      setToastMessage(null)
    }, 3400)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    document.body.classList.toggle('dark', theme === 'dark')
    document.documentElement.dataset.siteTheme = theme
    try {
      localStorage.setItem('lp-mobile-theme', theme)
      localStorage.setItem('logspoll-site-theme', theme)
    } catch {
      // Storage unavailable
    }
    const metaTheme = document.querySelector('meta[name="theme-color"]')
    if (metaTheme) {
      metaTheme.setAttribute('content', theme === 'dark' ? '#1a1f29' : '#f6f7f9')
    }
  }, [theme])

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'))
  }, [])

  const toggleHideBalance = useCallback(() => {
    setHideBalance((prev) => {
      const next = !prev
      try {
        localStorage.setItem('lp-mobile-hidebalance', String(next))
      } catch {
        // Storage unavailable
      }
      return next
    })
  }, [])

  const refreshWallet = useCallback(async () => {
    try {
      const res = await cloudflareRequest<{
        wallet?: { balance_minor: number }
      }>('/api/wallet')
      if (res.wallet) {
        setWalletBalanceMinor(res.wallet.balance_minor)
      }
    } catch {
      // Keep previous balance on network error
    }
  }, [])

  useEffect(() => {
    void refreshWallet()
  }, [refreshWallet])

  return (
    <DashboardContext.Provider
      value={{
        theme,
        toggleTheme,
        hideBalance,
        toggleHideBalance,
        walletBalanceMinor,
        setWalletBalanceMinor,
        refreshWallet,
        toastMessage,
        showToast,
      }}
    >
      {children}
    </DashboardContext.Provider>
  )
}

export function useDashboard() {
  const ctx = useContext(DashboardContext)
  if (!ctx) {
    throw new Error('useDashboard must be used within DashboardProvider')
  }
  return ctx
}

