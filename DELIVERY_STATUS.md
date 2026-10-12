# LOGSPOLL delivery status

**Latest task supersedes the historical database blocker below:** user reports real admin/customer login, database and manual products working. New `/admin/settings/supplier-api` page and YoungPG adapter are implemented with AES-GCM key storage, server-verified admin operations, category fetching, paginated staged sync, approval/rejection and preserved manual selling prices. `202610110002_configurable_suppliers.sql` is additive and NOT applied. Official provider header/endpoints/price/stock fields are confirmed; live key, full response shape and imports remain unverified (0 executed). See [SUPPLIER_SETUP.md](SUPPLIER_SETUP.md) for current instructions. Existing checkout remains disabled; no payment provider/webhook or secure order/fulfillment workflow is configured. No deploy/push.

Current verification: **24 automated tests pass** (mocked provider/database transport), production build passes with the existing chunk-size warning, Functions TypeScript/bundling passes, and local Wrangler checks verify supplier GET/POST 401 without login, cross-origin 403, disabled checkout 503 and settings SPA deep-link 200. Frontend asset checks find no supplier credential, privileged JWT or backend encryption/service-role configuration. Actual authenticated browser actions, PostgreSQL migration execution and live provider synchronization remain unverified. Local runtime probes used a synthetic public-key binding solely to test early denial; no live supplier or authenticated database operations ran.

**Not production ready.** Implementation is prepared on `rebuild/react-vite`; no push, deployment, migration execution, test-account creation, supplier import or payment was performed.

Latest repair pass (2026-10-11): `npm run check:supabase` confirms Auth settings HTTP 200 and nine application resources HTTP 404 / PGRST205. Added repeatable read-only API probes, SQL diagnostics, and a guarded atomic bootstrap for a confirmed empty LOGSPOLL schema; none executes database changes automatically. See [database repair instructions](supabase/manual/README.md). The public key cannot inspect or repair database schema. Live signup/login, orders and review operations remain unverified. Per the requested database-first gate, dynamic encrypted supplier configuration, credential replacement, markup/FX pricing and scheduling remain unfinished; the existing fixed supplier adapter is not a dynamic provider manager. No products imported in this pass. No new Cloudflare encryption secret is wired yet.

Fresh local verification in this repair pass: **12/12 automated tests pass**, `npm run build` passes (application and Functions TypeScript plus Vite), and Wrangler compiles the Pages Functions Worker successfully with logs directed to `/tmp`. The existing >500 kB chunk warning remains. SQL was generated, not executed or PostgreSQL-tested; browser, authentication and provider end-to-end tests remain unverified.

After explicit deployment approval and resolution of the blockers, from the repository root use `npx wrangler pages deploy dist --project-name logspoll --branch rebuild/react-vite` (verify the existing Pages project name first). This command has NOT been run. Current runtime configuration is listed in `.dev.vars.example`; dynamic credential encryption secrets/storage are not implemented and must not be represented as configured.

| Requested item | Verified status |
|---|---|
| ADMIN LOGIN URL | `http://127.0.0.1:5173/admin/login` (start Vite locally) |
| ADMIN ACCOUNT STATUS | Not provisioned. Privileged access/account email missing. Exact secure signup and trusted SQL role assignment steps are in LAUNCH_SETUP.md. |
| CUSTOMER LOGIN URL | `http://127.0.0.1:5173/login`; registration `/signup` |
| CUSTOMER ACCOUNT STATUS | Not provisioned. User chooses a real email/password and verifies it. |
| SUPABASE CONNECTION | Matching existing public configuration recovered safely; Auth settings HTTP 200. Products API HTTP 404 / PGRST205. Live schema/RLS and login unverified. |
| SUPPLIER API CONNECTION | Secure Pages Function prepared; no live supplier request. Rotated key, verified response adapter/currency, and product-specific resale authorization are missing. |
| IMPORTED ELIGIBLE PRODUCTS | 0; no import executed. |
| PRODUCT SYNC STATUS | Prepared: server identity/role checks, cooldown, response validation, authorization allowlist, staged upsert, approval/rejection, independent wholesale cost/retail price and stock refresh. New SQL is unexecuted and unverified against PostgreSQL. |
| ADMIN DASHBOARD | Approved twelve-section layout preserved; real queries, product/category saves, reviews, support, settings and supplier approval wired. Auth user management remains in Supabase operator dashboard. No demo login routes. |
| CUSTOMER DASHBOARD | Existing authenticated profile/orders/purchases/settings retained; eligible review submission added. Live records inaccessible until database rollout is verified. |
| PAYMENT STATUS | Disabled. No provider configured, sandbox verification/webhook/ledger/refund/stock reservation or supplier purchase workflow implemented. |
| REVIEWS STATUS | Existing genuine-review RPC paths wired for submit/moderate/publish. Exact five illustrative Nigerian testimonials recovered for development only, excluded from production assets. Live review workflows unverified. |
| PRODUCTION BUILD | PASS: TypeScript app and Functions checks plus Vite build. Vite warns of a JS chunk above 500 kB; optional code splitting remains. |
| CLOUDFLARE DEPLOYMENT METHOD | Prepared for Pages Git integration or Wrangler including functions; no deployment. Worker bundle compiled successfully (Wrangler's outside-workspace log write was denied; compilation still exited successfully). Runtime/end-to-end compatibility remains unverified. |
| BUILD OUTPUT DIRECTORY | `dist` |
| MISSING REQUIREMENTS | Approved database rollout, account emails/operator provisioning, SMTP/auth redirects, rotated supplier key and official response examples, resale evidence/allowlist, purchase endpoint, sandbox payment integration; final legal review. |
| UNVERIFIED TESTS | Live login/email/recovery, actual RLS/customer isolation, live admin CRUD, PostgreSQL migration execution, supplier response/pagination, Pages runtime, browser clicks/responsiveness, payment/fulfillment end-to-end. |
| DEPLOYMENT BLOCKERS | Products unavailable in API schema; major live database/account/supplier/payment security configuration remains incomplete. Deployment has not been authorized. |

Focused automated checks: **12 tests passed**, covering safe redirects/public keys, owner-scoped requests, explicit error states, supplier schema/pricing/stock validation, allowlisting, forbidden inventory, secret error redaction, denial of customer admin requests and sync cooldown. These tests mock transport and do not prove live RLS or ownership isolation.

Setup and manual verification: [LAUNCH_SETUP.md](LAUNCH_SETUP.md). Database changes follow a staged additive rollout and application-only rollback without dropping data. All new migration execution requires operator review and approval. Supplier documentation's public link redirects to login, so the adapter contract is explicitly unverified and disabled by default.
