import { useState, useEffect } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import {
  Sparkles,
  Shuffle,
  Save,
  CheckCircle2,
  AlertCircle,
  Eye,
  RefreshCw,
} from 'lucide-react'

type DiscoveryConfig = {
  rotation_enabled: boolean
  affordable_priority_enabled: boolean
  affordable_max_minor: number
  affordable_weight: number
  featured_weight: number
  new_weight: number
  products_per_page: number
  updated_at: number
}

type CatalogStats = {
  total_products: number
  affordable_count: number
  featured_count: number
  server1_count: number
  server2_count: number
  server3_count: number
  server4_count: number
  min_price_minor: number
  max_price_minor: number
}

type PreviewProduct = {
  id: string
  name: string
  price_minor: number
  currency: string
  featured: number
  server_number?: number | null
  category_name?: string | null
}

export default function StorefrontDiscoveryManager() {
  const [stats, setStats] = useState<CatalogStats | null>(null)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')

  // Form states
  const [rotationEnabled, setRotationEnabled] = useState(true)
  const [affordablePriority, setAffordablePriority] = useState(true)
  const [maxPriceNaira, setMaxPriceNaira] = useState(15000)
  const [affordableWeight, setAffordableWeight] = useState(65)
  const [featuredWeight, setFeaturedWeight] = useState(20)
  const [newWeight, setNewWeight] = useState(15)
  const [pageSize, setPageSize] = useState(20)

  // Preview state
  const [previewProducts, setPreviewProducts] = useState<PreviewProduct[]>([])
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewSeed, setPreviewSeed] = useState('')

  async function loadData() {
    try {
      const res = await cloudflareRequest<{
        config: DiscoveryConfig
        catalog_stats: CatalogStats
      }>('/api/admin/storefront-discovery')

      setStats(res.catalog_stats)

      setRotationEnabled(res.config.rotation_enabled)
      setAffordablePriority(res.config.affordable_priority_enabled)
      setMaxPriceNaira(Math.round(res.config.affordable_max_minor / 100))
      setAffordableWeight(res.config.affordable_weight)
      setFeaturedWeight(res.config.featured_weight)
      setNewWeight(res.config.new_weight)
      setPageSize(res.config.products_per_page)
    } catch (err) {
      setMessageType('error')
      setMessage(err instanceof Error ? err.message : 'Failed to load discovery configuration.')
    }
  }

  useEffect(() => {
    void loadData()
    void loadPreview()
  }, [])

  async function loadPreview(customSeed?: string) {
    setPreviewLoading(true)
    const seed = customSeed || Date.now().toString(36)
    setPreviewSeed(seed)
    try {
      const res = await cloudflareRequest<{
        discover: PreviewProduct[]
      }>(`/api/storefront/discovery?seed=${seed}&limit=12`)
      setPreviewProducts(res.discover || [])
    } catch {
      setPreviewProducts([])
    } finally {
      setPreviewLoading(false)
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage(null)
    try {
      const res = await cloudflareRequest<{
        saved: boolean
        message: string
        config: DiscoveryConfig
      }>('/api/admin/storefront-discovery', {
        rotation_enabled: rotationEnabled,
        affordable_priority_enabled: affordablePriority,
        affordable_max_minor: maxPriceNaira * 100,
        affordable_weight: affordableWeight,
        featured_weight: featuredWeight,
        new_weight: newWeight,
        products_per_page: pageSize,
      })

      if (res.saved) {
        setMessageType('success')
        setMessage(res.message || 'Storefront discovery configuration saved.')
        void loadPreview()
      }
    } catch (err) {
      setMessageType('error')
      setMessage(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Banner */}
      <div
        className="cf-panel"
        style={{
          padding: 24,
          borderRadius: 12,
          background: 'var(--admin-card-bg, #ffffff)',
          border: '1px solid var(--admin-border, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                background: 'linear-gradient(135deg, rgba(249,115,22,0.15) 0%, rgba(234,88,12,0.25) 100%)',
                color: '#f97316',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Sparkles size={28} />
            </div>
            <div>
              <div style={{ fontSize: '0.8rem', color: 'var(--admin-muted, #64748b)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Storefront Redesign Controls
              </div>
              <h2 style={{ margin: '2px 0 0', fontSize: '1.5rem', fontWeight: 800, color: 'var(--admin-text, #0f172a)' }}>
                Dynamic Discovery &amp; Product Rotation
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: 'var(--admin-muted, #64748b)' }}>
                Prevent static repetition and high-priced monopolies by rotating items dynamically and prioritizing affordable daily essentials.
              </p>
            </div>
          </div>

          {/* Quick Metrics */}
          {stats && (
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <div style={{ padding: '8px 14px', borderRadius: 8, background: 'var(--admin-subtle, #f8fafc)', border: '1px solid var(--admin-border, #e2e8f0)' }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)' }}>Active Catalog</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>{stats.total_products} Items</div>
              </div>
              <div style={{ padding: '8px 14px', borderRadius: 8, background: '#10b98110', border: '1px solid #10b98130' }}>
                <div style={{ fontSize: '0.75rem', color: '#059669' }}>Budget-Friendly (&le; ₦{maxPriceNaira.toLocaleString()})</div>
                <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#059669' }}>{stats.affordable_count} Items</div>
              </div>
            </div>
          )}
        </div>

        {/* Status Message */}
        {message && (
          <div
            style={{
              marginTop: 16,
              padding: '12px 16px',
              borderRadius: 8,
              fontSize: '0.875rem',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              background: messageType === 'success' ? '#10b98115' : '#ef444415',
              border: `1px solid ${messageType === 'success' ? '#10b98140' : '#ef444440'}`,
              color: messageType === 'success' ? '#059669' : '#dc2626',
            }}
          >
            {messageType === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
            <span>{message}</span>
          </div>
        )}
      </div>

      {/* Main Settings & Preview Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 20 }}>
        {/* Settings Form */}
        <div
          className="cf-panel"
          style={{
            padding: 24,
            borderRadius: 12,
            background: 'var(--admin-card-bg, #ffffff)',
            border: '1px solid var(--admin-border, #e2e8f0)',
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Shuffle size={18} color="#f97316" />
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
              Discovery &amp; Rotation Parameters
            </h3>
          </div>

          <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Toggle 1: Dynamic Rotation */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderRadius: 8,
                background: 'var(--admin-subtle, #f8fafc)',
                border: '1px solid var(--admin-border, #e2e8f0)',
              }}
            >
              <div>
                <strong style={{ fontSize: '0.9rem', color: 'var(--admin-text, #0f172a)' }}>Dynamic Rotation on Refresh</strong>
                <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--admin-muted, #64748b)' }}>
                  Shuffles product order dynamically on page load and when users click "Refresh Products".
                </p>
              </div>
              <input
                type="checkbox"
                checked={rotationEnabled}
                onChange={(e) => setRotationEnabled(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
            </div>

            {/* Toggle 2: Affordable Priority */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 16px',
                borderRadius: 8,
                background: 'var(--admin-subtle, #f8fafc)',
                border: '1px solid var(--admin-border, #e2e8f0)',
              }}
            >
              <div>
                <strong style={{ fontSize: '0.9rem', color: 'var(--admin-text, #0f172a)' }}>Affordable-First Priority</strong>
                <p style={{ margin: '2px 0 0', fontSize: '0.78rem', color: 'var(--admin-muted, #64748b)' }}>
                  Prioritizes budget-friendly items in top slots without reducing the global 50% markup.
                </p>
              </div>
              <input
                type="checkbox"
                checked={affordablePriority}
                onChange={(e) => setAffordablePriority(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
            </div>

            {/* Budget Threshold */}
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--admin-text, #334155)' }}>
              Budget-Friendly Price Ceiling (₦ NGN)
              <input
                type="number"
                min="1000"
                max="100000"
                step="500"
                value={maxPriceNaira}
                onChange={(e) => setMaxPriceNaira(Number(e.target.value))}
                style={{
                  width: '100%',
                  marginTop: 6,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--admin-border, #cbd5e1)',
                  background: 'var(--admin-input-bg, #ffffff)',
                  color: 'var(--admin-text, #0f172a)',
                  fontSize: '0.9rem',
                }}
              />
              <span style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)', fontWeight: 400 }}>
                Products with selling price &le; ₦{maxPriceNaira.toLocaleString()} are classified as Budget-Friendly.
              </span>
            </label>

            {/* Weighted Mix Sliders */}
            <div style={{ padding: '14px 16px', borderRadius: 8, background: 'var(--admin-subtle, #f8fafc)', border: '1px solid var(--admin-border, #e2e8f0)', display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
                Storefront Weight Distribution (Recommended: 65% / 20% / 15%)
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                  <span>Affordable Essentials Weight:</span>
                  <strong>{affordableWeight}%</strong>
                </div>
                <input
                  type="range"
                  min="20"
                  max="90"
                  value={affordableWeight}
                  onChange={(e) => setAffordableWeight(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                  <span>Featured / Popular Weight:</span>
                  <strong>{featuredWeight}%</strong>
                </div>
                <input
                  type="range"
                  min="5"
                  max="50"
                  value={featuredWeight}
                  onChange={(e) => setFeaturedWeight(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', marginBottom: 4 }}>
                  <span>Newly Added / Other Weight:</span>
                  <strong>{newWeight}%</strong>
                </div>
                <input
                  type="range"
                  min="5"
                  max="40"
                  value={newWeight}
                  onChange={(e) => setNewWeight(Number(e.target.value))}
                  style={{ width: '100%' }}
                />
              </div>
            </div>

            {/* Page Size */}
            <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--admin-text, #334155)' }}>
              Products Per Page
              <select
                value={pageSize}
                onChange={(e) => setPageSize(Number(e.target.value))}
                style={{
                  width: '100%',
                  marginTop: 6,
                  padding: '10px 12px',
                  borderRadius: 8,
                  border: '1px solid var(--admin-border, #cbd5e1)',
                  background: 'var(--admin-input-bg, #ffffff)',
                  color: 'var(--admin-text, #0f172a)',
                  fontSize: '0.85rem',
                }}
              >
                <option value={12}>12 products</option>
                <option value={20}>20 products (default)</option>
                <option value={24}>24 products</option>
                <option value={40}>40 products</option>
              </select>
            </label>

            <button
              type="submit"
              disabled={saving}
              className="cf-btn"
              style={{
                marginTop: 8,
                padding: '12px 20px',
                borderRadius: 8,
                background: '#f97316',
                color: '#fff',
                border: 'none',
                fontWeight: 700,
                fontSize: '0.9rem',
                cursor: saving ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
              }}
            >
              <Save size={16} />
              <span>{saving ? 'Saving Changes...' : 'Save Discovery Settings'}</span>
            </button>
          </form>
        </div>

        {/* Live Preview Panel */}
        <div
          className="cf-panel"
          style={{
            padding: 24,
            borderRadius: 12,
            background: 'var(--admin-card-bg, #ffffff)',
            border: '1px solid var(--admin-border, #e2e8f0)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Eye size={18} color="#059669" />
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
                Live Randomized Layout Preview
              </h3>
            </div>
            <button
              type="button"
              onClick={() => void loadPreview()}
              disabled={previewLoading}
              className="cf-btn"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 6,
                background: 'var(--admin-subtle, #f1f5f9)',
                color: 'var(--admin-text, #334155)',
                border: '1px solid var(--admin-border, #cbd5e1)',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: previewLoading ? 'not-allowed' : 'pointer',
              }}
            >
              <RefreshCw size={12} className={previewLoading ? 'spin' : ''} />
              <span>Simulate Refresh</span>
            </button>
          </div>

          <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--admin-muted, #64748b)' }}>
            Seed: <code style={{ fontSize: '0.75rem' }}>{previewSeed}</code>. Demonstrates the dynamic weighted multi-server mix users will experience.
          </p>

          {previewLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--admin-muted, #64748b)' }}>
              Generating simulated rotation...
            </div>
          ) : previewProducts.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--admin-muted, #64748b)' }}>
              No products found in active catalog.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, maxHeight: 480, overflowY: 'auto' }}>
              {previewProducts.map((p, idx) => {
                const isAffordable = p.price_minor <= maxPriceNaira * 100
                return (
                  <div
                    key={p.id}
                    style={{
                      padding: 12,
                      borderRadius: 8,
                      background: 'var(--admin-subtle, #f8fafc)',
                      border: '1px solid var(--admin-border, #e2e8f0)',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      gap: 8,
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                        <span
                          style={{
                            fontSize: '0.65rem',
                            padding: '1px 6px',
                            borderRadius: 6,
                            fontWeight: 700,
                            background:
                              p.server_number === 1
                                ? '#3b82f620'
                                : p.server_number === 2
                                  ? '#10b98120'
                                  : p.server_number === 3
                                    ? '#8b5cf620'
                                    : '#f59e0b20',
                            color:
                              p.server_number === 1
                                ? '#2563eb'
                                : p.server_number === 2
                                  ? '#059669'
                                  : p.server_number === 3
                                    ? '#7c3aed'
                                    : '#d97706',
                          }}
                        >
                          Server {p.server_number || '?'}
                        </span>

                        {isAffordable && (
                          <span
                            style={{
                              fontSize: '0.65rem',
                              padding: '1px 6px',
                              borderRadius: 6,
                              fontWeight: 700,
                              background: '#10b98120',
                              color: '#059669',
                            }}
                          >
                            BUDGET
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--admin-text, #0f172a)', lineHeight: 1.25 }}>
                        {p.name}
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 6, borderTop: '1px solid var(--admin-border, #f1f5f9)' }}>
                      <span style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #64748b)' }}>Slot #{idx + 1}</span>
                      <strong style={{ fontSize: '0.9rem', color: '#0f172a' }}>
                        ₦{(p.price_minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                      </strong>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

