import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowRight, PackageOpen, ShieldCheck } from 'lucide-react';
import { ProductOverview } from '../components/ProductOverview';
import { ProductArtwork } from '../components/ProductArtwork';
import { Categories } from '../components/Categories';
import { useCatalogCategories } from '../components/useCatalogCategories';
import { useAuth } from '../auth/AuthProvider';
import { useCart } from '../lib/cart';
import { useCurrency } from '../lib/currency';
import { cloudflareRequest } from '../lib/cloudflare-auth';
export function CategoryPage() {
    const { slug } = useParams();
    const { categories } = useCatalogCategories();
    const category = categories.find(item => item.slug === slug);
    return <section className="container section"><div className="page-heading"><span className="eyebrow">EXPLORE LOGSPOLL</span><h1>{category?.name ?? 'Service categories'}</h1><p>{category?.description ?? 'Find digital services by the way you work.'}</p></div>{slug ? <div className="cta"><div><h2>Explore this category</h2><p>Live availability and product details appear in the connected marketplace.</p></div><Link className="button" to={`/marketplace?category=${encodeURIComponent(slug)}`}>View services <ArrowRight size={16}/></Link></div> : <Categories />}</section>;
}
export function ContactPage() {
    const { session } = useAuth();
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    return <section className="container section info-page"><span className="eyebrow">CONTACT & SUPPORT</span><h1>Let’s talk about your digital needs.</h1><p>Signed-in customers can submit a support request to the LOGSPOLL team.</p>{!session ? <Link className="button" to="/login">Sign in to contact support</Link> : <form className="account-form profile-form" onSubmit={async (event) => {
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
interface Product {
    id: string;
    name: string;
    description: string;
    price_minor: number;
    currency: string;
    category_name: string;
    available_quantity: number;
    term: string;
    delivery_type: string;
    image_path?: string | null;
    supplier_image_urls?: string[];
    server_number?: number;
}
export function ProductDetails() {
    const { slug } = useParams();
    const { add } = useCart();
    const { formatPrice } = useCurrency();
    const [quantity, setQuantity] = useState(1);
    const [notice, setNotice] = useState('');
    const [product, setProduct] = useState<Product | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    useEffect(() => {
        let active = true;
        {
            void cloudflareRequest<{
                records: Product[];
            }>(`/api/products?slug=${encodeURIComponent(slug ?? '')}`).then(({ records }) => { if (active) {
                setProduct(records[0] ?? null);
                setError(records.length ? '' : 'This product is not available.');
            } }).catch(problem => { if (active)
                setError(problem.message); }).finally(() => { if (active)
                setLoading(false); });
            return () => { active = false; };
        }
    }, [slug]);
    return <section className="container section"><Link className="text-link" to="/marketplace">← Back to marketplace</Link>{loading ? <p className="section" role="status">Loading product details…</p> : !product ? <div className="empty-state"><PackageOpen size={38}/><h1>Product details</h1><p role="status">{error || 'Connect the live catalog to view available products and their details.'}</p><Link className="button" to="/login">Sign in to your account</Link></div> : <div className="public-product-grid"><div className="public-product-art"><ProductArtwork path={product.image_path} name={product.name} category={product.category_name} images={product.supplier_image_urls}/></div><article><div className="product-badges-row"><span className="eyebrow">{product.category_name}</span>{product.server_number ? <span className={`server-badge server-badge-${product.server_number}`}>Server {product.server_number}</span> : null}</div><h1>{product.name}</h1><p className="public-product-price">{formatPrice(product.price_minor)}</p><span className={`stock-badge ${product.available_quantity < 1 ? 'out-of-stock' : ''}`}>{product.available_quantity > 0 ? `${product.available_quantity} available` : 'Unavailable to order'}</span><dl className="public-product-info"><dt>Availability</dt><dd>{product.available_quantity > 0 ? `${product.available_quantity} available` : 'Unavailable to order'}</dd><dt>Duration</dt><dd>{product.term || 'See product description'}</dd><dt>Delivery</dt><dd>{product.delivery_type}</dd></dl><div className="product-detail-quantity"><label htmlFor="detail-quantity">Select quantity</label><div className="quantity-stepper"><button type="button" aria-label="Decrease quantity" disabled={!Number.isSafeInteger(quantity) || quantity <= 1} onClick={() => setQuantity(quantity - 1)}>−</button><input id="detail-quantity" aria-label="Quantity" type="number" min={1} max={Math.min(1000, product.available_quantity)} value={quantity} onChange={event => setQuantity(Number(event.target.value))}/><button type="button" aria-label="Increase quantity" disabled={!Number.isSafeInteger(quantity) || quantity >= Math.min(1000, product.available_quantity)} onClick={() => setQuantity(quantity + 1)}>+</button></div></div><div className="button-row"><button className="button" disabled={!Number.isSafeInteger(quantity) || quantity < 1 || quantity > Math.min(1000, product.available_quantity)} onClick={() => { add(product.id, quantity, product.available_quantity); setNotice("Added to your cart, subject to available quantity."); }}>Add to cart</button><Link className="text-link" to="/cart">View cart →</Link></div>{notice && <p className="form-success" role="status">{notice}</p>}<p className="preview-note"><ShieldCheck size={15}/> Secure payment processing must be connected before orders can be placed.</p></article><ProductOverview description={product.description}/></div>}</section>;
}
