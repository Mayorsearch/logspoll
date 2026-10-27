import { useEffect, useRef, useState } from 'react'
import { cloudflareRequest } from '../lib/cloudflare-auth'
import {
  Globe,
  Key,
  RefreshCw,
  Play,
  Power,
  AlertCircle,
  CheckCircle2,
  Info,
  Cpu,
  Wallet,
  ShoppingBag,
  Search,
  Sliders,
  TrendingUp,
  TrendingDown,
  Layers,
  Eye,
  EyeOff,
  ExternalLink,
  Clock,
  PackageCheck,
  AlertTriangle,
  Percent,
  ShieldCheck,
} from 'lucide-react'

type ConnectionStatus = {
  enabled: number
  revision: number
  auto_monitor: number
  monitor_interval_hours: number
  phase: string
  total: number | null
  scanned: number
  next_attempt: number
  last_success: number | null
  last_status: string
  base_url: string
  imported: number
  approved: number
  in_stock: number
}

type KoraCatalogItem = {
  external_id: string
  name: string
  description: string
  cost_minor: number
  previous_cost_minor: number | null
  selling_price_minor: number
  currency: string
  stock: number | null
  available: number
  delivery_type: string
  pricing_mode: 'markup' | 'override'
  markup_bps: number
  approval_status: 'pending' | 'approved' | 'rejected'
  product_id: string | null
  product_status?: string
  product_slug?: string
  checked_at: number
  reviewed_at: number | null
  price_updated_at: number | null
}

type PriceHistoryEntry = {
  id: string
  external_id: string
  product_name?: string
  old_cost_minor: number
  new_cost_minor: number
  old_price_minor: number
  new_price_minor: number
  markup_bps: number
  change_type: string
  recorded_at: number
}

type SupplierProduct = {
  id: string
  name: string
  price_kobo: number
  price_naira: number
  stock: number | null
  available: boolean
  delivery: 'instant' | 'manual'
  imported?: boolean
  approval_status?: string | null
  current_selling_price_minor?: number | null
  pricing_mode?: string | null
  markup_bps?: number | null
}

type SupplierOrder = {
  order_id: string
  product: string
  status: string
  price_kobo: number
  items: string[]
  created_at: string
}

type SubSection =
  | 'config'
  | 'products'
  | 'pricing'
  | 'stock'
  | 'orders'
  | 'sync'

