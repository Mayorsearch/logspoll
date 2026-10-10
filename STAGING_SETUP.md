# LOGSPOLL staging authentication

Status: the supplied hosted Supabase URL and publishable key are configured in the ignored `.env.local`. Auth settings respond successfully: email enabled, signup enabled, email confirmation required. Catalog and role tables returned `PGRST205` (missing tables); migrations still need to be applied by the project owner. Local panel fixtures are test infrastructure and do not implement real registration or login. Stop that launcher and use `npm run dev` for real Supabase authentication.

1. Create a separate staging Supabase project. In the ignored `.env.local`, set `SUPABASE_URL`, the new `SUPABASE_PUBLISHABLE_KEY` (`sb_publishable_…`), and `NEXT_PUBLIC_SITE_URL` to the exact address you open in your browser (default `http://127.0.0.1:3000`). Do not mix `localhost` and `127.0.0.1`; HTTPS is required for non-local staging. Restart Next.js after changes. Rebuild before using `npm run start`.
2. Apply all four files in `supabase/migrations` in filename order using the Supabase SQL editor. Never apply only the initial catalog migration: the second migration closes public catalog access.
3. In Supabase Auth, enable the email provider, new registrations and **Confirm email**. Set Site URL to the same origin as above; allow its `/auth/callback` and `/auth/callback?next=/account?mode=reset` redirect URLs. Configure SMTP for delivery to inboxes you control, plus provider rate limits and password policy (at least 12 characters). Supabase's default mail service restricts recipients; it is not suitable for general customer signup.
4. Use these links in the corresponding Supabase email templates. Token-hash links support opening invitations/recovery in another browser; PKCE confirmation codes are also supported for requests initiated by this app.

```html
<!-- Confirm signup -->
<a
  href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=signup"
  >Confirm email</a
>
<!-- Invite user -->
<a
  href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=invite"
  >Accept invitation and set password</a
>
<!-- Reset password -->
<a
  href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&amp;type=recovery"
  >Reset password</a
>
```

## Two separate accounts

- **Admin:** invite an inbox you control from Supabase Dashboard → Authentication → Users → Invite user. Do not register an admin through the public form. Open the invitation in that inbox and choose a strong, unique temporary password using a password manager. The app requires at least 12 characters. After confirmation, run the following SQL in the **staging** project SQL editor, replacing the placeholder with that account's UUID from Authentication → Users. It refuses unverified identities. No privileged key is required in the application.

```sql
do $$
declare admin_uuid uuid := 'REPLACE_WITH_VERIFIED_ADMIN_UUID';
begin
  if not exists(select 1 from auth.users where id=admin_uuid and email_confirmed_at is not null) then
    raise exception 'Confirm the staging admin email first';
  end if;
  insert into public.user_roles(user_id,role) values(admin_uuid,'admin')
  on conflict(user_id) do update set role='admin';
end;
$$;
```

- **Customer:** register a different inbox through `/signup`, generate a separate strong temporary password in a password manager and confirm the email. Do not grant this identity an admin role.
- Keep passwords in your password manager, never in source files, terminal logs or chat. No test accounts have been created: only publishable access is available and no controlled inbox addresses were provided. Use the Dashboard to invite accounts. Invitations avoid sharing passwords: each tester sets their own.
- Test the accounts in separate browser profiles. Admin tools are at `/admin/overview`; customer tools at `/dashboard` and `/marketplace`. Role checks query `user_roles` on the server; changing browser metadata cannot grant access.
- Before launch, revoke the staging admin role and ban/remove staging test identities through trusted Supabase administration. Never migrate staging accounts or test fixtures into production.

## Required real-backend checks

Register/confirm both identities, log in, refresh, reset a password from email and log out. Confirm guests cannot see inventory/prices and customers cannot open admin routes. Verify admin product changes appear in the customer's catalog. These checks have **not** been executed against hosted Supabase.

Implemented admin areas: product/category management, inventory quantities, order review/manual fulfillment, revenue overview and audit logs. Customer browsing, history, profile and notifications are implemented. Customer reviews/moderation are implemented and become available after migration 4. Customer management, payment records/provider verification, sandbox checkout/cart, support-ticket handling and website settings remain unfinished. Checkout and wallet funding stay disabled; no live payments or deployment.

References: [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [email templates](https://supabase.com/docs/guides/auth/auth-email-templates), [SMTP restrictions](https://supabase.com/docs/guides/auth/auth-smtp).

## Reviews

Apply `202610100003_profiles_reviews.sql` after the existing three migrations. It synchronizes private profile records from Supabase Auth and adds moderated reviews. Customers submit from `/dashboard/purchases/[id]` only for their own verified, paid, delivered purchases; administrators approve/reject at `/admin/reviews`. Approved feedback appears on the homepage, with optional customer-provided Nigerian location. Refunded purchases are excluded. Each purchased item can be reviewed once, with at most three submissions per customer per day; unpublished reviews and order/customer identifiers stay private.

Supabase project Dashboard: [users/invitations](https://supabase.com/dashboard/project/hdxihldwkugboqrsxokh/auth/users), [SQL editor](https://supabase.com/dashboard/project/hdxihldwkugboqrsxokh/sql/new). No service-role/secret key should be added to the website environment.
