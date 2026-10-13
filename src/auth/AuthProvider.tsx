import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { CloudflareUser } from '../lib/cloudflare-auth';
interface Session {
    access_token: string;
    user: {
        id: string;
        email?: string;
        email_confirmed_at?: string;
        user_metadata: Record<string, unknown>;
    };
}
interface AuthState {
    session: Session | null;
    loading: boolean;
    error: string | null;
    recovery: boolean;
    finishRecovery: () => void;
}
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: {
    children: ReactNode;
}) {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [recovery, setRecovery] = useState(false);
    useEffect(() => {
        {
            let active = true;
            const restore = async () => {
                try {
                    const response = await fetch('/api/account/session', { credentials: 'same-origin', cache: 'no-store' });
                    if (response.status === 401) {
                        if (active) {
                            setSession(null);
                            setError(null);
                        }
                        ;
                        return;
                    }
                    if (!response.ok)
                        throw new Error('Cloudflare account service unavailable.');
                    const { user } = await response.json() as {
                        user: CloudflareUser;
                    };
                    if (active) {
                        setSession({ access_token: '', user: { id: user.id, email: user.email, email_confirmed_at: 'verified', user_metadata: { full_name: user.name } } });
                        setError(null);
                    }
                }
                catch (problem) {
                    if (active) {
                        setSession(null);
                        setError(problem instanceof Error ? problem.message : 'Session unavailable.');
                    }
                }
                finally {
                    if (active)
                        setLoading(false);
                }
            };
            void restore();
            const listener = () => { void restore(); };
            window.addEventListener('logspoll-auth-change', listener);
            window.addEventListener('focus', listener);
            return () => { active = false; window.removeEventListener('logspoll-auth-change', listener); window.removeEventListener('focus', listener); };
        }
    }, []);
    return <AuthContext.Provider value={{ session, loading, error, recovery, finishRecovery: () => setRecovery(false) }}>{children}</AuthContext.Provider>;
}
// eslint-disable-next-line react-refresh/only-export-components -- Context hook stays beside its provider.
export function useAuth() {
    const state = useContext(AuthContext);
    if (!state)
        throw new Error('AuthProvider is required');
    return state;
}
