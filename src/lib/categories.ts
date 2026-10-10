export const categories = [
  {
    slug: "vpn-services",
    name: "VPN Services",
    shortName: "VPN Services",
    description:
      "Authorized VPN subscriptions and owner-managed setup services.",
    icon: "shield",
    color: "purple",
  },
  {
    slug: "facebook-services",
    name: "Facebook Services",
    shortName: "Facebook Services",
    description:
      "Approved setup and business-tool assistance for customer-owned Facebook assets.",
    icon: "users",
    color: "blue",
  },
  {
    slug: "instagram-services",
    name: "Instagram Services",
    shortName: "Instagram Services",
    description:
      "Approved setup and professional tools for customer-owned Instagram profiles.",
    icon: "camera",
    color: "pink",
  },
  {
    slug: "google-voice-services",
    name: "Google Voice Services",
    shortName: "Google Voice",
    description:
      "Customer-owned business communication setup, subject to provider eligibility.",
    icon: "phone",
    color: "green",
  },
  {
    slug: "usa-email-services",
    name: "USA Email Services",
    shortName: "USA Email",
    description:
      "Legitimate business email setup and licensed email tools; no pre-owned inbox transfers.",
    icon: "mail",
    color: "blue",
  },
  {
    slug: "textnow-services",
    name: "TextNow Services",
    shortName: "TextNow Services",
    description:
      "Customer-owned setup assistance and provider-approved services only.",
    icon: "message",
    color: "orange",
  },
  {
    slug: "textplus-services",
    name: "TextPlus Services",
    shortName: "TextPlus Services",
    description:
      "Approved communication setup assistance for eligible customer-owned services.",
    icon: "message-plus",
    color: "green",
  },
  {
    slug: "talkatone-services",
    name: "Talkatone Services",
    shortName: "Talkatone Services",
    description:
      "Provider-approved setup guidance for customer-owned communication services.",
    icon: "headphones",
    color: "purple",
  },
  {
    slug: "tiktok-services",
    name: "TikTok Services",
    shortName: "TikTok Services",
    description:
      "Approved creator and business-tool setup for customer-owned TikTok profiles.",
    icon: "video",
    color: "slate",
  },
  {
    slug: "other-digital-services",
    name: "Other Digital Products",
    shortName: "Other Digital Products",
    description:
      "Licensed software, authorized subscriptions, creative resources, and legitimate business tools.",
    icon: "grid",
    color: "orange",
  },
] as const;

export type CategorySlug = (typeof categories)[number]["slug"];
export type Category = {
  slug: string;
  name: string;
  shortName: string;
  description: string;
  icon: string;
  color: string;
  productCount: number;
};

// Preserve previously shared category links and filter bookmarks.
export const legacyCategoryAliases: Readonly<Record<string, CategorySlug>> = {
  "vpn-privacy": "vpn-services",
  "software-licenses": "other-digital-services",
  "digital-subscriptions": "other-digital-services",
  "business-tools": "other-digital-services",
  "creative-resources": "other-digital-services",
  "developer-tools": "other-digital-services",
  "licensed-streaming": "other-digital-services",
  "communication-services": "other-digital-services",
};

export function getCategory(slug: string) {
  const canonical = Object.hasOwn(legacyCategoryAliases, slug)
    ? legacyCategoryAliases[slug]
    : slug;
  return categories.find((category) => category.slug === canonical);
}
