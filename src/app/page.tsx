import Image from "next/image";
import Link from "next/link";
import { CustomerReviews } from "@/components/customer-reviews";
import {
  ArrowRight,
  LockKeyhole,
  Globe2,
  Users,
  Phone,
  Mail,
} from "lucide-react";

const services = [
  {
    name: "VPN Services",
    description: "Private connection tools",
    Icon: Globe2,
    tone: "blue",
    href: "/categories/vpn-services",
  },
  {
    name: "Social Media Services",
    description: "Business & management tools",
    Icon: Users,
    tone: "purple",
    href: "/marketplace",
  },
  {
    name: "Virtual Numbers",
    description: "Business communication",
    Icon: Phone,
    tone: "green",
    href: "/categories/google-voice-services",
  },
  {
    name: "US Emails",
    description: "Business email services",
    Icon: Mail,
    tone: "orange",
    href: "/categories/usa-email-services",
  },
];

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<{ reviewsPage?: string }>;
}) {
  const requested = Number((await searchParams).reviewsPage || 1);
  const page =
    Number.isSafeInteger(requested) && requested > 0
      ? Math.min(requested, 10000)
      : 1;
  return (
    <div className="reference-page reference-home">
      <section className="reference-hero">
        <div className="reference-copy">
          <span className="access-label">
            <LockKeyhole size={13} /> PRIVATE ACCESS
          </span>
          <h1>
            Access a Private
            <br />
            Digital Services
            <br />
            <span>Marketplace</span>
          </h1>
          <p>
            Sign up for an account to access our full catalog of digital
            products and services including VPN services, social media services,
            virtual numbers, US emails and more.
          </p>
          <Link href="/signup" className="button button-orange">
            Create Account to Access Catalog <ArrowRight size={18} />
          </Link>
        </div>
        <Image
          className="reference-art"
          src="/images/private-services.png"
          width={1122}
          height={1402}
          priority
          sizes="(max-width: 600px) 420px, 600px"
          alt=""
        />
      </section>
      <section
        className="reference-categories"
        aria-labelledby="popular-categories"
      >
        <h2 id="popular-categories">Popular Service Categories</h2>
        <p>Create an account to explore our complete catalog.</p>
        <div className="reference-category-grid">
          {services.map(({ name, description, Icon, tone, href }) => (
            <Link
              href={href}
              className="category-card reference-category"
              key={name}
            >
              <span className={`reference-service-icon ${tone}`}>
                <Icon size={25} strokeWidth={2.3} />
              </span>
              <h3>{name}</h3>
              <p>{description}</p>
            </Link>
          ))}
        </div>
      </section>
      <CustomerReviews page={page} />
    </div>
  );
}
