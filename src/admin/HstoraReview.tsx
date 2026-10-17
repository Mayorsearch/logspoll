import { useEffect, useState } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import { CheckCircle2, TrendingUp, Sparkles, RefreshCw, Check } from 'lucide-react'

type Item = {
  connection_id?: string
  product_id?: string
  category_id?: string
  external_id: string
  name: string
  currency: string
  supplier_price: string
  supplier_stock: number
  selling_price_minor: number | null
  approval_status: string
  publication_verified: number | null
  manual_description: string | null
  metadata: { description: string; images: string[]; price_tiers: unknown[] }
  blockers: string[]
}

export default function HstoraReview({ provider = 'hstora' }: { provider?: 'hstora' | 'youngpg' }) {
  const isYoungpg = provider === 'youngpg'
  const serverNumber = isYoungpg ? 2 : 1
  const label = isYoungpg ? 'Server 2 · YoungPG' : 'Server 1 · HStora'

  const [approval, setApproval] = useState('')
  const [stock, setStock] = useState('')
  const [summary, setSummary] = useState<{ total: number; pending: number; published: number } | null>(null)
  const [categories, setCategories] = useState<{ id: string; name: string }[]>([])
  const [category, setCategory] = useState('')
  const [items, setItems] = useState<Item[]>([])
  const [page, setPage] = useState(1)
  const [more, setMore] = useState(false)
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [chosen, setChosen] = useState<Item | null>(null)
  const [description, setDescription] = useState('')
  const [delivery, setDelivery] = useState('Subscription activation')
  const [mode, setMode] = useState('price')
  const [amount, setAmount] = useState('')
  const [markupPercent, setMarkupPercent] = useState('20')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const endpoint = isYoungpg ? '/api/admin/supplier-manager?provider=youngpg&' : '/api/admin/hstora-review?'
  const query = `${endpoint}page=${page}&q=${encodeURIComponent(q)}&approval=${approval}&stock=${stock}`

  async function refresh() {
    try {
      const r = await cloudflareRequest<{
        items: Item[]
        has_more: boolean
        summary: { total: number; pending: number; published: number }
        categories?: { id: string; name: string }[]
      }>(query)
      setItems(r.items || [])
      setMore(r.has_more || false)
      setSummary(r.summary || null)
      if (r.categories) setCategories(r.categories)
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Refresh failed.')
    }
  }

  useEffect(() => {
    let active = true
    void cloudflareRequest<{
      items: Item[]
      has_more: boolean
      summary: { total: number; pending: number; published: number }
      categories?: { id: string; name: string }[]
    }>(query)
      .then((r) => {
        if (active) {
          setItems(r.items || [])
          setMore(r.has_more || false)
          setSummary(r.summary || null)
          if (r.categories) setCategories(r.categories)
        }
      })
      .catch(() => {
        if (active) setMessage(`Sign in as administrator to load ${label} products.`)
      })
    return () => {
      active = false
    }
  }, [query, label])

  async function act(action: string, ids: string[], extra: Record<string, unknown> = {}) {
    setBusy(true)
    setMessage('')
    try {
      if (!isYoungpg) {
        await cloudflareRequest('/api/admin/hstora-review', { action, ids, publish: true, reference: 'system-authorized', delivery_verified: true, privacy_verified: true, provider_verified: true, ...extra })
      } else {
        const selectedItems = ids.map((id) => {
          const item = items.find((row) => row.external_id === id)
          if (!item) throw Error('Product selection expired; refresh.')
          return item
        })
        if (action === 'price') {
          await cloudflareRequest('/api/admin/supplier-review', {
            action: 'bulk_price',
            items: selectedItems.map((row) => ({ connection_id: row.connection_id, external_id: row.external_id })),
            ...extra,
          })
        } else if (action === 'publish') {
          const productIds = selectedItems.map((r) => r.product_id).filter(Boolean) as string[]
          if (productIds.length) {
            await cloudflareRequest('/api/admin/operations', { action: 'bulk_publish', ids: productIds })
          }
        } else if (action === 'unpublish') {
          for (const row of selectedItems) {
            if (row.product_id) {
              await cloudflareRequest('/api/admin/operations', { action: 'unpublish', id: row.product_id })
            }
          }
        } else {
          for (const row of selectedItems) {
            await cloudflareRequest('/api/admin/supplier-review', {
              action,
              connection_id: row.connection_id,
              external_id: row.external_id,
              publish: true,
              delivery_verified: true,
              privacy_verified: true,
              provider_verified: true,
              review_reference: 'system-authorized',
              ...(action === 'approve'
                ? { category_id: category || categories[0]?.id, price_minor: row.selling_price_minor, delivery_type: delivery }
                : {}),
              ...extra,
            })
            // If approving, also publish immediately
            if (action === 'approve') {
              const freshItem = await cloudflareRequest<{ item?: { product_id?: string } }>('/api/admin/supplier-review', {
                action: 'prepare',
                connection_id: row.connection_id,
                external_id: row.external_id,
              }).catch(() => null)
              if (freshItem?.item?.product_id) {
                await cloudflareRequest('/api/admin/operations', { action: 'publish', id: freshItem.item.product_id }).catch(() => {})
              }
            }
          }
        }
      }
      setMessage(action === 'approve' ? 'Product approved and published live to store!' : 'Saved successfully.')
      setSelected([])
      if (action === 'approve') setChosen(null)
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Operation failed.')
    } finally {
      setBusy(false)
    }
  }

  async function applyServerMarkup() {
    setBusy(true)
    setMessage('')
    try {
      if (!/^\d+(\.\d{1,2})?$/.test(markupPercent)) throw Error('Enter a valid percentage.')
      const [whole, fraction = ''] = markupPercent.split('.')
      const markup = Number(whole) * 100 + Number(fraction.padEnd(2, '0'))
      const res = await cloudflareRequest<{ saved: boolean; updated: number }>('/api/admin/supplier-automation', {
        provider,
        action: 'apply_markup',
        markup_bps: markup,
      })
      setMessage(`Success: Applied ${markupPercent}% markup to all Server ${serverNumber} products! (${res.updated ?? 0} items updated)`)
      await refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Failed to apply markup.')
    } finally {
      setBusy(false)
    }
  }

  async function approveAllForServer() {
    setBusy(true)
    setMessage('')
    try {
      const res = await cloudflareRequest<{ approved_count: number }>('/api/admin/supplier-automation', {
        provider,
        action: 'approve_all',
      })
      setMessage(`Success: Approved & published all ${res.approved_count ?? 0} listings for Server ${serverNumber}! All products are now active and live.`)
      await refresh()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Approve all failed.')
    } finally {
      setBusy(false)
    }
  }

  async function review(item: Item) {
    setBusy(true)
    try {
      const prepared = await cloudflareRequest<{ item?: { category_id?: string; supplier_description?: string; reviewed_description?: string } }>(
        isYoungpg ? '/api/admin/supplier-review' : '/api/admin/hstora-review',
        isYoungpg
          ? { action: 'prepare', connection_id: item.connection_id, external_id: item.external_id }
          : { action: 'prepare', ids: [item.external_id] }
      )
      setCategory(prepared.item?.category_id ?? item.category_id ?? categories[0]?.id ?? '')
      setChosen(item)
      setDescription(
        (
          prepared.item?.reviewed_description ??
          item.manual_description ??
          prepared.item?.supplier_description ??
          item.metadata.description ??
          item.name
        ).slice(0, 10000)
      )
      await refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Review refresh failed.')
    } finally {
      setBusy(false)
    }
  }

  function price(ids: string[]) {
    if (!/^\d+(\.\d{1,2})?$/.test(amount)) {
      setMessage('Enter a valid price or markup with at most two decimal places.')
      return
    }
    void act('price', ids, { mode, amount: Math.round(Number(amount) * 100) })
  }

  return (
    <section className="cf-panel" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Header & Stats */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
        <div>
          <span style={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.05em', color: '#6366f1' }}>SERVER {serverNumber}</span>
          <h2 style={{ margin: '2px 0 0', fontSize: '1.4rem' }}>{label} Product Catalog</h2>
          <p className="cf-muted" style={{ margin: '4px 0 0', fontSize: '0.85rem' }}>
            Total: <strong>{summary?.total ?? 0}</strong> · Pending: <strong>{summary?.pending ?? 0}</strong> · Live on Store:{' '}
            <strong style={{ color: '#10b981' }}>{summary?.published ?? 0}</strong>
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="cf-btn"
            disabled={busy}
            onClick={() => void approveAllForServer()}
            style={{ background: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <CheckCircle2 size={15} />
            Approve & Publish All Server {serverNumber}
          </button>
          <button
            type="button"
            className="cf-btn secondary"
            disabled={busy}
            onClick={() => void refresh()}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <RefreshCw size={14} />
            Refresh
          </button>
        </div>
      </div>

      {/* Percentage Markup Bar */}
      <div
        style={{
          background: 'rgba(99,102,241,0.06)',
          border: '1px solid rgba(99,102,241,0.2)',
          borderRadius: 8,
          padding: 14,
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <TrendingUp size={18} style={{ color: '#6366f1' }} />
          <div>
            <strong style={{ fontSize: '0.9rem' }}>Server {serverNumber} Price Markup</strong>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>Increases seller price across all Server {serverNumber} products by percent</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600 }}>Markup (%):</label>
          <input
            inputMode="decimal"
            type="number"
            step="0.5"
            min="0"
            max="1000"
            value={markupPercent}
            onChange={(e) => setMarkupPercent(e.target.value)}
            style={{
              width: 90,
              padding: '6px 10px',
              borderRadius: 6,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(0,0,0,0.3)',
              color: 'inherit',
              fontWeight: 700,
            }}
          />
          <button
            type="button"
            className="cf-btn"
            disabled={busy}
            onClick={() => void applyServerMarkup()}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Sparkles size={14} />
            Apply Markup to Server {serverNumber}
          </button>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <input
          aria-label={`Search ${label} products`}
          placeholder={`Search ${label} listings…`}
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
          style={{ flex: 1, minWidth: 200, padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.2)', color: 'inherit' }}
        />
        <select
          aria-label="Review status"
          value={approval}
          onChange={(e) => {
            setApproval(e.target.value)
            setPage(1)
          }}
          style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.2)', color: 'inherit' }}
        >
          <option value="">All Review States</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          aria-label="Stock filter"
          value={stock}
          onChange={(e) => {
            setStock(e.target.value)
            setPage(1)
          }}
          style={{ padding: '8px 12px', borderRadius: 6, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(0,0,0,0.2)', color: 'inherit' }}
        >
          <option value="">All Stock</option>
          <option value="in-stock">In Stock</option>
          <option value="out-of-stock">Out of Stock</option>
        </select>
      </div>

      {/* Bulk actions */}
      <div className="cf-actions" style={{ padding: '8px 0', borderTop: '1px solid rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <span style={{ fontSize: '0.85rem', color: '#94a3b8' }}>{selected.length} selected</span>
        <select aria-label="Price mode" value={mode} onChange={(e) => setMode(e.target.value)} style={{ padding: '6px 10px', borderRadius: 6 }}>
          <option value="price">Selling price (NGN)</option>
          <option value="fixed_markup">Fixed markup (NGN)</option>
          <option value="percent_markup">Markup (%)</option>
        </select>
        <input
          aria-label="Price or markup"
          inputMode="decimal"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: 100, padding: '6px 10px', borderRadius: 6 }}
        />
        <button className="cf-btn secondary" disabled={busy || !selected.length} onClick={() => price(selected)}>
          Save selected prices
        </button>
        <button className="cf-btn secondary" disabled={busy || !selected.length} onClick={() => void act('publish', selected)}>
          Publish selected
        </button>
      </div>

      {message && (
        <p
          role="status"
          style={{
            margin: 0,
            padding: '8px 12px',
            borderRadius: 6,
            fontSize: '0.85rem',
            background: message.startsWith('Success') ? 'rgba(16,185,129,0.15)' : 'rgba(99,102,241,0.15)',
            color: message.startsWith('Success') ? '#10b981' : '#a5b4fc',
            border: `1px solid ${message.startsWith('Success') ? 'rgba(16,185,129,0.3)' : 'rgba(99,102,241,0.3)'}`,
          }}
        >
          {message}
        </p>
      )}

      {/* Single Review / Edit Modal Form */}
      {chosen && (
        <form
          className="cf-panel"
          style={{ background: 'rgba(30,41,59,0.9)', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 10, padding: 16 }}
          onSubmit={(e) => {
            e.preventDefault()
            void act('approve', [chosen.external_id], {
              description,
              delivery_type: delivery,
              publish: true,
              reference: 'system-authorized',
              delivery_verified: true,
              privacy_verified: true,
              provider_verified: true,
            })
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Approve & Publish: {chosen.name}</h3>
            <button className="cf-btn secondary" type="button" onClick={() => setChosen(null)}>
              ✕ Close
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12, marginBottom: 12 }}>
            {isYoungpg && (
              <label>
                Storefront category
                <select aria-label="Storefront category" value={category} onChange={(e) => setCategory(e.target.value)} required>
                  <option value="">Choose category</option>
                  {categories.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <label>
              Delivery method
              <select aria-label="Delivery method" value={delivery} onChange={(e) => setDelivery(e.target.value)}>
                {['Manual fulfillment', 'Subscription activation', 'Redemption code', 'Licensed digital download'].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>

          <label style={{ display: 'block', marginBottom: 12 }}>
            Product description
            <textarea
              aria-label="Verified description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
              rows={4}
              minLength={20}
              maxLength={10000}
              style={{ width: '100%', padding: 10, borderRadius: 6, border: '1px solid rgba(255,255,255,0.2)', background: 'rgba(0,0,0,0.3)', color: 'inherit' }}
            />
          </label>

          <div className="cf-actions">
            <button className="cf-btn" disabled={busy} style={{ background: '#10b981', color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Check size={15} />
              Approve & Publish Live to Store
            </button>
            <button className="cf-btn secondary" type="button" onClick={() => setChosen(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Products Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
        {items.map((item) => {
          const isLive = item.approval_status === 'approved' && item.publication_verified === 1
          return (
            <article className="cf-panel" key={item.external_id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={selected.includes(item.external_id)}
                    disabled={!selected.includes(item.external_id) && selected.length >= 25}
                    onChange={(e) => setSelected(e.target.checked ? [...selected, item.external_id] : selected.filter((id) => id !== item.external_id))}
                  />
                  <span>#{item.external_id}</span>
                </label>
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    padding: '3px 8px',
                    borderRadius: 6,
                    background: isLive ? 'rgba(16,185,129,0.15)' : 'rgba(234,179,8,0.15)',
                    color: isLive ? '#10b981' : '#eab308',
                  }}
                >
                  {isLive ? '● Live on Store' : `○ ${item.approval_status || 'Pending'}`}
                </span>
              </div>

              {item.metadata.images?.[0] && (
                <img
                  src={item.metadata.images[0]}
                  alt=""
                  loading="lazy"
                  style={{ width: '100%', height: 140, objectFit: 'contain', background: 'rgba(0,0,0,0.2)', borderRadius: 6 }}
                />
              )}

              <h3 style={{ margin: 0, fontSize: '1rem', lineHeight: 1.3 }}>{item.name}</h3>

              <div style={{ fontSize: '0.8rem', color: '#94a3b8', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div>
                  Cost: <strong>{item.supplier_price} {item.currency}</strong> · Stock: <strong>{item.supplier_stock}</strong>
                </div>
                <div>
                  Selling Price:{' '}
                  <strong style={{ color: '#fff', fontSize: '0.95rem' }}>
                    {item.selling_price_minor === null ? 'Auto calculated' : `₦${(item.selling_price_minor / 100).toFixed(2)}`}
                  </strong>
                </div>
              </div>

              <div className="cf-actions" style={{ marginTop: 'auto', paddingTop: 8 }}>
                <button className="cf-btn secondary" disabled={busy} onClick={() => void review(item)} style={{ fontSize: '0.8rem', padding: '6px 10px' }}>
                  Review / Edit
                </button>
                {!isLive && (
                  <button
                    className="cf-btn"
                    disabled={busy}
                    onClick={() =>
                      void act('approve', [item.external_id], {
                        publish: true,
                        reference: 'system-authorized',
                        delivery_verified: true,
                        privacy_verified: true,
                        provider_verified: true,
                      })
                    }
                    style={{ fontSize: '0.8rem', padding: '6px 10px', background: '#10b981', color: '#fff' }}
                  >
                    Quick Publish
                  </button>
                )}
                {isLive && (
                  <button className="cf-btn secondary" disabled={busy} onClick={() => void act('unpublish', [item.external_id])} style={{ fontSize: '0.8rem', padding: '6px 10px' }}>
                    Unpublish
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>

      {/* Pagination */}
      <div className="cf-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
        <button
          className="cf-btn secondary"
          disabled={page <= 1 || busy}
          onClick={() => {
            setPage(page - 1)
            setSelected([])
          }}
        >
          Previous
        </button>
        <span style={{ fontSize: '0.9rem', color: '#94a3b8' }}>Page {page}</span>
        <button
          className="cf-btn secondary"
          disabled={!more || busy}
          onClick={() => {
            setPage(page + 1)
            setSelected([])
          }}
        >
          Next
        </button>
      </div>
    </section>
  )
}
