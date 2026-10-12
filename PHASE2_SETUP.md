> Historical Phase 2 notes. Current configuration, real admin access and deployment blockers are documented in [LAUNCH_SETUP.md](LAUNCH_SETUP.md).

# Phase 2 setup and verification

Authentication and customer routes are implemented. Live authentication, email delivery and database isolation have NOT been tested: this checkout has no `.env.local` or project access. No production data or migrations were changed.

## Existing Supabase project

1. Copy `.env.example` to `.env.local`. Supply the existing project's URL and publishable key (or legacy anon key). Never supply a service-role/secret key. Restart Vite. `.env.local` is ignored by Git.
2. In Authentication settings, enable Email/password signup and Confirm Email. Configure the password policy (at least 8 characters; stronger project policies are respected). Configure SMTP for reliable delivery.
3. Set Site URL to your intended site origin. Allow these exact local redirect URLs (use the same hostname/port consistently):
   - `http://127.0.0.1:5173/auth/callback`
   - `http://127.0.0.1:5173/reset-password`
   Add the equivalent HTTPS URLs for the approved preview/production domain when deploying. Confirmation/recovery email templates must preserve Supabase's `{{ .ConfirmationURL }}` verification link and the requested redirect.
4. PKCE is used. Open email links in the same browser/profile and origin where signup/reset was requested. Do not manually handle or share tokens.
5. Inspect migration history in the EXISTING database. `profiles`, `orders`, `order_items`, `product_entitlements`, and `user_roles` follow the retained migration schema. Run `supabase/verify_phase2.sql` (read only) to inspect RLS and grants. Do not blindly rerun old migrations. Do not enable production use until policies are verified against the live database.

## Local test

```sh
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

- Open `/signup`, register a real test account, open the verification email in the same browser, then sign in at `/login`.
- Visit `/dashboard`, reload to confirm the session persists, update your profile, and log out. Direct visits to `/dashboard/orders` must redirect to sign in.
- At `/forgot-password`, request a reset, open its email in the same browser, update the password, log out, then verify only the new password signs in. Test expired/used links and a missing configuration.
- Use two non-admin test accounts and existing authorized records to verify isolation via direct Supabase SDK/REST requests as well as the dashboard: each account must be unable to read the other's orders, items, entitlements or profile. Client filters alone are not authorization. Anonymous requests must fail. Customer writes to orders, entitlements and roles must fail.
- `/admin/login` shares Supabase identity. `/admin` reads only the signed-in user's existing database role to show a Phase 3 placeholder. No admin data operations or public admin signup are provided. Backend/RLS remains the authority. No role is granted by this implementation.

## Limitations

Transaction history is an explicit unavailable state: the retained schema has no transaction ledger. Orders show real payment statuses and purchases show only paid, delivered records with RLS-protected instructions. Profile updates use `auth.updateUser({data:{full_name}})` and the existing `private.sync_profile` trigger. Missing tables/permissions show errors rather than fabricated records. Checkout, admin management and payment processing remain later phases.

Focused offline verification: `node --experimental-strip-types --test tests/auth-security.test.ts`; build: `npm run build`. Offline tests mock transport; they do not prove live RLS or email delivery.

Supabase references: [password authentication](https://supabase.com/docs/guides/auth/passwords), [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
