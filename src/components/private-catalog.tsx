import Link from "next/link";
import { ArrowRight } from "lucide-react";
function CatalogLock({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size * 1.15}
      viewBox="0 0 48 56"
      aria-hidden="true"
    >
      <path
        d="M13 24V15a11 11 0 0 1 22 0v9"
        fill="none"
        stroke="currentColor"
        strokeWidth="5"
      />
      <rect
        x="4"
        y="23"
        width="40"
        height="30"
        rx="5"
        fill="currentColor"
        stroke="white"
        strokeWidth="1.5"
      />
      <circle cx="24" cy="35" r="3.5" fill="white" />
      <path d="M24 38v6" stroke="white" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
export function PrivateCatalog() {
  return (
    <section className="reference-page private-catalog">
      <div className="private-intro">
        <span className="private-lock">
          <CatalogLock />
        </span>
        <h1>Private Catalog</h1>
        <p>
          Create an account to access our full range of digital products and
          services.
        </p>
        <Link href="/signup" className="button button-orange">
          Sign Up to Access Catalog
          <ArrowRight size={17} />
        </Link>
        <p className="auth-switch">
          Already have an account? <Link href="/login">Login</Link>
        </p>
      </div>
      <div className="locked-preview" aria-hidden="true">
        <span className="locked-heading" />
        <div className="locked-grid">
          {Array.from({ length: 9 }, (_, i) => (
            <div className="locked-item" key={i}>
              <div>
                <CatalogLock size={24} />
              </div>
              <span />
              <span />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