export default function KoraStoreManager({ onComplete }: { onComplete?: () => void }) {
  const [activeSection, setActiveSection] = useState<SubSection>('config')
  const [status, setStatus] = useState<ConnectionStatus | null>(null)
  const [importedItems, setImportedItems] = useState<KoraCatalogItem[]>([])
  const [priceHistory, setPriceHistory] = useState<PriceHistoryEntry[]>([])
  const [supplierProducts, setSupplierProducts] = useState<SupplierProduct[]>([])
  const [supplierOrders, setSupplierOrders] = useState<SupplierOrder[]>([])
  const [balance, setBalance] = useState<{ kobo: number; naira: number } | null>(null)

  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showKey, setShowKey] = useState(false)

  // API Configuration form state
  const [baseUrl, setBaseUrl] = useState('https://korastore.cv/v1')
  const keyInput = useRef<HTMLInputElement>(null)

  // Product Selection & Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [productFilter, setProductFilter] = useState<'all' | 'chatgpt' | 'codex' | 'muse' | 'claude' | 'instant'>('all')
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([])
  const [defaultImportMarkupBps, setDefaultImportMarkupBps] = useState(5000) // 50%

  // Bulk Pricing State
  const [bulkPricingIds, setBulkPricingIds] = useState<string[]>([])
  const [bulkMarkupPercent, setBulkMarkupPercent] = useState('50')

  // History modal
  const [historyModalItem, setHistoryModalItem] = useState<string | null>(null)

  // Sync Settings
  const [autoMonitor, setAutoMonitor] = useState(false)
  const [syncIntervalHours, setSyncIntervalHours] = useState(6)
  const [syncStats, setSyncStats] = useState<{
    total_checked?: number
    price_increases?: number
    price_decreases?: number
    stock_updates?: number
    unchanged?: number
    d1_statements_executed?: number
  } | null>(null)

  async function loadData() {
    try {
      const res = await cloudflareRequest<{
        provider: string
        connection: ConnectionStatus | null
        items: KoraCatalogItem[]
        priceHistory: PriceHistoryEntry[]
      }>('/api/admin/korastore')
      if (res.connection) {
        setStatus(res.connection)
        if (res.connection.base_url) setBaseUrl(res.connection.base_url)
        setAutoMonitor(Boolean(res.connection.auto_monitor))
        setSyncIntervalHours(res.connection.monitor_interval_hours || 6)
      }
      setImportedItems(res.items || [])
      setPriceHistory(res.priceHistory || [])
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Kora Store settings unavailable.')
      setIsError(true)
    }
  }

  useEffect(() => {
    void loadData()
  }, [])

  async function executeAction(action: string, payload: Record<string, unknown> = {}) {
    setBusy(true)
    setMessage('')
    setIsError(false)
    try {
      const res = await cloudflareRequest<any>('/api/admin/korastore', {
        action,
        ...payload,
      })

      if (res.message) {
        setMessage(res.message)
      }

      if (action === 'save') {
        if (keyInput.current) keyInput.current.value = ''
        await loadData()
      } else if (action === 'toggle') {
        if (status) setStatus({ ...status, enabled: res.enabled })
        setMessage(`Kora Store ${res.enabled ? 'enabled' : 'disabled'}.`)
      } else if (action === 'test' || action === 'balance') {
        setBalance({ kobo: res.balance_kobo, naira: res.balance_naira })
        if (res.message) setMessage(res.message)
        await loadData()
      } else if (action === 'fetch_catalog') {
        setSupplierProducts(res.products || [])
        setMessage(`Fetched ${res.products?.length || 0} products from live Kora Store catalog.`)
      } else if (action === 'import_products') {
        setSelectedProductIds([])
        await loadData()
        // Refresh catalog tagging
        executeAction('fetch_catalog')
      } else if (action === 'update_pricing' || action === 'bulk_pricing') {
        setBulkPricingIds([])
        await loadData()
      } else if (action === 'toggle_publish') {
        await loadData()
        if (onComplete) onComplete()
      } else if (action === 'sync_prices') {
        setSyncStats({
          total_checked: res.total_checked,
          price_increases: res.price_increases,
          price_decreases: res.price_decreases,
          stock_updates: res.stock_updates,
          unchanged: res.unchanged,
          d1_statements_executed: res.d1_statements_executed,
        })
        await loadData()
      } else if (action === 'orders') {
        setSupplierOrders(res.orders || [])
      }

      return res
    } catch (err) {
      setIsError(true)
      setMessage(err instanceof Error ? err.message : 'Action failed.')
    } finally {
      setBusy(false)
    }
  }

  // Filter products for selection
  const filteredSupplierProducts = supplierProducts.filter((p) => {
    const q = searchQuery.toLowerCase().trim()
    const matchesSearch = !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)

    let matchesFilter = true
    if (productFilter === 'chatgpt') matchesFilter = /chatgpt|gpt/i.test(p.name) || /chatgpt|gpt/i.test(p.id)
    else if (productFilter === 'codex') matchesFilter = /codex/i.test(p.name) || /codex/i.test(p.id)
    else if (productFilter === 'muse') matchesFilter = /muse/i.test(p.name) || /muse/i.test(p.id)
    else if (productFilter === 'claude') matchesFilter = /claude/i.test(p.name) || /claude/i.test(p.id)
    else if (productFilter === 'instant') matchesFilter = p.delivery === 'instant'

    return matchesSearch && matchesFilter
  })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Top Banner & Header */}
      <div
        className="cf-panel"
        style={{
          padding: 20,
          borderRadius: 12,
          background: 'var(--admin-card-bg, #ffffff)',
          border: '1px solid var(--admin-border, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Cpu size={24} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 800, color: 'var(--admin-text, #0f172a)' }}>
                  Server 4 · Kora AI Store
                </h2>
                <span
                  style={{
                    fontSize: '0.7rem',
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: status?.enabled ? '#10b98120' : '#64748b20',
                    color: status?.enabled ? '#10b981' : '#64748b',
                    fontWeight: 700,
                  }}
                >
                  {status?.enabled ? 'ONLINE' : 'PAUSED'}
                </span>
                <span
                  style={{
                    fontSize: '0.7rem',
                    padding: '2px 8px',
                    borderRadius: 12,
                    background: '#3b82f620',
                    color: '#3b82f6',
                    fontWeight: 700,
                  }}
                >
                  NATIVE NGN (KOBO)
                </span>
              </div>
              <p style={{ margin: '4px 0 0', color: 'var(--admin-muted, #64748b)', fontSize: '0.85rem' }}>
                Reseller API integration under Server 4 (AI Tools) alongside DigitalCore. Selective product imports, independent percentage markup, and automated fulfillment.
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => executeAction('test')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 8,
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
                background: 'var(--admin-subtle, #f1f5f9)',
                color: 'var(--admin-text, #334155)',
                border: '1px solid var(--admin-border, #cbd5e1)',
              }}
            >
              <RefreshCw size={14} className={busy ? 'spin' : ''} />
              Test Connection
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => executeAction('toggle')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 16px',
                borderRadius: 8,
                fontSize: '0.8rem',
                fontWeight: 700,
                cursor: 'pointer',
                border: 'none',
                background: status?.enabled ? '#ef4444' : '#10b981',
                color: '#ffffff',
              }}
            >
              <Power size={14} />
              {status?.enabled ? 'Pause Kora' : 'Enable Kora'}
            </button>
          </div>
        </div>

        {/* Message Banner */}
        {message && (
          <div
            style={{
              marginTop: 16,
              padding: '10px 14px',
              borderRadius: 8,
              fontSize: '0.85rem',
              fontWeight: 500,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: isError ? 'rgba(239, 68, 68, 0.1)' : 'rgba(16, 185, 129, 0.1)',
              color: isError ? '#ef4444' : '#10b981',
              border: `1px solid ${isError ? 'rgba(239, 68, 68, 0.2)' : 'rgba(16, 185, 129, 0.2)'}`,
            }}
          >
            {isError ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
            <span>{message}</span>
          </div>
        )}

        {/* Metric Cards Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
            gap: 12,
            marginTop: 20,
          }}
        >
          {/* Supplier Balance */}
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: 'var(--admin-bg-subtle, #f8fafc)',
              border: '1px solid var(--admin-border-subtle, #e2e8f0)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: 'var(--admin-muted, #64748b)', textTransform: 'uppercase' }}>
              <Wallet size={14} />
              Kora Wallet Balance
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: 4, color: '#f97316' }}>
              {balance ? `₦${Number(balance.naira).toLocaleString('en-US', { minimumFractionDigits: 2 })}` : '—'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--admin-muted, #64748b)', marginTop: 2 }}>
              {balance ? `${balance.kobo.toLocaleString()} kobo` : 'Click Test or Balance'}
            </div>
          </div>

          {/* Imported Products */}
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: 'var(--admin-bg-subtle, #f8fafc)',
              border: '1px solid var(--admin-border-subtle, #e2e8f0)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: 'var(--admin-muted, #64748b)', textTransform: 'uppercase' }}>
              <PackageCheck size={14} />
              Imported Products
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: 4, color: 'var(--admin-text, #0f172a)' }}>
              {status?.imported ?? importedItems.length}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--admin-muted, #64748b)', marginTop: 2 }}>
              {importedItems.filter((i) => i.available && (i.stock === null || i.stock > 0)).length} in stock
            </div>
          </div>

          {/* Published / Approved */}
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: 'var(--admin-bg-subtle, #f8fafc)',
              border: '1px solid var(--admin-border-subtle, #e2e8f0)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: 'var(--admin-muted, #64748b)', textTransform: 'uppercase' }}>
              <ShoppingBag size={14} />
              Server 4 Active
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: 4, color: 'var(--admin-text, #0f172a)' }}>
              {status?.approved ?? importedItems.filter((i) => i.approval_status === 'approved').length}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--admin-muted, #64748b)', marginTop: 2 }}>
              Live on /categories/server4
            </div>
          </div>

          {/* Price Monitor */}
          <div
            style={{
              padding: 14,
              borderRadius: 8,
              background: 'var(--admin-bg-subtle, #f8fafc)',
              border: '1px solid var(--admin-border-subtle, #e2e8f0)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.75rem', fontWeight: 600, color: 'var(--admin-muted, #64748b)', textTransform: 'uppercase' }}>
              <TrendingUp size={14} />
              Price Monitor
            </div>
            <div style={{ fontSize: '1.35rem', fontWeight: 800, marginTop: 4, color: autoMonitor ? '#10b981' : '#64748b' }}>
              {autoMonitor ? 'ENABLED' : 'MANUAL'}
            </div>
            <div style={{ fontSize: '0.72rem', color: 'var(--admin-muted, #64748b)', marginTop: 2 }}>
              Every {syncIntervalHours}h (0 writes if unchanged)
            </div>
          </div>
        </div>

        {/* Section Navigation Tabs */}
        <div
          role="tablist"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid var(--admin-border, #e2e8f0)',
          }}
        >
          {[
            { id: 'config', label: '1. API Config & Balance', icon: Key },
            { id: 'products', label: '2. Product Import (Priority AI)', icon: Search },
            { id: 'pricing', label: '3. Pricing Manager (Percentage & Fixed)', icon: Percent },
            { id: 'stock', label: '4. Stock & Catalog', icon: Layers },
            { id: 'orders', label: '5. Supplier Orders', icon: ShoppingBag },
            { id: 'sync', label: '6. Price Sync & Billing Safety', icon: Sliders },
          ].map((tab) => {
            const Icon = tab.icon
            const active = activeSection === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setActiveSection(tab.id as SubSection)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 8,
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  background: active ? '#f97316' : 'var(--admin-subtle, #f1f5f9)',
                  color: active ? '#ffffff' : 'var(--admin-text, #334155)',
                  transition: 'all 0.15s ease',
                }}
              >
                <Icon size={14} />
                <span>{tab.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {/* SECTION 1: API CONFIGURATION & TEST CONNECTION */}
      {activeSection === 'config' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          {/* Credentials Card */}
          <div
            className="cf-panel"
            style={{
              padding: 20,
              borderRadius: 12,
              background: 'var(--admin-card-bg, #ffffff)',
              border: '1px solid var(--admin-border, #e2e8f0)',
            }}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
              1. API Configuration
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--admin-muted, #64748b)' }}>
              Credentials are sealed with AES-GCM encryption in D1 using <code>SUPPLIER_ENCRYPTION_KEY</code>.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
                  API Base URL
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Globe size={16} color="var(--admin-muted, #64748b)" />
                  <input
                    type="text"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--admin-border, #cbd5e1)',
                      fontSize: '0.85rem',
                    }}
                  />
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
                  Kora Store Secret API Key (Bearer kora_sk_...)
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Key size={16} color="var(--admin-muted, #64748b)" />
                  <input
                    ref={keyInput}
                    type={showKey ? 'text' : 'password'}
                    placeholder="Enter kora_sk_... to replace stored key"
                    style={{
                      flex: 1,
                      padding: '8px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--admin-border, #cbd5e1)',
                      fontSize: '0.85rem',
                      fontFamily: 'monospace',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    style={{
                      padding: '8px',
                      borderRadius: 6,
                      border: '1px solid var(--admin-border, #cbd5e1)',
                      background: 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.72rem', color: 'var(--admin-muted, #64748b)', marginTop: 4 }}>
                  <Info size={12} />
                  <span>Obtain API key via Telegram Bot <strong>@korastorebot</strong> or at <strong>korastore.cv</strong>.</span>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    executeAction('save', {
                      base_url: baseUrl,
                      api_key: keyInput.current?.value || undefined,
                      enabled: status?.enabled,
                    })
                  }
                  style={{
                    padding: '8px 18px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#f97316',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    cursor: 'pointer',
                  }}
                >
                  Save API Configuration
                </button>
              </div>
            </div>
          </div>

          {/* Documentation & Diagnostics Card */}
          <div
            className="cf-panel"
            style={{
              padding: 20,
              borderRadius: 12,
              background: 'var(--admin-card-bg, #ffffff)',
              border: '1px solid var(--admin-border, #e2e8f0)',
            }}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
              Official Kora API Reference
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: '0.8rem' }}>
              <div style={{ padding: 10, borderRadius: 6, background: 'var(--admin-subtle, #f8fafc)', border: '1px solid var(--admin-border, #e2e8f0)' }}>
                <strong>Base URL:</strong> <code>https://korastore.cv/v1</code>
              </div>
              <div style={{ padding: 10, borderRadius: 6, background: 'var(--admin-subtle, #f8fafc)', border: '1px solid var(--admin-border, #e2e8f0)' }}>
                <strong>Endpoints Used:</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 16 }}>
                  <li><code>GET /v1/me</code>: Wallet balance (kobo & naira)</li>
                  <li><code>GET /v1/products</code>: Live catalog</li>
                  <li><code>POST /v1/buy</code>: Automated order fulfillment with idempotency key</li>
                  <li><code>GET /v1/orders/{'{id}'}</code>: Single order recovery</li>
                  <li><code>GET /v1/orders</code>: Recent order audit</li>
                </ul>
              </div>
              <div style={{ padding: 10, borderRadius: 6, background: 'rgba(249, 115, 22, 0.08)', border: '1px solid rgba(249, 115, 22, 0.2)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#f97316' }}>
                  <ExternalLink size={14} />
                  <a href="https://korastore.cv/api-docs" target="_blank" rel="noreferrer" style={{ color: '#ea580c', textDecoration: 'underline' }}>
                    Open Kora Store API Documentation
                  </a>
                </div>
                <div style={{ marginTop: 4, color: 'var(--admin-muted, #64748b)' }}>
                  Telegram Bot: <a href="https://t.me/korastorebot" target="_blank" rel="noreferrer" style={{ color: '#3b82f6' }}>@korastorebot</a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* SECTION 2: SELECTIVE PRODUCT IMPORT (PRIORITY AI ITEMS) */}
      {activeSection === 'products' && (
        <div
          className="cf-panel"
          style={{
            padding: 20,
            borderRadius: 12,
            background: 'var(--admin-card-bg, #ffffff)',
            border: '1px solid var(--admin-border, #e2e8f0)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
                Selective Product Import
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--admin-muted, #64748b)' }}>
                Only selected products enter LogsPoll. Priority AI tools (ChatGPT, Codex, Muse AI, Claude) are highlighted. Imported products stay unpublished until approved.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button
                type="button"
                disabled={busy}
                onClick={() => executeAction('fetch_catalog')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 14px',
                  borderRadius: 6,
                  border: '1px solid var(--admin-border, #cbd5e1)',
                  background: '#f8fafc',
                  fontSize: '0.8rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <RefreshCw size={14} className={busy ? 'spin' : ''} />
                Fetch Live Products from Kora
              </button>

              <button
                type="button"
                disabled={busy || selectedProductIds.length === 0}
                onClick={() =>
                  executeAction('import_products', {
                    product_ids: selectedProductIds,
                    markup_bps: defaultImportMarkupBps,
                  })
                }
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '8px 18px',
                  borderRadius: 6,
                  border: 'none',
                  background: selectedProductIds.length > 0 ? '#f97316' : '#cbd5e1',
                  color: '#fff',
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  cursor: selectedProductIds.length > 0 ? 'pointer' : 'not-allowed',
                }}
              >
                <PackageCheck size={14} />
                Import Selected ({selectedProductIds.length})
              </button>
            </div>
          </div>

          {/* Filter Bar */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center', marginBottom: 16 }}>
            <div style={{ position: 'relative', flex: '1 1 200px', minWidth: 200 }}>
              <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--admin-muted, #64748b)' }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Kora catalog by name or ID..."
                style={{
                  width: '100%',
                  padding: '6px 10px 6px 30px',
                  borderRadius: 6,
                  border: '1px solid var(--admin-border, #cbd5e1)',
                  fontSize: '0.8rem',
                }}
              />
            </div>

            {/* Quick Priority Filter Chips */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { id: 'all', label: 'All Products' },
                { id: 'chatgpt', label: '⭐ ChatGPT' },
                { id: 'codex', label: '⭐ Codex' },
                { id: 'muse', label: '⭐ Muse AI' },
                { id: 'claude', label: '⭐ Claude' },
                { id: 'instant', label: '⚡ Instant Delivery' },
              ].map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  onClick={() => setProductFilter(chip.id as any)}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 16,
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                    border: '1px solid',
                    borderColor: productFilter === chip.id ? '#f97316' : 'var(--admin-border, #cbd5e1)',
                    background: productFilter === chip.id ? 'rgba(249, 115, 22, 0.1)' : 'transparent',
                    color: productFilter === chip.id ? '#f97316' : 'var(--admin-text, #475569)',
                  }}
                >
                  {chip.label}
                </button>
              ))}
            </div>

            {/* Default Markup Input */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', fontSize: '0.8rem' }}>
              <span style={{ color: 'var(--admin-muted, #64748b)' }}>Initial Markup:</span>
              <input
                type="number"
                min="0"
                max="500"
                value={defaultImportMarkupBps / 100}
                onChange={(e) => setDefaultImportMarkupBps(Math.round(Number(e.target.value) * 100))}
                style={{
                  width: 60,
                  padding: '4px 6px',
                  borderRadius: 4,
                  border: '1px solid var(--admin-border, #cbd5e1)',
                  fontSize: '0.8rem',
                  textAlign: 'center',
                }}
              />
              <span>%</span>
            </div>
          </div>

          {/* Supplier Catalog Table */}
          {supplierProducts.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--admin-muted, #64748b)', fontSize: '0.85rem' }}>
              Click <strong>"Fetch Live Products from Kora"</strong> above to load the official supplier catalog.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--admin-border, #e2e8f0)', textAlign: 'left', color: 'var(--admin-muted, #64748b)' }}>
                    <th style={{ padding: '8px 10px', width: 40 }}>
                      <input
                        type="checkbox"
                        checked={
                          filteredSupplierProducts.length > 0 &&
                          filteredSupplierProducts.every((p) => selectedProductIds.includes(p.id))
                        }
                        onChange={(e) => {
                          if (e.target.checked) {
                            const newIds = Array.from(new Set([...selectedProductIds, ...filteredSupplierProducts.map((p) => p.id)]))
                            setSelectedProductIds(newIds)
                          } else {
                            const filteredIds = new Set(filteredSupplierProducts.map((p) => p.id))
                            setSelectedProductIds(selectedProductIds.filter((id) => !filteredIds.has(id)))
                          }
                        }}
                      />
                    </th>
                    <th style={{ padding: '8px 10px' }}>Product</th>
                    <th style={{ padding: '8px 10px' }}>Supplier ID</th>
                    <th style={{ padding: '8px 10px' }}>Wholesale Cost</th>
                    <th style={{ padding: '8px 10px' }}>Delivery</th>
                    <th style={{ padding: '8px 10px' }}>Stock</th>
                    <th style={{ padding: '8px 10px' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSupplierProducts.map((p) => {
                    const isSelected = selectedProductIds.includes(p.id)
                    const isImported = Boolean(p.imported)
                    return (
                      <tr
                        key={p.id}
                        style={{
                          borderBottom: '1px solid var(--admin-border, #f1f5f9)',
                          background: isSelected ? 'rgba(249, 115, 22, 0.04)' : 'transparent',
                        }}
                      >
                        <td style={{ padding: '8px 10px' }}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedProductIds([...selectedProductIds, p.id])
                              else setSelectedProductIds(selectedProductIds.filter((id) => id !== p.id))
                            }}
                          />
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span>{p.name}</span>
                            {/chatgpt|gpt|codex|muse|claude/i.test(p.name) && (
                              <span style={{ fontSize: '0.65rem', padding: '1px 5px', borderRadius: 4, background: '#f9731620', color: '#ea580c', fontWeight: 700 }}>
                                PRIORITY
                              </span>
                            )}
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: 'var(--admin-muted, #64748b)' }}>
                          {p.id}
                        </td>
                        <td style={{ padding: '8px 10px', fontWeight: 700, color: '#f97316' }}>
                          ₦{p.price_naira.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                          <div style={{ fontSize: '0.68rem', color: 'var(--admin-muted, #64748b)', fontWeight: 400 }}>
                            {p.price_kobo.toLocaleString()} kobo
                          </div>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <span
                            style={{
                              fontSize: '0.7rem',
                              padding: '2px 6px',
                              borderRadius: 4,
                              background: p.delivery === 'instant' ? '#10b98115' : '#64748b15',
                              color: p.delivery === 'instant' ? '#10b981' : '#64748b',
                              fontWeight: 600,
                            }}
                          >
                            {p.delivery === 'instant' ? '⚡ Instant' : 'Manual'}
                          </span>
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {p.stock === null ? 'Unlimited' : `${p.stock} units`}
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          {isImported ? (
                            <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: '#10b98120', color: '#10b981', fontWeight: 700 }}>
                              {p.approval_status === 'approved' ? 'Active Storefront' : 'Imported (Draft)'}
                            </span>
                          ) : (
                            <span style={{ fontSize: '0.7rem', color: 'var(--admin-muted, #94a3b8)' }}>
                              Not imported
                            </span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SECTION 3: PRICING MANAGER (INDEPENDENT AUTOMATIC PERCENTAGE & FIXED MODES) */}
      {activeSection === 'pricing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Formula & Policy Card */}
          <div
            className="cf-panel"
            style={{
              padding: 20,
              borderRadius: 12,
              background: 'var(--admin-card-bg, #ffffff)',
              border: '1px solid var(--admin-border, #e2e8f0)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
                  Independent Percentage & Fixed Pricing Manager
                </h3>
                <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--admin-muted, #64748b)' }}>
                  Formula: <code>sellingPrice = verifiedSupplierCostNGN × (1 + markupPercentage / 100)</code>.
                  Automatic price increases AND price decreases preserve configured markup percentage.
                </p>
              </div>

              {/* Bulk Markup Editor */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--admin-subtle, #f8fafc)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--admin-border, #e2e8f0)' }}>
                <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Bulk Markup:</span>
                <input
                  type="number"
                  min="0"
                  max="500"
                  value={bulkMarkupPercent}
                  onChange={(e) => setBulkMarkupPercent(e.target.value)}
                  style={{ width: 50, padding: '4px', borderRadius: 4, border: '1px solid var(--admin-border, #cbd5e1)', fontSize: '0.8rem', textAlign: 'center' }}
                />
                <span style={{ fontSize: '0.75rem' }}>%</span>
                <button
                  type="button"
                  disabled={busy || bulkPricingIds.length === 0}
                  onClick={() =>
                    executeAction('bulk_pricing', {
                      external_ids: bulkPricingIds,
                      markup_bps: Math.round(Number(bulkMarkupPercent) * 100),
                    })
                  }
                  style={{
                    padding: '4px 10px',
                    borderRadius: 4,
                    border: 'none',
                    background: bulkPricingIds.length > 0 ? '#f97316' : '#cbd5e1',
                    color: '#fff',
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    cursor: bulkPricingIds.length > 0 ? 'pointer' : 'not-allowed',
                  }}
                >
                  Apply to Selected ({bulkPricingIds.length})
                </button>
              </div>
            </div>

            {/* Imported Products Pricing Table */}
            {importedItems.length === 0 ? (
              <div style={{ padding: 40, textAlign: 'center', color: 'var(--admin-muted, #64748b)', fontSize: '0.85rem' }}>
                No products imported yet. Go to <strong>"2. Product Import"</strong> to select priority AI items.
              </div>
            ) : (
              <div style={{ overflowX: 'auto', marginTop: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '2px solid var(--admin-border, #e2e8f0)', textAlign: 'left', color: 'var(--admin-muted, #64748b)' }}>
                      <th style={{ padding: '8px 10px', width: 36 }}>
                        <input
                          type="checkbox"
                          checked={bulkPricingIds.length === importedItems.length && importedItems.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) setBulkPricingIds(importedItems.map((i) => i.external_id))
                            else setBulkPricingIds([])
                          }}
                        />
                      </th>
                      <th style={{ padding: '8px 10px' }}>Product</th>
                      <th style={{ padding: '8px 10px' }}>Supplier Cost</th>
                      <th style={{ padding: '8px 10px' }}>Pricing Mode</th>
                      <th style={{ padding: '8px 10px' }}>Markup %</th>
                      <th style={{ padding: '8px 10px' }}>Selling Price</th>
                      <th style={{ padding: '8px 10px' }}>Profit Margin</th>
                      <th style={{ padding: '8px 10px' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importedItems.map((item) => {
                      const isBulkSelected = bulkPricingIds.includes(item.external_id)
                      const costNaira = item.cost_minor / 100
                      const priceNaira = item.selling_price_minor / 100
                      const profitNaira = priceNaira - costNaira
                      const profitPercent = costNaira > 0 ? ((profitNaira / costNaira) * 100).toFixed(1) : '0'
                      const isLoss = item.selling_price_minor < item.cost_minor

                      return (
                        <tr
                          key={item.external_id}
                          style={{
                            borderBottom: '1px solid var(--admin-border, #f1f5f9)',
                            background: isLoss ? 'rgba(239, 68, 68, 0.05)' : isBulkSelected ? 'rgba(249, 115, 22, 0.04)' : 'transparent',
                          }}
                        >
                          <td style={{ padding: '8px 10px' }}>
                            <input
                              type="checkbox"
                              checked={isBulkSelected}
                              onChange={(e) => {
                                if (e.target.checked) setBulkPricingIds([...bulkPricingIds, item.external_id])
                                else setBulkPricingIds(bulkPricingIds.filter((id) => id !== item.external_id))
                              }}
                            />
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                            <div>{item.name}</div>
                            <div style={{ fontSize: '0.68rem', color: 'var(--admin-muted, #64748b)', fontFamily: 'monospace' }}>
                              {item.external_id}
                            </div>
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                            ₦{costNaira.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            {item.previous_cost_minor && item.previous_cost_minor !== item.cost_minor && (
                              <div style={{ fontSize: '0.68rem', display: 'flex', alignItems: 'center', gap: 2, color: item.cost_minor > item.previous_cost_minor ? '#ef4444' : '#10b981' }}>
                                {item.cost_minor > item.previous_cost_minor ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
                                Was ₦{(item.previous_cost_minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <select
                              value={item.pricing_mode}
                              onChange={(e) => {
                                const newMode = e.target.value as 'markup' | 'override'
                                executeAction('update_pricing', {
                                  external_id: item.external_id,
                                  pricing_mode: newMode,
                                  markup_bps: item.markup_bps,
                                  selling_price_minor: item.selling_price_minor,
                                })
                              }}
                              style={{
                                padding: '4px 6px',
                                borderRadius: 4,
                                border: '1px solid var(--admin-border, #cbd5e1)',
                                fontSize: '0.75rem',
                                fontWeight: 600,
                              }}
                            >
                              <option value="markup">Option A: Percentage</option>
                              <option value="override">Option B: Fixed NGN</option>
                            </select>
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            {item.pricing_mode === 'markup' ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <input
                                  type="number"
                                  min="0"
                                  max="500"
                                  defaultValue={item.markup_bps / 100}
                                  onBlur={(e) => {
                                    const val = Math.round(Number(e.target.value) * 100)
                                    if (val !== item.markup_bps) {
                                      executeAction('update_pricing', {
                                        external_id: item.external_id,
                                        pricing_mode: 'markup',
                                        markup_bps: val,
                                      })
                                    }
                                  }}
                                  style={{
                                    width: 50,
                                    padding: '3px 4px',
                                    borderRadius: 4,
                                    border: '1px solid var(--admin-border, #cbd5e1)',
                                    fontSize: '0.75rem',
                                    textAlign: 'center',
                                  }}
                                />
                                <span>%</span>
                              </div>
                            ) : (
                              <span style={{ fontSize: '0.75rem', color: 'var(--admin-muted, #94a3b8)' }}>Fixed</span>
                            )}
                          </td>
                          <td style={{ padding: '8px 10px', fontWeight: 700 }}>
                            {item.pricing_mode === 'override' ? (
                              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <span>₦</span>
                                <input
                                  type="number"
                                  min="1"
                                  step="50"
                                  defaultValue={item.selling_price_minor / 100}
                                  onBlur={(e) => {
                                    const fixedKobo = Math.round(Number(e.target.value) * 100)
                                    if (fixedKobo !== item.selling_price_minor) {
                                      executeAction('update_pricing', {
                                        external_id: item.external_id,
                                        pricing_mode: 'override',
                                        selling_price_minor: fixedKobo,
                                      })
                                    }
                                  }}
                                  style={{
                                    width: 80,
                                    padding: '3px 4px',
                                    borderRadius: 4,
                                    border: `1px solid ${isLoss ? '#ef4444' : 'var(--admin-border, #cbd5e1)'}`,
                                    fontSize: '0.75rem',
                                    fontWeight: 700,
                                  }}
                                />
                              </div>
                            ) : (
                              <span style={{ color: '#0f172a' }}>
                                ₦{priceNaira.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                              </span>
                            )}
                            {isLoss && (
                              <div style={{ fontSize: '0.65rem', color: '#ef4444', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 2 }}>
                                <AlertTriangle size={10} /> LOSS WARNING
                              </div>
                            )}
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <span style={{ color: profitNaira >= 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                              +₦{profitNaira.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                            </span>
                            <span style={{ fontSize: '0.68rem', color: 'var(--admin-muted, #64748b)', marginLeft: 4 }}>
                              ({profitPercent}%)
                            </span>
                          </td>
                          <td style={{ padding: '8px 10px' }}>
                            <button
                              type="button"
                              onClick={() => setHistoryModalItem(item.external_id)}
                              style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                padding: '3px 8px',
                                borderRadius: 4,
                                border: '1px solid var(--admin-border, #cbd5e1)',
                                background: '#f8fafc',
                                fontSize: '0.7rem',
                                cursor: 'pointer',
                              }}
                            >
                              <Clock size={12} />
                              History
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* SECTION 4: STOCK & CATALOG PUBLICATION */}
      {activeSection === 'stock' && (
        <div
          className="cf-panel"
          style={{
            padding: 20,
            borderRadius: 12,
            background: 'var(--admin-card-bg, #ffffff)',
            border: '1px solid var(--admin-border, #e2e8f0)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
                Imported Products & Storefront Publication
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--admin-muted, #64748b)' }}>
                Approve products to make them visible on Server 4 (AI Tools). Unpublishing returns them safely to draft mode.
              </p>
            </div>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--admin-border, #e2e8f0)', textAlign: 'left', color: 'var(--admin-muted, #64748b)' }}>
                  <th style={{ padding: '8px 10px' }}>Product</th>
                  <th style={{ padding: '8px 10px' }}>Selling Price</th>
                  <th style={{ padding: '8px 10px' }}>Stock Status</th>
                  <th style={{ padding: '8px 10px' }}>Delivery Type</th>
                  <th style={{ padding: '8px 10px' }}>Storefront Status</th>
                  <th style={{ padding: '8px 10px' }}>Publication Toggle</th>
                </tr>
              </thead>
              <tbody>
                {importedItems.map((item) => {
                  const isApproved = item.approval_status === 'approved'
                  return (
                    <tr key={item.external_id} style={{ borderBottom: '1px solid var(--admin-border, #f1f5f9)' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>
                        <div>{item.name}</div>
                        <div style={{ fontSize: '0.68rem', color: 'var(--admin-muted, #64748b)', fontFamily: 'monospace' }}>
                          Slug: s4-kora-{item.external_id}
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 700, color: '#f97316' }}>
                        ₦{(item.selling_price_minor / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: '50%',
                              background: item.available && (item.stock === null || item.stock > 0) ? '#10b981' : '#ef4444',
                            }}
                          />
                          <span>{item.stock === null ? 'Unlimited' : `${item.stock} in stock`}</span>
                          <button
                            type="button"
                            onClick={() =>
                              executeAction('toggle_stock', {
                                external_id: item.external_id,
                                available: !item.available,
                              })
                            }
                            style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: '0.65rem',
                              border: '1px solid var(--admin-border, #cbd5e1)',
                              background: 'transparent',
                              cursor: 'pointer',
                            }}
                          >
                            {item.available ? 'Mark Out of Stock' : 'Mark In Stock'}
                          </button>
                        </div>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: 4, background: '#f1f5f9' }}>
                          {item.delivery_type === 'instant' ? '⚡ Instant' : 'Manual'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <span
                          style={{
                            fontSize: '0.7rem',
                            padding: '2px 8px',
                            borderRadius: 10,
                            background: isApproved ? '#10b98120' : '#64748b20',
                            color: isApproved ? '#10b981' : '#64748b',
                            fontWeight: 700,
                          }}
                        >
                          {isApproved ? 'PUBLISHED (Server 4)' : 'DRAFT / UNPUBLISHED'}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            executeAction('toggle_publish', {
                              external_id: item.external_id,
                              publish: !isApproved,
                            })
                          }
                          style={{
                            padding: '5px 12px',
                            borderRadius: 6,
                            border: 'none',
                            background: isApproved ? '#64748b' : '#10b981',
                            color: '#fff',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                          }}
                        >
                          {isApproved ? 'Unpublish' : 'Publish to Storefront'}
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 5: SUPPLIER ORDER HISTORY */}
      {activeSection === 'orders' && (
        <div
          className="cf-panel"
          style={{
            padding: 20,
            borderRadius: 12,
            background: 'var(--admin-card-bg, #ffffff)',
            border: '1px solid var(--admin-border, #e2e8f0)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
                Kora Supplier Order History
              </h3>
              <p style={{ margin: '4px 0 0', fontSize: '0.8rem', color: 'var(--admin-muted, #64748b)' }}>
                Audits real fulfillment purchases made via <code>POST /v1/buy</code> and retrieved via <code>GET /v1/orders</code>.
              </p>
            </div>
            <button
              type="button"
              disabled={busy}
              onClick={() => executeAction('orders')}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 6,
                border: '1px solid var(--admin-border, #cbd5e1)',
                background: '#f8fafc',
                fontSize: '0.8rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <RefreshCw size={14} className={busy ? 'spin' : ''} />
              Fetch Supplier Orders
            </button>
          </div>

          {supplierOrders.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: 'var(--admin-muted, #64748b)', fontSize: '0.85rem' }}>
              No supplier order history loaded. Click <strong>"Fetch Supplier Orders"</strong> above.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--admin-border, #e2e8f0)', textAlign: 'left', color: 'var(--admin-muted, #64748b)' }}>
                    <th style={{ padding: '8px 10px' }}>Order ID</th>
                    <th style={{ padding: '8px 10px' }}>Product</th>
                    <th style={{ padding: '8px 10px' }}>Status</th>
                    <th style={{ padding: '8px 10px' }}>Cost</th>
                    <th style={{ padding: '8px 10px' }}>Items Delivered</th>
                    <th style={{ padding: '8px 10px' }}>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierOrders.map((ord) => (
                    <tr key={ord.order_id} style={{ borderBottom: '1px solid var(--admin-border, #f1f5f9)' }}>
                      <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{ord.order_id}</td>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{ord.product}</td>
                      <td style={{ padding: '8px 10px' }}>
                        <span style={{ fontSize: '0.7rem', padding: '2px 8px', borderRadius: 10, background: ord.status === 'delivered' ? '#10b98120' : '#f9731620', color: ord.status === 'delivered' ? '#10b981' : '#f97316', fontWeight: 700 }}>
                          {ord.status}
                        </span>
                      </td>
                      <td style={{ padding: '8px 10px', fontWeight: 700 }}>
                        ₦{(ord.price_kobo / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>
                      <td style={{ padding: '8px 10px' }}>
                        {ord.items && ord.items.length > 0 ? (
                          <span style={{ fontSize: '0.75rem', color: '#10b981', fontWeight: 600 }}>
                            {ord.items.length} credential item(s) delivered
                          </span>
                        ) : (
                          <span style={{ color: 'var(--admin-muted, #94a3b8)' }}>None</span>
                        )}
                      </td>
                      <td style={{ padding: '8px 10px', color: 'var(--admin-muted, #64748b)' }}>
                        {ord.created_at || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* SECTION 6: SYNCHRONIZATION SETTINGS & CLOUDFLARE BILLING SAFETY */}
      {activeSection === 'sync' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
          {/* Cron & Monitoring Card */}
          <div
            className="cf-panel"
            style={{
              padding: 20,
              borderRadius: 12,
              background: 'var(--admin-card-bg, #ffffff)',
              border: '1px solid var(--admin-border, #e2e8f0)',
            }}
          >
            <h3 style={{ margin: '0 0 12px', fontSize: '1rem', fontWeight: 700, color: 'var(--admin-text, #0f172a)' }}>
              Automatic Price Monitoring
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--admin-muted, #64748b)' }}>
              Periodically checks supplier prices for selected products only. Recalculates percentage markups and alerts on fixed-price loss.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 8, background: 'var(--admin-subtle, #f8fafc)', border: '1px solid var(--admin-border, #e2e8f0)' }}>
                <div>
                  <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>Auto Price Monitoring</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--admin-muted, #64748b)' }}>
                    Runs in Cloudflare Scheduled worker cron
                  </div>
                </div>
                <input
                  type="checkbox"
                  checked={autoMonitor}
                  onChange={(e) => setAutoMonitor(e.target.checked)}
                  style={{ width: 18, height: 18, cursor: 'pointer' }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, marginBottom: 4 }}>
                  Monitoring Interval (Hours)
                </label>
                <input
                  type="number"
                  min="1"
                  max="48"
                  value={syncIntervalHours}
                  onChange={(e) => setSyncIntervalHours(Number(e.target.value))}
                  style={{
                    width: 100,
                    padding: '8px 12px',
                    borderRadius: 6,
                    border: '1px solid var(--admin-border, #cbd5e1)',
                    fontSize: '0.85rem',
                  }}
                />
                <div style={{ fontSize: '0.72rem', color: 'var(--admin-muted, #64748b)', marginTop: 4 }}>
                  Default is 6 hours to prevent excess API calls.
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    executeAction('save', {
                      auto_monitor: autoMonitor,
                      monitor_interval_hours: syncIntervalHours,
                    })
                  }
                  style={{
                    flex: 1,
                    padding: '8px 14px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#f97316',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  Save Sync Settings
                </button>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() => executeAction('sync_prices')}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    padding: '8px 14px',
                    borderRadius: 6,
                    border: '1px solid #f97316',
                    background: 'transparent',
                    color: '#ea580c',
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    cursor: 'pointer',
                  }}
                >
                  <Play size={14} />
                  Run Price Check Now
                </button>
              </div>
            </div>
          </div>

          {/* Cloudflare D1 Billing Containment Card */}
          <div
            className="cf-panel"
            style={{
              padding: 20,
              borderRadius: 12,
              background: 'var(--admin-card-bg, #ffffff)',
              border: '1px solid var(--admin-border, #e2e8f0)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#10b981', fontWeight: 700, fontSize: '0.9rem' }}>
              <ShieldCheck size={18} />
              Cloudflare D1 Billing Containment Active
            </div>
            <p style={{ margin: '8px 0 12px', fontSize: '0.8rem', color: 'var(--admin-muted, #64748b)' }}>
              To avoid expensive database write spikes, Kora Store price checking adheres to strict write containment rules:
            </p>

            <ul style={{ margin: 0, paddingLeft: 18, fontSize: '0.78rem', color: 'var(--admin-muted, #64748b)', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <li><strong>Zero writes on unchanged costs:</strong> If supplier cost, price, and stock are identical, no SQL updates run.</li>
              <li><strong>Selected-products-only:</strong> Only items you imported into <code>korastore_catalog_items</code> are scanned.</li>
              <li><strong>Durable concurrency lease:</strong> Leased execution prevents overlapping cron tasks.</li>
              <li><strong>Bounded batches:</strong> Statement batches are capped at 50 to prevent lock contention.</li>
            </ul>

            {syncStats && (
              <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: '#10b98115', border: '1px solid #10b98130', fontSize: '0.78rem' }}>
                <div style={{ fontWeight: 700, color: '#10b981', marginBottom: 4 }}>
                  Last Manual Run Diagnostics:
                </div>
                <div>Products checked: <strong>{syncStats.total_checked}</strong></div>
                <div>Price increases: <strong>{syncStats.price_increases}</strong></div>
                <div>Price decreases: <strong>{syncStats.price_decreases}</strong></div>
                <div>Unchanged items (0 writes): <strong>{syncStats.unchanged}</strong></div>
                <div>D1 statements executed: <strong>{syncStats.d1_statements_executed}</strong></div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Price History Modal */}
      {historyModalItem && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            padding: 20,
          }}
          onClick={() => setHistoryModalItem(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              padding: 24,
              maxWidth: 600,
              width: '100%',
              maxHeight: '80vh',
              overflowY: 'auto',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>
                Wholesale & Selling Price History
              </h3>
              <button
                type="button"
                onClick={() => setHistoryModalItem(null)}
                style={{ padding: '4px 8px', borderRadius: 4, border: 'none', background: '#f1f5f9', cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ fontSize: '0.8rem', color: 'var(--admin-muted, #64748b)', marginBottom: 12 }}>
              Product ID: <code>{historyModalItem}</code>
            </div>

            {priceHistory.filter((h) => h.external_id === historyModalItem).length === 0 ? (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--admin-muted, #94a3b8)', fontSize: '0.85rem' }}>
                No price change events recorded yet for this item.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {priceHistory
                  .filter((h) => h.external_id === historyModalItem)
                  .map((h) => (
                    <div
                      key={h.id}
                      style={{
                        padding: 10,
                        borderRadius: 6,
                        background: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        fontSize: '0.78rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          Cost: ₦{(h.old_cost_minor / 100).toLocaleString()} → ₦{(h.new_cost_minor / 100).toLocaleString()}
                        </div>
                        <div style={{ color: 'var(--admin-muted, #64748b)' }}>
                          Selling: ₦{(h.old_price_minor / 100).toLocaleString()} → ₦{(h.new_price_minor / 100).toLocaleString()} ({h.markup_bps / 100}%)
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <span
                          style={{
                            fontSize: '0.7rem',
                            padding: '2px 6px',
                            borderRadius: 4,
                            background: h.change_type === 'increase' ? '#ef444420' : h.change_type === 'decrease' ? '#10b98120' : '#3b82f620',
                            color: h.change_type === 'increase' ? '#ef4444' : h.change_type === 'decrease' ? '#10b981' : '#3b82f6',
                            fontWeight: 700,
                          }}
                        >
                          {h.change_type.toUpperCase()}
                        </span>
                        <div style={{ fontSize: '0.68rem', color: 'var(--admin-muted, #94a3b8)', marginTop: 2 }}>
                          {new Date(h.recorded_at).toLocaleDateString()} {new Date(h.recorded_at).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
