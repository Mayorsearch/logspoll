import Link from "next/link";
import { PublicPage } from "@/components/public-page";
import { publicMetadata } from "@/lib/site";
export const metadata = publicMetadata(
  "Marketplace guidelines",
  "Learn what LOGSPOLL supports: authorized subscriptions, licensed software and legitimate business services.",
  "/guidelines",
);
export default function Guidelines() {
  return (
    <PublicPage
      title="Marketplace guidelines"
      eyebrow="CLEAR EXPECTATIONS"
      description="A marketplace built around authorized digital services and clear product information."
    >
      <div className="reading-content">
        <section>
          <h2>Authorized products and services</h2>
          <p>
            LOGSPOLL supports licensed software, authorized subscriptions,
            approved setup services and legitimate business communication tools.
            Suppliers must have permission to distribute the products they list.
          </p>
        </section>
        <section>
          <h2>What is not allowed</h2>
          <p>
            Stolen credentials, session cookies or tokens, compromised accounts,
            account takeovers and unauthorized account transfers are not
            permitted. Services must respect the relevant platform’s
            distribution and transfer restrictions.
          </p>
        </section>
        <section>
          <h2>Understand each listing</h2>
          <p>
            Review the product description, supplier, price, license term,
            availability and delivery type. A product appearing in the catalog
            does not create an entitlement or confirm a purchase.
          </p>
        </section>
        <section>
          <h2>Purchasing and delivery</h2>
          <p>
            Checkout is currently unavailable. When purchasing is enabled,
            payment must be verified on the server before an order can be
            fulfilled. Product-specific delivery instructions and purchased
            entitlements must remain private to the customer.
          </p>
        </section>
        <section>
          <h2>Protect your account</h2>
          <p>
            Use your own email address, choose a strong password and keep
            account access private. Do not share passwords or third-party
            authentication credentials in product descriptions or support
            requests.
          </p>
        </section>
        <section>
          <h2>Questions about a service?</h2>
          <p>
            Visit the <Link href="/support">help center</Link> for information
            about account access, availability and delivery. Purchase,
            cancellation and refund terms must be available before live checkout
            is launched.
          </p>
        </section>
      </div>
    </PublicPage>
  );
}
