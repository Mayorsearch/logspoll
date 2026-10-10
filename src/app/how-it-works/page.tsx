import Link from "next/link";
import {
  UserRound,
  Search,
  PackageCheck,
  ArrowRight,
  LockKeyhole,
} from "lucide-react";
import { PublicPage } from "@/components/public-page";
import { publicMetadata } from "@/lib/site";
export const metadata = publicMetadata(
  "How it works",
  "Learn how to create your LOGSPOLL account and explore authorized digital services in our private marketplace.",
  "/how-it-works",
);
export default function HowItWorks() {
  const steps = [
    {
      Icon: UserRound,
      title: "Create your account",
      text: "Register with your name and email address, then follow the verification link sent to your inbox.",
    },
    {
      Icon: Search,
      title: "Find your digital service",
      text: "Sign in to compare products, search by name and filter by category, price or availability.",
    },
    {
      Icon: PackageCheck,
      title: "Review the details",
      text: "Check the supplier, license term, available quantity and fulfillment method before deciding what fits your needs.",
    },
  ];
  return (
    <PublicPage
      title="A simple start. More possibilities."
      eyebrow="HOW LOGSPOLL WORKS"
      description="From creating your account to finding the right service, everything starts in one place."
    >
      <section className="guide-steps" aria-label="Getting started">
        {steps.map(({ Icon, title, text }, i) => (
          <article key={title}>
            <span className="guide-step-icon">
              <Icon size={25} />
            </span>
            <span className="guide-step-number">0{i + 1}</span>
            <h2>{title}</h2>
            <p>{text}</p>
          </article>
        ))}
      </section>
      <section className="public-callout">
        <LockKeyhole size={24} />
        <div>
          <h2>Your catalog stays private</h2>
          <p>
            Product details, prices and availability are visible only after you
            sign in with a verified account.
          </p>
        </div>
        <Link href="/signup" className="text-link">
          Create an account <ArrowRight size={16} />
        </Link>
      </section>
      <section className="reading-section">
        <h2>Before you purchase</h2>
        <p>
          Checkout and digital delivery are not enabled yet. You will not be
          asked to pay through this website until payment verification and order
          fulfillment are connected and tested.
        </p>
        <Link href="/support#support-questions" className="text-link">
          Read the FAQs <ArrowRight size={15} />
        </Link>
      </section>
    </PublicPage>
  );
}
