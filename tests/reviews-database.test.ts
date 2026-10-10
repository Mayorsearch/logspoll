import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("reviews require completed owned purchases, enforce moderation/privacy/rate limits and synchronize private profiles", async () => {
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
      "create schema auth; create table auth.users(id uuid primary key,email_confirmed_at timestamptz default now(),raw_user_meta_data jsonb default '{}'::jsonb); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;",
    );
    for (const name of [
      "202610100001_private_catalog.sql",
      "202610100002_customer_panels.sql",
      "202610100003_profiles_reviews.sql",
    ])
      await db.exec(await migration(name));
    const admin = "10000000-0000-4000-8000-000000000001",
      owner = "10000000-0000-4000-8000-000000000002",
      other = "10000000-0000-4000-8000-000000000003",
      unverified = "10000000-0000-4000-8000-000000000004";
    await db.query(
      'insert into auth.users(id,raw_user_meta_data) values($1,\'{"full_name":"Admin"}\'),($2,\'{"full_name":"Owner"}\'),($3,\'{}\')',
      [admin, owner, other],
    );
    await db.query(
      "insert into auth.users(id,email_confirmed_at) values($1,null)",
      [unverified],
    );
    await db.query(
      "insert into public.user_roles(user_id,role) values($1,'admin')",
      [admin],
    );
    const product = (
      await db.query<{ id: string }>(
        "insert into public.products(category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type) select id,'review-tool','Licensed Tool','Authorized software',1234,'Approved supplier',true,'active','Redemption code' from public.categories limit 1 returning id",
      )
    ).rows[0].id;
    const items: string[] = [],
      orders: string[] = [];
    for (let i = 0; i < 8; i++) {
      const order = (
        await db.query<{ id: string }>(
          "insert into public.orders(customer_id,reference,payment_status,fulfillment_status,total_minor) values($1,$2,$3,$4,1234) returning id",
          [
            i === 6 ? other : i === 7 ? unverified : owner,
            `REVIEW-TEST-${i}`,
            i === 4 ? "pending" : "paid",
            i === 4 || i === 5 ? "pending" : "delivered",
          ],
        )
      ).rows[0].id;
      orders.push(order);
      items.push(
        (
          await db.query<{ id: string }>(
            "insert into public.order_items(order_id,product_id,product_name,category_name,quantity,unit_price_minor) values($1,$2,'Licensed Tool','Software',1,1234) returning id",
            [order, product],
          )
        ).rows[0].id,
      );
    }
    const asRole = async (
      role: string,
      uid: string,
      sql: string,
      args: unknown[] = [],
    ) => {
      await db.exec(`begin; set local role ${role};`);
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          uid,
        ]);
        const result = await db.query<Record<string, unknown>>(sql, args);
        await db.exec("commit");
        return result;
      } catch (error) {
        await db.exec("rollback");
        throw error;
      }
    };
    const submit = (uid: string, item: string, stars = 5) =>
      asRole(
        "authenticated",
        uid,
        "select public.submit_review($1,$2,$3,$4,$5) as id",
        [
          item,
          stars,
          "Genuine feedback from an isolated SQL test purchase.",
          "Test Reviewer",
          "Lagos",
        ],
      );
    assert.equal(
      (await asRole("authenticated", owner, "select * from public.profiles"))
        .rows.length,
      1,
    );
    await assert.rejects(
      asRole(
        "authenticated",
        owner,
        "update public.profiles set full_name='Forged'",
      ),
    );
    await db.query(
      'update auth.users set raw_user_meta_data=\'{"full_name":"Updated Owner","role":"admin"}\' where id=$1',
      [owner],
    );
    assert.equal(
      (
        await asRole(
          "authenticated",
          owner,
          "select full_name from public.profiles",
        )
      ).rows[0].full_name,
      "Updated Owner",
    );
    assert.equal(
      (
        await asRole(
          "authenticated",
          owner,
          "select private.is_admin() as admin",
        )
      ).rows[0].admin,
      false,
    );
    await assert.rejects(asRole("anon", "", "select * from public.profiles"));
    for (const item of [items[4], items[5], items[6]])
      await assert.rejects(submit(owner, item));
    await assert.rejects(submit(unverified, items[7]));
    await assert.rejects(submit(owner, items[0], 0));
    await assert.rejects(submit(owner, items[0], 6));
    const review = (await submit(owner, items[0])).rows[0].id;
    await assert.rejects(submit(owner, items[0]));
    const published = async () =>
      JSON.parse(
        JSON.stringify(
          (
            await asRole(
              "anon",
              "",
              "select public.published_reviews(1) as result",
            )
          ).rows[0].result,
        ),
      );
    assert.equal((await published()).reviews.length, 0);
    assert.equal(
      (await asRole("authenticated", other, "select * from public.reviews"))
        .rows.length,
      0,
    );
    await assert.rejects(asRole("anon", "", "select * from public.reviews"));
    await assert.rejects(
      asRole(
        "authenticated",
        owner,
        "update public.reviews set status='approved'",
      ),
    );
    await assert.rejects(
      asRole("authenticated", owner, "delete from public.reviews"),
    );
    await assert.rejects(
      asRole(
        "authenticated",
        owner,
        "select public.moderate_review($1,'approved')",
        [review],
      ),
    );
    await asRole(
      "authenticated",
      admin,
      "select public.moderate_review($1,'approved')",
      [review],
    );
    const approved = (await published()).reviews[0];
    assert.equal(approved.verified_purchase, true);
    assert.equal(approved.location, "Lagos");
    assert.deepEqual(
      Object.keys(approved).sort(),
      [
        "id",
        "display_name",
        "rating",
        "message",
        "location",
        "created_at",
        "verified_purchase",
      ].sort(),
    );
    await db.query(
      "update public.orders set payment_status='refunded' where id=$1",
      [orders[0]],
    );
    assert.equal((await published()).reviews.length, 0);
    await db.query(
      "update public.orders set payment_status='paid' where id=$1",
      [orders[0]],
    );
    await submit(owner, items[1]);
    await submit(owner, items[2]);
    await assert.rejects(submit(owner, items[3]), /Daily review limit/);
    await asRole(
      "authenticated",
      admin,
      "select public.moderate_review($1,'rejected')",
      [review],
    );
    assert.equal((await published()).reviews.length, 0);
    assert.equal(
      (
        await asRole(
          "authenticated",
          owner,
          "select status from public.reviews where id=$1",
          [review],
        )
      ).rows[0].status,
      "rejected",
    );
    await assert.rejects(
      asRole(
        "authenticated",
        admin,
        "select public.moderate_review($1,'invalid')",
        [review],
      ),
    );
    await assert.rejects(
      asRole("anon", "", "select public.published_reviews(10001)"),
    );
    assert.ok(
      (
        await db.query(
          "select id from public.audit_logs where table_name='reviews' and action='UPDATE'",
        )
      ).rows.length >= 2,
    );
  } finally {
    await db.close();
  }
});
