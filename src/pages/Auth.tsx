import { useState } from 'react';
import type { SubmitEvent } from 'react';
import { Link, Navigate, useSearchParams, useLocation } from 'react-router-dom';
import { ShieldCheck } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { cloudflareAuth } from '../lib/cloudflare-auth';
import { safeReturnTo } from '../lib/auth-policy';
type Mode = 'login' | 'signup' | 'forgot' | 'reset' | 'verify' | 'admin';
const titles: Record<Mode, string> = { login: 'Welcome Back', signup: 'Create Account', forgot: 'Forgot your password?', reset: 'Choose a new password', verify: 'Verify your email', admin: 'Administrator Sign In' };
export function AuthPage({ mode }: {
    mode: Mode;
}) {
    const { session, loading, error: sessionError, finishRecovery } = useAuth();
    const [params] = useSearchParams();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    const [complete, setComplete] = useState(false);
    const isPassword = ['login', 'signup', 'reset', 'admin'].includes(mode);
    const needsEmail = mode !== 'reset';
    async function submit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy)
            return;
        const values = new FormData(event.currentTarget);
        const email = String(values.get('email') ?? '').trim();
        const password = String(values.get('password') ?? '');
        const name = String(values.get('full_name') ?? '').trim();
        setError('');
        setMessage('');
        if (mode === 'signup' && name.length < 2) {
            setError('Enter your full name (at least 2 characters).');
            return;
        }
        if (['signup', 'reset'].includes(mode) && (password.length < (12) || password !== values.get('confirm'))) {
            setError(`Use at least ${12} characters and make sure both passwords match.`);
            return;
        }
        setBusy(true);
        try {
            {
                if (mode === 'login' || mode === 'admin') {
                    await cloudflareAuth('sign-in/email', { email, password });
                    window.location.assign(mode === 'admin' ? '/admin' : safeReturnTo(params.get('next')));
                }
                else if (mode === 'signup') {
                    await cloudflareAuth('sign-up/email', { email, password, name, callbackURL: '/login?verified=1' });
                    setComplete(true);
                    setMessage('Check your inbox to verify your email, then sign in. If already registered, sign in or reset your password.');
                }
                else if (mode === 'forgot') {
                    await cloudflareAuth('request-password-reset', { email, redirectTo: '/reset-password' });
                    setMessage('If this account exists, a password reset link has been requested.');
                }
                else if (mode === 'verify') {
                    await cloudflareAuth('send-verification-email', { email, callbackURL: '/login?verified=1' });
                    setMessage('If verification is pending, check your inbox for a new link.');
                }
                else {
                    await cloudflareAuth('reset-password', { newPassword: password, token: params.get('token') });
                    finishRecovery();
                    setComplete(true);
                    setMessage('Password updated. Sign in with your new password.');
                }
            }
        }
        catch (problem) {
            setError(problem instanceof Error ? problem.message : 'Something went wrong. Please try again.');
        }
        finally {
            setBusy(false);
        }
    }
    if (loading)
        return <p className="container section" role="status">Restoring your session…</p>;
    if (session && ['login', 'signup', 'admin'].includes(mode))
        return <Navigate to={mode === 'admin' ? '/admin' : safeReturnTo(params.get('next'))} replace/>;
    const resetUnavailable = mode === 'reset' && (!params.get('token') || Boolean(params.get('error')));
    return <section className={`auth-shell auth-${mode}`}><div className="auth-card"><div className="auth-card-heading"><span className="auth-shield"><ShieldCheck size={34}/></span><h1>{titles[mode]}</h1><p className="auth-intro">{mode === 'signup' ? 'Join LOGSPOLL to access digital tools and the private marketplace.' : mode === 'verify' ? 'Open the link in your confirmation email, or request a new one below.' : mode === 'forgot' ? 'We’ll email you a secure link to reset your password.' : mode === 'reset' ? 'Use a strong password that you haven’t used elsewhere.' : mode === 'admin' ? 'Restricted access for authorized LOGSPOLL administrators.' : 'Sign in to access your digital marketplace.'}</p></div><div className="auth-card-body">
    {(error || (mode === 'reset' && sessionError)) && <p className="form-error" role="alert">{error || sessionError}</p>}
    {resetUnavailable ? <p className="form-error" role="alert">Open a valid password reset link in the same browser where you requested it. <Link to="/forgot-password">Request another link</Link>.</p> : <form onSubmit={submit} className="account-form">
      <fieldset disabled={busy || complete}>
      {mode === 'signup' && <label>Full Name<input name="full_name" placeholder="John Doe" autoComplete="name" required minLength={2} maxLength={120}/></label>}
      {needsEmail && <label>Email Address<input type="email" name="email" placeholder="you@example.com" autoComplete="email" defaultValue={mode === 'verify' ? session?.user.email : ''} required maxLength={254}/></label>}
      {isPassword && <label><span className="password-label">{mode === 'reset' ? 'New Password' : 'Password'}{mode === 'login' && <Link to="/forgot-password">Forgot?</Link>}</span><input type="password" name="password" placeholder="••••••••" autoComplete={mode === 'signup' || mode === 'reset' ? 'new-password' : 'current-password'} required minLength={mode === 'login' || mode === 'admin' ? 1 : 12} maxLength={128}/></label>}
      {(mode === 'signup' || mode === 'reset') && <label>Confirm Password<input type="password" name="confirm" placeholder="Confirm your password" autoComplete="new-password" required minLength={12} maxLength={128}/></label>}
      <button className="button" type="submit">{busy ? 'Please wait…' : mode === 'signup' ? 'Create Account' : mode === 'forgot' ? 'Send reset link' : mode === 'reset' ? 'Update password' : mode === 'verify' ? 'Resend confirmation' : 'Sign In Securely'}</button>
      </fieldset></form>}
    {message && <p className="form-success" role="status">{message}</p>}
    {mode === 'reset' && complete && <Link className="button" to={"/login"}>{"Sign in"}</Link>}
    <div className="auth-links">{mode === 'login' && <><p>Don’t have an account? <Link to="/signup">Sign up</Link></p><Link className="verification-link" to="/verify-email">Resend verification email</Link></>}{mode !== 'login' && <p>{mode === 'signup' ? 'Already have an account? ' : ''}<Link to="/login">Sign in</Link></p>}</div>
  </div></div></section>;
}
export function AuthCallback() {
    const { session, loading, error } = useAuth();
    if (loading)
        return <p className="container section" role="status">Verifying your email link…</p>;
    return <section className="container section info-page"><span className="eyebrow">EMAIL VERIFICATION</span><h1>{!error && session ? 'You’re signed in.' : 'Check your confirmation link.'}</h1><p role={error ? 'alert' : 'status'}>{error || (session ? 'Your email link has been processed successfully.' : 'This link may have expired or been opened in another browser. Please sign in or request another confirmation email.')}</p><Link className="button" to={!error && session ? '/dashboard' : '/verify-email'}>{!error && session ? 'Open dashboard' : 'Resend confirmation'}</Link><div className="auth-links"><Link to="/login">Sign in</Link></div></section>;
}
export function RecoveryRedirect() {
    const { recovery } = useAuth();
    const { pathname } = useLocation();
    return recovery && pathname !== '/reset-password' ? <Navigate to="/reset-password" replace/> : null;
}
