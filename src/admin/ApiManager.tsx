import { useState, useEffect } from 'react'
import HstoraManager from './HstoraManager'
import Shopviaclone22Manager from './Shopviaclone22Manager'
import DigitalTopManager from './DigitalTopManager'
import ExchangeRateManager from './ExchangeRateManager'
import CloudflareCatalog from './CloudflareCatalog'
import SupplierAutomation from './SupplierAutomation'
import StorefrontDiscoveryManager from './StorefrontDiscoveryManager'
import { Server, TrendingUp, Layers, Cpu, DollarSign, Sparkles } from 'lucide-react'
import { cloudflareRequest } from '../lib/cloudflare-auth'

export type ApiManagerTab = 'server1' | 'server2' | 'server3' | 'server4' | 'exchange-rate' | 'pricing' | 'discovery'

interface ApiManagerProps {
  initialTab?: ApiManagerTab
  onComplete?: () => void
}

export default function ApiManager({ initialTab = 'server1', onComplete }: ApiManagerProps) {
  const [activeTab, setActiveTab] = useState<ApiManagerTab>(initialTab)
  const [hStatus, setHStatus] = useState<{ enabled: number; imported: number; last_status: string } | null>(null)
  const [s3Status, setS3Status] = useState<{ enabled: number; imported: number; in_stock: number; last_status: string } | null>(null)
  const [s4Status, setS4Status] = useState<{ enabled: number; imported: number; in_stock: number; last_status: string } | null>(null)

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab])

  // Load quick health badges for tab headers
  useEffect(() => {
    void cloudflareRequest<{ connection: { enabled: number; imported: number; last_status: string } | null }>('/api/admin/hstora')
      .then((res) => setHStatus(res.connection))
      .catch(() => {})

    void cloudflareRequest<{ connection: { enabled: number; imported: number; in_stock: number; last_status: string } | null }>('/api/admin/shopviaclone22')
      .then((res) => setS3Status(res.connection))
      .catch(() => {})

    void cloudflareRequest<{ connection: { enabled: number; imported: number; in_stock: number; last_status: string } | null }>('/api/admin/digitaltop')
      .then((res) => setS4Status(res.connection))
      .catch(() => {})
  }, [activeTab])

  return (
    <div className="api-manager-container" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Overview Header */}
      <div
        className="cf-panel"
        style={{
          padding: '20px 24px',
          borderRadius: 12,
          background: 'linear-gradient(135deg, rgba(249,115,22,0.06) 0%, rgba(59,130,246,0.04) 100%)',
          border: '1px solid var(--admin-border, #e2e8f0)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#f97316', fontWeight: 700, fontSize: '0.75rem', letterSpacing: '0.05em' }}>
              <Layers size={14} />
              SUPPLIER INTEGRATION & API MANAGER
            </div>
            <h1 style={{ margin: '4px 0 0', fontSize: '1.4rem', fontWeight: 800, color: 'var(--admin-text, #0f172a)' }}>
              API Manager & Supplier Controls
            </h1>
            <p style={{ margin: '4px 0 0', color: 'var(--admin-muted, #64748b)', fontSize: '0.875rem' }}>
              Configure endpoints, encrypted API credentials, synchronization schedules, and webhooks for all three LogsPoll supplier servers.
            </p>
          </div>
        </div>

        {/* Tab Navigation */}
        <div
          role="tablist"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            marginTop: 20,
            paddingTop: 16,
            borderTop: '1px solid var(--admin-border, #e2e8f0)',
          }}
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'server1'}
            onClick={() => setActiveTab('server1')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 8,
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'server1' ? '#f97316' : 'var(--admin-subtle, #f1f5f9)',
              color: activeTab === 'server1' ? '#ffffff' : 'var(--admin-text, #334155)',
              transition: 'all 0.15s ease',
            }}
          >
            <Server size={15} />
            <span>Server 1 · HStora</span>
            {hStatus && (
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 6px',
                  borderRadius: 10,
                  background: activeTab === 'server1' ? 'rgba(255,255,255,0.25)' : hStatus.enabled ? '#10b98120' : '#64748b20',
                  color: activeTab === 'server1' ? '#ffffff' : hStatus.enabled ? '#10b981' : '#64748b',
                  fontWeight: 700,
                }}
              >
                {hStatus.enabled ? 'ON' : 'OFF'}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'server2'}
            onClick={() => setActiveTab('server2')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 8,
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'server2' ? '#f97316' : 'var(--admin-subtle, #f1f5f9)',
              color: activeTab === 'server2' ? '#ffffff' : 'var(--admin-text, #334155)',
              transition: 'all 0.15s ease',
            }}
          >
            <Server size={15} />
            <span>Server 2 · YoungPG</span>
            <span
              style={{
                fontSize: '0.7rem',
                padding: '2px 6px',
                borderRadius: 10,
                background: activeTab === 'server2' ? 'rgba(255,255,255,0.25)' : '#10b98120',
                color: activeTab === 'server2' ? '#ffffff' : '#10b981',
                fontWeight: 700,
              }}
            >
              ACTIVE
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'server3'}
            onClick={() => setActiveTab('server3')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 8,
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'server3' ? '#f97316' : 'var(--admin-subtle, #f1f5f9)',
              color: activeTab === 'server3' ? '#ffffff' : 'var(--admin-text, #334155)',
              transition: 'all 0.15s ease',
            }}
          >
            <Server size={15} />
            <span>Server 3 · ShopViaClone22</span>
            {s3Status && (
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 6px',
                  borderRadius: 10,
                  background: activeTab === 'server3' ? 'rgba(255,255,255,0.25)' : s3Status.enabled ? '#10b98120' : '#64748b20',
                  color: activeTab === 'server3' ? '#ffffff' : s3Status.enabled ? '#10b981' : '#64748b',
                  fontWeight: 700,
                }}
              >
                {s3Status.enabled ? 'ON' : 'OFF'}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'server4'}
            onClick={() => setActiveTab('server4')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 8,
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'server4' ? '#f97316' : 'var(--admin-subtle, #f1f5f9)',
              color: activeTab === 'server4' ? '#ffffff' : 'var(--admin-text, #334155)',
              transition: 'all 0.15s ease',
            }}
          >
            <Cpu size={15} />
            <span>Server 4 · DigitalTop (AI Tools)</span>
            {s4Status && (
              <span
                style={{
                  fontSize: '0.7rem',
                  padding: '2px 6px',
                  borderRadius: 10,
                  background: activeTab === 'server4' ? 'rgba(255,255,255,0.25)' : s4Status.enabled ? '#10b98120' : '#64748b20',
                  color: activeTab === 'server4' ? '#ffffff' : s4Status.enabled ? '#10b981' : '#64748b',
                  fontWeight: 700,
                }}
              >
                {s4Status.enabled ? 'ON' : 'OFF'}
              </span>
            )}
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'exchange-rate'}
            onClick={() => setActiveTab('exchange-rate')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 8,
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'exchange-rate' ? '#f97316' : 'var(--admin-subtle, #f1f5f9)',
              color: activeTab === 'exchange-rate' ? '#ffffff' : 'var(--admin-text, #334155)',
              transition: 'all 0.15s ease',
            }}
          >
            <DollarSign size={15} />
            <span>Bybit P2P Dynamic FX Rates</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'pricing'}
            onClick={() => setActiveTab('pricing')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 8,
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'pricing' ? '#f97316' : 'var(--admin-subtle, #f1f5f9)',
              color: activeTab === 'pricing' ? '#ffffff' : 'var(--admin-text, #334155)',
              transition: 'all 0.15s ease',
            }}
          >
            <TrendingUp size={15} />
            <span>Global 50% Pricing & Automation</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'discovery'}
            onClick={() => setActiveTab('discovery')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 18px',
              borderRadius: 8,
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
              border: 'none',
              background: activeTab === 'discovery' ? '#f97316' : 'var(--admin-subtle, #f1f5f9)',
              color: activeTab === 'discovery' ? '#ffffff' : 'var(--admin-text, #334155)',
              transition: 'all 0.15s ease',
            }}
          >
            <Sparkles size={15} />
            <span>Storefront Discovery</span>
          </button>
        </div>
      </div>

      {/* Tab Panels */}
      {activeTab === 'server1' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <HstoraManager onComplete={onComplete} />
        </div>
      )}

      {activeTab === 'server2' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <CloudflareCatalog
            showHstora={false}
            onComplete={async () => {
              if (onComplete) onComplete()
            }}
          />
        </div>
      )}

      {activeTab === 'server3' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <Shopviaclone22Manager onComplete={onComplete} />
        </div>
      )}

      {activeTab === 'server4' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <DigitalTopManager onComplete={onComplete} />
        </div>
      )}

      {activeTab === 'exchange-rate' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <ExchangeRateManager />
        </div>
      )}

      {activeTab === 'pricing' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <SupplierAutomation />
        </div>
      )}

      {activeTab === 'discovery' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <StorefrontDiscoveryManager />
        </div>
      )}
    </div>
  )
}
