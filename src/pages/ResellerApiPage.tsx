import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Key, Plus, Copy, Check, AlertTriangle, RefreshCw,
  ExternalLink, Trash2, RotateCw, Terminal, CheckCircle2,
  Wallet, Layers, ShoppingBag
} from 'lucide-react'
import { useAuth } from '../auth/AuthProvider'
import { useDashboard } from './DashboardContext'

interface ApiKeyItem {
  id: string
  key_prefix: string
  name: string
  scopes: string[]
  status: 'active' | 'revoked'
  last_used_at: number | null
  created_at: number
}

interface ApiKeysResponse {
  keys: ApiKeyItem[]
}

interface CreateKeyResponse {
  success: boolean
  key: string
  apiKey: ApiKeyItem
  message: string
}

export function ResellerApiPage() {
  const { session } = useAuth()
  const { showToast } = useDashboard()

  const [keys, setKeys] = useState<ApiKeyItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  // Create key modal & state
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [keyName, setKeyName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Revealed newly created / rotated key (one-time view)
  const [revealedKey, setRevealedKey] = useState<{ rawKey: string; keyPrefix: string; name: string } | null>(null)
  const [keyCopied, setKeyCopied] = useState(false)

  // Confirmation modals
  const [keyToRevoke, setKeyToRevoke] = useState<ApiKeyItem | null>(null)
  const [keyToRotate, setKeyToRotate] = useState<ApiKeyItem | null>(null)

  // Quickstart tab
  const [activeCodeTab, setActiveCodeTab] = useState<'curl' | 'javascript' | 'python'>('curl')
  const [codeCopied, setCodeCopied] = useState(false)

  const activeKeysCount = keys.filter(k => k.status === 'active').length

  const fetchKeys = useCallback(async (isRefresh = false) => {
    if (!session) return
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/account/api-keys', {
        credentials: 'same-origin',
        cache: 'no-store',
      })
      if (!res.ok) {
        const errJson = await res.json().catch(() => null)
        throw new Error(errJson?.error || errJson?.message || `Failed to fetch API keys (HTTP ${res.status})`)
      }
      const data: ApiKeysResponse = await res.json()
      setKeys(data.keys || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load API keys.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [session])

  useEffect(() => {
    void fetchKeys()
  }, [fetchKeys])

  const handleCreateKey = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setSubmitting(true)
    setError('')

    try {
      const res = await fetch('/api/account/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          name: keyName.trim() || 'Reseller API Key',
          scopes: ['read:catalog', 'orders:create', 'orders:read'],
        }),
      })

      const data: CreateKeyResponse = await res.json()
      if (!res.ok || !data.success) {
        throw new Error((data as unknown as { error?: string })?.error || data.message || 'Failed to create API key.')
      }

      setRevealedKey({
        rawKey: data.key,
        keyPrefix: data.apiKey.key_prefix,
        name: data.apiKey.name,
      })
      setShowCreateModal(false)
      setKeyName('')
      showToast('API key generated successfully!')
      void fetchKeys(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate API key.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRevokeKey = async () => {
    if (!keyToRevoke || submitting) return
    setSubmitting(true)

    try {
      const res = await fetch(`/api/account/api-keys?id=${encodeURIComponent(keyToRevoke.id)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data?.error || data?.message || 'Failed to revoke API key.')
      }

      showToast('API key revoked successfully.')
      setKeyToRevoke(null)
      void fetchKeys(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke API key.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleRotateKey = async () => {
    if (!keyToRotate || submitting) return
    setSubmitting(true)

    try {
      const res = await fetch('/api/account/api-keys/rotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ id: keyToRotate.id }),
      })
      const data: CreateKeyResponse = await res.json()
      if (!res.ok || !data.success) {
        throw new Error((data as unknown as { error?: string })?.error || data.message || 'Failed to rotate API key.')
      }

      setRevealedKey({
        rawKey: data.key,
        keyPrefix: data.apiKey.key_prefix,
        name: data.apiKey.name,
      })
      setKeyToRotate(null)
      showToast('API key rotated. Remember to copy your new key!')
      void fetchKeys(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to rotate API key.')
    } finally {
      setSubmitting(false)
    }
  }

  const copyToClipboard = (text: string, isSnippet = false) => {
    void navigator.clipboard.writeText(text)
    if (isSnippet) {
      setCodeCopied(true)
      setTimeout(() => setCodeCopied(false), 2000)
    } else {
      setKeyCopied(true)
      showToast('API key copied to clipboard!')
      setTimeout(() => setKeyCopied(false), 2000)
    }
  }

  const activeKeySample = revealedKey?.rawKey || (keys.find(k => k.status === 'active')?.key_prefix ?? 'lp_live_YOUR_API_KEY')

  const codeSnippets = {
    curl: `# 1. Query verified products
curl -s "https://logspoll.com/api/v1/products?availability=in-stock" \\
  -H "Accept: application/json"

# 2. Check your wallet balance
curl -s "https://logspoll.com/api/v1/wallet" \\
  -H "Authorization: Bearer ${activeKeySample}"

# 3. Create automated order using wallet balance
curl -s -X POST "https://logspoll.com/api/v1/orders" \\
  -H "Authorization: Bearer ${activeKeySample}" \\
  -H "Content-Type: application/json" \\
  -d '{"items":[{"product_id":"PRODUCT_UUID","quantity":1}]}'

# 4. Retrieve delivered account credentials
curl -s "https://logspoll.com/api/v1/orders?purchases=true" \\
  -H "Authorization: Bearer ${activeKeySample}"`,

    javascript: `// Reseller Automation using JavaScript / Node.js
const API_KEY = '${activeKeySample}';
const BASE_URL = 'https://logspoll.com/api/v1';

async function buyProduct(productId, quantity = 1) {
  // 1. Purchase directly with wallet balance
  const res = await fetch(\`\${BASE_URL}/orders\`, {
    method: 'POST',
    headers: {
      'Authorization': \`Bearer \${API_KEY}\`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      items: [{ product_id: productId, quantity }]
    })
  });

  const order = await res.json();
  console.log('Order created:', order.reference, 'Status:', order.payment_status);

  // 2. Fetch delivered credentials
  const vaultRes = await fetch(\`\${BASE_URL}/orders?purchases=true\`, {
    headers: { 'Authorization': \`Bearer \${API_KEY}\` }
  });
  const { records } = await vaultRes.json();
  console.log('Delivered credentials:', records[0]?.order_items[0]?.product_entitlements);
}`,

    python: `# Reseller Automation in Python
import requests

API_KEY = "${activeKeySample}"
BASE_URL = "https://logspoll.com/api/v1"
HEADERS = {
    "Authorization": f"Bearer {API_KEY}",
    "Content-Type": "application/json"
}

def purchase_account(product_id: str, qty: int = 1):
    # 1. Place order with funded wallet
    order_res = requests.post(
        f"{BASE_URL}/orders",
        headers=HEADERS,
        json={"items": [{"product_id": product_id, "quantity": qty}]}
    )
    order_data = order_res.json()
    print("Order status:", order_data.get("payment_status"))

    # 2. Get delivered product credentials
    vault_res = requests.get(f"{BASE_URL}/orders?purchases=true", headers=HEADERS)
    vault_data = vault_res.json()
    print("Credentials:", vault_data.get("records", [])[0]["order_items"][0]["product_entitlements"])
`
  }

  return (
    <div className="fintech-body" style={{ maxWidth: 1100, margin: '0 auto', paddingBottom: 60 }}>
      {/* Top Header Card */}
      <div className="fintech-card" style={{ marginBottom: 24, padding: '24px 28px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <div style={{
                background: 'rgba(16, 185, 129, 0.12)',
                color: '#10b981',
                padding: '8px 10px',
                borderRadius: 8,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}>
                <Key size={22} />
              </div>
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.02em' }}>
                Reseller API & Keys
              </h1>
              <span style={{
                background: 'var(--tag-bg, #f1f5f9)',
                color: 'var(--text-muted, #64748b)',
                fontSize: 12,
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: 12
              }}>
                v1.0 REST
              </span>
            </div>
            <p style={{ margin: 0, color: 'var(--text-muted, #64748b)', fontSize: 14, maxWidth: 640, lineHeight: 1.5 }}>
              Integrate LogsPoll directly into your reseller store, Telegram bot, or automation system.
              Generate high-entropy secret keys, query live stock across all servers, and fulfill orders directly using your wallet balance.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link
              to="/docs"
              className="fintech-btn-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 16px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                textDecoration: 'none'
              }}
            >
              <span>View API Docs</span>
              <ExternalLink size={15} />
            </Link>

            <button
              type="button"
              className="fintech-btn-primary"
              disabled={activeKeysCount >= 5}
              onClick={() => {
                setError('')
                setShowCreateModal(true)
              }}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 18px',
                borderRadius: 8,
                fontSize: 14,
                fontWeight: 600,
                cursor: activeKeysCount >= 5 ? 'not-allowed' : 'pointer',
                opacity: activeKeysCount >= 5 ? 0.6 : 1
              }}
            >
              <Plus size={16} />
              <span>Generate New Key</span>
            </button>
          </div>
        </div>

        {activeKeysCount >= 5 && (
          <div style={{
            marginTop: 16,
            background: 'rgba(234, 179, 8, 0.1)',
            border: '1px solid rgba(234, 179, 8, 0.3)',
            borderRadius: 8,
            padding: '10px 14px',
            fontSize: 13,
            color: '#b45309',
            display: 'flex',
            alignItems: 'center',
            gap: 8
          }}>
            <AlertTriangle size={16} />
            <span>Maximum limit of 5 active keys reached. Revoke an unused key before generating a new one.</span>
          </div>
        )}
      </div>

      {/* Error Banner */}
      {error && (
        <div style={{
          marginBottom: 20,
          background: 'rgba(239, 68, 68, 0.1)',
          border: '1px solid rgba(239, 68, 68, 0.3)',
          borderRadius: 8,
          padding: '12px 16px',
          color: '#ef4444',
          fontSize: 14,
          display: 'flex',
          alignItems: 'center',
          gap: 10
        }}>
          <AlertTriangle size={18} />
          <span style={{ flex: 1 }}>{error}</span>
          <button
            type="button"
            onClick={() => setError('')}
            style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: 16 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Newly Revealed Secret Key Banner */}
      {revealedKey && (
        <div style={{
          marginBottom: 24,
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.08) 0%, rgba(5, 150, 105, 0.14) 100%)',
          border: '1.5px solid #10b981',
          borderRadius: 12,
          padding: '20px 24px',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
            <div style={{
              background: '#10b981',
              color: '#fff',
              borderRadius: '50%',
              width: 24,
              height: 24,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
              marginTop: 2
            }}>
              <Check size={14} />
            </div>
            <div style={{ flex: 1 }}>
              <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700, color: '#065f46' }}>
                Your API Key is Ready ({revealedKey.name})
              </h3>
              <p style={{ margin: 0, fontSize: 13, color: '#047857' }}>
                Please copy your secret key now. For your security, <strong>it will never be displayed again</strong>.
                LogsPoll only stores a secure cryptographic SHA-256 hash in D1.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setRevealedKey(null)}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#065f46',
                cursor: 'pointer',
                fontSize: 18,
                lineHeight: 1
              }}
              title="Dismiss warning"
            >
              ✕
            </button>
          </div>

          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: 'var(--card-bg, #ffffff)',
            border: '1px solid #10b981',
            borderRadius: 8,
            padding: '8px 12px',
            marginTop: 8
          }}>
            <code style={{
              flex: 1,
              fontFamily: 'monospace',
              fontSize: 15,
              fontWeight: 600,
              color: '#047857',
              wordBreak: 'break-all'
            }}>
              {revealedKey.rawKey}
            </code>
            <button
              type="button"
              onClick={() => copyToClipboard(revealedKey.rawKey)}
              style={{
                background: keyCopied ? '#10b981' : '#059669',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                cursor: 'pointer',
                flexShrink: 0,
                transition: 'background 0.15s ease'
              }}
            >
              {keyCopied ? <Check size={14} /> : <Copy size={14} />}
              <span>{keyCopied ? 'Copied!' : 'Copy Key'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Grid: Keys List & Wallet Readiness */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 24, marginBottom: 24 }}>
        {/* Keys Table Card */}
        <div className="fintech-card" style={{ padding: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Active & Registered Keys</h2>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-muted, #64748b)' }}>
                {keys.length} total key{keys.length === 1 ? '' : 's'} registered ({activeKeysCount} active)
              </p>
            </div>
            <button
              type="button"
              onClick={() => void fetchKeys(true)}
              disabled={refreshing}
              className="fintech-btn-secondary"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                fontSize: 13,
                borderRadius: 6
              }}
              title="Refresh list"
            >
              <RefreshCw size={14} className={refreshing ? 'spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>

          {loading ? (
            <div style={{ padding: '40px 0', textAlign: 'center', color: 'var(--text-muted, #64748b)' }}>
              <RefreshCw size={24} className="spin" style={{ margin: '0 auto 12px' }} />
              <p style={{ margin: 0, fontSize: 14 }}>Loading your API keys...</p>
            </div>
          ) : keys.length === 0 ? (
            <div style={{
              padding: '48px 24px',
              textAlign: 'center',
              background: 'var(--bg-subtle, #f8fafc)',
              borderRadius: 10,
              border: '1px dashed var(--line, #e2e8f0)'
            }}>
              <Key size={36} style={{ color: 'var(--text-muted, #94a3b8)', margin: '0 auto 12px' }} />
              <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 600 }}>No API Keys Generated Yet</h3>
              <p style={{ margin: '0 auto 16px', fontSize: 13, color: 'var(--text-muted, #64748b)', maxWidth: 440 }}>
                Generate your first secret API key to automate stock lookups, embed LogsPoll products in your store, or build reseller bots.
              </p>
              <button
                type="button"
                className="fintech-btn-primary"
                onClick={() => setShowCreateModal(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '9px 18px',
                  borderRadius: 8,
                  fontSize: 14,
                  fontWeight: 600
                }}
              >
                <Plus size={16} />
                <span>Generate Your First Key</span>
              </button>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line, #e2e8f0)', color: 'var(--text-muted, #64748b)' }}>
                    <th style={{ padding: '10px 12px', fontWeight: 600 }}>Name & Prefix</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600 }}>Scopes</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600 }}>Created</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600 }}>Last Used</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600 }}>Status</th>
                    <th style={{ padding: '10px 12px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((k) => {
                    const isActive = k.status === 'active'
                    return (
                      <tr
                        key={k.id}
                        style={{
                          borderBottom: '1px solid var(--line, #f1f5f9)',
                          opacity: isActive ? 1 : 0.6,
                        }}
                      >
                        <td style={{ padding: '14px 12px' }}>
                          <div style={{ fontWeight: 600, color: 'var(--text-main, #0f172a)', marginBottom: 2 }}>
                            {k.name}
                          </div>
                          <code style={{
                            fontFamily: 'monospace',
                            fontSize: 12,
                            background: 'var(--tag-bg, #f1f5f9)',
                            padding: '2px 6px',
                            borderRadius: 4,
                            color: 'var(--text-muted, #475569)'
                          }}>
                            {k.key_prefix}
                          </code>
                        </td>

                        <td style={{ padding: '14px 12px' }}>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {k.scopes.map(s => (
                              <span
                                key={s}
                                style={{
                                  background: 'var(--tag-bg, #f1f5f9)',
                                  color: 'var(--text-muted, #475569)',
                                  fontSize: 11,
                                  fontWeight: 500,
                                  padding: '2px 6px',
                                  borderRadius: 4
                                }}
                              >
                                {s}
                              </span>
                            ))}
                          </div>
                        </td>

                        <td style={{ padding: '14px 12px', color: 'var(--text-muted, #64748b)', whiteSpace: 'nowrap' }}>
                          {new Date(k.created_at).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </td>

                        <td style={{ padding: '14px 12px', color: 'var(--text-muted, #64748b)', whiteSpace: 'nowrap' }}>
                          {k.last_used_at ? (
                            new Date(k.last_used_at).toLocaleDateString(undefined, {
                              month: 'short',
                              day: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit'
                            })
                          ) : (
                            <span style={{ fontStyle: 'italic', color: '#94a3b8' }}>Never</span>
                          )}
                        </td>

                        <td style={{ padding: '14px 12px' }}>
                          {isActive ? (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'rgba(16, 185, 129, 0.12)',
                              color: '#059669',
                              fontSize: 12,
                              fontWeight: 600,
                              padding: '3px 8px',
                              borderRadius: 12
                            }}>
                              <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} />
                              Active
                            </span>
                          ) : (
                            <span style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                              background: 'rgba(100, 116, 139, 0.12)',
                              color: '#64748b',
                              fontSize: 12,
                              fontWeight: 600,
                              padding: '3px 8px',
                              borderRadius: 12
                            }}>
                              Revoked
                            </span>
                          )}
                        </td>

                        <td style={{ padding: '14px 12px', textAlign: 'right' }}>
                          {isActive ? (
                            <div style={{ display: 'inline-flex', gap: 6 }}>
                              <button
                                type="button"
                                onClick={() => setKeyToRotate(k)}
                                className="fintech-btn-secondary"
                                style={{
                                  padding: '5px 9px',
                                  fontSize: 12,
                                  borderRadius: 6,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4
                                }}
                                title="Rotate this key"
                              >
                                <RotateCw size={13} />
                                <span>Rotate</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setKeyToRevoke(k)}
                                style={{
                                  padding: '5px 9px',
                                  fontSize: 12,
                                  borderRadius: 6,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  background: 'rgba(239, 68, 68, 0.08)',
                                  color: '#ef4444',
                                  border: '1px solid rgba(239, 68, 68, 0.2)',
                                  cursor: 'pointer'
                                }}
                                title="Revoke this key"
                              >
                                <Trash2 size={13} />
                                <span>Revoke</span>
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: 12, color: '#94a3b8' }}>Inactive</span>
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
      </div>

      {/* Reseller Workflow & Wallet Integration Notice */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: 20,
        marginBottom: 24
      }}>
        {/* Step 1: Wallet Funding */}
        <div className="fintech-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              background: 'rgba(59, 130, 246, 0.1)',
              color: '#3b82f6',
              padding: 8,
              borderRadius: 8
            }}>
              <Wallet size={20} />
            </div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>1. Fund Your Reseller Wallet</h3>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted, #64748b)', lineHeight: 1.5, flex: 1 }}>
            API orders are paid automatically from your wallet balance. Before deploying your bot or store integration, make sure your wallet is funded.
          </p>
          <Link
            to="/dashboard/wallet"
            className="fintech-btn-secondary"
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              textAlign: 'center',
              display: 'inline-block'
            }}
          >
            Manage Wallet Balance →
          </Link>
        </div>

        {/* Step 2: Query Live Catalog */}
        <div className="fintech-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              background: 'rgba(16, 185, 129, 0.1)',
              color: '#10b981',
              padding: 8,
              borderRadius: 8
            }}>
              <Layers size={20} />
            </div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>2. Query Available Catalog</h3>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted, #64748b)', lineHeight: 1.5, flex: 1 }}>
            Fetch live stock across Server 1 (HStora), Server 2 (ShopViaClone22), Server 3 (DigitalCore), and Server 4 (KoraStore) using <code>/api/v1/products</code>.
          </p>
          <Link
            to="/docs#products"
            className="fintech-btn-secondary"
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              textAlign: 'center',
              display: 'inline-block'
            }}
          >
            Catalog Docs →
          </Link>
        </div>

        {/* Step 3: Instant Fulfillment */}
        <div className="fintech-card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              background: 'rgba(168, 85, 247, 0.1)',
              color: '#a855f7',
              padding: 8,
              borderRadius: 8
            }}>
              <ShoppingBag size={20} />
            </div>
            <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>3. Instant Delivery to Your Bot</h3>
          </div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted, #64748b)', lineHeight: 1.5, flex: 1 }}>
            Post orders to <code>/api/v1/orders</code> and retrieve decrypted account credentials instantly via <code>/api/v1/orders?purchases=true</code>.
          </p>
          <Link
            to="/docs#orders"
            className="fintech-btn-secondary"
            style={{
              padding: '8px 14px',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'none',
              textAlign: 'center',
              display: 'inline-block'
            }}
          >
            Fulfillment Docs →
          </Link>
        </div>
      </div>

      {/* Interactive Quickstart Code Snippets Card */}
      <div className="fintech-card" style={{ padding: '24px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Terminal size={20} style={{ color: 'var(--text-muted, #64748b)' }} />
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Reseller Quickstart Examples</h3>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {/* Language Switcher */}
            <div style={{
              display: 'flex',
              background: 'var(--bg-subtle, #f1f5f9)',
              borderRadius: 6,
              padding: 2
            }}>
              {(['curl', 'javascript', 'python'] as const).map(tab => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveCodeTab(tab)}
                  style={{
                    background: activeCodeTab === tab ? 'var(--card-bg, #ffffff)' : 'transparent',
                    color: activeCodeTab === tab ? 'var(--text-main, #0f172a)' : 'var(--text-muted, #64748b)',
                    border: 'none',
                    borderRadius: 4,
                    padding: '4px 10px',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: activeCodeTab === tab ? '0 1px 3px rgba(0,0,0,0.08)' : 'none'
                  }}
                >
                  {tab === 'curl' ? 'cURL' : tab === 'javascript' ? 'JavaScript' : 'Python'}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => copyToClipboard(codeSnippets[activeCodeTab], true)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                background: 'var(--bg-subtle, #f1f5f9)',
                border: '1px solid var(--line, #e2e8f0)',
                color: 'var(--text-main, #0f172a)',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer'
              }}
            >
              {codeCopied ? <Check size={13} style={{ color: '#10b981' }} /> : <Copy size={13} />}
              <span>{codeCopied ? 'Copied' : 'Copy'}</span>
            </button>
          </div>
        </div>

        <pre style={{
          margin: 0,
          background: '#090d16',
          color: '#e2e8f0',
          padding: '16px 20px',
          borderRadius: 8,
          fontSize: 13,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
          overflowX: 'auto',
          lineHeight: 1.6
        }}>
          <code>{codeSnippets[activeCodeTab]}</code>
        </pre>
      </div>

      {/* Generate API Key Modal */}
      {showCreateModal && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          zIndex: 9999
        }}>
          <div style={{
            background: 'var(--card-bg, #ffffff)',
            borderRadius: 12,
            padding: '24px 28px',
            maxWidth: 480,
            width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Generate Reseller API Key</h3>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                style={{ background: 'none', border: 'none', fontSize: 18, cursor: 'pointer', color: 'var(--text-muted, #64748b)' }}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateKey}>
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                  Key Name / Description (Optional)
                </label>
                <input
                  type="text"
                  placeholder="e.g. Telegram Reseller Bot or WooCommerce Store"
                  value={keyName}
                  onChange={(e) => setKeyName(e.target.value)}
                  maxLength={60}
                  style={{
                    width: '100%',
                    padding: '10px 12px',
                    borderRadius: 8,
                    border: '1px solid var(--line, #cbd5e1)',
                    background: 'var(--input-bg, #ffffff)',
                    color: 'var(--text-main, #0f172a)',
                    fontSize: 14,
                    boxSizing: 'border-box'
                  }}
                />
                <span style={{ display: 'block', fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 4 }}>
                  Use a recognizable name to track where this key is integrated.
                </span>
              </div>

              <div style={{
                background: 'var(--bg-subtle, #f8fafc)',
                border: '1px solid var(--line, #e2e8f0)',
                borderRadius: 8,
                padding: '12px 14px',
                marginBottom: 20
              }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted, #475569)', marginBottom: 6 }}>
                  Default Scopes Assigned:
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#059669' }}>
                    <CheckCircle2 size={13} />
                    <span><code>read:catalog</code> — Query products and stock availability</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#059669' }}>
                    <CheckCircle2 size={13} />
                    <span><code>orders:create</code> — Create automated orders with wallet</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#059669' }}>
                    <CheckCircle2 size={13} />
                    <span><code>orders:read</code> — Access receipts and delivery credentials</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="fintech-btn-secondary"
                  style={{ padding: '8px 16px', borderRadius: 8, fontSize: 14 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="fintech-btn-primary"
                  style={{
                    padding: '8px 20px',
                    borderRadius: 8,
                    fontSize: 14,
                    fontWeight: 600,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6
                  }}
                >
                  {submitting ? <RefreshCw size={14} className="spin" /> : <Key size={14} />}
                  <span>{submitting ? 'Generating...' : 'Generate Key'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Revoke Key Confirmation Modal */}
      {keyToRevoke && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          zIndex: 9999
        }}>
          <div style={{
            background: 'var(--card-bg, #ffffff)',
            borderRadius: 12,
            padding: '24px 28px',
            maxWidth: 440,
            width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#ef4444', marginBottom: 12 }}>
              <AlertTriangle size={24} />
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Revoke API Key?</h3>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-muted, #64748b)', margin: '0 0 16px', lineHeight: 1.5 }}>
              Are you sure you want to revoke <strong>{keyToRevoke.name}</strong> ({keyToRevoke.key_prefix})?
              Any applications, bots, or scripts using this key will immediately be rejected with <code>401 Unauthorized</code>.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setKeyToRevoke(null)}
                className="fintech-btn-secondary"
                style={{ padding: '8px 16px', borderRadius: 8, fontSize: 14 }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleRevokeKey}
                style={{
                  background: '#ef4444',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 8,
                  padding: '8px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                {submitting ? <RefreshCw size={14} className="spin" /> : <Trash2 size={14} />}
                <span>{submitting ? 'Revoking...' : 'Yes, Revoke Key'}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rotate Key Confirmation Modal */}
      {keyToRotate && (
        <div style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.6)',
          backdropFilter: 'blur(3px)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 16,
          zIndex: 9999
        }}>
          <div style={{
            background: 'var(--card-bg, #ffffff)',
            borderRadius: 12,
            padding: '24px 28px',
            maxWidth: 440,
            width: '100%',
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.2)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: '#059669', marginBottom: 12 }}>
              <RotateCw size={24} />
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>Rotate API Key?</h3>
            </div>
            <p style={{ fontSize: 14, color: 'var(--text-muted, #64748b)', margin: '0 0 16px', lineHeight: 1.5 }}>
              Rotating <strong>{keyToRotate.name}</strong> will immediately revoke the existing key and issue a new secret key.
              You will need to update your application or bot with the replacement key.
            </p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
              <button
                type="button"
                onClick={() => setKeyToRotate(null)}
                className="fintech-btn-secondary"
                style={{ padding: '8px 16px', borderRadius: 8, fontSize: 14 }}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={submitting}
                onClick={handleRotateKey}
                className="fintech-btn-primary"
                style={{
                  borderRadius: 8,
                  padding: '8px 18px',
                  fontSize: 14,
                  fontWeight: 600,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6
                }}
              >
                {submitting ? <RefreshCw size={14} className="spin" /> : <RotateCw size={14} />}
                <span>{submitting ? 'Rotating...' : 'Rotate Key'}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
