import Link from "next/link";
import { ArrowLeft, Search } from "lucide-react";
export default function NotFound() {
  return (
    <section className="container section status-page">
      <span className="notice-icon">
        <Search size={28} />
      </span>
      <p className="eyebrow">404 · PAGE NOT FOUND</p>
      <h1>Let’s find a better place.</h1>
      <p>This page may have moved, or the product is no longer listed.</p>
      <Link href="/marketplace" className="button button-dark">
        <ArrowLeft size={16} /> Back to marketplace
      </Link>
    </section>
  );
}
