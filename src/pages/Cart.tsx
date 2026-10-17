import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { cloudflareRequest } from '../lib/cloudflare-auth';
import { useAuth } from '../auth/AuthProvider';
import { useCurrency } from '../lib/currency';
interface Product {
    id: string;
    name: string;
    slug: string;
    price_minor: number;
    currency: string;
    available_quantity: number;
}
export function Cart({ checkout = false }: {
    checkout?: boolean;
}) {
    const { items, update, clear } = useCart();
    const { session } = useAuth();
    const sandboxMode = false;
    const [sandboxBusy, setSandboxBusy] = useState(false);
    const [sandboxMessage, setSandboxMessage] = useState('');
    async function sandboxPay() {
        if (!session || items.length !== 1 || items[0].quantity !== 1) {
            setSandboxMessage('Sandbox testing supports one approved item at a time.');
            return;
        }
        setSandboxBusy(true);
        setSandboxMessage('');
        try {
            const key = `logspoll-sandbox-request:${session.user.id}:${items[0].id}`;
            let requestId = sessionStorage.getItem(key);
            if (!requestId) {
                requestId = crypto.randomUUID();
                sessionStorage.setItem(key, requestId);
            }
            const response = await fetch('/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
                body: JSON.stringify({ product_id: items[0].id, quantity: 1, request_id: requestId }) });
            const data: {
                error?: string;
                checkout_url?: string;
                order_id?: string;
            } = await response.json();
            if (!response.ok || !data.checkout_url || !data.order_id)
                throw Error(data.error ?? 'Sandbox checkout unavailable.');
            const url = new URL(data.checkout_url);
            if (url.protocol !== 'https:' || !['checkout.bachs.io', 'sandbox-checkout.bachs.io'].includes(url.hostname))
                throw Error('Unexpected Bachs checkout URL.');
            sessionStorage.setItem('logspoll-last-sandbox-order', data.order_id);
            window.location.assign(data.checkout_url);
        }
        catch (problem) {
            setSandboxMessage(problem instanceof Error ? problem.message : 'Sandbox checkout unavailable.');
        }
        finally {
            setSandboxBusy(false);
        }
    }
    async function checkSandboxStatus() {
        const id = sessionStorage.getItem('logspoll-last-sandbox-order');
        if (!session || !id) {
            setSandboxMessage('No previous sandbox order found in this browser.');
            return;
        }
        setSandboxBusy(true);
        try {
            const response = await fetch(`/api/bachs/order?id=${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
            const data: {
                error?: string;
                order?: {
                    state: string;
                };
            } = await response.json();
            if (!response.ok || !data.order)
                throw Error(data.error ?? 'Unable to retrieve sandbox order.');
            setSandboxMessage(`Sandbox payment status: ${data.order.state}. Automatic supplier delivery is not yet enabled.`);
        }
        catch (problem) {
            setSandboxMessage(problem instanceof Error ? problem.message : 'Unable to retrieve sandbox order.');
        }
        finally {
            setSandboxBusy(false);
        }
    }
    const [products, setProducts] = useState<Product[]>([]);
    const [loading, setLoading] = useState(Boolean(items.length));
    const [error, setError] = useState('');
    const ids = items.map(item => item.id).sort().join(',');
    useEffect(() => {
        let active=true;
        queueMicrotask(()=>{
            if(!active)return;
            if(!ids){setProducts([]);setLoading(false);return}
            setLoading(true);setError('');
            void cloudflareRequest<{records:Product[]}>(`/api/products?ids=${encodeURIComponent(ids)}`).then(({records})=>{if(active)setProducts(records)}).catch(problem=>{if(active)setError(problem.message)}).finally(()=>{if(active)setLoading(false)});
        });
        return()=>{active=false};
    },[ids]);
    const { formatPrice } = useCurrency();
    const total = items.reduce((sum, item) => sum + (products.find(product => product.id === item.id)?.price_minor ?? 0) * item.quantity, 0);
    return <section className="container section"><span className="eyebrow">YOUR PRIVATE ACCOUNT</span><h1>{checkout ? (sandboxMode ? 'Bachs sandbox checkout test' : 'Checkout unavailable') : 'Your cart'}</h1><p className="form-error">{sandboxMode ? 'TEST ONLY: Bachs sandbox uses simulated payments. Even a verified sandbox payment will not purchase or deliver products from the provider yet.' : 'Live checkout is disabled pending verified payment, stock reservation, refund handling and authorized automatic fulfillment. No charge or supplier purchase will occur.'}</p>{loading ? <p role="status">Checking current product details…</p> : error ? <p className="form-error" role="alert">{error}</p> : !items.length ? <div className="empty-state"><h2>Your cart is empty</h2><Link className="button" to="/marketplace">Browse approved products</Link></div> : <div className="order-list">{items.map(item => { const product = products.find(product => product.id === item.id); return <article className="order-card cart-row" key={item.id}><div><h3>{product ? <Link to={`/products/${product.slug}`}>{product.name}</Link> : 'Product unavailable'}</h3><p>{product ? formatPrice(product.price_minor) : 'Remove this product before checkout.'}</p>{product && item.quantity > product.available_quantity && <p className="form-error">Only {product.available_quantity} currently available.</p>}</div><label>Quantity<input aria-label={`Quantity for ${product?.name ?? 'unavailable product'}`} type="number" min={1} max={Math.min(1000, product?.available_quantity ?? 1000)} value={item.quantity} onChange={event => update(item.id, Number(event.target.value))}/></label><button className="button button-outline" onClick={() => update(item.id, 0)}>Remove</button></article>; })}<p>Estimated total: <strong>{formatPrice(total)}</strong> <small style={{ color: '#667085', fontSize: '11px' }}>(Settlement currency: NGN ₦ via Bachs)</small></p><p className="preview-note">Cart estimates use current catalog prices. A secure backend must recalculate totals before accepting any payment.</p><div className="button-row"><button className="button button-outline" onClick={clear}>Clear cart</button>{sandboxMode ? <button className="button" disabled={sandboxBusy || loading || !!error || items.length !== 1 || items[0]?.quantity !== 1} onClick={() => void sandboxPay()}>Test Bachs sandbox payment</button> : <button className="button" disabled>Checkout unavailable</button>}{sandboxMode && <button className="button button-outline" disabled={sandboxBusy} onClick={() => void checkSandboxStatus()}>Check test order status</button>}</div>{sandboxMessage && <p role="status">{sandboxMessage}</p>}</div>}</section>;
}
