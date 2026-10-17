import { useState } from 'react'
import { Link } from 'react-router-dom'
import { MessageCircle, X, HelpCircle, FileText, Send, ShieldCheck } from 'lucide-react'

export function FloatingChatWidget() {
  const [open, setOpen] = useState(false)

  return (
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
                  <span className="status-dot"></span> Online &amp; Ready to Help
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
            <small>Built by SwiftNova Labs · 24/7 Monitored</small>
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
  )
}

