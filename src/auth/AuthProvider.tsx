import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { configurationError, supabase } from '../lib/supabase'

interface AuthState {
  session: Session | null
  loading: boolean
  error: string | null
  recovery: boolean
  finishRecovery: () => void
}
const AuthContext = createContext<AuthState | null>(null)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(Boolean(supabase))
  const [error, setError] = useState<string | null>(configurationError)
  const [recovery, setRecovery] = useState(false)
  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let active = true
    const { data: { subscription } } = client.auth.onAuthStateChange((event, next) => {
      if (!active) return
      setSession(next)
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') setRecovery(false)
    })
    void (async () => {
      try {
        const initialized = await client.auth.initialize()
        if (initialized.error) throw initialized.error
        const { data, error: problem } = await client.auth.getSession()
        if (problem) throw problem
        if (active) setSession(data.session)
      } catch (problem) {
        if (active) setError(problem instanceof Error ? problem.message : 'Unable to restore your session. Please sign in again.')
      } finally { if (active) setLoading(false) }
    })()
    return () => { active = false; subscription.unsubscribe() }
  }, [])
  return <AuthContext.Provider value={{ session, loading, error, recovery, finishRecovery: () => setRecovery(false) }}>{children}</AuthContext.Provider>
}
export function useAuth() {
  const state = useContext(AuthContext)
  if (!state) throw new Error('AuthProvider is required')
  return state
}
