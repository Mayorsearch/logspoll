# LOGSPOLL · React rebuild

Phase 1 only: React 19 + Vite + TypeScript, Tailwind v4, React Router and Lucide. Reuses the previous homepage artwork and category direction. No fabricated products, prices or activity. Accounts and checkout are explicitly unavailable.

## Local development

```sh
npm ci
npm run dev -- --host 127.0.0.1
npm run build
```

## Cloudflare Pages (not deployed)

Connect `Mayorsearch/logspoll` after reviewing and pushing `rebuild/react-vite`. Build command: `npm run build`; output directory: `dist`; root directory: repository root. Use a Node version satisfying the installed Vite package. Do not upload the project directory or node_modules. `public/_redirects` provides SPA fallback. Keep this branch as a preview until authentication, RLS and payments are verified. Do not change the production branch automatically.

## Remaining phases

2. Inspect the existing Supabase project and migration history; install the SDK and React Hook Form when used; implement sign up, verification, recovery, sessions and customer dashboard. `.env.example` contains public configuration placeholders only. No credentials were copied. Existing migrations are retained for reference only: do not apply them blindly or create another database.
3. Implement invitations, persistent admin identity, database-enforced roles/RLS, admin management and audit records. The attached admin reference was not available in this session.
4. Implement Edge Functions for provider connectors, secret storage, safe URL validation, connection tests and sync/error status; secure orders, checkout, payment verification and purchase fulfillment. Complete public/legal pages and deployment security review.

Database changes, deployment, pushes, authentication and purchases have not been performed. The backup remains unchanged. The branch starts from the backup's existing Git commit history; the diff intentionally removes the old Next.js application from this rebuild.
