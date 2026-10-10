import Link from "next/link";
import { PublicPage } from "@/components/public-page";
import { publicMetadata } from "@/lib/site";
export const metadata = publicMetadata(
  "Privacy & account access",
  "Understand the information LOGSPOLL uses for authentication and how private catalog access is protected.",
  "/privacy",
);
export default function Privacy() {
  return (
    <PublicPage
      title="Privacy & account access"
      eyebrow="YOUR ACCOUNT, EXPLAINED"
      description="A practical overview of the information used by the website’s current account and catalog features."
    >
      <div className="reading-content">
        <section>
          <h2>Account information</h2>
          <p>
            Registration asks for your name, email address and password.
            Authentication is handled by Supabase Auth when the service is
            configured. LOGSPOLL does not implement its own password-storage
            system.
          </p>
        </section>
        <section>
          <h2>Session cookies</h2>
          <p>
            The website uses authentication cookies to maintain your session and
            refresh your login. These cookies are marked HTTP-only and use
            secure transport in production. Signing out ends access to your
            private account session.
          </p>
        </section>
        <section>
          <h2>Private catalog access</h2>
          <p>
            The server verifies your signed-in account before returning product
            details, pricing or inventory. Administrator access is checked
            against roles held in the database; changing browser state does not
            grant that access.
          </p>
        </section>
        <section>
          <h2>Payments and delivery</h2>
          <p>
            Checkout is currently unavailable, and this website does not collect
            card details. Payment and fulfillment providers, their data handling
            and purchase terms must be disclosed before live purchasing is
            enabled.
          </p>
        </section>
        <section>
          <h2>Account security</h2>
          <p>
            You can request a password recovery email from the login page. Keep
            your email account secure and sign out when using a shared device.
            Never send passwords or third-party credentials in a support
            request.
          </p>
        </section>
        <section>
          <h2>Privacy questions</h2>
          <p>
            Use the <Link href="/support">help center</Link> for current support
            information. Business contact details, data retention periods and
            privacy-request procedures are still required before commercial
            launch.
          </p>
        </section>
      </div>
    </PublicPage>
  );
}
