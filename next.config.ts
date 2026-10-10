import type { NextConfig } from "next";
import { legacyCategoryAliases } from "./src/lib/categories.ts";
const nextConfig: NextConfig = {
  turbopack: { root: process.cwd() },
  poweredByHeader: false,
  async redirects() {
    return Object.entries(legacyCategoryAliases).map(([oldSlug, slug]) => ({
      source: `/categories/${oldSlug}`,
      destination: `/categories/${slug}`,
      permanent: true,
    }));
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
};
export default nextConfig;
