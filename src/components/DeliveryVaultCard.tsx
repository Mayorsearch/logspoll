import React, { useState } from 'react'
import {
  Copy,
  Check,
  Eye,
  EyeOff,
  Download,
  Key,
  Lock,
  Mail,
  User,
  Shield,
  FileText,
  Globe,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  Info,
  ExternalLink,
} from 'lucide-react'
import type {
  StructuredProductDelivery,
  StructuredAccountCard,
  StructuredCredentialField,
  CredentialFieldType,
} from '../lib/delivery-parser'
import { parseDeliveryCredentials } from '../lib/delivery-parser'

interface DeliveryVaultCardProps {
  structured?: StructuredProductDelivery | null
  rawInstructions: string
  productName: string
  categoryName?: string
  orderRef?: string
  orderId?: string
}

function getFieldIcon(label: string, fieldType?: CredentialFieldType) {
  const l = label.toLowerCase()
  if (fieldType === 'email' || l.includes('email') || l.includes('mail')) return Mail
  if (fieldType === 'password' || l.includes('password') || l.includes('pass')) return Lock
  if (fieldType === 'two_factor' || l.includes('2fa') || l.includes('two-factor') || l.includes('authenticator')) return Shield
  if (fieldType === 'username' || l.includes('user') || l.includes('login') || l.includes('id')) return User
  if (fieldType === 'license_key' || l.includes('key') || l.includes('code') || l.includes('license')) return Key
  if (fieldType === 'token' || l.includes('token') || l.includes('session')) return FileText
  if (fieldType === 'activation_url' || l.includes('url') || l.includes('link') || l.includes('server')) return Globe
  return FileText
}

