import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageCircle, X, HelpCircle, FileText, Send, ShieldCheck, MessageSquare } from 'lucide-react'
import { WhatsAppSupportModal } from './WhatsAppSupportModal'
import { useWhatsAppConfig } from '../lib/whatsapp'

export function FloatingChatWidget() {
  const [open, setOpen] = useState(false)
  const [whatsAppOpen, setWhatsAppOpen] = useState(false)
  const { displayPhone } = useWhatsAppConfig()

  return (
    <>
      <aside className="floating-chat-container" aria-label="Customer Live Support Widget">
        {open && (
          <div className="floating-chat-card" role="dialog" aria-modal="true" aria-labelledby="chat-title">
            <div className="floating-chat-header">
              <div className="chat-header-info">
                <span className="chat-avatar-badge">
                  <ShieldCheck size={18} />
                </span>
                <div>
                  <h3 id="chat-title">LogsPoll Support</h3>
                  <span className="chat-status-indicator">
                    <span className="status-dot"></span> Official Support Desk
                  </span>
                </div>
              </div>
              <button 
                type="button" 
                onClick={() => setOpen(false)} 
                className="chat-close-btn" 
                aria-label="Close support modal"
              >
                <X size={18} />
              </button>
            </div>

            <div className="floating-chat-body">
              <p className="chat-intro">
                Need assistance with an order, account verification, or API integration? We are here for you.
              </p>

              <div className="chat-actions-list">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    setWhatsAppOpen(true)
                  }}
                  className="chat-action-item"
                  style={{ textAlign: 'left', width: '100%', cursor: 'pointer', font: 'inherit' }}
                >
                  <div className="chat-action-icon green" style={{ background: '#25D36620', color: '#25D366' }}>
                    <MessageSquare size={18} />
                  </div>
                  <div className="chat-action-text">
                    <strong style={{ color: '#128C7E' }}>Contact Support on WhatsApp</strong>
                    <small>Direct desk at {displayPhone} · Instant chat</small>
                  </div>
                </button>

                <Link 
                  to="/support" 
                  onClick={() => setOpen(false)}
                  className="chat-action-item"
                >
                  <div className="chat-action-icon blue">
                    <Send size={18} />
                  </div>
                  <div className="chat-action-text">
                    <strong>Submit Support Ticket</strong>
                    <small>Get authoritative assistance from our team</small>
                  </div>
                </Link>

                <Link 
                  to="/faq" 
                  onClick={() => setOpen(false)}
                  className="chat-action-item"
                >
                  <div className="chat-action-icon orange">
                    <HelpCircle size={18} />
                  </div>
                  <div className="chat-action-text">
                    <strong>Browse FAQs</strong>
                    <small>Instant answers to common questions</small>
                  </div>
                </Link>

                <Link 
                  to="/docs" 
                  onClick={() => setOpen(false)}
                  className="chat-action-item"
                >
                  <div className="chat-action-icon green">
                    <FileText size={18} />
                  </div>
                  <div className="chat-action-text">
                    <strong>Developer Documentation</strong>
                    <small>Integrate with our REST API &amp; webhooks</small>
                  </div>
                </Link>
              </div>
            </div>

            <div className="floating-chat-footer">
              <small>Built by SwiftNova Labs · Production Monitored</small>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="floating-chat-trigger"
          aria-label={open ? 'Close customer support' : 'Open customer support'}
          aria-expanded={open}
        >
          {open ? <X size={24} /> : <MessageCircle size={24} />}
          <span className="chat-pulse-ring"></span>
        </button>
      </aside>

      <WhatsAppSupportModal
        isOpen={whatsAppOpen}
        onClose={() => setWhatsAppOpen(false)}
      />
    </>
  )
}
