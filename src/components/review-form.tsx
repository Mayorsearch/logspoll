"use client";
import { useActionState, useId } from "react";
import {
  submitReview,
  type ReviewState,
} from "@/app/dashboard/reviews/actions";
export function ReviewForm({ itemId }: { itemId: string }) {
  const [state, action, pending] = useActionState<ReviewState, FormData>(
    submitReview,
    {},
  );
  const locationsId = useId();
  return (
    <form action={action} className="review-form">
      <h3>Review your purchase</h3>
      <p>
        Share genuine feedback. Your display name and optional location will be
        public if approved. Keep delivery codes and personal contact details
        private.
      </p>
      {state.error && (
        <p role="alert" className="form-error">
          {state.error}
        </p>
      )}
      {state.message && (
        <p role="status" className="form-message">
          {state.message}
        </p>
      )}
      {!state.message && (
        <fieldset disabled={pending}>
          <input type="hidden" name="item_id" value={itemId} />
          <label className="review-honeypot" aria-hidden="true">
            Website
            <input name="website" tabIndex={-1} autoComplete="off" />
          </label>
          <div className="review-form-grid">
            <label>
              Public display name
              <input
                name="display_name"
                required
                minLength={2}
                maxLength={80}
                autoComplete="nickname"
              />
            </label>
            <label>
              Star rating
              <select name="rating" defaultValue="5" required>
                {[5, 4, 3, 2, 1].map((value) => (
                  <option value={value} key={value}>
                    {value} {value === 1 ? "star" : "stars"}
                  </option>
                ))}
              </select>
            </label>
            <label>
              City or state in Nigeria (optional)
              <input name="location" maxLength={100} list={locationsId} />
              <datalist id={locationsId}>
                {[
                  "Lagos",
                  "Abuja",
                  "Ibadan",
                  "Abeokuta",
                  "Port Harcourt",
                  "Osogbo",
                  "Enugu",
                  "Benin City",
                ].map((city) => (
                  <option value={city} key={city} />
                ))}
              </datalist>
            </label>
          </div>
          <label>
            Your feedback
            <textarea
              name="message"
              required
              minLength={20}
              maxLength={2000}
              rows={3}
            />
          </label>
          <button className="button button-orange" type="submit">
            {pending ? "Submitting…" : "Submit review"}
          </button>
        </fieldset>
      )}
    </form>
  );
}
