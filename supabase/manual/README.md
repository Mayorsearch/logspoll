# Database repair gate

2026-10-11 read-only API checks: Auth settings HTTP 200; `categories`, `products`,
`storefront_products`, `storefront_categories`, `user_roles`, `profiles`, `orders`,
`order_items`, and `reviews` each HTTP 404 / PGRST205. This confirms that these
resources are unavailable through the configured API, not that the underlying
database is empty. No privileged connection or authenticated test identity is available.

The application and retained migrations consistently use `public.products`;
renaming frontend queries would conceal the problem rather than repair it.

1. Open the **existing** Supabase project `hdxihldwkugboqrsxokh`, SQL Editor.
   Run [diagnose.sql](diagnose.sql), which is read-only. Check object existence,
   columns, schema locations, policies, grants, function signatures, and migration
   history. Check Data API exposed schemas include `public`.
2. **If application objects already exist:** do not execute the bootstrap. Compare
   diagnostic output with the six retained migrations in chronological order.
   Apply only reviewed missing migrations compatible with that schema. Do not
   rename, drop or recreate existing tables, relax RLS, or replay applied migrations.
   If the schema is correct but the cache is stale, manually execute only:

   ```sql
   notify pgrst, 'reload schema';
   ```

3. **Only if all LOGSPOLL objects are absent and operator approval is obtained:**
   review [bootstrap_empty_project.sql](bootstrap_empty_project.sql) and execute
   it manually. It reuses all six migrations in one transaction, aborts if any
   application table/view exists, commits private catalog policies atomically,
   and requests a schema cache refresh. It creates no products or admin accounts;
   it backfills profiles for existing Auth users. Existing unrelated schemas remain.
   An error rolls back the entire transaction. PostgreSQL execution is untested.
4. After rollout run `npm run check:supabase`. Expected anonymous catalog/record
   queries are denied (401/403), not successful or PGRST205. Auth settings and
   public categories should succeed. This command never retrieves customer rows.
5. Provision and verify the real customer/admin identities using
   [LAUNCH_SETUP.md](../../LAUNCH_SETUP.md). Optionally provide a short-lived real
   access token through `LOGSPOLL_VERIFY_TOKEN` in your terminal environment to
   rerun the same read-only probes as that user. Do not paste tokens into chat,
   command history or committed files. These probes cannot prove cross-user RLS.
6. Complete actual two-user isolation, admin denial/allowance, catalog reads,
   order ownership, and eligible review submit/moderate/publish tests before
   unblocking supplier development or deployment. No fabricated purchases should
   be created to make review tests pass.

`npm run prepare:database` regenerates the bootstrap from the retained migrations;
it never contacts Supabase. Do not also replay the constituent migrations after
executing the bootstrap. Manual SQL Editor execution does not automatically
record CLI migration history: reconcile history against the exact reviewed files
before any later `supabase db push`. Never use a blind database push as this repair.

Supplier work remains at its previous implementation: a fixed-provider adapter
requiring server secrets and verified documentation. Dynamic encrypted credentials,
provider selection, markup/FX rules, and scheduled sync are **not implemented**.
The required future encryption secret/backend-only credential schema is not yet
defined; do not add guessed secret names or enable an unverified provider.

Reference: [PostgREST schema-cache errors](https://docs.postgrest.org/en/stable/references/errors.html#group-2-schema-cache).
