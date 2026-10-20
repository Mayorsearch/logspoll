import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ShieldCheck, AlertCircle, RefreshCw, CheckCircle2, ArrowRight, Lock } from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { cloudflareRequest } from '../lib/cloudflare-auth'

interface EnrollmentCheck {
  invited: boolean
  expires_at?: number | null
}

export function AcceptInvitation() {
  const { session, loading: authLoading } = useAuth()
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [checking, setChecking] = useState(true)
  const [invited, setInvited] = useState(false)
  const [expiresAt, setExpiresAt] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    let active = true
    if (authLoading) return

    if (!session) {
      setChecking(false)
      return
    }

    setChecking(true)
    setError('')

    const query = token ? `?token=${encodeURIComponent(token)}` : ''
    cloudflareRequest<EnrollmentCheck>(`/api/account/admin-enrollment${query}`)
      .then((data) => {
        if (!active) return
        setInvited(Boolean(data.invited))
        setExpiresAt(data.expires_at ?? null)
      })
      .catch((err) => {
        if (!active) return
        setInvited(false)
        setError(err instanceof Error ? err.message : 'Unable to verify invitation.')
      })
      .finally(() => {
        if (active) setChecking(false)
      })

    return () => {
      active = false
    }
  }, [session, authLoading, token])

  async function handleAccept() {
    if (submitting) return
    setSubmitting(true)
    setError('')
    try {
      await cloudflareRequest('/api/account/admin-enrollment', {
        ...(token ? { token } : {}),
      })
      setSuccess(true)
      setTimeout(() => {
        window.location.assign('/admin')
      }, 1200)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unable to accept administrator invitation.'
      if (msg.toLowerCase().includes('fresh') || msg.toLowerCase().includes('sign-in')) {
        setError('Security check: A fresh sign-in within the last 15 minutes is required before accepting administrative privileges. Please log out and sign in again.')
      } else {
        setError(msg)
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (authLoading || checking) {
    return (
      <div className="auth-shell">
        <div className="auth-card" style={{ textAlign: 'center', padding: '48px 24px' }}>
          <RefreshCw size={28} className="spin-icon" style={{ margin: '0 auto 16px', color: 'var(--orange)' }} />
          <h2 style={{ fontSize: 18, margin: 0, fontWeight: 700 }}>Verifying Administrator Invitation…</h2>
          <p style={{ fontSize: 13, color: 'var(--muted)', marginTop: 8 }}>
            Checking your authenticated account credentials and invitation validity.
          </p>
        </div>
      </div>
    )
  }

  // Case 1: Unauthenticated user
  if (!session) {
    return (
      <div className="auth-shell">
        <div className="auth-card" style={{ maxWidth: 480, margin: 'auto' }}>
          <div style={{ textAlign: 'center', marginBottom: 20 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fff3e9', color: 'var(--orange)', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>
              <Lock size={26} />
            </div>
            <h1 style={{ fontSize: 24, margin: '0 0 8px', fontWeight: 800 }}>Administrator Invitation</h1>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0, lineHeight: 1.5 }}>
              Sign in with your verified LogsPoll account to review and accept your administrator invitation.
            </p>
          </div>

          <div style={{ display: 'grid', gap: 12, marginTop: 24 }}>
            <Link
              to={`/login?returnTo=${encodeURIComponent(window.location.pathname + window.location.search)}`}
              className="button button-orange"
              style={{ width: '100%', textAlign: 'center', justifyContent: 'center' }}
            >
              Sign In to Accept Invitation
            </Link>
            <Link
              to="/"
              className="button button-outline"
              style={{ width: '100%', textAlign: 'center', justifyContent: 'center' }}
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Case 2: Success state
  if (success) {
    return (
      <div className="auth-shell">
        <div className="auth-card" style={{ maxWidth: 480, margin: 'auto', textAlign: 'center', padding: '40px 28px' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#ecfdf3', color: '#027a48', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
            <CheckCircle2 size={32} />
          </div>
          <h1 style={{ fontSize: 22, margin: '0 0 8px', fontWeight: 800, color: '#0f172a' }}>
            Administrator Privileges Granted
          </h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 20px', lineHeight: 1.5 }}>
            Your account ({session.user.email}) has been successfully enrolled as an authorized administrator. Redirecting to the control center…
          </p>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, color: 'var(--orange)', fontSize: 13, fontWeight: 700 }}>
            <RefreshCw size={14} className="spin-icon" />
            <span>Opening Administrator Control Center…</span>
          </div>
        </div>
      </div>
    )
  }

  // Case 3: No valid pending invitation
  if (!invited) {
    return (
      <div className="auth-shell">
        <div className="auth-card" style={{ maxWidth: 480, margin: 'auto', textAlign: 'center', padding: '40px 24px' }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#f1f5f9', color: '#64748b', display: 'grid', placeItems: 'center', margin: '0 auto 16px' }}>
            <ShieldCheck size={28} />
          </div>
          <h1 style={{ fontSize: 22, margin: '0 0 8px', fontWeight: 800, color: '#0f172a' }}>
            No Pending Invitation Found
          </h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: '0 0 20px', lineHeight: 1.5 }}>
            Your account (<strong>{session.user.email}</strong>) does not have an active administrator invitation. Invitations are single-use, time-limited, and must be issued directly by an existing platform administrator.
          </p>

          <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
            <Link to="/dashboard" className="button button-orange" style={{ width: '100%', justifyContent: 'center' }}>
              Return to Customer Dashboard
            </Link>
            <Link to="/marketplace" className="button button-outline" style={{ width: '100%', justifyContent: 'center' }}>
              Explore Marketplace
            </Link>
          </div>
        </div>
      </div>
    )
  }

  // Case 4: Valid pending invitation found
  return (
    <div className="auth-shell">
      <div className="auth-card" style={{ maxWidth: 520, margin: 'auto', padding: '36px 28px' }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ width: 56, height: 56, borderRadius: '50%', background: '#fff3e9', color: 'var(--orange)', display: 'grid', placeItems: 'center', margin: '0 auto 14px' }}>
            <ShieldCheck size={28} />
          </div>
          <h1 style={{ fontSize: 24, margin: '0 0 6px', fontWeight: 800 }}>Accept Administrator Invitation</h1>
          <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
            You have received an authorized invitation to join the LogsPoll administration team.
          </p>
        </div>

        <div style={{ background: 'var(--page, #f8fafc)', border: '1px solid var(--line, #e2e8f0)', borderRadius: 14, padding: '16px 18px', marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line, #e2e8f0)', paddingBottom: 10, marginBottom: 10, fontSize: 12.5 }}>
            <span style={{ color: 'var(--muted)' }}>Invited Account</span>
            <strong style={{ color: 'var(--ink, #0f172a)' }}>{session.user.email}</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--line, #e2e8f0)', paddingBottom: 10, marginBottom: 10, fontSize: 12.5 }}>
            <span style={{ color: 'var(--muted)' }}>Assigned Role</span>
            <strong style={{ color: 'var(--orange, #f97316)' }}>Administrator (Full Access)</strong>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
            <span style={{ color: 'var(--muted)' }}>Invitation Status</span>
            <strong style={{ color: '#027a48' }}>Active · Pending Acceptance</strong>
          </div>
          {expiresAt && (
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--line, #e2e8f0)', fontSize: 11.5, color: 'var(--muted)' }}>
              <span>Valid Until</span>
              <span>{new Date(expiresAt).toLocaleString()}</span>
            </div>
          )}
        </div>

        <div style={{ background: 'rgba(249, 115, 22, 0.08)', border: '1px solid rgba(249, 115, 22, 0.25)', borderRadius: 12, padding: '12px 14px', marginBottom: 20, fontSize: 12, lineHeight: 1.5, color: '#9a3412' }}>
          <strong>Security Notice:</strong> Accepting this invitation will permanently grant your account administrative permissions to manage products, suppliers, customers, and order fulfillments. Do not accept if you were not expecting this invitation.
        </div>

        {error && (
          <div role="alert" style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 12, padding: '12px 14px', marginBottom: 20, color: '#b91c1c', fontSize: 12.5, lineHeight: 1.45, display: 'flex', gap: 8 }}>
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 2 }} />
            <span>{error}</span>
          </div>
        )}

        <div style={{ display: 'grid', gap: 10 }}>
          <button
            type="button"
            className="button button-orange"
            onClick={handleAccept}
            disabled={submitting}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            {submitting ? (
              <>
                <RefreshCw size={15} className="spin-icon" />
                <span>Confirming Enrollment…</span>
              </>
            ) : (
              <>
                <span>Accept Administrator Invitation</span>
                <ArrowRight size={15} />
              </>
            )}
          </button>
          <Link
            to="/dashboard"
            className="button button-outline"
            style={{ width: '100%', justifyContent: 'center' }}
          >
            Decline / Cancel
          </Link>
        </div>
      </div>
    </div>
  )
}
