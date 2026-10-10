import type { Metadata } from "next";
import Link from "next/link";
import { Workspace } from "@/components/workspace";
import { requireAdmin } from "@/lib/supabase/server";
import { purchaseDate } from "@/lib/purchases";
import { moderateReview } from "./actions";
export const metadata: Metadata = {
  title: "Review Moderation",
  robots: { index: false, follow: false },
};
export default async function Reviews({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string;
    page?: string;
    error?: string;
    saved?: string;
  }>;
}) {
  const { client, user } = await requireAdmin(),
    params = await searchParams;
  const status = ["approved", "rejected"].includes(params.status || "")
    ? params.status!
    : "pending";
  const requested = Number(params.page || 1),
    page =
      Number.isSafeInteger(requested) && requested > 0
        ? Math.min(requested, 10000)
        : 1;
  const { data, error } = await client
    .from("reviews")
    .select("id,display_name,rating,message,location,status,created_at")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 30, page * 30);
  return (
    <Workspace title="Reviews" user={user} admin>
      <section className="workspace-content">
        <div className="panel-heading">
          <div>
            <h1>Customer reviews</h1>
            <p>
              Approve genuine feedback only. Never publish private delivery
              information or personal contact details.
            </p>
          </div>
        </div>
        <nav className="review-status-tabs" aria-label="Review status">
          {["pending", "approved", "rejected"].map((value) => (
            <Link
              key={value}
              aria-current={status === value ? "page" : undefined}
              href={`/admin/reviews?status=${value}`}
            >
              {value}
            </Link>
          ))}
        </nav>
        {params.saved && (
          <p className="form-message" role="status">
            Review moderation saved.
          </p>
        )}
        {params.error && (
          <p className="form-error" role="alert">
            The review could not be updated. Please try again.
          </p>
        )}
        {error ? (
          <div className="honest-empty">
            <h2>Review moderation is unavailable</h2>
            <p>
              Apply the profiles and reviews migration in Supabase before using
              this feature.
            </p>
          </div>
        ) : !data?.length ? (
          <div className="honest-empty">
            <h2>No {status} reviews</h2>
            <p>
              Eligible customers can submit reviews from their completed
              purchases.
            </p>
          </div>
        ) : (
          <div className="moderation-list">
            {data.slice(0, 30).map((review) => (
              <article className="review-card" key={review.id}>
                <strong>{review.display_name}</strong>
                <p>
                  {review.rating}/5 stars ·{" "}
                  {review.location || "Location not provided"} ·{" "}
                  {purchaseDate(review.created_at)}
                </p>
                <p className="review-message">{review.message}</p>
                <form action={moderateReview}>
                  <input type="hidden" name="review_id" value={review.id} />
                  <button
                    className="button button-orange"
                    name="decision"
                    value="approved"
                    disabled={status === "approved"}
                  >
                    Approve
                  </button>
                  <button
                    className="button button-outline"
                    name="decision"
                    value="rejected"
                    disabled={status === "rejected"}
                  >
                    Reject
                  </button>
                </form>
              </article>
            ))}
          </div>
        )}
        {!error && (
          <nav className="pagination" aria-label="Moderation pages">
            {page > 1 && (
              <Link href={`/admin/reviews?status=${status}&page=${page - 1}`}>
                Previous
              </Link>
            )}
            <span>Page {page}</span>
            {(data?.length || 0) > 30 && (
              <Link href={`/admin/reviews?status=${status}&page=${page + 1}`}>
                Next
              </Link>
            )}
          </nav>
        )}
      </section>
    </Workspace>
  );
}
