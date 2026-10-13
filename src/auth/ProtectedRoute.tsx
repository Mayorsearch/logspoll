import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { cloudflareRequest } from '../lib/cloudflare-auth';
export function ProtectedRoute() {
    const { session, loading } = useAuth();
    const { pathname } = useLocation();
    if (loading)
        return <p className="container section" role="status">Restoring your session…</p>;
    if (!session)
        return <Navigate to={`/login?next=${encodeURIComponent(pathname)}`} replace/>;
    if (!session.user.email_confirmed_at)
        return <Navigate to="/verify-email" replace/>;
    return <Outlet key={session.user.id}/>;
}
// UI routing only. Every database request and RPC independently enforces RLS/roles.
export function AdminGate() {
    const { session } = useAuth();
    const [state, setState] = useState<'loading' | 'allowed' | 'denied'>('loading');
    useEffect(() => {
        let active = true;
        if (session) {
            void cloudflareRequest('/api/admin/overview').then(() => { if (active)
                setState('allowed'); }).catch(() => { if (active)
                setState('denied'); });
            return () => { active = false; };
        }
        return;
    }, [session]);
    if (state === 'loading')
        return <p className="container section" role="status">Checking administrator access…</p>;
    if (state === 'denied')
        return <section className="container section info-page"><h1>Administrator access unavailable.</h1><p>Your account needs an existing administrator role and verified database policies.</p><Link className="button" to="/dashboard">Customer dashboard</Link></section>;
    return <Outlet />;
}
