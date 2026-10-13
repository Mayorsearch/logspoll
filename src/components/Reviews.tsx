import { useEffect, useState } from 'react';
import type { SubmitEvent } from 'react';
import { Star, BadgeCheck } from 'lucide-react';
import { cloudflareRequest } from '../lib/cloudflare-auth';
import { useAuth } from '../auth/AuthProvider';
interface Review {
    id: string;
    display_name: string;
    location: string;
    rating: number;
    message: string;
    verified_purchase: boolean;
}
function Cards({ reviews }: {
    reviews: Review[];
}) { return <div className="reviews-grid">{reviews.map(review => <article className="review-card" key={review.id}><div className="review-stars" aria-label={`${review.rating} out of 5 stars`}>{Array.from({ length: 5 }, (_, index) => <Star key={index} size={15} fill={index < review.rating ? 'currentColor' : 'none'} aria-hidden="true"/>)}</div><p>{review.message}</p><strong>{review.display_name}</strong><small>{review.location}</small>{review.verified_purchase && <span className="verified-review"><BadgeCheck size={14}/>Verified purchase</span>}</article>)}</div>; }
function IllustrativeReviews() {
    if (!import.meta.env.DEV)
        return null;
    const examples = [
        ['Tunde Adebayo', 'Lagos', 5, 'The website is easy to navigate, and finding what I need is straightforward.'],
        ['Chidera Okafor', 'Abuja', 5, 'I like the clean interface and how simple the ordering process looks.'],
        ['Aisha Bello', 'Kano', 4, 'The platform has a neat design, and the categories are well arranged.'],
        ['Femi Ogunleye', 'Ibadan', 5, 'Everything is organized properly. The dashboard looks professional.'],
        ['Blessing Eze', 'Port Harcourt', 5, 'I really like how easy it is to browse the available services.'],
    ] as const;
    return <div className="illustrative-reviews"><h3>Illustrative Reviews</h3><p>Fictional Nigerian-style examples for local staging preview only. These are not real customer experiences.</p><Cards reviews={examples.map(([display_name, location, rating, message]) => ({ id: display_name, display_name, location, rating, message, verified_purchase: false }))}/></div>;
}
export function Reviews() {
    const [reviews, setReviews] = useState<Review[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);
    const [page, setPage] = useState(1);
    const [pages, setPages] = useState(1);
    useEffect(() => { let active = true; {
        queueMicrotask(() => { if(active) setLoading(true) });
        void cloudflareRequest<{
            reviews: Review[];
            pages: number;
        }>(`/api/reviews?page=${page}`).then(data => { if (active) {
            setReviews(data.reviews);
            setPages(data.pages);
            setError(false);
        } }).catch(() => { if (active)
            setError(true); }).finally(() => { if (active)
            setLoading(false); });
        return () => { active = false; };
    } }, [page]);
    return <section className="container section" id="customer-reviews"><div className="section-heading"><div><span className="eyebrow">CUSTOMER FEEDBACK</span><h2>What our customers are saying</h2><p>Genuine approved reviews from verified purchases.</p></div></div><IllustrativeReviews />{loading ? <p role="status">Loading customer reviews…</p> : error ? <p className="preview-note">Genuine customer reviews are temporarily unavailable.</p> : reviews.length ? <Cards reviews={reviews}/> : <p className="preview-note">No approved customer reviews yet. Share your experience after an eligible purchase.</p>}{!error && pages > 1 && <div className="pagination"><button className="button button-outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous reviews</button><span>{page} / {pages}</span><button className="button button-outline" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next reviews</button></div>}</section>;
}
export function ReviewForm({ itemId }: {
    itemId: string;
}) {
    const { session } = useAuth();
    const [busy, setBusy] = useState(false);
    const [done, setDone] = useState(false);
    const [error, setError] = useState('');
    async function submit(event: SubmitEvent<HTMLFormElement>) {
        event.preventDefault();
        if (busy || done)
            return;
        const values = new FormData(event.currentTarget);
        setBusy(true);
        setError('');
        try {
            const body = { item_uuid: itemId, stars: Number(values.get('stars')), feedback: String(values.get('feedback')).trim(), customer_name: String(values.get('name')).trim(), customer_location: String(values.get('location')).trim() };
            await cloudflareRequest('/api/reviews', body);
            ;
            setDone(true);
        }
        catch {
            setError('Review could not be submitted. A verified, paid, delivered purchase is required; each item can be reviewed once.');
        }
        finally {
            setBusy(false);
        }
    }
    return <details className="purchase-review"><summary>Review this purchase</summary>{done ? <p className="form-success" role="status">Review submitted for administrator moderation.</p> : <form className="account-form" onSubmit={submit}><fieldset disabled={busy}><label>Display name<input name="name" defaultValue={String(session?.user.user_metadata.full_name ?? '').slice(0, 80)} required minLength={2} maxLength={80}/></label><label>Rating<select name="stars" defaultValue="5">{[5, 4, 3, 2, 1].map(value => <option key={value}>{value}</option>)}</select></label><label>Your experience<textarea className="public-textarea" name="feedback" required minLength={20} maxLength={2000}/></label><label>Location (optional)<input name="location" maxLength={100}/></label><button className="button">{busy ? 'Submitting…' : 'Submit for review'}</button></fieldset></form>}{error && <p className="form-error" role="alert">{error}</p>}</details>;
}
