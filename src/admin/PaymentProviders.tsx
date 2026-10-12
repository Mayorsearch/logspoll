import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
interface Readiness {
  payments: { provider: string; mode: string; keyConfigured: boolean; webhookConfigured: boolean; ledgerReady: boolean; enabled: boolean; liveEnabled: boolean; automaticFulfillment: boolean }
  email: { testReady: boolean; automaticDelivery: boolean }
  supplier: { blockers: string[] }
}
export default function PaymentProviders() {
  const [data, setData] = useState<Readiness | null>(null)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const session = await supabase?.auth.getSession()
        if (!session?.data.session) throw new Error('Administrator sign-in required.')
        const response = await fetch('/api/admin/readiness', { headers: { Authorization: `Bearer ${session.data.session.access_token}` } })
        if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Use the Cloudflare Pages runtime to verify backend configuration.')
        const value = await response.json()
        if (!response.ok) throw new Error(value.error ?? 'Readiness could not be verified.')
        if (active) { setData(value); setError('') }
      } catch (problem) { if (active) { setData(null); setError(problem instanceof Error ? problem.message : 'Verification failed.') } }
    }
    void load()
    return () => { active = false }
  }, [attempt])
  return <section className="demo-panel"><div className="demo-panel-heading"><h2>Payment Providers</h2><button className="demo-mini-button" onClick={() => setAttempt(value => value + 1)}>Refresh configuration status</button></div>
    {error && <p className="form-error" role="alert">{error}</p>}
    {!data && !error && <p role="status">Verifying server configuration…</p>}
    {data && <><dl className="demo-detail-list">{Object.entries({ Provider: data.payments.provider, Mode: data.payments.mode, 'Sandbox API credential': data.payments.keyConfigured ? 'Configured · value hidden' : 'Missing', 'Webhook verification secret': data.payments.webhookConfigured ? 'Configured · value hidden' : 'Missing', 'Sandbox ledger': data.payments.ledgerReady ? 'Available' : 'Unavailable', 'Sandbox checkout': data.payments.enabled ? 'Configured; end-to-end payment test still required' : 'Disabled / incomplete configuration', 'Live payments': 'Disabled', 'Automatic supplier fulfillment': 'Disabled' }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl><p>No payment was created or tested by this status check. Secure add/edit/rotation and additional provider adapters are not implemented. Credentials currently remain in Cloudflare Pages secrets; this page never accepts or displays them.</p><h3>Launch dependencies</h3>{data.supplier.blockers.map(blocker => <p className="form-error" key={blocker}>{blocker}</p>)}<p>Resend test sender: {data.email.testReady ? 'Configured; delivery still requires a test' : 'Configuration could not be validated'}. Automatic event delivery: {data.email.automaticDelivery ? 'Enabled' : 'Not implemented'}.</p><Link className="text-link" to="/admin/settings/email-notifications">Open email previews and approved-recipient test →</Link></>}
  </section>
}
