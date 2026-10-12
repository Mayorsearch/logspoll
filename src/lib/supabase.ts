import { createClient } from '@supabase/supabase-js'
import { publicConfigError } from './auth-policy'

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? ''
export const configurationError = publicConfigError(url, key)
export const supabase = configurationError ? null : createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
})
export const authRedirect = (path: '/auth/callback' | '/reset-password') => `${window.location.origin}${path}`
