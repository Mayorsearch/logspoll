import { Lock, ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'

interface PrivateCatalogGateProps {
  onUnlockPreview?: () => void
  showExploreOption?: boolean
}

export function PrivateCatalogGate({ onUnlockPreview, showExploreOption }: PrivateCatalogGateProps) {
  return (
    <div className="private-catalog-gate">
      {/* Orange Squircle Lock */}
      <div className="catalog-lock-squircle" aria-hidden="true">
        <Lock size={32} strokeWidth={2.4} />
      </div>

      <h1 className="catalog-gate-title">Private Catalog</h1>
      <p className="catalog-gate-subtitle">
        Create an account to access our full range of digital products and services.
      </p>

      <div className="catalog-gate-actions">
        <Link to="/signup" className="button catalog-gate-primary-btn">
          Sign Up to Access Catalog <ArrowRight size={17} />
        </Link>
        <p className="catalog-gate-login-prompt">
          Already have an account? <Link to="/login">Login</Link>
        </p>
      </div>

      {/* Locked Preview Cards Teaser (Screen 3 Reference) */}
      <div className="catalog-locked-grid" aria-hidden="true">
        {[1, 2, 3, 4, 5, 6].map((idx) => (
          <div key={idx} className="locked-preview-card">
            <span className="locked-card-icon">
              <Lock size={15} />
            </span>
            <div className="locked-card-skeleton-long" />
            <div className="locked-card-skeleton-short" />
          </div>
        ))}
      </div>

      {showExploreOption && (
        <div className="catalog-gate-explore-row">
          <button 
            type="button" 
            className="catalog-explore-btn" 
            onClick={onUnlockPreview}
          >
            Explore Public Preview Below ↓
          </button>
        </div>
      )}
    </div>
  )
}
