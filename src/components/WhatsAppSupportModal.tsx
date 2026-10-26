import React, { useState } from 'react'
import { MessageSquare, X, ExternalLink, ShieldCheck } from 'lucide-react'
import {
  buildWhatsAppMessage,
  buildWhatsAppUrl,
  sanitizeComplaint,
  useWhatsAppConfig
} from '../lib/whatsapp'

interface WhatsAppSupportModalProps {
  isOpen: boolean
  onClose: () => void
  orderReference?: string
  initialComplaint?: string
}

export function WhatsAppSupportModal({
  isOpen,
  onClose,
  orderReference,
  initialComplaint = ''
}: WhatsAppSupportModalProps) {
  const { whatsappNumber, displayPhone } = useWhatsAppConfig()
  const [complaint, setComplaint] = useState(initialComplaint)
  const [touched, setTouched] = useState(false)

  if (!isOpen) return null

  const cleanComplaint = complaint.trim()
  const sanitized = sanitizeComplaint(cleanComplaint)
  const previewMessage = buildWhatsAppMessage(
    sanitized || '[Your complaint will appear here]',
    orderReference
  )

  const handleLaunchWhatsApp = (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true)
    if (!cleanComplaint) return

    const url = buildWhatsAppUrl({
      phone: whatsappNumber,
      complaint: sanitized,
      orderReference
    })

    // Open WhatsApp in a new tab / native application
    window.open(url, '_blank', 'noopener,noreferrer')
    onClose()
  }

  return (
    <div
      className="whatsapp-modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="whatsapp-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="whatsapp-modal-card">
        {/* Header */}
        <div className="whatsapp-modal-header">
          <div className="whatsapp-header-brand">
            <span className="whatsapp-brand-badge" aria-hidden="true">
              <MessageSquare size={18} />
            </span>
            <div>
              <h2 id="whatsapp-modal-title">Contact Support on WhatsApp</h2>
              <span className="whatsapp-header-sub">
                Official Desk: <strong>{displayPhone}</strong>
              </span>
            </div>
          </div>
          <button
            type="button"
            className="whatsapp-close-btn"
            onClick={onClose}
            aria-label="Close WhatsApp support dialog"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleLaunchWhatsApp} className="whatsapp-modal-body">
          {orderReference && (
            <div className="whatsapp-order-callout">
              <span className="whatsapp-order-label">Linked Order Reference:</span>
              <strong className="whatsapp-order-ref">{orderReference}</strong>
            </div>
          )}

          <div className="whatsapp-form-group">
            <label htmlFor="whatsapp-complaint-input" className="whatsapp-label">
              Describe your complaint or inquiry
            </label>
            <textarea
              id="whatsapp-complaint-input"
              rows={4}
              required
              className="whatsapp-textarea"
              placeholder="Please explain what you need help with (e.g. payment confirmation, delivery question, or product assistance)..."
              value={complaint}
              onChange={(e) => setComplaint(e.target.value)}
              autoFocus
            />
            {touched && !cleanComplaint && (
              <span className="whatsapp-field-error">
                Please describe your complaint before opening WhatsApp.
              </span>
            )}
          </div>

          {/* Live Preview Box */}
          <div className="whatsapp-preview-box">
            <span className="whatsapp-preview-title">Message to be loaded in WhatsApp:</span>
            <pre className="whatsapp-preview-text">{previewMessage}</pre>
            <small className="whatsapp-preview-note">
              ✓ Loaded into your WhatsApp chat composer. You can review and edit before sending.
            </small>
          </div>

          <div className="whatsapp-security-notice">
            <ShieldCheck size={16} className="whatsapp-security-icon" />
            <span>
              For your safety, never include passwords, account credentials, or security PINs.
            </span>
          </div>

          {/* Footer Actions */}
          <div className="whatsapp-modal-footer">
            <button
              type="button"
              className="button button-outline whatsapp-cancel-btn"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="whatsapp-submit-btn"
              disabled={!cleanComplaint}
            >
              <ExternalLink size={16} />
              <span>Open in WhatsApp</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