function SingleCredentialRow({ field }: { field: StructuredCredentialField }) {
  const [revealed, setRevealed] = useState(!field.isSensitive)
  const [copied, setCopied] = useState(false)
  const Icon = getFieldIcon(field.label, field.type)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    void navigator.clipboard.writeText(field.value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isUrl = /^https?:\/\//i.test(field.value)

  return (
    <div className="vault-credential-row">
      <div className="vault-field-meta">
        <Icon size={14} className="vault-field-icon" />
        <span className="vault-field-label">{field.label}</span>
      </div>

      <div className="vault-field-content">
        <div className="vault-field-value-box">
          {field.isSensitive && !revealed ? (
            <span className="vault-field-masked" aria-label="Hidden sensitive credential">
              ••••••••••••••••••••
            </span>
          ) : isUrl ? (
            <a
              href={field.value}
              target="_blank"
              rel="noopener noreferrer"
              className="vault-field-url"
              title="Open link in new window"
            >
              <span>{field.value}</span>
              <ExternalLink size={12} className="inline-icon" />
            </a>
          ) : (
            <code className="vault-field-value">{field.value}</code>
          )}
        </div>

        <div className="vault-field-actions">
          {field.isSensitive && (
            <button
              type="button"
              className="vault-icon-btn"
              onClick={() => setRevealed((v) => !v)}
              title={revealed ? 'Hide credential' : 'Show credential'}
              aria-label={revealed ? `Hide ${field.label}` : `Show ${field.label}`}
            >
              {revealed ? <EyeOff size={14} /> : <Eye size={14} />}
              <span className="sr-only">{revealed ? 'Hide' : 'Show'}</span>
            </button>
          )}

          <button
            type="button"
            className={`vault-copy-btn ${copied ? 'copied' : ''}`}
            onClick={handleCopy}
            title={`Copy ${field.label}`}
            aria-label={`Copy ${field.label}`}
          >
            {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
            <span>{copied ? 'Copied' : 'Copy'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}

function AccountCardBlock({
  card,
  index,
  total,
  productName,
  orderRef,
}: {
  card: StructuredAccountCard
  index: number
  total: number
  productName: string
  orderRef?: string
}) {
  const [copiedAll, setCopiedAll] = useState(false)

  const handleCopyCard = () => {
    const formatted = [
      `Product: ${productName}`,
      orderRef ? `Order: ${orderRef}` : '',
      total > 1 ? `Account #${index + 1}` : '',
      '----------------------------------------',
      ...card.fields.map((f) => `${f.label}: ${f.value}`),
      '----------------------------------------',
      'Delivered securely by LogsPoll (https://logspoll.com)',
    ]
      .filter(Boolean)
      .join('\n')

    void navigator.clipboard.writeText(formatted)
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 2000)
  }

  return (
    <div className="vault-account-card">
      <div className="vault-account-header">
        <div className="vault-account-title-group">
          <span className="vault-account-badge">
            {total > 1 ? `ACCOUNT #${index + 1}` : 'CREDENTIALS & ACCESS'}
          </span>
          {card.title && card.title !== `Account #${index + 1}` && (
            <span className="vault-account-subhead">{card.title}</span>
          )}
        </div>

        <button
          type="button"
          className={`vault-card-action-btn ${copiedAll ? 'copied' : ''}`}
          onClick={handleCopyCard}
          title="Copy this account's details"
        >
          {copiedAll ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
          <span>{copiedAll ? 'Account Copied' : 'Copy Account'}</span>
        </button>
      </div>

      <div className="vault-fields-grid">
        {card.fields.map((field, fIdx) => (
          <SingleCredentialRow key={`${field.label}-${fIdx}`} field={field} />
        ))}
      </div>
    </div>
  )
}

export function DeliveryVaultCard({
  structured,
  rawInstructions,
  productName,
  categoryName,
  orderRef,
  orderId,
}: DeliveryVaultCardProps) {
  const [showGuide, setShowGuide] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const [copiedAll, setCopiedAll] = useState(false)

  // Dynamically parse if structured wasn't pre-computed
  const deliveryData =
    structured ?? parseDeliveryCredentials(rawInstructions, productName, categoryName)

  const handleCopyAll = () => {
    const lines: string[] = [
      '========================================',
      'LOGSPOLL DIGITAL DELIVERY VAULT',
      '========================================',
      `Product: ${productName}`,
      orderRef ? `Order Reference: ${orderRef}` : '',
      `Delivered: ${new Date().toISOString()}`,
      '----------------------------------------',
    ]

    deliveryData.accounts.forEach((card, idx) => {
      if (deliveryData.accounts.length > 1) {
        lines.push(`\n[ACCOUNT #${idx + 1}]`)
      }
      card.fields.forEach((f) => {
        lines.push(`${f.label}: ${f.value}`)
      })
    })

    lines.push('----------------------------------------')
    lines.push('Keep confidential. Delivered securely by LogsPoll (https://logspoll.com).')
    lines.push('========================================')

    void navigator.clipboard.writeText(lines.join('\n'))
    setCopiedAll(true)
    setTimeout(() => setCopiedAll(false), 2000)
  }

  const handleDownload = () => {
    const lines: string[] = [
      '========================================',
      'LOGSPOLL DIGITAL DELIVERY VAULT',
      '========================================',
      `Product: ${productName}`,
      orderRef ? `Order Reference: ${orderRef}` : '',
      orderId ? `Order ID: ${orderId}` : '',
      `Delivered: ${new Date().toISOString()}`,
      '----------------------------------------',
      'CREDENTIALS / ACCESS INSTRUCTIONS:',
    ]

    deliveryData.accounts.forEach((card, idx) => {
      if (deliveryData.accounts.length > 1) {
        lines.push(`\n--- ACCOUNT #${idx + 1} ---`)
      }
      card.fields.forEach((f) => {
        lines.push(`${f.label}: ${f.value}`)
      })
    })

    if (deliveryData.instructions && deliveryData.instructions.length > 0) {
      lines.push('\n----------------------------------------')
      lines.push('USAGE & ACTIVATION GUIDE:')
      deliveryData.instructions.forEach((inst, i) => {
        lines.push(`${i + 1}. ${inst}`)
      })
    }

    lines.push('----------------------------------------')
    lines.push('Keep this information confidential.')
    lines.push('Support: https://logspoll.com/support')
    lines.push('Delivered securely by LogsPoll (https://logspoll.com).')
    lines.push('========================================')

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${(orderRef || 'logspoll-delivery').toLowerCase()}-credentials.txt`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="delivery-vault-container">
      {/* Top Bar with Title and Actions */}
      <div className="vault-top-bar">
        <div className="vault-title-group">
          <div className="vault-shield-icon-box">
            <Shield size={18} />
          </div>
          <div>
            <h4 className="vault-main-title">Digital Delivery Vault</h4>
            <span className="vault-subtitle">
              {deliveryData.accounts.length > 1
                ? `${deliveryData.accounts.length} Accounts Delivered · Verified Access`
                : 'Verified Secure Access · Sensitive details masked by default'}
            </span>
          </div>
        </div>

        <div className="vault-header-actions">
          {deliveryData.instructions && deliveryData.instructions.length > 0 && (
            <button
              type="button"
              className={`vault-header-btn ${showGuide ? 'active' : ''}`}
              onClick={() => setShowGuide((v) => !v)}
              title="Step-by-step usage instructions"
            >
              <Info size={14} />
              <span>{showGuide ? 'Hide Guide' : 'Usage Guide'}</span>
            </button>
          )}

          <button
            type="button"
            className="vault-header-btn"
            onClick={handleDownload}
            title="Download confidential credentials file"
          >
            <Download size={14} />
            <span>Download .txt</span>
          </button>

          <button
            type="button"
            className={`vault-header-btn primary ${copiedAll ? 'copied' : ''}`}
            onClick={handleCopyAll}
            title="Copy all delivery details to clipboard"
          >
            {copiedAll ? <Check size={14} className="text-white" /> : <Copy size={14} />}
            <span>{copiedAll ? 'All Copied!' : 'Copy All'}</span>
          </button>
        </div>
      </div>

      {/* Ambiguous Format Warning Banner */}
      {deliveryData.isAmbiguous && (
        <div className="vault-warning-banner" role="alert">
          <AlertTriangle size={16} className="vault-warning-icon" />
          <div className="vault-warning-text">
            <strong>Custom Supplier Delivery Format:</strong>
            <span>
              Credentials delivered in custom format. The original content has been preserved below without mislabeling.
            </span>
          </div>
        </div>
      )}

      {/* Usage Guide Accordion Box */}
      {showGuide && deliveryData.instructions && deliveryData.instructions.length > 0 && (
        <div className="vault-guide-box">
          <div className="vault-guide-header">
            <Info size={15} className="text-orange-500" />
            <h5>How to Use Your Purchased {deliveryData.platformName.toUpperCase()} Account</h5>
          </div>
          <ol className="vault-guide-steps">
            {deliveryData.instructions.map((step, idx) => (
              <li key={idx}>
                <span className="step-number">{idx + 1}</span>
                <span className="step-text">{step}</span>
              </li>
            ))}
          </ol>
          <div className="vault-guide-footer">
            <small>
              🔒 For maximum security, always access accounts from clean browser profiles or residential proxies. Never share credentials.
            </small>
          </div>
        </div>
      )}

      {/* Account Cards */}
      <div className="vault-account-cards-list">
        {deliveryData.accounts.map((card, idx) => (
          <AccountCardBlock
            key={card.title || idx}
            card={card}
            index={idx}
            total={deliveryData.accounts.length}
            productName={productName}
            orderRef={orderRef}
          />
        ))}
      </div>

      {/* Raw Fallback Toggle (Always available for advanced users/transparency) */}
      <div className="vault-raw-toggle-row">
        <button
          type="button"
          className="vault-raw-toggle-btn"
          onClick={() => setShowRaw((v) => !v)}
        >
          <span>{showRaw ? 'Hide Original Supplier Text' : 'View Original Supplier Raw Text'}</span>
          {showRaw ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        </button>
      </div>

      {showRaw && (
        <div className="vault-raw-box">
          <pre className="vault-raw-pre">{rawInstructions}</pre>
        </div>
      )}
    </div>
  )
}
