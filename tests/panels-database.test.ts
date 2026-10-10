import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("customer orders are isolated; only verified paid orders can be delivered once", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role bypassrls;",
    );
    const migration = (name: string) =>
      readFile(
        new URL(`../supabase/migrations/${name}`, import.meta.url),
        "utf8",
      );
    await db.exec(await migration("202610090001_catalog.sql"));
    await db.exec(
      "create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;",
    );
    await db.exec(await migration("202610100001_private_catalog.sql"));
    await db.exec(await migration("202610100002_customer_panels.sql"));
    const admin = "10000000-0000-4000-8000-000000000001",
      owner = "10000000-0000-4000-8000-000000000002",
      other = "10000000-0000-4000-8000-000000000003";
    const paid = "20000000-0000-4000-8000-000000000001",
      unpaid = "20000000-0000-4000-8000-000000000002",
      item = "30000000-0000-4000-8000-000000000001";
    await db.query("insert into auth.users values($1),($2),($3)", [
      admin,
      owner,
      other,
    ]);
    await db.query(
      "insert into public.user_roles(user_id,role) values($1,'admin')",
      [admin],
    );
    const product = (
      await db.query<{ id: string }>(
        "insert into public.products(category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type) select id,'licensed-tool','Licensed Tool','Authorized software',1234,'Approved supplier',true,'active','Redemption code' from public.categories limit 1 returning id",
      )
    ).rows[0].id;
    await db.query(
      "insert into public.orders(id,customer_id,reference,payment_status,total_minor) values($1,$3,'PAID','paid',1234),($2,$3,'UNPAID','pending',1234)",
      [paid, unpaid, owner],
    );
    await db.query(
      "insert into public.order_items(id,order_id,product_id,product_name,category_name,quantity,unit_price_minor) values($1,$2,$3,'Licensed Tool','Software',1,1234)",
      [item, paid, product],
    );
    const asRole = async (
      role: string,
      uid: string,
      sql: string,
      args: unknown[] = [],
      commit = false,
    ) => {
      await db.exec(`begin; set local role ${role};`);
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          uid,
        ]);
        const result = await db.query<Record<string, unknown>>(sql, args);
        await db.exec(commit ? "commit" : "rollback");
        return result;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    };
    await assert.rejects(
      asRole("anon", "", "select * from public.orders"),
      /permission denied/,
    );
    assert.equal(
      (await asRole("authenticated", owner, "select * from public.orders")).rows
        .length,
      2,
    );
    assert.equal(
      (await asRole("authenticated", other, "select * from public.orders")).rows
        .length,
      0,
    );
    assert.equal(
      (await asRole("authenticated", other, "select * from public.order_items"))
        .rows.length,
      0,
    );
    for (const who of [owner, admin])
      await assert.rejects(
        asRole(
          "authenticated",
          who,
          "update public.orders set payment_status='paid'",
        ),
        /permission denied/,
      );
    await assert.rejects(
      asRole(
        "authenticated",
        owner,
        "select public.admin_fulfill_order($1,$2::jsonb)",
        [paid, JSON.stringify({ [item]: "CODE" })],
      ),
      /Not authorized/,
    );
    await assert.rejects(
      asRole(
        "authenticated",
        admin,
        "select public.admin_fulfill_order($1,'{}'::jsonb)",
        [unpaid],
      ),
      /verified paid/,
    );
    await assert.rejects(
      asRole(
        "authenticated",
        admin,
        "select public.admin_fulfill_order($1,'{}'::jsonb)",
        [paid],
      ),
      /Instructions/,
    );
    assert.equal(
      (await db.query("select * from public.product_entitlements")).rows.length,
      0,
    );
    await asRole(
      "authenticated",
      admin,
      "select public.admin_fulfill_order($1,$2::jsonb)",
      [paid, JSON.stringify({ [item]: "AUTHORIZED-TEST-CODE" })],
      true,
    );
    await asRole(
      "authenticated",
      admin,
      "select public.admin_fulfill_order($1,$2::jsonb)",
      [paid, JSON.stringify({ [item]: "DUPLICATE-MUST-NOT-REPLACE" })],
      true,
    );
    const visible = await asRole(
      "authenticated",
      owner,
      "select instructions from public.product_entitlements",
    );
    assert.equal(visible.rows.length, 1);
    assert.equal(visible.rows[0].instructions, "AUTHORIZED-TEST-CODE");
    assert.equal(
      (
        await asRole(
          "authenticated",
          other,
          "select * from public.product_entitlements",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await asRole(
          "authenticated",
          admin,
          "select * from public.product_entitlements",
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await asRole(
          "authenticated",
          owner,
          "select * from public.notifications",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await asRole(
          "authenticated",
          other,
          "select * from public.notifications",
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      asRole(
        "authenticated",
        owner,
        "update public.notifications set user_id=$1",
        [other],
      ),
      /permission denied/,
    );
    await asRole(
      "authenticated",
      owner,
      "update public.notifications set read_at=now()",
      [],
      true,
    );
    assert.ok(
      (await db.query<{ read_at: string | null }>("select read_at from public.notifications")).rows[0]
        .read_at,
    );
    assert.equal(
      (
        await db.query(
          "select * from public.audit_logs where table_name='orders' and action='UPDATE'",
        )
      ).rows.length,
      1,
    );
    assert.equal(
      JSON.stringify(
        (await db.query("select * from public.audit_logs")).rows,
      ).includes("AUTHORIZED-TEST-CODE"),
      false,
    );
    await assert.rejects(
      asRole("authenticated", owner, "select public.panel_admin_overview()"),
      /Not authorized/,
    );
    const totals = (
      await asRole(
        "authenticated",
        admin,
        "select public.panel_admin_overview() as totals",
      )
    ).rows[0].totals as { revenue_minor: number };
    assert.equal(totals.revenue_minor, 1234);
  } finally {
    await db.close();
  }
});
