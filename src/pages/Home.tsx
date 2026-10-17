import { 
  ArrowRight, ShieldCheck, ShoppingBag, PackageCheck, Zap, 
  Layers, Search, CheckCircle2, ChevronDown, Lock, Sparkles
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Reviews } from '../components/Reviews'
import { HomeCategories as Categories } from '../components/HomeCategories'
import '../homepage.css'

export function Home() {
  return (
    <div className="reference-home">
      {/* Hero Section */}
      <section className="private-access-hero" aria-labelledby="home-title">
        <div className="private-access-copy">
          <span className="private-access-badge">
            <Sparkles size={16} /> VERIFIED DIGITAL MARKETPLACE
          </span>
          <h1 id="home-title">
            Your Marketplace for<br />
            <span>Digital Essentials</span>
          </h1>
          <p>
            Explore a growing collection of digital products, services, and tools in one convenient marketplace. 
            Organized across verified server tiers for seamless discovery, reliable purchasing, and private fulfillment.
          </p>
          <div className="hero-button-group">
            <Link className="button private-access-button" to="/marketplace">
              Explore Marketplace <ArrowRight size={19} />
            </Link>
            <Link className="button button-outline home-explore" to="/signup">
              Get Started
            </Link>
          </div>
          <div className="hero-trust-indicators">
            <span><CheckCircle2 size={15} /> Real-time Stock</span>
            <span><CheckCircle2 size={15} /> Secure Bachs Settlement</span>
            <span><CheckCircle2 size={15} /> Authenticated Access</span>
          </div>
        </div>

        <div className="private-access-art" aria-hidden="true">
          <img 
            src="/images/private-services.webp" 
            alt="LogsPoll digital marketplace" 
            width={900} 
            height={1125} 
            fetchPriority="high" 
            decoding="async" 
          />
          <span className="service-float service-float-vpn">
            <ShieldCheck size={26} />
            <small>VPN</small>
          </span>
          <span className="service-float service-float-instagram">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="3" width="18" height="18" rx="5" />
              <circle cx="12" cy="12" r="4" />
              <circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" />
            </svg>
          </span>
          <span className="service-float service-float-facebook">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="currentColor">
              <path d="M14 21v-8h3l.5-4H14V7c0-1 .3-2 2-2h2V1.5A24 24 0 0 0 15 1c-3 0-5 2-5 5v3H7v4h3v8z" />
            </svg>
          </span>
        </div>
      </section>

      {/* Product Categories Section (Unified across all 3 servers) */}
      <section className="container section home-categories" id="categories-section">
        <div className="reference-section-heading">
          <div>
            <span className="eyebrow">UNIFIED PRODUCT DIRECTORY</span>
            <h2>Browse by Category</h2>
          </div>
          <p>
            All products belonging to the same category appear together regardless of server origin.
          </p>
        </div>
        <Categories />
      </section>

      {/* Why Choose LogsPoll */}
      <section className="container section home-features">
        <div className="reference-section-heading">
          <div>
            <span className="eyebrow">PLATFORM EXCELLENCE</span>
            <h2>Why Choose LogsPoll?</h2>
          </div>
          <p>Built for reliability, absolute customer privacy, and clean digital operations.</p>
        </div>

        <div className="reference-features">
          <article className="feature-wide feature-dark">
            <span className="feature-icon"><Zap size={24} /></span>
            <h3>Unified Multi-Server Architecture</h3>
            <p>
              Browse digital essentials organized into logical server tiers (Server 1, Server 2, and Server 3). 
              Compare prices and inventory across servers within the exact same category.
            </p>
          </article>

          <article>
            <span className="feature-icon status-green"><ShieldCheck size={24} /></span>
            <h3>Verified Inventory Only</h3>
            <p>
              Stock counts reflect authoritative real-time availability. Out-of-stock items are clearly marked 
              to prevent failed orders.
            </p>
          </article>

          <article>
            <span className="feature-icon"><Lock size={24} /></span>
            <h3>Private Fulfillment Vault</h3>
            <p>
              Account credentials and delivery instructions are stored securely and revealed only to authenticated 
              buyers after payment confirmation.
            </p>
          </article>

          <article className="feature-wide feature-team">
            <span className="feature-icon"><Layers size={24} /></span>
            <h3>Developer &amp; API Ready</h3>
            <p>
              Integrate LogsPoll into your own systems using our official REST API, signed webhooks, 
              and developer documentation at <code>/docs</code>.
            </p>
          </article>
        </div>
      </section>

      {/* How LogsPoll Works (3 steps) */}
      <section className="reference-how">
        <div className="container">
          <div className="reference-section-heading centered">
            <span className="eyebrow white">SIMPLE THREE-STEP WORKFLOW</span>
            <h2>How LogsPoll Works</h2>
            <p>A streamlined experience from browsing to accessing your digital goods.</p>
          </div>

          <div className="reference-steps">
            <article>
              <div className="step-number">01</div>
              <span className="feature-icon"><Search size={28} /></span>
              <h3>1. Explore Products</h3>
              <p>Browse by category or server tier. Compare verified prices and check stock availability.</p>
            </article>

            <article>
              <div className="step-number">02</div>
              <span className="feature-icon"><ShoppingBag size={28} /></span>
              <h3>2. Complete Checkout</h3>
              <p>Add items to your cart and complete your transaction securely via Bachs Payment Gateway in NGN.</p>
            </article>

            <article>
              <div className="step-number">03</div>
              <span className="feature-icon"><PackageCheck size={28} /></span>
              <h3>3. Access Your Order</h3>
              <p>Receive order updates via email and access your purchased digital credentials directly in your dashboard.</p>
            </article>
          </div>
        </div>
      </section>

      {/* Logical Server Architecture Showcase (Server 1, Server 2, Server 3) */}
      <section className="container section home-servers">
        <div className="reference-section-heading">
          <div>
            <span className="eyebrow">HIGH-PERFORMANCE INFRASTRUCTURE</span>
            <h2>Logical Server Network</h2>
          </div>
          <p>
            LogsPoll coordinates products across three distinct logical server tiers to guarantee inventory diversity and high availability.
          </p>
        </div>

        <div className="server-cards">
          <article className="server-card">
            <div className="server-card-badge server-badge-1">Server 1</div>
            <h3>Server 1</h3>
            <p>
              Premium digital accounts and verified tools. Features rigorous authorization and dedicated fulfillment pathways.
            </p>
            <div className="server-card-footer">
              <Link to="/marketplace?server=1" className="text-link">
                View Server 1 Products <ArrowRight size={14} />
              </Link>
            </div>
          </article>

          <article className="server-card">
            <div className="server-card-badge server-badge-2">Server 2</div>
            <h3>Server 2</h3>
            <p>
              High-volume social media accounts, aged platforms, and verified essentials with rapid availability and competitive pricing.
            </p>
            <div className="server-card-footer">
              <Link to="/marketplace?server=2" className="text-link">
                View Server 2 Products <ArrowRight size={14} />
              </Link>
            </div>
          </article>

          <article className="server-card server-card-soon">
            <div className="server-card-badge server-badge-3">Server 3</div>
            <h3>Server 3</h3>
            <p>
              Specialty digital services and expanded international catalog. Integration currently preparing for launch.
            </p>
            <div className="server-card-footer">
              <span className="coming-soon-tag">Coming Soon</span>
            </div>
          </article>
        </div>
      </section>

      {/* Customer Reviews Section (Authentic only) */}
      <Reviews />

      {/* Interactive FAQ Section */}
      <section className="container section home-faq" id="faq-section">
        <div className="reference-section-heading">
          <div>
            <span className="eyebrow">CLEAR ANSWERS</span>
            <h2>Frequently Asked Questions</h2>
          </div>
          <p>Common questions about LogsPoll marketplace, ordering, and fulfillment.</p>
        </div>

        <div className="faq-list">
          {[
            {
              q: 'What is LogsPoll?',
              a: 'LogsPoll is a premium digital marketplace offering verified accounts, subscriptions, and digital tools organized across three logical server tiers: Server 1, Server 2, and Server 3.'
            },
            {
              q: 'How does server grouping work?',
              a: 'Products from Server 1, Server 2, and Server 3 belonging to the same category (such as Facebook or Instagram) appear unified in that category, while maintaining independent server filters and verified stock.'
            },
            {
              q: 'How do I complete a purchase?',
              a: 'Browse the marketplace, select your desired items and quantities, and proceed to checkout. Payment is securely processed through Bachs Payment Gateway in Nigerian Naira (NGN).'
            },
            {
              q: 'How are digital goods delivered?',
              a: 'Once your payment is authoritatively reconciled, your purchased items and delivery instructions are immediately available in your customer dashboard under Purchase History, and a branded confirmation is sent to your email.'
            },
            {
              q: 'Can I integrate with LogsPoll programmatically?',
              a: 'Yes. LogsPoll provides an official REST API and developer documentation at /docs for querying products, checking live availability, and managing orders via API keys.'
            }
          ].map(({ q, a }) => (
            <details key={q} className="faq-item">
              <summary className="faq-question">
                <span>{q}</span>
                <ChevronDown size={18} className="faq-arrow" />
              </summary>
              <p className="faq-answer">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* Call to Action */}
      <section className="reference-cta">
        <div className="container cta-inner">
          <div className="cta-copy">
            <h2>Ready to discover digital essentials?</h2>
            <p>Create your free account today and explore verified digital products with complete confidence.</p>
          </div>
          <div className="button-row">
            <Link className="button" to="/signup">Create Free Account</Link>
            <Link className="button hero-secondary" to="/marketplace">Explore Marketplace</Link>
          </div>
        </div>
      </section>
    </div>
  )
}
