import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LogOut, PackageOpen, House, History, List, Settings, UserRound, ShoppingBag, ShieldCheck, ArrowRight } from 'lucide-react';
import { useAuth } from '../auth/AuthProvider';
import { cloudflareAuth, cloudflareRequest } from '../lib/cloudflare-auth';
import { ReviewForm } from '../components/Reviews';
import type { Order } from '../lib/customer-data';
const links = [['', 'Overview', House], ['/purchases', 'Purchase History', History], ['/orders', 'Orders', ShoppingBag], ['/transactions', 'Transactions', List], ['/profile', 'Profile', UserRound], ['/settings', 'Settings', Settings]] as const;
export function DashboardLayout() {
    const { session } = useAuth();
    const navigate = useNavigate();
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const displayName = String(session?.user.user_metadata.full_name || session?.user.email?.split('@')[0] || 'Your account');
    async function logout() {
        if (busy)
            return;
        setBusy(true);
        setError('');
        try {
            const { error: problem } = (await cloudflareAuth('sign-out', {}), { error: null });
            if (problem)
                throw problem;
            navigate('/login', { replace: true });
        }
        catch {
            setError('Unable to sign out. Please try again.');
        }
        finally {
            setBusy(false);
        }
    }
    return <div className="container dashboard-shell"><aside className="dashboard-sidebar"><div className="customer-identity"><span className="customer-avatar">{displayName.charAt(0).toUpperCase()}</span><div><strong>{displayName}</strong><span className="member-label">MEMBER</span></div></div><nav aria-label="Customer dashboard">{links.map(([suffix, label, Icon]) => <NavLink key={label} to={`/dashboard${suffix}`} end><Icon size={21}/>{label}</NavLink>)}</nav><button className="text-link logout-button" disabled={busy} onClick={logout}><LogOut size={21}/>{busy ? 'Signing out…' : 'Sign Out'}</button>{error && <p className="form-error" role="alert">{error}</p>}</aside><section className="dashboard-content"><Outlet /></section></div>;
}
export function CustomerRecords({ mode }: {
    mode: 'overview' | 'orders' | 'purchases' | 'transactions';
}) {
    const { session } = useAuth();
    const [records, setRecords] = useState<Order[]>([]);
    const [loading, setLoading] = useState(mode !== 'transactions');
    const [error, setError] = useState('');
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
        if (session && mode !== 'transactions') {
            let active = true;
            void cloudflareRequest<{
                records: Order[];
            }>(mode === 'purchases' ? '/api/orders?purchases=true' : '/api/orders').then(({ records }) => { if (active)
                setRecords(mode === 'purchases' ? records.filter(order => order.payment_status === 'paid' && order.fulfillment_status === 'delivered') : records); }).catch(problem => { if (active)
                setError(problem.message); }).finally(() => { if (active)
                setLoading(false); });
            return () => { active = false; };
        }
        return;
    }, [session, mode, attempt]);
    const title = { overview: `Welcome back, ${String(session?.user.user_metadata.full_name || session?.user.email?.split('@')[0] || 'there')}! 👋`, orders: 'Your Orders', purchases: 'Purchase History', transactions: 'Transaction History' }[mode];
    return <div className={mode === 'overview' ? 'customer-overview' : 'customer-page-panel'}><h1>{title}</h1><p className="dashboard-intro">{mode === 'overview' ? 'Here’s what’s happening with your account today.' : mode === 'purchases' ? 'Access products from your paid, delivered orders.' : mode === 'transactions' ? 'View payment activity when transaction records are connected to this view.' : 'Track payment and fulfillment status for your orders.'}</p>
    {mode === 'overview' && <div className="customer-summary"><article className="customer-account-card"><span className="summary-label"><ShieldCheck size={18}/> YOUR ACCOUNT</span><div><p>Signed in as</p><strong>{session?.user.email}</strong></div><Link className="button" to="/dashboard/profile">Manage Profile <ArrowRight size={18}/></Link></article><article className="customer-assets-card"><span className="summary-label"><PackageOpen size={18}/> DIGITAL ASSETS</span><h2>Your Purchases</h2><p>Access your purchased tools and available delivery instructions.</p><Link className="button" to="/dashboard/purchases">View Purchases <ArrowRight size={18}/></Link><PackageOpen className="asset-watermark" size={150} aria-hidden="true"/></article></div>}
    <div className={mode === 'overview' ? 'customer-activity' : undefined}>{mode === 'overview' && <div className="activity-heading"><h2>Recent Activity</h2><Link className="text-link" to="/dashboard/orders">View All</Link></div>}
    {mode === 'transactions' ? <Empty title="Transaction history unavailable" text="Payment records are not connected to this account view yet. Check your orders for their current payment status."/> : loading ? <p role="status">Loading your records…</p> : error ? <div role="alert"><p className="form-error">{error}</p><button className="button button-outline" onClick={() => setAttempt(attempt + 1)}>Retry</button></div> : records.length === 0 ? <Empty title={mode === 'purchases' ? 'No purchases yet' : 'No orders yet'} text={mode === 'purchases' ? 'Your paid, delivered products will appear here.' : 'When you place an order, you can track it here.'}/> : <><h2 className="records-title">{mode === 'overview' ? 'Recent orders' : 'Most recent records'}</h2><div className="order-list">{records.slice(0, mode === 'overview' ? 5 : 50).map(order => <article className="order-card" key={order.id}><div className="order-heading"><h3>{order.reference}</h3><strong>{new Intl.NumberFormat('en-NG', { style: 'currency', currency: order.currency }).format(order.total_minor / 100)}</strong></div><p>{new Date(order.created_at).toLocaleDateString()} · Payment: {order.payment_status} · Delivery: {order.fulfillment_status}</p>{mode === 'purchases' && order.order_items?.map(item => <div className="purchase-item" key={item.id}><h4>{item.product_name} × {item.quantity}</h4>{item.product_entitlements ? <details><summary>View delivery instructions</summary><p className="delivery-instructions">{item.product_entitlements.instructions}</p></details> : <p>Delivery instructions are not available. Please contact support.</p>}<ReviewForm itemId={item.id}/></div>)}</article>)}</div><p className="preview-note">Showing up to {mode === 'overview' ? 5 : 50} recent records.</p></>}
    </div>{mode === 'overview' && <div className="customer-quick-actions"><h2>Quick Actions</h2><Link to="/marketplace"><PackageOpen size={22}/>Browse Products <ArrowRight size={18}/></Link><Link to="/dashboard/settings"><Settings size={22}/>Account Settings <ArrowRight size={18}/></Link><Link to="/support">Contact Support <ArrowRight size={18}/></Link></div>}
  </div>;
}
function Empty({ title, text }: {
    title: string;
    text: string;
}) { return <div className="empty-state"><PackageOpen size={32}/><h2>{title}</h2><p>{text}</p><Link className="text-link" to="/marketplace">Explore marketplace →</Link></div>; }
export function Profile() {
    const { session } = useAuth();
    const [name, setName] = useState(String(session?.user.user_metadata.full_name ?? ''));
    const loading = false;
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [message, setMessage] = useState('');
    async function save(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy)
            return;
        if (name.trim().length < 2) {
            setError('Enter at least 2 characters for your name.');
            return;
        }
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const { error: problem } = (await cloudflareAuth('update-user', { name: name.trim() }), { error: null });
            if (problem)
                throw problem;
            setMessage('Account name saved.');
        }
        catch (problem) {
            setError(problem instanceof Error ? problem.message : 'Unable to save your name.');
        }
        finally {
            setBusy(false);
        }
    }
    return <section className="customer-page-panel profile-page"><h1>Account Settings</h1><p className="dashboard-intro">Manage your personal information and account security.</p><div className="profile-columns"><div className="profile-details"><h2><ShieldCheck size={22}/>Personal Details</h2>{loading ? <p role="status">Loading your profile…</p> : <form className="account-form profile-form" onSubmit={save}><fieldset disabled={busy}><label>Full Name<input name="full_name" autoComplete="name" value={name} onChange={e => setName(e.target.value)} required minLength={2} maxLength={120}/></label><label>Email Address<input type="email" value={session?.user.email ?? ''} readOnly/></label><button className="button">{busy ? 'Saving…' : 'Update Profile'}</button></fieldset></form>}{error && <p role="alert" className="form-error">{error}</p>}{message && <p role="status" className="form-success">{message}</p>}</div><AccountSettings embedded/></div></section>;
}
export function AccountSettings({ embedded = false }: {
    embedded?: boolean;
}) {
    const { session } = useAuth();
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState('');
    const [error, setError] = useState('');
    async function reset() {
        if (!session?.user.email || busy)
            return;
        setBusy(true);
        setError('');
        setMessage('');
        try {
            const { error: problem } = (await cloudflareAuth('request-password-reset', { email: session.user.email, redirectTo: '/reset-password' }), { error: null });
            if (problem)
                throw problem;
            setMessage('A password reset link has been requested. Check your inbox and open it in this browser.');
        }
        catch (problem) {
            setError(problem instanceof Error ? problem.message : 'Unable to request a password reset.');
        }
        finally {
            setBusy(false);
        }
    }
    async function acceptAdmin(){setBusy(true);setError('');try{await cloudflareRequest('/api/account/admin-enrollment',{});window.location.assign('/admin')}catch(e){setError(e instanceof Error?e.message:'Enrollment unavailable.')}finally{setBusy(false)}}
    return <section className={embedded ? 'profile-security' : 'customer-page-panel'}>{!embedded && <><h1>Account Settings</h1><p className="dashboard-intro">Manage access to your LOGSPOLL account.</p><Link className="text-link" to="/dashboard/profile">Edit personal details →</Link></>}<div className="settings-panel"><h2><Settings size={22}/>Security & Password</h2><p>Request a secure email link to change your password. Open the link in this browser to choose your new password.</p><button className="button button-navy" onClick={reset} disabled={busy}>{busy ? 'Sending…' : 'Send Password Reset Link'}</button><button className="button button-outline" onClick={()=>void acceptAdmin()} disabled={busy}>Accept administrator invitation</button></div>{message && <p role="status" className="form-success">{message}</p>}{error && <p role="alert" className="form-error">{error}</p>}</section>;
}
