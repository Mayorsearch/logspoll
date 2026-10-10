import type { Metadata, Viewport } from "next";
import { getIdentity } from "@/lib/supabase/server";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";
import { site } from "@/lib/site";
import "./globals.css";
import "./design.css";
import "./public.css";
import "./panels.css";
export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: "LOGSPOLL — Private Digital Services Marketplace",
    template: "%s | LOGSPOLL",
  },
  description: site.description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: site.name,
    title: "LOGSPOLL — Private Digital Services Marketplace",
    description: site.description,
    locale: "en_NG",
    url: "/",
  },
  twitter: { card: "summary_large_image" },
};
export const viewport: Viewport = { themeColor: "#F97316" };
export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const identity = await getIdentity();
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        <Header signedIn={Boolean(identity)} />
        <main id="main-content">{children}</main>
        <Footer signedIn={Boolean(identity)} />
      </body>
    </html>
  );
}
