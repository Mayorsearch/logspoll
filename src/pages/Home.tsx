import { ArrowRight, LockKeyhole, Search, ShoppingBag, PackageCheck, ShieldCheck, Zap, Users, ChartNoAxesColumnIncreasing } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Reviews } from '../components/Reviews'
import { HomeCategories as Categories } from '../components/HomeCategories'
import '../homepage.css'

export function Home() {
  return <div className="reference-home">
    <section className="private-access-hero" aria-labelledby="home-title">
      <div className="private-access-copy">
        <span className="private-access-badge"><LockKeyhole size={17} /> PRIVATE ACCESS</span>
        <h1 id="home-title">Your digital services.<br /><span>One trusted workspace.</span></h1>
        <p>Sign up for an account to access our full catalog of digital products and services including VPN services, social media services, virtual numbers, US emails and more.</p>
        <Link className="button private-access-button" to="/signup">Get Started <ArrowRight size={20} /></Link><Link className="button button-outline home-explore" to="/marketplace">Explore Products</Link>
      </div>
      <div className="private-access-art" aria-hidden="true">
        <img src="/images/private-services.webp" alt="" width={900} height={1125} fetchPriority="high" decoding="async" />
        <span className="service-float service-float-vpn"><ShieldCheck size={28} /><small>VPN</small></span>
        <span className="service-float service-float-instagram"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg></span>
        <span className="service-float service-float-facebook"><svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M14 21v-8h3l.5-4H14V7c0-1 .3-2 2-2h2V1.5A24 24 0 0 0 15 1c-3 0-5 2-5 5v3H7v4h3v8z" /></svg></span>
      </div>
    </section>
    <section className="container section home-categories"><div className="reference-section-heading"><h2>Browse by Category</h2><p>Explore our catalog of digital products and services by category.</p></div><Categories /></section>
    <section className="container section"><div className="reference-section-heading"><h2>Why Professionals Choose Us</h2><p>Digital services with clear product details and a dedicated account workspace.</p></div><div className="reference-features"><article className="feature-wide feature-dark"><span className="feature-icon"><Zap /></span><h3>Connected Digital Marketplace</h3><p>Browse approved listings and review current prices, availability, and product requirements before adding to your cart.</p></article><article><span className="feature-icon status-green"><ShieldCheck /></span><h3>Approved Products</h3><p>Explore products published following administrator review and resale authorization.</p></article><article><span className="feature-icon"><ChartNoAxesColumnIncreasing /></span><h3>Clear Product Details</h3><p>Compare prices, stock availability, and service terms in the private catalog.</p></article><article className="feature-wide feature-team"><span className="feature-icon"><Users /></span><h3>Built for Your Workflow</h3><p>Keep your profile, orders, purchase details, and support requests together in your LogsPoll account.</p></article></div></section>
    <section className="reference-how"><div className="reference-section-heading"><h2>How LogsPoll Works</h2><p>A clear path from finding a service to managing your purchases.</p></div><div className="reference-steps">{[{ Icon: Search, title: '1. Browse Catalog', text: 'Sign in to explore available products, compare details, and find the service you need.' }, { Icon: ShoppingBag, title: '2. Review Your Cart', text: 'Choose quantities and review prices and availability before continuing.' }, { Icon: PackageCheck, title: '3. Manage Purchases', text: 'View your order status and available delivery instructions in your account.' }].map(({ Icon, title, text }) => <article key={title}><span className="feature-icon"><Icon size={30} /></span><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <Reviews />
    <section className="container section home-servers">
      <div className="reference-section-heading"><h2>Our Supplier Network</h2><p>LogsPoll sources products from three verified supplier networks, each specialising in different digital service categories.</p></div>
      <div className="server-cards">
        <article className="server-card"><div className="server-card-badge server-badge-1">Server 1</div><h3>HStora</h3><p>Premium digital accounts sourced directly from HStora — covering a wide range of social media, email, and subscription services.</p></article>
        <article className="server-card"><div className="server-card-badge server-badge-2">Server 2</div><h3>YoungPG</h3><p>Social media accounts and digital services from YoungPG, offering competitive pricing and broad platform coverage.</p></article>
        <article className="server-card server-card-soon"><div className="server-card-badge server-badge-3">Server 3</div><h3>Shopviaclone22</h3><p>A third verified supplier network — coming soon. New product categories and expanded availability on the way.</p><span className="coming-soon-tag">Coming Soon</span></article>
      </div>
    </section>
    <section className="container section home-faq">
      <div className="reference-section-heading"><h2>Frequently Asked Questions</h2><p>Everything you need to know about LogsPoll.</p></div>
      <div className="faq-list">
        {([
          { q: 'What is LogsPoll?', a: 'LogsPoll is a premium digital marketplace offering accounts, subscriptions and digital services from three verified supplier networks — HStora (Server 1), YoungPG (Server 2), and Shopviaclone22 (Server 3).' },
          { q: 'How do I purchase products?', a: 'Create a free account, browse the catalog, add items to your cart, and complete payment securely via Bachs payment gateway.' },
          { q: 'What payment methods are accepted?', a: 'We accept bank transfers and card payments through Bachs, our secure Nigerian payment provider.' },
          { q: 'How are products delivered?', a: "Products are delivered digitally through your account dashboard. You'll receive an email notification with access instructions." },
        ] as {q:string;a:string}[]).map(({ q, a }) => (
          <details key={q} className="faq-item"><summary className="faq-question">{q}</summary><p className="faq-answer">{a}</p></details>
        ))}
      </div>
    </section>
    <section className="reference-cta"><h2>Ready to scale your digital operations?</h2><p>Create your LogsPoll account to explore the private catalog of digital products and professional tools.</p><div className="button-row"><Link className="button" to="/signup">Create Free Account</Link><Link className="button hero-secondary" to="/support">Contact Support</Link></div></section>
  </div>
}
