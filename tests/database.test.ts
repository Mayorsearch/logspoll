import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  new URL("../supabase/migrations/202610090001_catalog.sql", import.meta.url),
  "utf8",
);
test("catalog migration enforces visibility, write restrictions, integrity and paginated search", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "create role anon; create role authenticated; create role service_role bypassrls;",
    );
    await db.exec(migration);
    const asRole = async (
      role: string,
      sql: string,
      args: unknown[] = [],
      uid = "",
    ) => {
      await db.exec(`begin; set local role ${role};`);
      try {
        await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
          uid,
        ]);
        return await db.query<{ result: unknown }>(sql, args);
      } finally {
        await db.exec("rollback");
      }
    };
    assert.equal(
      (await asRole("anon", "select * from public.storefront_categories")).rows
        .length,
      10,
    );
    assert.equal(
      (await asRole("anon", "select * from public.storefront_products")).rows
        .length,
      0,
    );
    await assert.rejects(
      db.query(
        "insert into public.categories(slug,name,short_name) values ('business-tools','Reserved','Reserved')",
      ),
      /categories_reserved_slug/,
    );
    await db.query(
      "insert into public.categories(slug,name,short_name) values ('new-tools','New Tools','New Tools')",
    );
    for (let i = 1; i <= 12; i++) {
      await db.query(
        `insert into public.products(id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type,featured)
        select $1,id,$2,$3,'Licensed business tool', $4,'Authorized supplier',true,'active','Manual fulfillment',$5 from public.categories where slug='new-tools'`,
        [
          `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
          `licensed-tool-${i}`,
          `Licensed Tool ${String(i).padStart(2, "0")}`,
          i * 10000,
          i < 5,
        ],
      );
    }
    await db.query(
      "insert into public.inventory(product_id,available_quantity) select id,3 from public.products where slug <> 'licensed-tool-12'",
    );
    await db.query(
      "insert into public.products(category_id,slug,name,description,price_minor,supplier_name,status,delivery_type) select id,'draft','Draft','Not approved',100,'Unverified','draft','Manual fulfillment' from public.categories limit 1",
    );
    for (const role of ["anon", "authenticated"]) {
      const visible = await asRole(
        role,
        "select * from public.storefront_products",
      );
      assert.equal(visible.rows.length, 12);
      assert.equal(
        (await asRole(role, "select * from public.products where slug='draft'"))
          .rows.length,
        0,
      );
      assert.equal(
        (await asRole(role, "select * from public.inventory")).rows.length,
        11,
      );
      for (const sql of [
        "update public.products set price_minor=0",
        "update public.inventory set available_quantity=999",
        "delete from public.categories",
        "insert into public.categories(slug,name,short_name) values ('evil','Evil','Evil')",
        "update public.storefront_products set name='Tampered'",
      ]) {
        await assert.rejects(
          asRole(role, sql),
          /permission denied|cannot update view/,
        );
      }
    }
    const search = async (args: unknown[]) =>
      (
        await asRole(
          "anon",
          "select public.storefront_search($1,$2,$3,$4,$5,$6,$7) as result",
          args,
        )
      ).rows[0].result as {
        total: number;
        page: number;
        pages: number;
        products: {
          slug: string;
          available_quantity: number;
          price_minor: number;
        }[];
      };
    let result = await search([
      "",
      "new-tools",
      null,
      null,
      "",
      "price-asc",
      1,
    ]);
    assert.equal(result.total, 12);
    assert.equal(result.pages, 2);
    assert.equal(result.products.length, 9);
    assert.equal(result.products[0].price_minor, 10000);
    result = await search(["", "new-tools", null, null, "", "price-asc", 999]);
    assert.equal(result.page, 2);
    assert.equal(result.products.length, 3);
    result = await search([
      "licensed",
      "new-tools",
      20000,
      50000,
      "in-stock",
      "price-desc",
      1,
    ]);
    assert.equal(result.total, 4);
    assert.equal(result.products[0].price_minor, 50000);
    result = await search([
      "",
      "new-tools",
      null,
      null,
      "out-of-stock",
      "featured",
      1,
    ]);
    assert.equal(result.total, 1);
    assert.equal(result.products[0].available_quantity, 0);
    assert.equal(
      (await search(["%", "", null, null, "", "featured", 1])).total,
      0,
    );
    assert.equal(
      (await search(["", "", 90000, 10000, "", "featured", 1])).total,
      0,
    );
    await assert.rejects(
      search(["", "", null, null, "", "invalid", 1]),
      /Invalid catalog filters/,
    );
    await assert.rejects(
      search(["x".repeat(121), "", null, null, "", "featured", 1]),
      /Invalid catalog filters/,
    );
    await assert.rejects(
      db.query("update public.products set status='active' where slug='draft'"),
      /check constraint/,
    );
    await assert.rejects(
      db.query("update public.inventory set available_quantity=-1"),
      /check constraint/,
    );
    await assert.rejects(
      db.query("update public.products set price_minor=-1"),
      /check constraint/,
    );
    await assert.rejects(
      db.query("update public.products set image_path='../../secret.png'"),
      /check constraint/,
    );
    await db.query(
      "update public.products set status='inactive' where slug='licensed-tool-1'",
    );
    assert.equal(
      (
        await asRole(
          "anon",
          "select * from public.inventory where product_id='00000000-0000-4000-8000-000000000001'",
        )
      ).rows.length,
      0,
    );
    await db.query(
      "update public.categories set active=false where slug='new-tools'",
    );
    assert.equal(
      (await asRole("anon", "select * from public.storefront_products")).rows
        .length,
      0,
    );
    assert.equal(
      (await asRole("anon", "select * from public.inventory")).rows.length,
      0,
    );
    assert.equal(
      (await asRole("anon", "select * from public.storefront_categories")).rows
        .length,
      10,
    );
    // Exercise the private-catalog migration using PostgreSQL roles and Supabase-like auth claims.
    await db.exec(
      "create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;",
    );
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/202610100001_private_catalog.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const admin = "10000000-0000-4000-8000-000000000001",
      customer = "10000000-0000-4000-8000-000000000002";
    await db.query("insert into auth.users values($1),($2)", [admin, customer]);
    await db.query(
      "insert into public.user_roles(user_id,role) values($1,'admin'),($2,'customer')",
      [admin, customer],
    );
    await db.query(
      "update public.categories set active=true where slug='new-tools'",
    );
    for (const sql of [
      "select * from public.products",
      "select * from public.inventory",
      "select * from public.storefront_products",
      "select * from public.storefront_categories",
      "select public.storefront_search()",
    ]) {
      await assert.rejects(asRole("anon", sql), /permission denied/);
    }
    assert.equal(
      (
        await asRole(
          "authenticated",
          "select * from public.products",
          [],
          customer,
        )
      ).rows.length,
      11,
    );
    assert.equal(
      (
        await asRole(
          "authenticated",
          "select * from public.products",
          [],
          admin,
        )
      ).rows.length,
      13,
    );
    await assert.rejects(
      asRole(
        "authenticated",
        "update public.user_roles set role='admin'",
        [],
        customer,
      ),
      /permission denied/,
    );
    assert.equal(
      (
        await asRole(
          "authenticated",
          "select * from public.user_roles",
          [],
          customer,
        )
      ).rows.length,
      1,
    );
    assert.equal(
      (
        await asRole(
          "authenticated",
          "update public.inventory set available_quantity=999 returning *",
          [],
          customer,
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      asRole(
        "authenticated",
        "select public.admin_save_product('{}'::jsonb)",
        [],
        customer,
      ),
      /Not authorized/,
    );
    const category = (
      await db.query<{ id: string }>(
        "select id from public.categories where slug='new-tools'",
      )
    ).rows[0].id;
    const product = {
      id: "",
      category_id: category,
      slug: "admin-tool",
      name: "Admin Tool",
      description: "Licensed software",
      price_minor: 125050,
      supplier_name: "Licensed supplier",
      authorized_resale: true,
      status: "active",
      delivery_type: "Manual fulfillment",
      image_path: "",
      term: "Annual",
      available_quantity: 7,
    };
    await db.exec("begin; set local role authenticated;");
    try {
      await db.query("select set_config('request.jwt.claim.sub',$1,true)", [
        admin,
      ]);
      await db.query("select public.admin_save_product($1::jsonb)", [
        JSON.stringify(product),
      ]);
      assert.equal(
        (
          await db.query<{ available_quantity: number }>(
            "select available_quantity from public.storefront_products where slug='admin-tool'",
          )
        ).rows[0].available_quantity,
        7,
      );
      assert.equal(
        (
          await db.query<{ count: number }>(
            "select count(*)::int as count from public.audit_logs where actor_id=$1",
            [admin],
          )
        ).rows[0].count,
        2,
      );
    } finally {
      await db.exec("rollback");
    }
    // A failed RPC statement rolls back its product and audit inserts without an outer rollback.
    await db.exec("set role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      admin,
    ]);
    try {
      await assert.rejects(
        db.query("select public.admin_save_product($1::jsonb)", [
          JSON.stringify({ ...product, available_quantity: -1 }),
        ]),
        /check constraint/,
      );
    } finally {
      await db.exec("reset role");
    }
    assert.equal(
      (await db.query("select * from public.products where slug='admin-tool'"))
        .rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
