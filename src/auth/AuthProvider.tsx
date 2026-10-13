import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { configurationError, supabase } from '../lib/supabase'
import { cloudflareMode } from '../lib/cloudflare-auth'
import type { CloudflareUser } from '../lib/cloudflare-auth'

interface Session { access_token: string; user: { id: string; email?: string; email_confirmed_at?: string; user_metadata: Record<string, unknown> } }

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
  const [loading, setLoading] = useState(cloudflareMode || Boolean(supabase))
  const [error, setError] = useState<string | null>(configurationError)
  const [recovery, setRecovery] = useState(false)
  useEffect(() => {
    if (cloudflareMode) {
      let active = true
      const restore = async () => {
        try {
          const response = await fetch('/api/account/session', { credentials: 'same-origin', cache: 'no-store' })
          if (response.status === 401) { if (active) { setSession(null); setError(null) }; return }
          if (!response.ok) throw new Error('Cloudflare account service unavailable.')
          const { user } = await response.json() as { user: CloudflareUser }
          if (active) { setSession({ access_token: '', user: { id: user.id, email: user.email, email_confirmed_at: 'verified', user_metadata: { full_name: user.name } } }); setError(null) }
        } catch (problem) { if (active) { setSession(null); setError(problem instanceof Error ? problem.message : 'Session unavailable.') } }
        finally { if (active) setLoading(false) }
      }
      void restore()
      const listener = () => { void restore() }
      window.addEventListener('logspoll-auth-change', listener)
      window.addEventListener('focus', listener)
      return () => { active = false; window.removeEventListener('logspoll-auth-change', listener); window.removeEventListener('focus', listener) }
    }
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
// eslint-disable-next-line react-refresh/only-export-components -- Context hook stays beside its provider.
export function useAuth() {
  const state = useContext(AuthContext)
  if (!state) throw new Error('AuthProvider is required')
  return state
}
