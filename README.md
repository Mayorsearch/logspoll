# LOGSPOLL · React + Vite

Existing approved white/orange UI with Supabase authentication, private catalog/cart, customer dashboard, live admin data paths, reviews and a Cloudflare Pages supplier-sync component. Payments and supplier purchasing remain disabled. Demo admin authentication has been removed.

**Not production ready:** the live products API is unavailable (`PGRST205`); database rollout, genuine accounts/RLS, supplier credentials/schema/authorization and payment workflows require completion. No deployment or migrations were performed.

See [LAUNCH_SETUP.md](LAUNCH_SETUP.md) for exact setup, account provisioning, current limitations and verification steps.

```sh
npm ci
npm run dev -- --host 127.0.0.1
npm test
npm run build
```

Cloudflare Pages: Git integration or Wrangler (includes `functions/`), build `npm run build`, output `dist`. Secrets stay in Cloudflare runtime settings or ignored local `.dev.vars`; frontend `VITE_*` values are public. Do not deploy without approval.
