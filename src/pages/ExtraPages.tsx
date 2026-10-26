import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Categories } from '../components/Categories';
import { useCatalogCategories } from '../components/useCatalogCategories';
import { useAuth } from '../auth/AuthProvider';
import { cloudflareRequest } from '../lib/cloudflare-auth';
import { WhatsAppSupportButton } from '../components/WhatsAppSupportButton';
import { useWhatsAppConfig } from '../lib/whatsapp';
export function CategoryPage() {
    const { slug } = useParams();
    const { categories } = useCatalogCategories();
    const category = categories.find(item => item.slug === slug);
    return <section className="container section"><div className="page-heading"><span className="eyebrow">EXPLORE LOGSPOLL</span><h1>{category?.name ?? 'Service categories'}</h1><p>{category?.description ?? 'Find digital services by the way you work.'}</p></div>{slug ? <div className="cta"><div><h2>Explore this category</h2><p>Live availability and product details appear in the connected marketplace.</p></div><Link className="button" to={`/marketplace?category=${encodeURIComponent(slug)}`}>View services <ArrowRight size={16}/></Link></div> : <Categories />}</section>;
}
export function ContactPage() {
    const { session } = useAuth();
    const { displayPhone } = useWhatsAppConfig();
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    return <section className="container section info-page"><span className="eyebrow">CONTACT & SUPPORT</span><h1>Let’s talk about your digital needs.</h1><p>Need instant assistance with an order, account inquiry, or payment issue? Reach out to our verified priority desk on WhatsApp or submit a ticket below.</p>
    <div className="whatsapp-contact-banner" style={{ margin: '24px 0', padding: '18px 20px', borderRadius: 12, background: 'linear-gradient(135deg, rgba(37, 211, 102, 0.08), rgba(18, 140, 126, 0.05))', border: '1px solid rgba(37, 211, 102, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
      <div>
        <strong style={{ fontSize: 15, display: 'block', color: '#0f172a' }}>Direct WhatsApp Priority Desk</strong>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#475569' }}>Instant chat with our official support team at {displayPhone}.</p>
      </div>
      <WhatsAppSupportButton variant="primary" buttonText="Contact Support on WhatsApp" />
    </div>
    {!session ? <div style={{ marginTop: 16 }}><p style={{ marginBottom: 12 }}>You can also sign in to track and submit registered web tickets:</p><Link className="button" to="/login">Sign in to contact support</Link></div> : <form className="account-form profile-form" onSubmit={async (event) => {
                event.preventDefault();
                if (busy)
                    return;
                const form = event.currentTarget;
                const values = new FormData(form);
                setBusy(true);
                setMessage('');
                setError('');
                try {
                    const body = { subject: String(values.get('subject')).trim(), message: String(values.get('message')).trim() };
                    await cloudflareRequest('/api/support', body);
                    ;
                    setMessage('Your support request was saved.');
                    form.reset();
                }
                catch {
                    setError('Your request could not be saved. Please retry or check support availability.');
                }
                finally {
                    setBusy(false);
                }
            }}><fieldset disabled={busy}><label>Subject<input name="subject" required maxLength={200}/></label><label>How can we help?<textarea name="message" required minLength={10} maxLength={2000} rows={5} className="public-textarea"/></label><button className="button">{busy ? 'Submitting…' : 'Submit support request'}</button></fieldset></form>}{message && <p className="form-success" role="status">{message}</p>}{error && <p className="form-error" role="alert">{error}</p>}<div className="auth-links"><Link to="/faq">Browse frequently asked questions →</Link></div></section>;
}
export function PolicyPage({ privacy = false }: {
    privacy?: boolean;
}) {
    return <section className="container section info-page"><span className="eyebrow">LOGSPOLL POLICIES · DRAFT</span><h1>{privacy ? 'Privacy Policy' : 'Terms and Conditions'}</h1><p className="form-error">This policy interface is a draft. Final business policies must be reviewed and published before checkout becomes available.</p>{privacy ? <><h2>Your account information</h2><p>The application uses Cloudflare D1 and secure server-side authentication. Resend delivers account emails.</p><h2>Orders and service records</h2><p>The customer dashboard is designed to display account-owned order and purchase records. Administrator access is enforced by Cloudflare server permissions.</p><h2>Policy details pending publication</h2><p>Operator contact information, retention periods, data-request procedures and applicable service-provider details will be added to the final policy.</p></> : <><h2>Marketplace access</h2><p>LOGSPOLL provides interfaces for discovering digital products and services. Availability, prices and requirements must be confirmed on live product listings.</p><h2>Orders and payments</h2><p>Checkout is currently unavailable. No payment processing or supplier purchasing is enabled.</p><h2>Terms pending publication</h2><p>Seller identity, delivery commitments, refund conditions, permitted use and dispute procedures will be included in the final published terms.</p></>}<Link className="text-link" to="/contact">Contact & support <ArrowRight size={16}/></Link></section>;
}
export { ProductDetails } from './ProductDetails';

