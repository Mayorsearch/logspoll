import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import { FAQ } from '../components/faq'
import { WhatsAppSupportButton } from '../components/WhatsAppSupportButton'

export function Information({ kind }: { kind: 'about' | 'support' | 'faq' }) {
  const title = kind === 'about' ? 'Digital services, brought together.' : kind === 'support' ? 'How can we help?' : 'Frequently asked questions'
  return (
    <section className="container section info-page">
      <span className="eyebrow">{kind === 'about' ? 'ABOUT LOGSPOLL' : 'HELP & INFORMATION'}</span>
      <h1>{title}</h1>
      {kind === 'about' ? (
        <>
          <p>LOGSPOLL is a digital products and services marketplace being rebuilt around a clear catalog and a straightforward customer experience.</p>
          <p>Our service categories include VPN tools, business communication, virtual numbers and email services. Customer accounts use Cloudflare authentication. Live catalog availability depends on the configured database connection.</p>
          <Link className="button" to="/marketplace">Explore categories <ArrowRight size={17} /></Link>
        </>
      ) : (
        <>
          {kind === 'support' && (
            <div style={{ marginBottom: 32 }}>
              <p style={{ marginBottom: 16 }}>Need instant help with an order, wallet funding, or license key? Connect directly with our priority support team on WhatsApp or review common questions below.</p>
              <WhatsAppSupportButton variant="primary" buttonText="Contact Support on WhatsApp" />
            </div>
          )}
          <FAQ />
          <div className="auth-links">
            <Link to="/contact">Contact support &amp; open ticket →</Link>
          </div>
        </>
      )}
    </section>
  )
}
export function NotFound() { return <section className="container section info-page"><span className="eyebrow">404 · PAGE NOT FOUND</span><h1>Let’s get you back on track.</h1><p>This page is not available.</p><Link to="/" className="button">Back to home <ArrowRight size={17} /></Link></section> }
