import { useEffect, useState } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import {
  CheckCircle2,
  TrendingUp,
  Sparkles,
  RefreshCw,
  Layers,
  ShieldCheck,
  Trash2,
  Clock,
  Check,
  AlertCircle,
  History,
  X
} from 'lucide-react'

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

export type GlobalPricingConfig = {
  id: string
  markup_bps: number
  auto_publish: number
  automatic_pricing: number
  auto_approve: number
  usd_to_ngn_rate: number
  delivery_type: string
  updated_by?: string | null
  updated_at: number
}

type PublishingEvent = {
  id: string
  event_type: string
  markup_bps: number
  items_count: number
  status: string
  details?: string
  created_at: number
}

type PreviewItem = {
  id: string
  name?: string
  server_number?: number
  server_name?: string
  category_name?: string
  cost_minor: number
  price: number
  old_price_minor?: number
  profit_minor: number
  markup_bps: number
  eligible: boolean
  is_override?: boolean
  reasons?: string[]
}

const providers = [
  ['hstora', 'Server 1 · HStora', 1],
  ['youngpg', 'Server 2 · YoungPG', 2],
  ['shopviaclone22', 'Server 3 · Shopviaclone22', 3],
] as const

function formatCurrency(kobo: number) {
  return `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

export default function SupplierAutomation() {
  const [globalConfig, setGlobalConfig] = useState<GlobalPricingConfig>({
    id: 'global',
    markup_bps: 5000,
    auto_publish: 1,
    automatic_pricing: 1,
    auto_approve: 1,
    usd_to_ngn_rate: 1500.0,
    delivery_type: 'Subscription activation',
    updated_at: Date.now()
  })
  const [globalPercent, setGlobalPercent] = useState('50')
  const [usdRate, setUsdRate] = useState('1500')
  const [autoPublish, setAutoPublish] = useState(true)
  const [autoPricing, setAutoPricing] = useState(true)
  const [autoApprove, setAutoApprove] = useState(true)

  const [policies, setPolicies] = useState<Policy[]>([])
  const [stats, setStats] = useState<Record<string, Stats>>({})
  const [categoryRules, setCategoryRules] = useState<CategoryRule[]>([])
  const [categories, setCategories] = useState<CategoryOption[]>([])
  const [events, setEvents] = useState<PublishingEvent[]>([])
  const [overridesCount, setOverridesCount] = useState(0)
  const [outOfStockCount, setOutOfStockCount] = useState(0)

  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [statusMessage, setStatusMessage] = useState('')

  // Confirmation Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false)
  const [replaceOverrides, setReplaceOverrides] = useState(false)

  // Preview Drawer State
  const [showPreviewDrawer, setShowPreviewDrawer] = useState(false)
  const [previewItems, setPreviewItems] = useState<PreviewItem[]>([])
  const [previewTotal, setPreviewTotal] = useState(0)
  const [previewFilter, setPreviewFilter] = useState<'all' | '1' | '2' | '3'>('all')
  const [previewSearch, setPreviewSearch] = useState('')

  async function loadData() {
    try {
      const res = await cloudflareRequest<{
        policies: Policy[]
        stats?: Record<string, Stats>
        category_rules?: CategoryRule[]
        categories?: CategoryOption[]
        global_pricing?: GlobalPricingConfig
        global_events?: PublishingEvent[]
        overrides_count?: number
        out_of_stock_count?: number
      }>('/api/admin/supplier-automation')

      setPolicies(res.policies || [])
      if (res.stats) setStats(res.stats)
      if (res.category_rules) setCategoryRules(res.category_rules)
      if (res.categories) setCategories(res.categories)
      if (res.global_events) setEvents(res.global_events)
      if (typeof res.overrides_count === 'number') setOverridesCount(res.overrides_count)
      if (typeof res.out_of_stock_count === 'number') setOutOfStockCount(res.out_of_stock_count)

      if (res.global_pricing) {
        setGlobalConfig(res.global_pricing)
        setGlobalPercent(String((res.global_pricing.markup_bps ?? 5000) / 100))
        setUsdRate(String(res.global_pricing.usd_to_ngn_rate ?? 1500))
        setAutoPublish(res.global_pricing.auto_publish !== 0)
        setAutoPricing(res.global_pricing.automatic_pricing !== 0)
        setAutoApprove(res.global_pricing.auto_approve !== 0)
      }
      setError('')
      setLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Automation settings unavailable.')
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  const totalSupplierProducts = Object.values(stats).reduce((acc, s) => acc + (s.total || 0), 0)
  const totalApprovedProducts = Object.values(stats).reduce((acc, s) => acc + (s.approved || 0), 0)
  const totalPublishedProducts = Object.values(stats).reduce((acc, s) => acc + (s.published || 0), 0)

  async function handleSaveGlobalConfig() {
    setBusy(true)
    setStatusMessage('')
    try {
      const pct = parseFloat(globalPercent)
      if (isNaN(pct) || pct < 0 || pct > 10000) throw new Error('Enter a valid markup percentage (e.g. 50).')
      const markup_bps = Math.round(pct * 100)
      const rate = parseFloat(usdRate)
      if (isNaN(rate) || rate <= 0) throw new Error('Enter a valid USD to NGN exchange rate (e.g. 1500).')

      await cloudflareRequest('/api/admin/supplier-automation', {
        action: 'save_global_pricing',
        markup_bps,
        auto_publish: autoPublish,
        automatic_pricing: autoPricing,
        auto_approve: autoApprove,
        usd_to_ngn_rate: rate,
      })

      setStatusMessage(`Success: Global ${pct}% markup and automated settings saved persistently in Cloudflare D1.`)
      await loadData()
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Save failed.')
    } finally {
      setBusy(false)
    }
  }

  async function handlePreview() {
    setBusy(true)
    setStatusMessage('')
    try {
      const pct = parseFloat(globalPercent) || 50
      const markup_bps = Math.round(pct * 100)
      const rate = parseFloat(usdRate) || 1500

      const res = await cloudflareRequest<{
        items: PreviewItem[]
        total: number
        eligible_count: number
        overrides_count: number
      }>('/api/admin/supplier-automation', {
        action: 'global_preview',
        markup_bps,
        usd_to_ngn_rate: rate,
        restore_overrides: replaceOverrides,
      })

      setPreviewItems(res.items || [])
      setPreviewTotal(res.total ?? (res.items?.length || 0))
      if (typeof res.overrides_count === 'number') setOverridesCount(res.overrides_count)
      setShowPreviewDrawer(true)
      setStatusMessage(`Preview: Calculated prices for ${res.total} products with ${pct}% markup.`)
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Preview failed.')
    } finally {
      setBusy(false)
    }
  }

  async function executeApplyAndPublish() {
    setBusy(true)
    setStatusMessage('')
    try {
      const pct = parseFloat(globalPercent) || 50
      const markup_bps = Math.round(pct * 100)
      const rate = parseFloat(usdRate) || 1500

      const res = await cloudflareRequest<{
        success: boolean
        approved_count: number
        published_count: number
        overrides_count: number
        overrides_replaced: boolean
        message: string
      }>('/api/admin/supplier-automation', {
        action: 'global_apply_and_publish',
        markup_bps,
        usd_to_ngn_rate: rate,
        restore_overrides: replaceOverrides,
      })

      setShowConfirmModal(false)
      setStatusMessage(`Success: ${res.message} (${res.published_count} live products, ${res.overrides_count} overrides active)`)
      await loadData()
    } catch (err) {
      setStatusMessage(err instanceof Error ? err.message : 'Publication failed.')
    } finally {
      setBusy(false)
    }
  }

  const filteredPreview = previewItems.filter((item) => {
    if (previewFilter !== 'all' && String(item.server_number) !== previewFilter) return false
    if (previewSearch.trim()) {
      const q = previewSearch.toLowerCase()
      return (item.name?.toLowerCase().includes(q) || item.id.toLowerCase().includes(q) || item.category_name?.toLowerCase().includes(q))
    }
    return true
  })

  return (
    <section className="supplier-settings" style={{ marginBottom: 32 }}>
      {/* Page Title & Status */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16, marginBottom: 20 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.08em', color: '#10b981', textTransform: 'uppercase' }}>
              Automated Operations
            </span>
            <span style={{ background: 'rgba(16,185,129,0.15)', color: '#10b981', fontSize: '0.7rem', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
              Live System
            </span>
          </div>
          <h2 style={{ margin: 0, fontSize: '1.6rem', fontWeight: 700 }}>Supplier Pricing & Product Publishing Hub</h2>
          <p className="cf-muted" style={{ margin: '6px 0 0', maxWidth: 720, fontSize: '0.9rem' }}>
            Permanent, fully automated pricing and publishing system for LogsPoll. All suppliers inherit the global 50% markup with automatic price updates on cost changes and continuous 24/7 background sync.
          </p>
        </div>

        <button
          type="button"
          className="cf-btn"
          disabled={busy}
          onClick={() => setShowConfirmModal(true)}
          style={{
            background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '12px 22px',
            fontSize: '0.95rem',
            fontWeight: 700,
            boxShadow: '0 4px 14px rgba(16,185,129,0.35)',
            border: 'none',
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          <Sparkles size={18} />
          {busy ? 'Processing…' : `Apply ${globalPercent}% Markup & Publish All Products`}
        </button>
      </div>

      {/* 24/7 Background Automation Indicator */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.25)', padding: '12px 18px', borderRadius: 10, marginBottom: 20 }}>
        <Clock size={20} color="#10b981" style={{ flexShrink: 0 }} />
        <div style={{ fontSize: '0.85rem', lineHeight: 1.5 }}>
          <strong style={{ color: '#10b981' }}>24/7 Cloudflare Background Automation Active:</strong> Cloudflare Cron Trigger (<code>* * * * *</code>) executes continuously in the background, automatically importing new supplier listings, applying the 50% markup rule, and publishing in-stock products live to marketplace without requiring manual clicks.
        </div>
      </div>

      {statusMessage && (
        <div
          role="status"
          style={{
            padding: '12px 16px',
            borderRadius: 8,
            fontSize: '0.9rem',
            background: statusMessage.startsWith('Success') ? 'rgba(16,185,129,0.12)' : 'rgba(99,102,241,0.12)',
            color: statusMessage.startsWith('Success') ? '#10b981' : '#a5b4fc',
            border: `1px solid ${statusMessage.startsWith('Success') ? 'rgba(16,185,129,0.3)' : 'rgba(99,102,241,0.3)'}`,
            marginBottom: 20,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          {statusMessage.startsWith('Success') ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{statusMessage}</span>
        </div>
      )}

      {error && <p role="alert" className="cf-error" style={{ marginBottom: 20 }}>{error}</p>}

      {/* Main Global Pricing Section */}
      <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 24, marginBottom: 24 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <TrendingUp size={22} color="#6366f1" />
            <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Global Pricing Configuration (Default: 50% Markup)</h3>
          </div>
          <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
            Persistent in Cloudflare D1 · All 3 supplier APIs inherit this rule · Last updated: {new Date(globalConfig.updated_at).toLocaleDateString()}
          </span>
        </div>

        {/* Pricing Formula Callout */}
        <div style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 8, padding: 16, marginBottom: 20 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#a5b4fc', marginBottom: 6 }}>
            AUTOMATED PRICING FORMULA:
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, fontFamily: 'monospace', color: '#fff', marginBottom: 10 }}>
            Selling Price = Supplier Cost × {(1 + (parseFloat(globalPercent) || 50) / 100).toFixed(2)} ({globalPercent}% Markup)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, fontSize: '0.85rem', color: '#cbd5e1' }}>
            <div style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 12px', borderRadius: 6 }}>
              <span>Supplier Cost: <strong>₦1,000</strong></span>
              <span style={{ display: 'block', color: '#10b981' }}>Selling Price: <strong>{formatCurrency(Math.round(100000 * (1 + (parseFloat(globalPercent) || 50) / 100)))}</strong> (+{formatCurrency(Math.round(100000 * ((parseFloat(globalPercent) || 50) / 100)))} profit)</span>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 12px', borderRadius: 6 }}>
              <span>Supplier Cost: <strong>₦5,000</strong></span>
              <span style={{ display: 'block', color: '#10b981' }}>Selling Price: <strong>{formatCurrency(Math.round(500000 * (1 + (parseFloat(globalPercent) || 50) / 100)))}</strong> (+{formatCurrency(Math.round(500000 * ((parseFloat(globalPercent) || 50) / 100)))} profit)</span>
            </div>
            <div style={{ background: 'rgba(0,0,0,0.25)', padding: '8px 12px', borderRadius: 6 }}>
              <span>Supplier Cost: <strong>₦10,000</strong></span>
              <span style={{ display: 'block', color: '#10b981' }}>Selling Price: <strong>{formatCurrency(Math.round(1000000 * (1 + (parseFloat(globalPercent) || 50) / 100)))}</strong> (+{formatCurrency(Math.round(1000000 * ((parseFloat(globalPercent) || 50) / 100)))} profit)</span>
            </div>
          </div>
        </div>

        {/* Global Controls Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>
              Global Default Markup (%)
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="10000"
              value={globalPercent}
              onChange={(e) => setGlobalPercent(e.target.value)}
              disabled={busy}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                background: '#18181b',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.15)',
                fontSize: '1.1rem',
                fontWeight: 700,
              }}
            />
            <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4, display: 'block' }}>
              Default for all suppliers (Server 1, 2, 3)
            </span>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '0.85rem', fontWeight: 600, marginBottom: 6 }}>
              USD to NGN Exchange Rate
            </label>
            <input
              type="number"
              step="1"
              min="1"
              max="10000"
              value={usdRate}
              onChange={(e) => setUsdRate(e.target.value)}
              disabled={busy}
              style={{
                width: '100%',
                padding: '10px 14px',
                borderRadius: 8,
                background: '#18181b',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.15)',
                fontSize: '1.1rem',
                fontWeight: 700,
              }}
            />
            <span style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: 4, display: 'block' }}>
              Converts USD supplier feeds to NGN before markup
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoPublish}
                onChange={(e) => setAutoPublish(e.target.checked)}
                disabled={busy}
              />
              <span><strong>Auto-Publish:</strong> Publish eligible products live automatically</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoPricing}
                onChange={(e) => setAutoPricing(e.target.checked)}
                disabled={busy}
              />
              <span><strong>Auto-Recalculate:</strong> Update selling price when supplier cost changes</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.85rem', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(e) => setAutoApprove(e.target.checked)}
                disabled={busy}
              />
              <span><strong>Auto-Approve:</strong> Approve new candidate listings automatically</span>
            </label>
          </div>
        </div>

        {/* Global Summary Metrics */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 20 }}>
          <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: '0.75rem', color: '#94a3b8' }}>TOTAL SUPPLIER PRODUCTS</div>
            <strong style={{ fontSize: '1.4rem', color: '#fff' }}>{totalSupplierProducts}</strong>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Across Servers 1, 2, 3</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: '0.75rem', color: '#10b981' }}>APPROVED PRODUCTS</div>
            <strong style={{ fontSize: '1.4rem', color: '#10b981' }}>{totalApprovedProducts}</strong>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Ready for resale</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: '0.75rem', color: '#6366f1' }}>LIVE ON STOREFRONT</div>
            <strong style={{ fontSize: '1.4rem', color: '#6366f1' }}>{totalPublishedProducts}</strong>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Active customer listings</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: '0.75rem', color: '#eab308' }}>MANUAL PRICE OVERRIDES</div>
            <strong style={{ fontSize: '1.4rem', color: '#eab308' }}>{overridesCount}</strong>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Protected from auto-pricing</div>
          </div>
          <div style={{ background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 8, padding: 12 }}>
            <div style={{ fontSize: '0.75rem', color: '#ef4444' }}>OUT OF STOCK</div>
            <strong style={{ fontSize: '1.4rem', color: '#ef4444' }}>{outOfStockCount}</strong>
            <div style={{ fontSize: '0.7rem', color: '#64748b' }}>Supplier stock = 0</div>
          </div>
        </div>

        {/* Action Row */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="cf-btn"
            disabled={busy}
            onClick={() => setShowConfirmModal(true)}
            style={{
              background: '#10b981',
              color: '#fff',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              fontWeight: 700,
            }}
          >
            <Sparkles size={16} />
            Apply {globalPercent}% Markup & Publish All Products
          </button>

          <button
            type="button"
            className="cf-btn secondary"
            disabled={busy}
            onClick={() => void handlePreview()}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px' }}
          >
            <Layers size={16} />
            Preview Selling Prices & Profit
          </button>

          <button
            type="button"
            className="cf-btn secondary"
            disabled={busy}
            onClick={() => void handleSaveGlobalConfig()}
            style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 18px' }}
          >
            <RefreshCw size={16} />
            Save Global Settings
          </button>
        </div>
      </div>

      {/* Confirmation Modal for "Apply 50% Markup & Publish All" */}
      {showConfirmModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.75)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 16,
          }}
        >
          <div
            style={{
              background: '#18181b',
              border: '1px solid rgba(255,255,255,0.15)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 540,
              width: '100%',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <Sparkles size={20} color="#10b981" />
                <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Publish All Products Live</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowConfirmModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}
              >
                <X size={20} />
              </button>
            </div>

            <p style={{ margin: '0 0 16px', fontSize: '0.9rem', color: '#cbd5e1', lineHeight: 1.5 }}>
              You are about to apply the <strong>{globalPercent}% markup</strong> and publish all eligible existing products across Server 1 (HStora), Server 2 (YoungPG), and Server 3 (ShopViaClone22) live to the LogsPoll marketplace.
            </p>

            <div style={{ background: 'rgba(0,0,0,0.3)', padding: 12, borderRadius: 8, marginBottom: 16, fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#94a3b8' }}>Total Listings to Process:</span>
                <strong>{totalSupplierProducts} products</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ color: '#94a3b8' }}>Default Markup Formula:</span>
                <strong style={{ color: '#10b981' }}>Cost × {(1 + (parseFloat(globalPercent) || 50) / 100).toFixed(2)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8' }}>Future New Products:</span>
                <strong style={{ color: '#6366f1' }}>Auto-publish enabled (24/7 background)</strong>
              </div>
            </div>

            {/* Manual Price Overrides Decision */}
            <div style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.25)', borderRadius: 8, padding: 14, marginBottom: 20 }}>
              <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#fbbf24', marginBottom: 6 }}>
                Manual Price Overrides ({overridesCount} products found):
              </div>
              <p style={{ margin: '0 0 10px', fontSize: '0.8rem', color: '#fef3c7' }}>
                Choose how to handle products that already have a custom manual price configured:
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: '0.85rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="override_choice"
                    checked={!replaceOverrides}
                    onChange={() => setReplaceOverrides(false)}
                  />
                  <span><strong>(Recommended) Preserve manual price overrides:</strong> Keep custom prices intact; apply 50% only to automatic listings.</span>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
                  <input
                    type="radio"
                    name="override_choice"
                    checked={replaceOverrides}
                    onChange={() => setReplaceOverrides(true)}
                  />
                  <span><strong>Replace manual price overrides:</strong> Overwrite all manual prices with the global 50% automatic rule.</span>
                </label>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                className="cf-btn secondary"
                disabled={busy}
                onClick={() => setShowConfirmModal(false)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="cf-btn"
                disabled={busy}
                onClick={() => void executeApplyAndPublish()}
                style={{ background: '#10b981', color: '#fff', fontWeight: 700 }}
              >
                {busy ? 'Publishing All…' : `Confirm & Publish All Products`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price Preview Drawer / Modal */}
      {showPreviewDrawer && (
        <div style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20, marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Selling Price & Profit Preview ({previewTotal} Total Products)</h3>
              <p className="cf-muted" style={{ margin: '2px 0 0', fontSize: '0.8rem' }}>
                Preview of calculated prices with {globalPercent}% markup. Displays supplier cost, selling price, and gross profit.
              </p>
            </div>
            <button
              type="button"
              className="cf-btn secondary"
              onClick={() => setShowPreviewDrawer(false)}
              style={{ fontSize: '0.8rem', padding: '6px 12px' }}
            >
              Hide Preview
            </button>
          </div>

          {/* Filters */}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12, alignItems: 'center' }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['all', '1', '2', '3'] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setPreviewFilter(key)}
                  style={{
                    padding: '6px 12px',
                    borderRadius: 6,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    background: previewFilter === key ? '#6366f1' : 'rgba(255,255,255,0.05)',
                    color: previewFilter === key ? '#fff' : '#94a3b8',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {key === 'all' ? 'All Servers' : `Server ${key}`}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="Filter by product name or category…"
              value={previewSearch}
              onChange={(e) => setPreviewSearch(e.target.value)}
              style={{
                flex: 1,
                minWidth: 200,
                padding: '6px 10px',
                borderRadius: 6,
                background: '#18181b',
                color: '#fff',
                border: '1px solid rgba(255,255,255,0.15)',
                fontSize: '0.8rem',
              }}
            />
          </div>

          <div style={{ maxHeight: 380, overflowY: 'auto', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: '0.8rem' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: 'rgba(255,255,255,0.06)', borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}>
                  <th style={{ padding: '8px 10px' }}>Product</th>
                  <th style={{ padding: '8px 10px' }}>Server</th>
                  <th style={{ padding: '8px 10px' }}>Supplier Cost</th>
                  <th style={{ padding: '8px 10px' }}>Selling Price</th>
                  <th style={{ padding: '8px 10px' }}>Markup</th>
                  <th style={{ padding: '8px 10px' }}>Gross Profit</th>
                  <th style={{ padding: '8px 10px' }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredPreview.slice(0, 100).map((item) => (
                  <tr key={`${item.server_number}-${item.id}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td style={{ padding: '8px 10px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.name || item.id}>
                      <strong>{item.name || item.id}</strong>
                      <div style={{ fontSize: '0.7rem', color: '#64748b' }}>{item.category_name}</div>
                    </td>
                    <td style={{ padding: '8px 10px', color: '#94a3b8' }}>
                      Server {item.server_number}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#94a3b8' }}>
                      {formatCurrency(item.cost_minor)}
                    </td>
                    <td style={{ padding: '8px 10px', fontWeight: 700, color: '#10b981' }}>
                      {formatCurrency(item.price)}
                    </td>
                    <td style={{ padding: '8px 10px', color: '#6366f1', fontWeight: 600 }}>
                      {(item.markup_bps / 100).toFixed(0)}%
                    </td>
                    <td style={{ padding: '8px 10px', color: '#10b981', fontWeight: 600 }}>
                      +{formatCurrency(item.profit_minor)}
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      {item.is_override ? (
                        <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem', background: 'rgba(234,179,8,0.15)', color: '#fbbf24' }}>
                          Manual Override
                        </span>
                      ) : (
                        <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem', background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
                          Auto 50%
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredPreview.length > 100 && (
              <div style={{ padding: '8px 10px', textAlign: 'center', color: '#94a3b8', background: 'rgba(0,0,0,0.2)' }}>
                Showing first 100 of {filteredPreview.length} previewed products
              </div>
            )}
          </div>
        </div>
      )}

      {/* Individual Supplier Server Controls */}
      {loaded && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <Layers size={18} color="#6366f1" />
            <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Supplier Server Breakdown</h3>
          </div>
          <div className="supplier-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
            {providers.map(([provider, name, num]) => (
              <Controls
                key={provider}
                provider={provider}
                name={name}
                serverNumber={num}
                initial={policies.find((p) => p.provider === provider)}
                globalMarkup={globalPercent}
                stat={stats[provider]}
                reload={() => void loadData()}
              />
            ))}
          </div>

          <CategoryPricingManager
            categories={categories}
            rules={categoryRules}
            reload={() => void loadData()}
          />

          {/* Publishing Activity History */}
          {events.length > 0 && (
            <div style={{ marginTop: 24, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 12, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <History size={18} color="#6366f1" />
                <h3 style={{ margin: 0, fontSize: '1.15rem' }}>Automated Publishing & Pricing Event History</h3>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem', textAlign: 'left' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8' }}>
                      <th style={{ padding: '8px 10px' }}>Date & Time</th>
                      <th style={{ padding: '8px 10px' }}>Event Type</th>
                      <th style={{ padding: '8px 10px' }}>Markup</th>
                      <th style={{ padding: '8px 10px' }}>Items Processed</th>
                      <th style={{ padding: '8px 10px' }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev) => (
                      <tr key={ev.id} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                        <td style={{ padding: '8px 10px', color: '#94a3b8' }}>
                          {new Date(ev.created_at).toLocaleString()}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                          {ev.event_type === 'global_publish'
                            ? 'Global 50% Publication'
                            : ev.event_type === 'cron_auto_publish'
                            ? '24/7 Background Auto-Publish'
                            : ev.event_type === 'config_saved'
                            ? 'Global Pricing Settings Saved'
                            : ev.event_type}
                        </td>
                        <td style={{ padding: '8px 10px', color: '#6366f1' }}>
                          {(ev.markup_bps / 100).toFixed(0)}%
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {ev.items_count > 0 ? `${ev.items_count} products` : '—'}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: '0.7rem', background: 'rgba(16,185,129,0.15)', color: '#10b981' }}>
                            {ev.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Controls({
  provider,
  name,
  serverNumber,
  initial,
  globalMarkup,
  stat,
  reload,
}: {
  provider: string
  name: string
  serverNumber: number
  initial?: Policy
  globalMarkup: string
  stat?: Stats
  reload: () => void
}) {
  const [percent, setPercent] = useState(String((initial?.markup_bps ?? 5000) / 100))
  const [pricing, setPricing] = useState(initial?.automatic_pricing !== 0)
  const [publish, setPublish] = useState(initial?.auto_publish !== 0)
  const [approve, setApprove] = useState(initial?.auto_approve !== 0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const supported = true

  useEffect(() => {
    if (initial) {
      setPercent(String((initial.markup_bps ?? 5000) / 100))
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
        setMessage(`Success: ${percent}% markup applied to Server ${serverNumber} products! (${result.updated ?? 0} items updated)`)
        reload()
        return
      }

      if (act === 'approve_all') {
        const result = await cloudflareRequest<{ approved_count: number }>('/api/admin/supplier-automation', {
          provider,
          action: 'approve_all',
        })
        setMessage(`Success: All ${result.approved_count ?? 0} listings for Server ${serverNumber} approved and published live!`)
        reload()
        return
      }

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
            background: 'rgba(16,185,129,0.15)',
            color: '#10b981',
            padding: '4px 8px',
            borderRadius: 6,
            fontSize: '0.75rem',
            fontWeight: 600,
          }}
        >
          Operational
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
          Server Markup (%)
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
            Apply
          </button>
        </div>
        <p className="cf-muted" style={{ fontSize: '0.75rem', marginTop: 6, marginBottom: 0 }}>
          Inherits global {globalMarkup}% default unless explicitly customized.
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
          <span>Auto-approve new listings from supplier</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={publish}
            disabled={!supported || busy}
            onChange={(e) => setPublish(e.target.checked)}
          />
          <span>Auto-publish in-stock items live</span>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={pricing}
            disabled={!supported || busy}
            onChange={(e) => setPricing(e.target.checked)}
          />
          <span>Auto-recalculate on supplier cost change</span>
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
          Publish Server {serverNumber}
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
  const [markupPercent, setMarkupPercent] = useState('50')
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
        <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Category-Based Pricing & Trusted Resale Rules</h3>
      </div>
      <p className="cf-muted" style={{ margin: '0 0 16px', fontSize: '0.85rem' }}>
        Configure specific percentage markups for individual categories (Facebook, Instagram, TikTok, Twitter/X, Gmail, VPN). Categories without rules inherit the global 50% default. Mark categories as <strong>Trusted</strong> for immediate zero-touch auto-publishing.
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
              else if (p === 'shopviaclone22') setAuthRef('ShopViaClone22 authorized supplier permission')
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
            placeholder="e.g. 50"
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
          No category-specific rules configured yet. All categories inherit the global 50% default.
        </p>
      )}
    </div>
  )
}
