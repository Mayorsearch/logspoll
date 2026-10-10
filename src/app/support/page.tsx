import Link from "next/link";
import {
  ArrowRight,
  UserRound,
  Search,
  CreditCard,
  ArrowUpRight,
  LifeBuoy,
} from "lucide-react";
import { FAQ } from "@/components/faq";
import { PublicPage } from "@/components/public-page";
import { publicMetadata } from "@/lib/site";
export const metadata = publicMetadata(
  "Help center",
  "Find answers about LOGSPOLL account access, the private product catalog, availability and digital delivery.",
  "/support",
);
export default function Support() {
  return (
    <PublicPage
      title="A little help. A clearer next step."
      eyebrow="LOGSPOLL HELP CENTER"
      description="Find answers about your account, digital services and the private marketplace."
    >
      <section className="support-cards" aria-label="Help topics">
        {[
          {
            Icon: UserRound,
            title: "Account & access",
            text: "Registration, email verification and password recovery.",
            href: "/account?mode=forgot",
            label: "Recover your account",
          },
          {
            Icon: Search,
            title: "Finding a service",
            text: "Browse categories and understand product details.",
            href: "/how-it-works",
            label: "See how it works",
          },
          {
            Icon: CreditCard,
            title: "Purchases & delivery",
            text: "Get clear answers about purchasing and fulfillment.",
            href: "#support-questions",
            label: "Read the FAQs",
          },
        ].map(({ Icon, title, text, href, label }) => (
          <article key={title} className="support-card">
            <span className="reference-service-icon orange">
              <Icon size={24} />
            </span>
            <h2>{title}</h2>
            <p>{text}</p>
            <Link href={href} className="text-link">
              {label}
              <ArrowUpRight size={15} />
            </Link>
          </article>
        ))}
      </section>
      <section id="support-questions" className="faq-section">
        <div className="faq-intro">
          <span className="access-label">COMMON QUESTIONS</span>
          <h2>
            Good questions.
            <br />
            Clear answers.
          </h2>
          <p>
            Start here for information about account access, product
            availability and what happens next.
          </p>
          <Link href="/guidelines" className="text-link">
            Marketplace guidelines
            <ArrowRight size={15} />
          </Link>
        </div>
        <FAQ />
      </section>
      <section className="public-callout">
        <LifeBuoy size={25} />
        <div>
          <h2>Need help accessing your account?</h2>
          <p>
            Request a recovery email and follow the link sent to your inbox.
            Never share your password with anyone.
          </p>
        </div>
        <Link href="/account?mode=forgot" className="text-link">
          Reset password
          <ArrowRight size={15} />
        </Link>
      </section>
    </PublicPage>
  );
}
