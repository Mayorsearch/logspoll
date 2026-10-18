import { useEffect, useRef, useState } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'

type Status = {
  enabled: number
  phase: string
  scanned: number
  total: number | null
  imported: number
  in_stock: number
  approved: number
  last_status: string
  last_success: number | null
  base_url: string
}

export default function Shopviaclone22Manager({ onComplete }: { onComplete?: () => void }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [baseUrl, setBaseUrl] = useState('https://shopviaclone22.com/api')
  const keyRef = useRef<HTMLInputElement>(null)

  async function refresh() {
    try {
      const result = await cloudflareRequest<{ connection: Status | null }>('/api/admin/shopviaclone22')
      setStatus(result.connection)
      if (result.connection?.base_url) setBaseUrl(result.connection.base_url)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Status unavailable.')
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function action(act: string) {
    if (act === 'toggle' && status?.enabled && !confirm('Disable ShopViaClone22? Purchases and new syncs will stop. Existing products remain.')) {
      return
    }
    setBusy(true)
    setMessage('')
    try {
      const body: Record<string, unknown> = { action: act }
      if (act === 'save') {
        const apiKey = keyRef.current?.value?.trim()
        if (apiKey) body.api_key = apiKey
        body.base_url = baseUrl
        body.enabled = Boolean(status?.enabled)
      } else if (act === 'toggle') {
        body.action = 'toggle'
      } else if (act === 'test') {
        body.action = 'test'
      } else if (act === 'sync') {
        body.action = 'sync'
      }

      const result = await cloudflareRequest<{
        connected?: boolean
        total?: number
        categories?: number
        message?: string
        error?: string
      }>('/api/admin/shopviaclone22', body)

      if (keyRef.current && act === 'save') keyRef.current.value = ''

      if (result.error) {
        setMessage(`Error: ${result.error}`)
      } else {
        setMessage(
          result.message ??
            (result.connected
              ? `Connection verified: ${result.total ?? 0} products found in ${result.categories ?? 0} categories.`
              : act === 'sync'
                ? 'Background catalog sync queued successfully.'
                : 'Settings saved successfully.')
        )
      }
      await refresh()
      if (onComplete) onComplete()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operation failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="cf-panel" style={{ marginTop: 16 }}>
      <h2>API Manager · ShopViaClone22 (Server 3)</h2>
      <p>
        Official ShopViaClone22 adapter. Products are mapped exclusively to Server 3 on the customer storefront.
        Supplier credentials and endpoints are securely encrypted on Cloudflare and never exposed to customers.
      </p>

      <label>
        API Base URL
        <input
          type="url"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="https://shopviaclone22.com/api"
        />
      </label>

      <label>
        API Key
        <input
          ref={keyRef}
          type="password"
          autoComplete="new-password"
          placeholder={status ? '•••••••••••••••• (Leave blank to keep existing key)' : 'Enter ShopViaClone22 API key'}
        />
      </label>

      <div className="cf-actions" style={{ marginTop: 12 }}>
        <button className="cf-btn" disabled={busy} onClick={() => void action('save')}>
          {status ? 'Save / Replace Key' : 'Save Credentials'}
        </button>
        <button className="cf-btn secondary" disabled={busy || !status} onClick={() => void action('toggle')}>
          {status?.enabled ? 'Disable' : 'Enable'} Supplier
        </button>
        <button className="cf-btn secondary" disabled={busy || !status} onClick={() => void action('test')}>
          Test Connection
        </button>
        <button className="cf-btn secondary" disabled={busy || !status?.enabled} onClick={() => void action('sync')}>
          Sync Products Now
        </button>
        <button className="cf-btn secondary" disabled={busy} onClick={() => void refresh()}>
          Refresh Status
        </button>
      </div>

      {message && (
        <p
          role="status"
          style={{
            marginTop: 12,
            padding: '8px 12px',
            borderRadius: 6,
            background: message.startsWith('Error') ? 'rgba(239,68,68,0.1)' : 'rgba(16,185,129,0.1)',
            color: message.startsWith('Error') ? '#ef4444' : '#10b981',
          }}
        >
          {message}
        </p>
      )}

      {status && (
        <dl style={{ marginTop: 16 }}>
          <dt>Status</dt>
          <dd>{status.enabled ? 'Enabled' : 'Disabled'}</dd>
          <dt>Imported Products</dt>
          <dd>
            {status.imported} total ({status.in_stock} in stock, {status.approved} approved)
          </dd>
          <dt>Last Successful Sync</dt>
          <dd>{status.last_success ? new Date(status.last_success).toLocaleString() : 'Never'}</dd>
          <dt>Last Sync Status / Message</dt>
          <dd>{status.last_status}</dd>
        </dl>
      )}
    </section>
  )
}

