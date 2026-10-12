import { useEffect, useState } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'

export function ProtectedRoute() {
  const { session, loading } = useAuth()
  const { pathname } = useLocation()
  if (loading) return <p className="container section" role="status">Restoring your session…</p>
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace />
  if (!session.user.email_confirmed_at) return <Navigate to="/verify-email" replace />
  return <Outlet key={session.user.id} />
}
// UI routing only. Every database request and RPC independently enforces RLS/roles.
export function AdminGate() {
  const { session } = useAuth()
  const [state, setState] = useState<'loading' | 'allowed' | 'denied'>('loading')
  useEffect(() => {
    let active = true
    if (!supabase || !session) return
    void supabase.from('user_roles').select('role').eq('user_id', session.user.id).maybeSingle().then(({ data, error }) => {
      if (active) setState(!error && data?.role === 'admin' ? 'allowed' : 'denied')
    })
    return () => { active = false }
  }, [session?.user.id])
  if (state === 'loading') return <p className="container section" role="status">Checking administrator access…</p>
  if (state === 'denied') return <section className="container section info-page"><h1>Administrator access unavailable.</h1><p>Your account needs an existing administrator role and verified database policies.</p><Link className="button" to="/dashboard">Customer dashboard</Link></section>
  return <Outlet />
}
