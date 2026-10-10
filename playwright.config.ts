import { defineConfig, devices } from "@playwright/test";
const database = process.env.CATALOG_DATABASE_TEST === "1";
export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: !database,
  timeout: 60000,
  workers: database ? 1 : 2,
  reporter: "list",
  webServer: {
    command: database
      ? "node --experimental-strip-types tests/helpers/catalog-server.ts"
      : "SUPABASE_URL= SUPABASE_PUBLISHABLE_KEY= npm run start -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 30000,
  },
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: "chrome",
    trace: "retain-on-failure",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], browserName: "chromium" },
    },
  ],
});
