import { ArrowRight, LockKeyhole, Search, ShoppingBag, PackageCheck, ShieldCheck, Zap, Users, ChartNoAxesColumnIncreasing } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Reviews } from '../components/Reviews'
import { Categories } from '../components/Categories'
import '../homepage.css'

export function Home() {
  return <div className="reference-home">
    <section className="private-access-hero" aria-labelledby="home-title">
      <div className="private-access-copy">
        <span className="private-access-badge"><LockKeyhole size={17} /> PRIVATE ACCESS</span>
        <h1 id="home-title">Access a Private<br />Digital Services<br /><span>Marketplace</span></h1>
        <p>Sign up for an account to access our full catalog of digital products and services including VPN services, social media services, virtual numbers, US emails and more.</p>
        <Link className="button private-access-button" to="/signup">Create Account to Access Catalog <ArrowRight size={22} /></Link>
      </div>
      <div className="private-access-art" aria-hidden="true">
        <img src="/images/private-services.webp" alt="" width={900} height={1125} fetchPriority="high" decoding="async" />
        <span className="service-float service-float-vpn"><ShieldCheck size={28} /><small>VPN</small></span>
        <span className="service-float service-float-instagram"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="18" height="18" rx="5" /><circle cx="12" cy="12" r="4" /><circle cx="17.5" cy="6.5" r="1" fill="currentColor" stroke="none" /></svg></span>
        <span className="service-float service-float-facebook"><svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor"><path d="M14 21v-8h3l.5-4H14V7c0-1 .3-2 2-2h2V1.5A24 24 0 0 0 15 1c-3 0-5 2-5 5v3H7v4h3v8z" /></svg></span>
      </div>
    </section>
    <section className="container section home-categories"><div className="reference-section-heading"><h2>Browse by Category</h2><p>Explore our catalog of digital products and services by category.</p></div><Categories /></section>
    <section className="container section"><div className="reference-section-heading"><h2>Why Professionals Choose Us</h2><p>Digital services with clear product details and a dedicated account workspace.</p></div><div className="reference-features"><article className="feature-wide feature-dark"><span className="feature-icon"><Zap /></span><h3>Connected Digital Marketplace</h3><p>Browse approved listings and review current prices, availability, and product requirements before adding to your cart.</p></article><article><span className="feature-icon status-green"><ShieldCheck /></span><h3>Approved Products</h3><p>Explore products published following administrator review and resale authorization.</p></article><article><span className="feature-icon"><ChartNoAxesColumnIncreasing /></span><h3>Clear Product Details</h3><p>Compare prices, stock availability, and service terms in the private catalog.</p></article><article className="feature-wide feature-team"><span className="feature-icon"><Users /></span><h3>Built for Your Workflow</h3><p>Keep your profile, orders, purchase details, and support requests together in your LOGSPOLL account.</p></article></div></section>
    <section className="reference-how"><div className="reference-section-heading"><h2>How LOGSPOLL Works</h2><p>A clear path from finding a service to managing your purchases.</p></div><div className="reference-steps">{[{ Icon: Search, title: '1. Browse Catalog', text: 'Sign in to explore available products, compare details, and find the service you need.' }, { Icon: ShoppingBag, title: '2. Review Your Cart', text: 'Choose quantities and review prices and availability before continuing.' }, { Icon: PackageCheck, title: '3. Manage Purchases', text: 'View your order status and available delivery instructions in your account.' }].map(({ Icon, title, text }) => <article key={title}><span className="feature-icon"><Icon size={30} /></span><h3>{title}</h3><p>{text}</p></article>)}</div></section>
    <Reviews />
    <section className="reference-cta"><h2>Ready to scale your digital operations?</h2><p>Create your LOGSPOLL account to explore the private catalog of digital products and professional tools.</p><div className="button-row"><Link className="button" to="/signup">Create Free Account</Link><Link className="button hero-secondary" to="/support">Contact Support</Link></div></section>
  </div>
}
