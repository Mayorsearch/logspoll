import { defineCloudflareConfig } from "@opennextjs/cloudflare";
// Account/catalog pages are dynamic and uncached; no R2 or ISR infrastructure is needed.
export default defineCloudflareConfig({});
