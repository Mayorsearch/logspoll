import { useEffect, useState } from 'react'
import type { SubmitEvent } from 'react'
import { Link, Navigate, useSearchParams, useLocation, useNavigate } from 'react-router-dom'
import { 
  ShieldCheck, Eye, EyeOff, Mail, Lock, User, ArrowRight, Loader2, CheckCircle2,
  Zap, LifeBuoy
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { cloudflareAuth } from '../lib/cloudflare-auth'
import { safeReturnTo } from '../lib/auth-policy'
import { OtpInput } from '../components/OtpInput'
import './Otp.css'

type Mode = 'login' | 'signup' | 'forgot' | 'reset' | 'verify' | 'admin'

const titles: Record<Mode, string> = {
  login: 'Welcome Back',
  signup: 'Create Your Account',
  forgot: 'Forgot Password?',
  reset: 'Reset Your Password',
  verify: 'Verify Your Email',
  admin: 'Administrator Sign In',
}

const subtitles: Record<Mode, string> = {
  login: 'Sign in to access the private catalog and start ordering digital services.',
  signup: 'Sign up to access the private catalog and start ordering digital services.',
  forgot: 'Enter your email address and we will send a 6-digit recovery code.',
  reset: 'Enter your 6-digit code and choose a new secure password.',
  verify: 'Enter the 6-digit verification code sent to your email address.',
  admin: 'Restricted access for authorized platform administrators.',
}

export function AuthPage({ mode }: { mode: Mode }) {
  const { session, loading, finishRecovery } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [params] = useSearchParams()

  const state = location.state as { email?: string; sentAt?: number } | null
  const [email, setEmail] = useState(state?.email ?? '')
  const [pending, setPending] = useState(mode === 'reset')
  const [otp, setOtp] = useState('')
  const [readyAt, setReadyAt] = useState(state?.sentAt ? state.sentAt + 60000 : 0)
  const [seconds, setSeconds] = useState(() => Math.max(0, Math.ceil((readyAt - Date.now()) / 1000)))
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [agreedToTerms, setAgreedToTerms] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [complete, setComplete] = useState(false)

  const codeFlow = pending && ['signup', 'verify', 'reset'].includes(mode)

  useEffect(() => {
    const update = () => setSeconds(Math.max(0, Math.ceil((readyAt - Date.now()) / 1000)))
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [readyAt])

  function sent() {
    setReadyAt(Date.now() + 60000)
    setPending(true)
    setOtp('')
    setMessage('If this account is eligible, a 6-digit verification code has been sent. Please check your inbox.')
  }

  function fail(problem: unknown) {
    const text = problem instanceof Error ? problem.message : 'Please retry.'
    setError(/invalid otp/i.test(text) ? 'Code incorrect, expired, or already used. Please request a new code.' : text)
  }

  async function requestCode() {
    if (mode === 'reset' || mode === 'forgot') {
      await cloudflareAuth('email-otp/request-password-reset', { email })
    } else {
      await cloudflareAuth('email-otp/send-verification-otp', { email, type: 'email-verification' })
    }
  }

  async function resend() {
    if (busy || seconds > 0) return
    setBusy(true)
    setError('')
    try {
      await requestCode()
      sent()
    } catch (problem) {
      fail(problem)
    } finally {
      setBusy(false)
    }
  }

  async function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return

    const values = new FormData(event.currentTarget)
    const password = String(values.get('password') ?? '')
    const name = String(values.get('full_name') ?? '').trim()

    setError('')
    setMessage('')

    if (mode === 'signup' && !codeFlow) {
      if (name.length < 2) {
        setError('Please enter your full name (at least 2 characters).')
        return
      }
      if (!agreedToTerms) {
        setError('Please agree to the Terms of Service and Privacy Policy to continue.')
        return
      }
    }

    if ((mode === 'reset' || (mode === 'signup' && !codeFlow)) && (password.length < 12 || password !== values.get('confirm'))) {
      setError('Passwords must match and be at least 12 characters long.')
      return
    }

    if (codeFlow && !/^\d{6}$/.test(otp)) {
      setError('Please enter all 6 digits of your verification code.')
      return
    }

    setBusy(true)
    try {
      if (mode === 'login' || mode === 'admin') {
        await cloudflareAuth('sign-in/email', { email, password })
        window.location.assign(mode === 'admin' ? '/admin' : safeReturnTo(params.get('next')))
      } else if (codeFlow) {
        if (mode === 'reset') {
          await cloudflareAuth('email-otp/reset-password', { email, otp, password })
          finishRecovery()
          setMessage('Password updated successfully. You can now sign in with your new password.')
        } else {
          await cloudflareAuth('email-otp/verify-email', { email, otp })
          setMessage('Email verified successfully! You can now sign in.')
        }
        setComplete(true)
        setOtp('')
      } else if (mode === 'signup') {
        await cloudflareAuth('sign-up/email', { email, password, name })
        sent()
      } else {
        await requestCode()
        if (mode === 'forgot') navigate('/reset-password', { state: { email, sentAt: Date.now() } })
        else sent()
      }
    } catch (problem) {
      fail(problem)
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <p className="container section" role="status">Restoring your session…</p>
  if (session && ['login', 'signup', 'admin'].includes(mode)) {
    return <Navigate to={mode === 'admin' ? '/admin' : safeReturnTo(params.get('next'))} replace />
  }

  const passwordFields = ['login', 'admin', 'reset'].includes(mode) || (mode === 'signup' && !codeFlow)

  return (
    <section className={`auth-shell auth-${mode}`}>
      <div className="auth-card">
        {/* Brand Header */}
        <div className="auth-card-heading">
          <div className="auth-brand" style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
            <Link to="/" aria-label="LOGSPOLL home">
              <img
                src="/logo-light.png"
                alt="LogsPoll"
                style={{ height: 36, width: 'auto', display: 'block' }}
              />
            </Link>
          </div>
          <h1 className="auth-page-title">{codeFlow && mode !== 'reset' ? 'Enter Verification Code' : titles[mode]}</h1>
          <p className="auth-intro">
            {codeFlow
              ? 'Enter the six-digit code sent to your email. Codes expire in 10 minutes.'
              : subtitles[mode]}
          </p>

          {(mode === 'signup' || mode === 'login') && (
            <div className="auth-mode-tabs" role="tablist" aria-label="Account access modes">
              <Link
                to={params.get('next') ? `/signup?next=${encodeURIComponent(params.get('next')!)}` : '/signup'}
                className={`auth-mode-tab ${mode === 'signup' ? 'active' : ''}`}
                role="tab"
                aria-selected={mode === 'signup'}
              >
                Sign Up
              </Link>
              <Link
                to={params.get('next') ? `/login?next=${encodeURIComponent(params.get('next')!)}` : '/login'}
                className={`auth-mode-tab ${mode === 'login' ? 'active' : ''}`}
                role="tab"
                aria-selected={mode === 'login'}
              >
                Login
              </Link>
            </div>
          )}
        </div>

        <div className="auth-card-body">
          {error && (
            <div className="form-error" role="alert">
              <span>{error}</span>
            </div>
          )}

          {!complete && (
            <form onSubmit={submit} className="account-form">
              <fieldset disabled={busy}>
                {/* Full Name for Signup */}
                {mode === 'signup' && !codeFlow && (
                  <label>
                    <span className="label-text">Full Name</span>
                    <div className="input-with-icon">
                      <User size={18} className="field-icon" />
                      <input
                        name="full_name"
                        placeholder="Enter your full name"
                        autoComplete="name"
                        required
                        minLength={2}
                        maxLength={120}
                      />
                    </div>
                  </label>
                )}

                {/* Email Address */}
                <label>
                  <span className="label-text">Email Address</span>
                  <div className="input-with-icon">
                    <Mail size={18} className="field-icon" />
                    <input
                      type="email"
                      name="email"
                      placeholder="you@example.com"
                      autoComplete="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value.trim().toLowerCase())
                        setOtp('')
                      }}
                      readOnly={codeFlow && mode !== 'reset'}
                      required
                      maxLength={254}
                    />
                  </div>
                </label>

                {/* 6-Digit OTP */}
                {codeFlow && (
                  <div className="otp-container">
                    <OtpInput value={otp} onChange={setOtp} disabled={busy} />
                    <p className="otp-help">Check your inbox or spam folder for the code.</p>
                  </div>
                )}

                {/* Password Field */}
                {passwordFields && (
                  <label>
                    <div className="password-label-row">
                      <span className="label-text">{mode === 'reset' ? 'New Password' : 'Password'}</span>
                      {mode === 'login' && (
                        <Link to="/forgot-password" className="forgot-password-link">
                          Forgot password?
                        </Link>
                      )}
                    </div>
                    <div className="input-with-icon">
                      <Lock size={18} className="field-icon" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        name="password"
                        placeholder={mode === 'signup' ? 'Create a password' : 'Enter your password'}
                        autoComplete={mode === 'signup' || mode === 'reset' ? 'new-password' : 'current-password'}
                        required
                        minLength={mode === 'login' || mode === 'admin' ? 1 : 12}
                        maxLength={128}
                      />
                      <button
                        type="button"
                        className="password-toggle-btn"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                    {(mode === 'signup' || mode === 'reset') && (
                      <span className="field-hint">Must be at least 12 characters long.</span>
                    )}
                  </label>
                )}

                {/* Confirm Password */}
                {((mode === 'signup' && !codeFlow) || mode === 'reset') && (
                  <label>
                    <span className="label-text">Confirm Password</span>
                    <div className="input-with-icon">
                      <Lock size={18} className="field-icon" />
                      <input
                        type={showConfirmPassword ? 'text' : 'password'}
                        name="confirm"
                        placeholder="Confirm your password"
                        autoComplete="new-password"
                        required
                        minLength={12}
                        maxLength={128}
                      />
                      <button
                        type="button"
                        className="password-toggle-btn"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
                      >
                        {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </label>
                )}

                {/* Terms and Privacy Checkbox for Signup */}
                {mode === 'signup' && !codeFlow && (
                  <label className="auth-checkbox-label">
                    <input
                      type="checkbox"
                      checked={agreedToTerms}
                      onChange={(e) => setAgreedToTerms(e.target.checked)}
                      required
                    />
                    <span>
                      I agree to the <Link to="/terms">Terms of Service</Link> and{' '}
                      <Link to="/privacy">Privacy Policy</Link>.
                    </span>
                  </label>
                )}

                {/* Submit CTA */}
                <button className="button auth-submit-btn" type="submit" disabled={busy}>
                  {busy ? (
                    <>
                      <Loader2 size={18} className="animate-spin" />
                      <span>Please wait…</span>
                    </>
                  ) : codeFlow ? (
                    mode === 'reset' ? 'Update Password' : 'Verify Email'
                  ) : mode === 'signup' ? (
                    'Sign Up'
                  ) : ['forgot', 'verify'].includes(mode) ? (
                    'Send Verification Code'
                  ) : (
                    'Login'
                  )}
                </button>
              </fieldset>
            </form>
          )}

          {/* Resend Code for OTP */}
          {codeFlow && !complete && (
            <div className="otp-resend-wrapper">
              <button
                type="button"
                className="otp-resend-btn"
                onClick={() => void resend()}
                disabled={busy || seconds > 0 || !email}
              >
                {seconds > 0 ? `Resend code in ${seconds}s` : 'Resend code'}
              </button>
            </div>
          )}

          {/* Success Message */}
          {message && (
            <div className="form-success" role="status">
              <CheckCircle2 size={18} />
              <span>{message}</span>
            </div>
          )}

          {complete && (
            <Link className="button auth-submit-btn" to="/login">
              Continue to Sign In <ArrowRight size={18} />
            </Link>
          )}

          {/* OR Divider and Bottom Link (Screen 2 Reference) */}
          {(mode === 'signup' || mode === 'login') && (
            <>
              <div className="auth-or-divider">
                <span>OR</span>
              </div>
              <div className="auth-footer-prompt">
                {mode === 'signup' ? (
                  <p>
                    Already have an account? <Link to="/login" className="auth-accent-link">Login</Link>
                  </p>
                ) : (
                  <p>
                    Don't have an account? <Link to="/signup" className="auth-accent-link">Sign Up</Link>
                  </p>
                )}
              </div>
            </>
          )}

          {mode !== 'signup' && mode !== 'login' && (
            <div className="auth-footer-links">
              <Link to="/login" className="secondary-auth-link">
                ← Back to Login
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Screen 2 Reference: Bottom Trust Indicators */}
      <div className="auth-trust-strip">
        <div className="auth-trust-box">
          <span className="auth-trust-icon-circle">
            <Zap size={18} />
          </span>
          <div className="auth-trust-texts">
            <strong>Fast Access</strong>
            <small>Get started quickly</small>
          </div>
        </div>
        <div className="auth-trust-box">
          <span className="auth-trust-icon-circle">
            <ShieldCheck size={18} />
          </span>
          <div className="auth-trust-texts">
            <strong>Secure &amp; Private</strong>
            <small>Your data is safe</small>
          </div>
        </div>
        <div className="auth-trust-box">
          <span className="auth-trust-icon-circle">
            <LifeBuoy size={18} />
          </span>
          <div className="auth-trust-texts">
            <strong>Dedicated Support</strong>
            <small>We're here to help</small>
          </div>
        </div>
      </div>
    </section>
  )
}

export function AuthCallback() {
  return <Navigate to="/verify-email" replace />
}

export function RecoveryRedirect() {
  const { recovery } = useAuth()
  const { pathname } = useLocation()
  return recovery && pathname !== '/reset-password' ? <Navigate to="/reset-password" replace /> : null
}
