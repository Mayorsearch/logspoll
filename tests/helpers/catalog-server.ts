// Local integration fixture only. Hosted Supabase Auth/PostgREST still requires configuration and testing.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
await db.exec(
  "create role anon; create role authenticated; create role service_role bypassrls;",
);
await db.exec(
  await readFile(
    new URL(
      "../../supabase/migrations/202610090001_catalog.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
await db.exec(
  "create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now(),raw_user_meta_data jsonb default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;",
);
await db.exec(
  await readFile(
    new URL(
      "../../supabase/migrations/202610100001_private_catalog.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
await db.exec(
  await readFile(
    new URL(
      "../../supabase/migrations/202610100002_customer_panels.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const interactive = process.env.LOGSPOLL_LOCAL_PANEL_TEST === "1";
await db.exec(
  await readFile(
    new URL(
      "../../supabase/migrations/202610100003_profiles_reviews.sql",
      import.meta.url,
    ),
    "utf8",
  ),
);
const otherCustomer = "10000000-0000-4000-8000-000000000003";
const customer = "10000000-0000-4000-8000-000000000002",
  admin = "10000000-0000-4000-8000-000000000001";
await db.query("insert into auth.users(id) values($1),($2),($3)", [
  admin,
  customer,
  otherCustomer,
]);
await db.query(
  "insert into public.user_roles(user_id,role) values($1,'admin'),($2,'customer')",
  [admin, customer],
);
await db.query(
  "insert into public.categories(slug,name,short_name,icon,color) values ('business-suite','Business Tools','Business Tools','briefcase','blue')",
);
for (let i = 1; i <= 12; i++) {
  await db.query(
    `insert into public.products(category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type,featured) select id,$1,$2,'Licensed business software',$3,'Test supplier',true,'active','Manual fulfillment',$4 from public.categories where slug='business-suite'`,
    [
      `business-tool-${i}`,
      `Business Tool ${String(i).padStart(2, "0")}`,
      i === 1 ? 123456 : i * 100000,
      i <= 4,
    ],
  );
}
await db.query(
  "insert into public.inventory(product_id,available_quantity) select id,2 from public.products where slug<>'business-tool-12'",
);
// Isolated fixtures only; these rows never enter a hosted database.
for (const [suffix, owner, payment, fulfillment, slug] of [
  ["001", customer, "paid", "delivered", "business-tool-1"],
  ["002", customer, "paid", "pending", "business-tool-2"],
  ["003", customer, "pending", "pending", "business-tool-3"],
  ["004", otherCustomer, "paid", "delivered", "business-tool-4"],
] as const) {
  const orderId = `20000000-0000-4000-8000-000000000${suffix}`;
  const itemId = `30000000-0000-4000-8000-000000000${suffix}`;
  await db.query(
    "insert into public.orders(id,customer_id,reference,payment_status,fulfillment_status,total_minor) select $1,$2,$3,$4,$5,price_minor from public.products where slug=$6",
    [orderId, owner, `LOCAL-TEST-${suffix}`, payment, fulfillment, slug],
  );
  await db.query(
    "insert into public.order_items(id,order_id,product_id,product_name,category_name,quantity,unit_price_minor) select $1,$2,id,name,'Business Tools',1,price_minor from public.products where slug=$3",
    [itemId, orderId, slug],
  );
  if (fulfillment === "delivered")
    await db.query(
      "insert into public.product_entitlements(order_item_id,instructions) values($1,$2)",
      [
        itemId,
        owner === customer
          ? "TEST LICENSE ONLY: LOGSPOLL-LOCAL-001\nThis fixture does not provide access to any real service."
          : "OTHER-CUSTOMER-PRIVATE",
      ],
    );
}
const names = new Map([
  [admin, "Test Administrator"],
  [customer, "Test Customer"],
  [otherCustomer, "Other Test Customer"],
]);
const user = (id: string) => ({
  id,
  aud: "authenticated",
  role: "authenticated",
  email: `${id === admin ? "admin" : "customer"}@example.test`,
  email_confirmed_at: "2026-10-10T00:00:00Z",
  created_at: "2026-10-10T00:00:00Z",
  app_metadata: { provider: "email" },
  user_metadata: {
    full_name: names.get(id) || "Test Customer",
  },
});
const expiresAt = Math.floor(Date.now() / 1000) + 86400;
const token = (id: string) =>
  `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString("base64url")}.${Buffer.from(JSON.stringify({ sub: id, role: "authenticated", exp: expiresAt })).toString("base64url")}.localtestsignature`;
const tokens = new Map([
  [token(admin), admin],
  [token(customer), customer],
  [token(otherCustomer), otherCustomer],
]);
let failing = false,
  queue = Promise.resolve();
const server = createServer((req, res) => {
  queue = queue
    .then(async () => {
      const url = new URL(req.url || "/", "http://127.0.0.1");
      res.setHeader("Content-Type", "application/json");
      if (interactive && url.pathname === "/__test/panels") {
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(
          `<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>LOGSPOLL local panel testing</title><style>body{font:15px/1.7 Arial,sans-serif;background:#f8fafc;color:#10172d;margin:0;padding:50px 20px}main{max-width:600px;margin:auto;background:white;border:1px solid #e7ebf1;border-radius:20px;padding:32px}h1{font-size:28px}strong{color:#dc5700}form{display:inline-block;margin:12px 10px 12px 0}button{padding:13px 20px;border:0;border-radius:9px;color:white;background:#11172c;cursor:pointer}p{color:#66738a}</style><main><strong>LOGSPOLL · LOCAL TEST DATABASE</strong><h1>Test your customer and admin panels</h1><p>This isolated database contains test records only. No Supabase project, live payments or real entitlements are connected.</p><form action="/__test/open" method="post"><input type="hidden" name="role" value="customer"><button>Open customer panel</button></form><form action="/__test/open" method="post"><input type="hidden" name="role" value="admin"><button>Open admin panel</button></form><p>Changes stay in this test database while the server runs. Restarting resets all fixtures. Use the yellow test banner to switch roles. This launcher binds only to this computer and is never included in the website’s production routes.</p></main></html>`,
        );
        return;
      }
      if (
        interactive &&
        url.pathname === "/__test/open" &&
        req.method === "POST"
      ) {
        if (req.headers.origin !== "http://127.0.0.1:3101") {
          res.statusCode = 403;
          res.end("{}");
          return;
        }
        let body = "";
        for await (const chunk of req) {
          body += chunk;
          if (body.length > 1024) throw new Error("Request too large");
        }
        const id =
          new URLSearchParams(body).get("role") === "admin" ? admin : customer;
        const session = {
          access_token: token(id),
          refresh_token: "test-refresh-token",
          token_type: "bearer",
          expires_in: 86400,
          expires_at: expiresAt,
          user: user(id),
        };
        res.setHeader(
          "Set-Cookie",
          `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`,
        );
        res.statusCode = 303;
        res.setHeader(
          "Location",
          `http://127.0.0.1:3100/${id === admin ? "admin/overview" : "dashboard/purchases"}`,
        );
        res.end();
        return;
      }
      if (url.pathname === "/__test/session") {
        const id =
          url.searchParams.get("role") === "admin"
            ? admin
            : url.searchParams.get("role") === "other"
              ? otherCustomer
              : customer;
        const session = {
          access_token: token(id),
          refresh_token: "test-refresh-token",
          token_type: "bearer",
          expires_in: 86400,
          expires_at: expiresAt,
          user: user(id),
        };
        res.end(
          JSON.stringify({
            name: "sb-127-auth-token",
            value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
          }),
        );
        return;
      }
      if (url.pathname === "/__test/failure") {
        failing = url.searchParams.get("enabled") === "true";
        res.end("{}");
        return;
      }
      const bearer = String(req.headers.authorization || "").replace(
        /^Bearer /,
        "",
      );
      const uid = tokens.get(bearer);
      if (url.pathname === "/auth/v1/user") {
        if (uid && req.method === "PUT") {
          let body = "";
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 10000) throw new Error("Request too large");
          }
          const update = JSON.parse(body);
          const name = update.data?.full_name;
          if (
            typeof name === "string" &&
            name.trim().length >= 2 &&
            name.trim().length <= 120
          )
            names.set(uid, name.trim());
        }

        res.statusCode = uid ? 200 : 401;
        res.end(JSON.stringify(uid ? user(uid) : { message: "Invalid token" }));
        return;
      }
      if (url.pathname === "/auth/v1/logout") {
        res.statusCode = 204;
        res.end();
        return;
      }
      if (failing) {
        res.statusCode = 503;
        res.end('{"message":"private provider diagnostics"}');
        return;
      }
      if (req.headers.apikey !== "sb_publishable_localtest") {
        res.statusCode = 403;
        res.end("{}");
        return;
      }
      await db.exec(`begin; set local role ${uid ? "authenticated" : "anon"};`);
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          uid || "",
        ]);
        let rows: unknown;
        let body = "";
        if (req.method === "POST" || req.method === "PATCH") {
          for await (const chunk of req) {
            body += chunk;
            if (body.length > 100000) throw new Error("Request too large");
          }
        }
        const args = body ? JSON.parse(body) : {};
        if (url.pathname === "/rest/v1/storefront_categories")
          rows = (
            await db.query(
              "select * from public.storefront_categories order by sort_order,slug",
            )
          ).rows;
        else if (url.pathname === "/rest/v1/storefront_products")
          rows = (
            await db.query(
              "select * from public.storefront_products where slug=$1 limit 1",
              [(url.searchParams.get("slug") || "").slice(3)],
            )
          ).rows;
        else if (url.pathname === "/rest/v1/rpc/storefront_search")
          rows = (
            await db.query<{ result: unknown }>(
              "select public.storefront_search($1,$2,$3,$4,$5,$6,$7) as result",
              [
                args.q,
                args.category_slug,
                args.min_minor,
                args.max_minor,
                args.availability,
                args.sort_by,
                args.requested_page,
              ],
            )
          ).rows[0].result;
        else if (url.pathname === "/rest/v1/rpc/published_reviews")
          rows = (
            await db.query<{ result: unknown }>(
              "select public.published_reviews($1) as result",
              [args.requested_page],
            )
          ).rows[0].result;
        else if (url.pathname === "/rest/v1/rpc/submit_review")
          rows = (
            await db.query<{ result: string }>(
              "select public.submit_review($1,$2,$3,$4,$5) as result",
              [
                args.item_uuid,
                args.stars,
                args.feedback,
                args.customer_name,
                args.customer_location,
              ],
            )
          ).rows[0].result;
        else if (url.pathname === "/rest/v1/rpc/moderate_review") {
          await db.query("select public.moderate_review($1,$2)", [
            args.review_uuid,
            args.decision,
          ]);
          rows = null;
        } else if (url.pathname === "/rest/v1/reviews") {
          const itemIds =
            url.searchParams.get("order_item_id")?.slice(4, -1).split(",") ||
            null;
          rows = (
            await db.query(
              "select * from public.reviews where ($1::uuid[] is null or order_item_id=any($1::uuid[])) and ($2::text is null or status=$2) order by created_at desc,id limit $3 offset $4",
              [
                itemIds,
                url.searchParams.get("status")?.slice(3) || null,
                Math.min(Number(url.searchParams.get("limit")) || 31, 101),
                Math.min(Number(url.searchParams.get("offset")) || 0, 500000),
              ],
            )
          ).rows;
        } else if (url.pathname === "/rest/v1/rpc/admin_save_product")
          rows = (
            await db.query<{ result: string }>(
              "select public.admin_save_product($1::jsonb) as result",
              [JSON.stringify(args.p)],
            )
          ).rows[0].result;
        else if (url.pathname === "/rest/v1/rpc/panel_admin_overview")
          rows = (
            await db.query<{ result: unknown }>(
              "select public.panel_admin_overview() as result",
            )
          ).rows[0].result;
        else if (url.pathname === "/rest/v1/rpc/admin_fulfill_order") {
          await db.query("select public.admin_fulfill_order($1,$2::jsonb)", [
            args.order_uuid,
            JSON.stringify(args.delivery),
          ]);
          rows = null;
        } else if (url.pathname === "/rest/v1/orders") {
          const offset = Math.min(
              Number(url.searchParams.get("offset")) || 0,
              500000,
            ),
            limit = Math.min(Number(url.searchParams.get("limit")) || 31, 101);
          rows = (
            await db.query(
              `select o.*,coalesce((select jsonb_agg(i) from public.order_items i where i.order_id=o.id),'[]'::jsonb) as order_items from public.orders o where ($1::uuid is null or o.id=$1) and ($2::uuid is null or o.customer_id=$2) order by o.created_at desc,o.id limit $3 offset $4`,
              [
                url.searchParams.get("id")?.slice(3) || null,
                url.searchParams.get("customer_id")?.slice(3) || null,
                limit,
                offset,
              ],
            )
          ).rows;
        } else if (url.pathname === "/rest/v1/product_entitlements") {
          const ids = (url.searchParams.get("order_item_id") || "")
            .slice(4, -1)
            .split(",")
            .filter(Boolean);
          rows = (
            await db.query(
              "select order_item_id,instructions from public.product_entitlements where order_item_id=any($1::uuid[])",
              [ids],
            )
          ).rows;
        } else if (url.pathname === "/rest/v1/notifications") {
          if (req.method === "PATCH")
            rows = (
              await db.query(
                "update public.notifications set read_at=$1 where user_id=$2 and read_at is null returning *",
                [args.read_at, uid],
              )
            ).rows;
          else
            rows = (
              await db.query(
                "select * from public.notifications where user_id=$1 order by created_at desc limit 50",
                [uid],
              )
            ).rows;
        } else if (url.pathname === "/rest/v1/audit_logs")
          rows = (
            await db.query(
              "select * from public.audit_logs order by created_at desc,id limit $1 offset $2",
              [
                Math.min(Number(url.searchParams.get("limit")) || 51, 51),
                Math.min(Number(url.searchParams.get("offset")) || 0, 500000),
              ],
            )
          ).rows;
        else if (url.pathname === "/rest/v1/user_roles")
          rows = (
            await db.query(
              "select role from public.user_roles where user_id=$1 and role='admin'",
              [uid || null],
            )
          ).rows;
        else if (url.pathname === "/rest/v1/categories") {
          if (req.method === "PATCH")
            rows = (
              await db.query(
                "update public.categories set name=$1,slug=$2,short_name=$3,description=$4,active=$5 where id=$6 returning *",
                [
                  args.name,
                  args.slug,
                  args.short_name,
                  args.description,
                  args.active,
                  url.searchParams.get("id")?.slice(3),
                ],
              )
            ).rows;
          else if (req.method === "POST")
            rows = (
              await db.query(
                "insert into public.categories(slug,name,short_name,description,icon,color) values($1,$2,$3,$4,$5,$6) returning *",
                [
                  args.slug,
                  args.name,
                  args.short_name,
                  args.description,
                  args.icon,
                  args.color,
                ],
              )
            ).rows;
          else
            rows = (
              await db.query(
                "select * from public.categories order by sort_order",
              )
            ).rows;
        } else if (url.pathname === "/rest/v1/products")
          rows = (
            await db.query(
              `select p.*,jsonb_build_object('name',c.name) as categories,case when i.product_id is null then null else jsonb_build_object('available_quantity',i.available_quantity) end as inventory from public.products p join public.categories c on c.id=p.category_id left join public.inventory i on i.product_id=p.id where ($1::uuid is null or p.id=$1) order by p.created_at desc limit 100`,
              [url.searchParams.get("id")?.slice(3) || null],
            )
          ).rows;
        else {
          res.statusCode = 404;
          rows = {};
        }
        if (
          String(req.headers.accept).includes("vnd.pgrst.object+json") &&
          Array.isArray(rows)
        )
          rows = rows[0] || null;
        await db.exec("commit");
        res.end(JSON.stringify(rows));
      } catch {
        await db.exec("rollback");
        res.statusCode = 403;
        res.end('{"message":"request denied"}');
      }
    })
    .catch(() => {
      res.statusCode = 500;
      res.end("{}");
    });
});
await new Promise<void>((resolve) => server.listen(3101, "127.0.0.1", resolve));
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    "start",
    "--hostname",
    "127.0.0.1",
    "--port",
    "3100",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_SITE_URL: "http://127.0.0.1:3100",
      SUPABASE_URL: "http://127.0.0.1:3101",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_localtest",
    },
  },
);
if (interactive)
  process.stdout.write(
    "\nLOGSPOLL local testing: http://127.0.0.1:3101/__test/panels\nTest records only. Restart resets the isolated database.\n\n",
  );
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  child.kill("SIGTERM");
  server.close();
  await db.close();
}
process.on("SIGTERM", () => {
  void stop();
});
process.on("SIGINT", () => {
  void stop();
});
child.on("exit", () => {
  void stop();
});
