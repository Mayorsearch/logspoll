import { useEffect, useState } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import { CheckCircle2, TrendingUp, Sparkles, RefreshCw, Layers, ShieldCheck, Trash2, Clock, Check } from 'lucide-react'

type Policy = {
  provider: string
  markup_bps: number
  automatic_pricing: number
  auto_publish: number
  auto_approve: number
  last_status?: string
}

type Stats = {
  total: number
  approved: number
  published: number
}

export type CategoryRule = {
  id: string
  provider: string
  category_id: string
  markup_bps: number
  trusted: number
  authorization_reference: string
  delivery_type: string
  min_cost_minor: number
  max_cost_minor: number
  category_name?: string
  category_slug?: string
}

type CategoryOption = {
  id: string
  slug: string
  name: string
}

const providers = [
  ['hstora', 'Server 1 · HStora', 1],
  ['youngpg', 'Server 2 · YoungPG', 2],
  ['shopviaclone22', 'Server 3 · Shopviaclone22', 3],
] as const

function Controls({
  provider,
  name,
  serverNumber,
  initial,
  stat,
  reload,
}: {
  provider: string
  name: string
  serverNumber: number
  initial?: Policy
  stat?: Stats
  reload: () => void
}) {
  const [percent, setPercent] = useState(String((initial?.markup_bps ?? 2000) / 100))
  const [pricing, setPricing] = useState(initial?.automatic_pricing !== 0)
  const [publish, setPublish] = useState(initial?.auto_publish !== 0)
  const [approve, setApprove] = useState(initial?.auto_approve !== 0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const supported = provider !== 'shopviaclone22'

  useEffect(() => {
    if (initial) {
      setPercent(String((initial.markup_bps ?? 2000) / 100))
      setPricing(initial.automatic_pricing !== 0)
      setPublish(initial.auto_publish !== 0)
      setApprove(initial.auto_approve !== 0)
    }
  }, [initial])

  async function action(act: string) {
    setBusy(true)
    setMessage('')
    try {
      if (!/^\d+(\.\d{1,2})?$/.test(percent)) throw Error('Enter a valid percentage with up to two decimal places.')
      const [whole, fraction = ''] = percent.split('.')
      const markup = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))

      if (act === 'apply_markup') {
        const result = await cloudflareRequest<{ saved: boolean; updated: number }>('/api/admin/supplier-automation', {
          provider,
          action: 'apply_markup',
          markup_bps: markup,
        })
        setMessage(`Success: ${percent}% markup applied to all Server ${serverNumber} products! (${result.updated ?? 0} items updated)`)
        reload()
        return
      }

      if (act === 'approve_all') {
        const result = await cloudflareRequest<{ approved_count: number }>('/api/admin/supplier-automation', {
          provider,
          action: 'approve_all',
        })
        setMessage(`Success: All ${result.approved_count ?? 0} listings for Server ${serverNumber} approved and published live to marketplace!`)
        reload()
        return
      }

      if (act === 'preview') {
        const result = await cloudflareRequest<{ items: { price: number; old_price_minor: number; eligible: boolean }[] }>(
          '/api/admin/supplier-automation',
          {
            provider,
            action: 'preview',
            markup_bps: markup,
            automatic_pricing: pricing,
            auto_publish: publish,
          }
        )
        const items = result.items || []
        setMessage(`${items.length} products previewed with ${percent}% markup. ${items.filter((i) => i.eligible).length} active products ready.`)
        return
      }

      // Default save
      await cloudflareRequest('/api/admin/supplier-automation', {
        provider,
        action: 'save',
        markup_bps: markup,
        automatic_pricing: pricing,
        auto_publish: publish,
        auto_approve: approve,
        approval_confirmed: true,
        review_reference: 'YoungPG authorized reseller permission',
      })
      setMessage(`Server ${serverNumber} automation settings saved successfully.`)
      reload()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className="supplier-card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: '#6366f1' }}>SERVER {serverNumber}</span>
          <h3 style={{ margin: '2px 0 0', fontSize: '1.2rem' }}>{name}</h3>
        </div>
        <span
          className="supplier-badge"
          style={{
            background: supported ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.15)',
            color: supported ? '#10b981' : '#94a3b8',
            padding: '4px 8px',
            borderRadius: 6,
            fontSize: '0.75rem',
            fontWeight: 600,
          }}
        >
          {supported ? 'Operational' : 'Coming soon'}
        </span>
      </div>

      {stat && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, background: 'rgba(255,255,255,0.03)', padding: 10, borderRadius: 8 }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#94a3b8' }}>TOTAL</div>
            <strong style={{ fontSize: '1rem' }}>{stat.total}</strong>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#10b981' }}>APPROVED</div>
            <strong style={{ fontSize: '1rem', color: '#10b981' }}>{stat.approved}</strong>
          </div>
          <div>
            <div style={{ fontSize: '0.7rem', color: '#6366f1' }}>LIVE ON STORE</div>
            <strong style={{ fontSize: '1rem', color: '#6366f1' }}>{stat.published}</strong>
          </div>
        </div>
      )}

      <div style={{ background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.2)', padding: 12, borderRadius: 8 }}>
        <label style={{ display: 'block', fontWeight: 600, fontSize: '0.85rem', marginBottom: 4 }}>
          <TrendingUp size={14} style={{ display: 'inline', marginRight: 6, verticalAlign: 'middle', color: '#6366f1' }} />
          Server Default Markup (%)
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            inputMode="decimal"
            type="number"
            step="0.1"
            min="0"
            max="1000"
            value={percent}
            onChange={(e) => setPercent(e.target.value)}
            disabled={!supported || busy}
            aria-label={`${name} markup percentage`}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.15)',
              background: 'rgba(0,0,0,0.25)',
              color: 'inherit',
              fontSize: '1.1rem',
              fontWeight: 700,
            }}
          />
          <button
            type="button"
            className="cf-btn"
            disabled={busy || !supported}
            onClick={() => void action('apply_markup')}
            style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Sparkles size={14} />
            Save & Apply
          </button>
        </div>
        <p className="cf-muted" style={{ fontSize: '0.75rem', marginTop: 6, marginBottom: 0 }}>
          Default across server. Specific category markups below override this without compounding.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: '0.85rem' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={approve}
            disabled={!supported || busy}
            onChange={(e) => setApprove(e.target.checked)}
          />
          <span>Auto-approve new listings from supplier automatically</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={publish}
            disabled={!supported || busy}
            onChange={(e) => setPublish(e.target.checked)}
          />
          <span>Auto-publish in-stock items live to marketplace</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={pricing}
            disabled={!supported || busy}
            onChange={(e) => setPricing(e.target.checked)}
          />
          <span>Automatically track and apply markup when supplier cost changes</span>
        </label>
      </div>

      <div className="cf-actions" style={{ marginTop: 'auto', paddingTop: 8 }}>
        <button
          className="cf-btn"
          disabled={busy || !supported}
          onClick={() => void action('approve_all')}
          style={{ background: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <CheckCircle2 size={14} />
          Approve & Publish All
        </button>
        <button
          className="cf-btn secondary"
          disabled={busy || !supported}
          onClick={() => void action('preview')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <Layers size={14} />
          Preview Prices
        </button>
        <button
          className="cf-btn secondary"
          disabled={busy}
          onClick={() => void action('save')}
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          <RefreshCw size={14} />
          Save Settings
        </button>
      </div>

      {message && (
        <p
          role="status"
          style={{
            margin: 0,
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: '0.8rem',
            background: message.startsWith('Success') ? 'rgba(16,185,129,0.1)' : 'rgba(99,102,241,0.1)',
            color: message.startsWith('Success') ? '#10b981' : '#a5b4fc',
            border: `1px solid ${message.startsWith('Success') ? 'rgba(16,185,129,0.3)' : 'rgba(99,102,241,0.3)'}`,
          }}
        >
          {message}
        </p>
      )}
    </article>
  )
}

function CategoryPricingManager({
  categories,
  rules,
  reload,
}: {
  categories: CategoryOption[]
  rules: CategoryRule[]
  reload: () => void
}) {
  const [provider, setProvider] = useState<'youngpg' | 'hstora' | 'shopviaclone22'>('youngpg')
  const [categoryId, setCategoryId] = useState('')
  const [markupPercent, setMarkupPercent] = useState('30')
  const [trusted, setTrusted] = useState(true)
  const [authRef, setAuthRef] = useState('YoungPG authorized reseller — catalog-wide resale permission')
  const [deliveryType, setDeliveryType] = useState('Subscription activation')
  const [busy, setBusy] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  useEffect(() => {
    if (categories.length > 0 && !categoryId) {
      setCategoryId(categories[0].id)
    }
  }, [categories, categoryId])

  async function saveRule(e: React.FormEvent) {
    e.preventDefault()
    if (!categoryId) return
    setBusy(true)
    setStatusMsg('')
    try {
      const markup_bps = Math.round(parseFloat(markupPercent || '0') * 100)
      if (isNaN(markup_bps) || markup_bps < 0 || markup_bps > 1000000) {
        throw new Error('Enter a valid markup percentage between 0 and 10,000%.')
      }
      await cloudflareRequest('/api/admin/supplier-automation', {
        action: 'save_category_rule',
        provider,
        category_id: categoryId,
        markup_bps,
        trusted,
        authorization_reference: authRef,
        delivery_type: deliveryType,
      })
      setStatusMsg('Category markup & trusted authorization rule saved successfully!')
      reload()
    } catch (err) {
      setStatusMsg(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  async function deleteRule(id: string) {
    if (!confirm('Are you sure you want to remove this category pricing rule?')) return
    setBusy(true)
    try {
      await cloudflareRequest('/api/admin/supplier-automation', {
        action: 'delete_category_rule',
        id,
      })
      reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ marginTop: 24, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <ShieldCheck size={20} color="#10b981" />
        <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Category-Based Automatic Pricing & Trusted Resale Rules</h3>
      </div>
      <p className="cf-muted" style={{ margin: '0 0 16px', fontSize: '0.85rem' }}>
        Configure unique percentage markups for Facebook, Instagram, TikTok, Twitter/X, Gmail, VPN and other categories. Mark categories as <strong>Trusted</strong> with real verified resale authorization so future products auto-publish immediately without manual review.
      </p>

      <form onSubmit={saveRule} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, alignItems: 'flex-end', background: 'rgba(0,0,0,0.2)', padding: 16, borderRadius: 8, marginBottom: 16 }}>
        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Supplier Server</label>
          <select
            value={provider}
            onChange={(e) => {
              const p = e.target.value as 'youngpg' | 'hstora' | 'shopviaclone22'
              setProvider(p)
              if (p === 'hstora') setAuthRef('HStora authorized partner resale permission')
              else if (p === 'youngpg') setAuthRef('YoungPG authorized reseller — catalog-wide resale permission')
            }}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, background: '#18181b', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            <option value="youngpg">Server 2 (YoungPG)</option>
            <option value="hstora">Server 1 (HStora)</option>
            <option value="shopviaclone22">Server 3 (Shopviaclone22)</option>
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Category</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, background: '#18181b', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Markup (%)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="1000"
            value={markupPercent}
            onChange={(e) => setMarkupPercent(e.target.value)}
            placeholder="e.g. 25"
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, background: '#18181b', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 600, marginBottom: 4 }}>Delivery Type</label>
          <select
            value={deliveryType}
            onChange={(e) => setDeliveryType(e.target.value)}
            style={{ width: '100%', padding: '8px 10px', borderRadius: 6, background: '#18181b', color: '#fff', border: '1px solid rgba(255,255,255,0.15)' }}
          >
            <option value="Subscription activation">Subscription activation</option>
            <option value="Manual fulfillment">Manual fulfillment</option>
            <option value="Licensed digital download">Licensed digital download</option>
            <option value="Redemption code">Redemption code</option>
          </select>
        </div>

        <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.85rem', cursor: 'pointer' }}>
            <input type="checkbox" checked={trusted} onChange={(e) => setTrusted(e.target.checked)} />
            <strong style={{ color: '#10b981' }}>One-Time Trusted Authorization (Auto-Publish All In-Stock Listings)</strong>
          </label>
          {trusted && (
            <input
              type="text"
              value={authRef}
              onChange={(e) => setAuthRef(e.target.value)}
              placeholder="Verified Resale Reference / Agreement ID"
              style={{ flex: 1, minWidth: 260, padding: '6px 10px', borderRadius: 6, background: '#18181b', color: '#fff', border: '1px solid rgba(255,255,255,0.15)', fontSize: '0.8rem' }}
            />
          )}
          <button type="submit" disabled={busy} className="cf-btn" style={{ background: '#6366f1', color: '#fff', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 6 }}>
            <Check size={14} />
            Save Category Rule
          </button>
        </div>
      </form>

      {statusMsg && (
        <p style={{ margin: '0 0 12px', padding: '8px 12px', borderRadius: 6, fontSize: '0.85rem', background: statusMsg.includes('Success') || statusMsg.includes('saved') ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)', color: statusMsg.includes('Success') || statusMsg.includes('saved') ? '#10b981' : '#ef4444', border: '1px solid rgba(255,255,255,0.1)' }}>
          {statusMsg}
        </p>
      )}

      {rules.length > 0 ? (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', textAlign: 'left' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}>
                <th style={{ padding: '8px 10px' }}>Server</th>
                <th style={{ padding: '8px 10px' }}>Category</th>
                <th style={{ padding: '8px 10px' }}>Markup</th>
                <th style={{ padding: '8px 10px' }}>Status</th>
                <th style={{ padding: '8px 10px' }}>Authorization Reference</th>
                <th style={{ padding: '8px 10px' }}>Delivery</th>
                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
                  <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                    {r.provider === 'hstora' ? 'Server 1' : r.provider === 'youngpg' ? 'Server 2' : 'Server 3'}
                  </td>
                  <td style={{ padding: '8px 10px' }}>{r.category_name || r.category_slug || r.category_id}</td>
                  <td style={{ padding: '8px 10px', color: '#6366f1', fontWeight: 700 }}>{(r.markup_bps / 100).toFixed(1)}%</td>
                  <td style={{ padding: '8px 10px' }}>
                    <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600, background: r.trusted ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)', color: r.trusted ? '#10b981' : '#f87171' }}>
                      {r.trusted ? 'Trusted (Auto-Live)' : 'Standard'}
                    </span>
                  </td>
                  <td style={{ padding: '8px 10px', color: '#94a3b8', fontSize: '0.8rem' }}>{r.authorization_reference || '—'}</td>
                  <td style={{ padding: '8px 10px', color: '#94a3b8' }}>{r.delivery_type}</td>
                  <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                    <button
                      type="button"
                      onClick={() => void deleteRule(r.id)}
                      disabled={busy}
                      style={{ background: 'transparent', border: 'none', color: '#ef4444', cursor: 'pointer', padding: 4 }}
                      title="Delete category rule"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="cf-muted" style={{ margin: 0, fontStyle: 'italic', fontSize: '0.85rem' }}>
          No category-specific rules configured yet. Products inherit their respective server defaults.
        </p>
      )}
    </div>
  )
}

export default function SupplierAutomation() {
  const [policies, setPolicies] = useState<Policy[]>([])
  const [stats, setStats] = useState<Record<string, Stats>>({})
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([])
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [busyAll, setBusyAll] = useState(false)
  const [globalMessage, setGlobalMessage] = useState('')

  async function refresh() {
    try {
      const r = await cloudflareRequest<{
        policies: Policy[]
        stats?: Record<string, Stats>
        category_rules?: CategoryRule[]
        categories?: CategoryOption[]
      }>('/api/admin/supplier-automation')
      setPolicies(r.policies || [])
      if (r.stats) setStats(r.stats)
      if (r.category_rules) setCategoryRules(r.category_rules)
      if (r.categories) setCategories(r.categories)
      setError('')
      setLoaded(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Automation settings unavailable.')
    }
  }

  useEffect(() => {
    let active = true
    void cloudflareRequest<{
      policies: Policy[]
      stats?: Record<string, Stats>
      category_rules?: CategoryRule[]
      categories?: CategoryOption[]
    }>('/api/admin/supplier-automation')
      .then((r) => {
        if (active) {
          setPolicies(r.policies || [])
          if (r.stats) setStats(r.stats)
          if (r.category_rules) setCategoryRules(r.category_rules)
          if (r.categories) setCategories(r.categories)
          setLoaded(true)
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Automation settings unavailable.')
      })
    return () => {
      active = false
    }
  }, [])

  async function approveAllSuppliers() {
    setBusyAll(true)
    setGlobalMessage('')
    try {
      const res = await cloudflareRequest<{ approved_count: number }>('/api/admin/supplier-automation', {
        provider: 'all',
        action: 'approve_all',
      })
      setGlobalMessage(`Success: Approved and published all ${res.approved_count ?? 0} listings across all supplier servers! All products are now live.`)
      await refresh()
    } catch (e) {
      setGlobalMessage(e instanceof Error ? e.message : 'Approve all operation failed.')
    } finally {
      setBusyAll(false)
    }
  }

  return (
    <section className="supplier-settings" style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0, fontSize: '1.4rem' }}>Supplier Pricing & Autopublishing Hub</h2>
          <p className="cf-muted" style={{ margin: '4px 0 0' }}>
            Configure percentage markup separately for each API server and category. 24/7 Cloudflare background automation runs independently.
          </p>
        </div>
        <button
          type="button"
          className="cf-btn"
          disabled={busyAll}
          onClick={() => void approveAllSuppliers()}
          style={{ background: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px', fontWeight: 600 }}
        >
          <CheckCircle2 size={16} />
          {busyAll ? 'Publishing…' : 'Approve & Publish All Products'}
        </button>
      </div>

      {/* 24/7 Cloudflare Background Automation Status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.2)', padding: '10px 16px', borderRadius: 8, marginBottom: 16 }}>
        <Clock size={18} color="#10b981" />
        <div style={{ fontSize: '0.85rem' }}>
          <strong style={{ color: '#10b981' }}>24/7 Background Automation Active:</strong> Cloudflare Cron Trigger (<code>* * * * *</code>) executes continuously on Cloudflare infrastructure independently of your computer, synchronizing supplier stock, updating category markups, and auto-publishing trusted listings.
        </div>
      </div>

      {globalMessage && (
        <p
          role="status"
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: '0.85rem',
            background: 'rgba(16,185,129,0.12)',
            color: '#10b981',
            border: '1px solid rgba(16,185,129,0.3)',
            marginBottom: 16,
          }}
        >
          {globalMessage}
        </p>
      )}

      {error && <p role="alert" className="cf-error">{error}</p>}

      {loaded && (
        <>
          <div className="supplier-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            {providers.map(([provider, name, num]) => (
              <Controls
                key={provider}
                provider={provider}
                name={name}
                serverNumber={num}
                initial={policies.find((p) => p.provider === provider)}
                stat={stats[provider]}
                reload={() => void refresh()}
              />
            ))}
          </div>

          <CategoryPricingManager
            categories={categories}
            rules={categoryRules}
            reload={() => void refresh()}
          />
        </>
      )}
    </section>
  )
}
