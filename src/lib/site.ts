import type { Metadata } from "next";
export const site = {
  name: "LOGSPOLL",
  description:
    "Explore digital services, premium subscriptions, VPN solutions, and essential digital tools in the private LOGSPOLL marketplace.",
  url: (process.env.NEXT_PUBLIC_SITE_URL || "http://127.0.0.1:3000").replace(
    /\/$/,
    "",
  ),
};
export function publicMetadata(
  title: string,
  description: string,
  path: string,
): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: site.name,
      title: `${title} | ${site.name}`,
      description,
      url: path,
    },
    twitter: {
      card: "summary_large_image",
      title: `${title} | ${site.name}`,
      description,
    },
  };
}
