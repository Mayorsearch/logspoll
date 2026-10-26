import { 
  ArrowRight, ShieldCheck, ShoppingBag, PackageCheck, Zap, 
  Layers, Search, ChevronDown, Lock,
  Globe, Users, Phone, Mail, LifeBuoy
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { Reviews } from '../components/Reviews'
import { HomeCategories as Categories } from '../components/HomeCategories'
import '../homepage.css'

export function Home() {
  return (
    <div className="reference-home">
      {/* Hero Section (Screen 1 Reference) */}
      <section className="private-access-hero" aria-labelledby="home-title">
        <div className="private-access-copy">
          <span className="private-access-badge">
            <Lock size={13} />
            <span>PRIVATE ACCESS</span>
          </span>
          <h1 id="home-title">
            Access a Private<br />
            Digital Services<br />
            <span className="hero-orange-accent">Marketplace</span>
          </h1>
          <p>
            Sign up for an account to access our full catalog of digital products and services including VPN services, social media services, virtual numbers, US emails and more.
          </p>
          <div className="hero-button-group">
            <Link className="button private-access-button" to="/signup">
              Create Account to Access Catalog <ArrowRight size={17} />
            </Link>
          </div>
        </div>

        <div className="private-access-art" aria-hidden="true">
          <img 
            src="/images/private-services.png" 
            alt="LogsPoll digital marketplace" 
            width={900} 
            height={1125} 
            fetchPriority="high" 
            decoding="async" 
          />
        </div>
      </section>

      {/* Popular Service Categories Section (Screen 1 Reference) */}
      <section className="container section home-categories" id="categories-section">
        <div className="popular-categories-heading">
          <h2>Popular Service Categories</h2>
          <p>Create an account to explore our complete catalog.</p>
        </div>

        <div className="popular-categories-grid">
          <Link to="/marketplace?category=vpn" className="popular-cat-card">
            <span className="popular-cat-icon vpn">
              <Globe size={24} />
            </span>
            <h3>VPN Services</h3>
            <p>Secure &amp; anonymous access</p>
          </Link>

          <Link to="/marketplace?category=social-media" className="popular-cat-card">
            <span className="popular-cat-icon social">
              <Users size={24} />
            </span>
            <h3>Social Media Services</h3>
            <p>Growth &amp; engagement tools</p>
          </Link>

          <Link to="/marketplace?category=virtual-numbers" className="popular-cat-card">
            <span className="popular-cat-icon numbers">
              <Phone size={24} />
            </span>
            <h3>Virtual Numbers</h3>
            <p>Global phone numbers</p>
          </Link>

          <Link to="/marketplace?category=gmail" className="popular-cat-card">
            <span className="popular-cat-icon emails">
              <Mail size={24} />
            </span>
            <h3>US Emails</h3>
            <p>Verified email accounts</p>
          </Link>
        </div>

        {/* Trust strip matching reference design */}
        <div className="auth-trust-strip" style={{ margin: '32px auto 0' }}>
          <div className="auth-trust-box">
            <div className="auth-trust-icon-circle"><Zap size={18} /></div>
            <div className="auth-trust-texts">
              <strong>Fast Access</strong>
              <small>Get started quickly</small>
            </div>
          </div>
          <div className="auth-trust-box">
            <div className="auth-trust-icon-circle"><ShieldCheck size={18} /></div>
            <div className="auth-trust-texts">
              <strong>Secure &amp; Private</strong>
              <small>Your data is safe</small>
            </div>
          </div>
          <div className="auth-trust-box">
            <div className="auth-trust-icon-circle"><LifeBuoy size={18} /></div>
            <div className="auth-trust-texts">
              <strong>Dedicated Support</strong>
              <small>We're here to help</small>
            </div>
          </div>
        </div>

        <div className="category-directory-divider">
          <span className="eyebrow">ALL DIRECTORY CATEGORIES</span>
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
            <h3>Fast Access</h3>
            <p>
              Immediate account credentials and digital access delivered automatically with transparent inventory across Server 1, Server 2, Server 3, and Server 4 (AI Tools).
            </p>
          </article>

          <article>
            <span className="feature-icon status-green"><ShieldCheck size={24} /></span>
            <h3>Secure &amp; Private</h3>
            <p>
              Server-isolated architecture with end-to-end encryption on all customer orders and private fulfillment.
            </p>
          </article>

          <article>
            <span className="feature-icon"><Lock size={24} /></span>
            <h3>Dedicated Support</h3>
            <p>
              Dedicated technical assistance and prompt resolution for any order inquiries and account questions.
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
            LogsPoll coordinates products across four distinct logical server tiers to guarantee inventory diversity and high availability.
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

          <article className="server-card">
            <div className="server-card-badge server-badge-3">Server 3</div>
            <h3>Server 3</h3>
            <p>
              Specialty international accounts, verified services, and multi-currency digital assets with automated USD-to-NGN conversion.
            </p>
            <div className="server-card-footer">
              <Link to="/marketplace?server=3" className="text-link">
                View Server 3 Products <ArrowRight size={14} />
              </Link>
            </div>
          </article>

          <article className="server-card">
            <div className="server-card-badge server-badge-4">Server 4 (AI Tools)</div>
            <h3>Server 4 (AI Tools)</h3>
            <p>
              Authorized AI software licenses, ChatGPT Plus, Midjourney subscriptions, developer tools, and high-performance utility accounts.
            </p>
            <div className="server-card-footer">
              <Link to="/marketplace?server=4" className="text-link">
                View Server 4 (AI Tools) Products <ArrowRight size={14} />
              </Link>
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
              a: 'LogsPoll is a premium digital marketplace offering verified accounts, subscriptions, and digital tools organized across four logical server tiers: Server 1, Server 2, Server 3, and Server 4 (AI Tools).'
            },
            {
              q: 'How does server grouping work?',
              a: 'Products from Server 1, Server 2, Server 3, and Server 4 (AI Tools) belonging to the same category (such as Facebook or Instagram) appear unified in that category, while maintaining independent server filters and verified stock.'
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
