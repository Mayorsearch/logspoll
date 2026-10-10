"use client";
import Link from "next/link";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section className="container section status-page">
      <p className="eyebrow">SOMETHING WENT WRONG</p>
      <h1>We couldn’t load this page.</h1>
      <p>Please try again. If the problem continues, visit our help page.</p>
      <div className="button-row">
        <button onClick={reset} className="button button-dark">
          Try again
        </button>
        <Link href="/support" className="button button-outline">
          Get help
        </Link>
      </div>
    </section>
  );
}
