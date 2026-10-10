import Link from "next/link";
import { Star, BadgeCheck, MessageSquare } from "lucide-react";
import { createAuthClient } from "@/lib/supabase/server";
import { purchaseDate } from "@/lib/purchases";
type PublishedReview = {
  id: string;
  display_name: string;
  rating: number;
  message: string;
  location: string;
  created_at: string;
  verified_purchase: boolean;
};
type PublishedReviews = {
  reviews: PublishedReview[];
  page: number;
  pages: number;
};
export async function CustomerReviews({ page = 1 }: { page?: number }) {
  const client = await createAuthClient();
  const { data, error } = client
    ? await client.rpc("published_reviews", { requested_page: page })
    : { data: null, error: null };
  const result = data as PublishedReviews | null;
  const unavailable = !client || Boolean(error);
  return (
    <section
      className="customer-reviews"
      id="customer-reviews"
      aria-labelledby="reviews-title"
    >
      <div className="reviews-heading">
        <span className="reference-service-icon orange">
          <MessageSquare size={22} />
        </span>
        <div>
          <h2 id="reviews-title">What Our Customers Are Saying</h2>
          <p>Feedback from customers who use LOGSPOLL.</p>
        </div>
      </div>
      {!result?.reviews.length ? (
        <div className="reviews-empty">
          <h3>
            {unavailable
              ? "Customer reviews are temporarily unavailable"
              : "Be among the first to share your experience"}
          </h3>
          <p>
            {unavailable
              ? "Please check back soon."
              : "Genuine reviews appear here after a completed purchase and approval. No published reviews yet."}
          </p>
        </div>
      ) : (
        <>
          <div className="reviews-grid">
            {result.reviews.map((review) => (
              <article className="review-card" key={review.id}>
                <div
                  className="review-stars"
                  aria-label={`${review.rating} out of 5 stars`}
                >
                  {Array.from({ length: 5 }, (_, i) => (
                    <Star
                      size={15}
                      key={i}
                      fill={i < review.rating ? "currentColor" : "none"}
                      aria-hidden="true"
                    />
                  ))}
                </div>
                <p className="review-message">{review.message}</p>
                <strong>{review.display_name}</strong>
                {review.location && (
                  <span className="review-location">{review.location}</span>
                )}
                <div className="review-card-foot">
                  <time dateTime={review.created_at}>
                    {purchaseDate(review.created_at)}
                  </time>
                  {review.verified_purchase && (
                    <span>
                      <BadgeCheck size={13} />
                      Verified Purchase
                    </span>
                  )}
                </div>
              </article>
            ))}
          </div>
          {result.pages > 1 && (
            <nav className="pagination" aria-label="Customer reviews pages">
              {result.page > 1 && (
                <Link
                  href={`/?reviewsPage=${result.page - 1}#customer-reviews`}
                >
                  Previous
                </Link>
              )}
              <span>
                Page {result.page} of {result.pages}
              </span>
              {result.page < result.pages && (
                <Link
                  href={`/?reviewsPage=${result.page + 1}#customer-reviews`}
                >
                  Next
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </section>
  );
}
