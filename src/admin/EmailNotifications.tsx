import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { emailTemplates, sampleEmail } from '../lib/email-templates'
import type { EmailKind } from '../lib/email-templates'
import './email-notifications.css'
interface Attempt { template: EmailKind; requestId: string; startedAt: number; status: string; error?: string }
async function api(body?: Attempt) {
  const session = await supabase?.auth.getSession()
  if (!session?.data.session) throw new Error('Verified administrator sign-in required.')
  const response = await fetch('/api/admin/email', { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session.data.session.access_token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify({ template: body.template, requestId: body.requestId, startedAt: body.startedAt }) } : {}) })
  if (!response.headers.get('Content-Type')?.includes('application/json')) throw new Error('Use the Cloudflare Pages runtime; Vite alone cannot run email Functions.')
  const result = await response.json() as { error?: string; testReady?: boolean; id?: string }
  if (!response.ok) throw new Error(result.error ?? 'Email test unavailable.')
  return result
}
export default function EmailNotifications() {
  const [kind, setKind] = useState<EmailKind>('verification')
  const [mobile, setMobile] = useState(false)
  const [plain, setPlain] = useState(false)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState<Attempt | null>(null)
  const [retryExpired, setRetryExpired] = useState(false)
  useEffect(() => { let active = true; void api().then(result => { if (active) setReady(Boolean(result.testReady)) }).catch(problem => { if (active) setError(problem.message) }); return () => { active = false } }, [])
  useEffect(() => {
    if (!attempt) return
    const timer = setTimeout(() => setRetryExpired(true), Math.max(0, attempt.startedAt + 23 * 60 * 60 * 1000 - Date.now()))
    return () => clearTimeout(timer)
  }, [attempt])
  const email = sampleEmail(kind)
  async function send(retry = false) {
    const next = retry && attempt ? attempt : { template: kind, requestId: crypto.randomUUID(), startedAt: Date.now(), status: 'Sending…' }
    setAttempt({ ...next, status: 'Sending…', error: undefined }); setBusy(true); setError(''); setRetryExpired(false)
    try { const result = await api(next); setAttempt({ ...next, status: `Provider accepted test: ${result.id}. Inbox delivery is unconfirmed.` }) }
    catch (problem) { const message = problem instanceof Error ? problem.message : 'Email test failed.'; setAttempt({ ...next, status: 'Test failed or acceptance unknown', error: message }); setError(message) }
    finally { setBusy(false) }
  }
  return <section className="demo-panel email-settings"><h2>Email Notifications</h2><p>Preview synthetic emails. Automatic customer notifications are not enabled.</p><p>Supabase continues to handle signup, resend and password-reset requests. Install the prepared templates and verified SMTP settings in Supabase.</p><div className="email-controls"><label>Template<select value={kind} onChange={event => setKind(event.target.value as EmailKind)}>{Object.entries(emailTemplates).map(([id, template]) => <option key={id} value={id}>{template[0]}</option>)}</select></label><label>Viewport<select value={mobile ? 'mobile' : 'desktop'} onChange={event => setMobile(event.target.value === 'mobile')}><option value="desktop">Desktop email</option><option value="mobile">Mobile email (375 px)</option></select></label><label>Format<select value={plain ? 'text' : 'html'} onChange={event => setPlain(event.target.value === 'text')}><option value="html">HTML preview</option><option value="text">Plain text</option></select></label></div><p><strong>{emailTemplates[kind][6] ? 'Mandatory notification — no disabling control.' : 'Optional notification — not automated.'}</strong><br />Required event: {emailTemplates[kind][5]}</p><div className={`email-preview ${mobile ? 'email-mobile' : ''}`}>{plain ? <pre>{email.text}</pre> : <iframe title={`${email.subject} — sample email`} sandbox="" srcDoc={email.html.replace('<head>', '<head><meta http-equiv="Content-Security-Policy" content="default-src &apos;none&apos;; style-src &apos;unsafe-inline&apos;; base-uri &apos;none&apos;; form-action &apos;none&apos;">')} />}</div><div className="email-controls"><button className="button" disabled={!ready || busy || Boolean(attempt?.error)} onClick={() => void send()}>{busy ? 'Sending…' : 'Send synthetic test to approved address'}</button>{attempt?.error && <button className="button" disabled={busy || !ready || retryExpired} onClick={() => void send(true)}>Retry same test safely</button>}</div><p>{ready ? 'Test settings are configured server-side. Sending requires a provider-verified domain; tests never target customer records.' : 'Test sending is disabled until the provider, verified sender and approved recipient are configured.'}</p>{error && <p className="form-error" role="alert">{error}</p>}{attempt && <p role="status">{attempt.status}{retryExpired && ' Retry window expired; review provider logs before starting another test.'}</p>}<p>Test status is kept for this visit only. Durable event logs, delivery webhooks, optional preferences and automatic transactional retries remain to be connected.</p></section>
}
