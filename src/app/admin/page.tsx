import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Package } from "lucide-react";
import { requireAdmin } from "@/lib/supabase/server";
import { Workspace } from "@/components/workspace";
import { formatPrice } from "@/lib/catalog";
import { saveProduct, saveCategory } from "./actions";
export const metadata: Metadata = {
  title: "Product Administration",
  robots: { index: false, follow: false },
};
export default async function Admin({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; error?: string; saved?: string }>;
}) {
  const { client, user } = await requireAdmin();
  const params = await searchParams;
  const [products, categories, editing] = await Promise.all([
    client
      .from("products")
      .select(
        "id,name,price_minor,status,categories(name),inventory(available_quantity)",
      )
      .order("created_at", { ascending: false })
      .limit(100),
    client.from("categories").select("id,name").order("sort_order"),
    params.edit
      ? client
          .from("products")
          .select("*,inventory(available_quantity)")
          .eq("id", params.edit)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (products.error || categories.error || editing.error)
    throw new Error(
      "Product administration is unavailable. Please check the database configuration.",
    );
  const p = editing.data;
  const inventory = Array.isArray(p?.inventory) ? p.inventory[0] : p?.inventory;
  return (
    <Workspace title="Products" user={user} admin>
      <section className="workspace-content">
        <div className="section-heading">
          <div>
            <h1>Products</h1>
            <p>Manage your authorized products and inventory.</p>
          </div>
          <a href="#product-form" className="button button-orange">
            <Plus size={16} />
            Add Product
          </a>
        </div>
        {params.error && (
          <p className="form-error" role="alert">
            Could not save your changes. Check the fields, category,
            authorization and database configuration.
          </p>
        )}
        {params.saved && (
          <p className="form-message" role="status">
            Changes saved.
          </p>
        )}
        <div className="surface-panel admin-table">
          <table>
            <thead>
              <tr>
                <th>Product</th>
                <th>Price (NGN)</th>
                <th>Stock</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {products.data?.map((row) => {
                const stock = Array.isArray(row.inventory)
                  ? row.inventory[0]
                  : row.inventory;
                return (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{formatPrice(row.price_minor / 100)}</td>
                    <td>{stock?.available_quantity || 0}</td>
                    <td>
                      <span
                        className={`status-pill ${row.status === "active" ? "active" : ""}`}
                      >
                        {row.status}
                      </span>
                    </td>
                    <td>
                      <Link href={`/admin?edit=${row.id}#product-form`}>
                        Edit
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!products.data?.length && (
            <div className="honest-empty">
              <Package size={28} />
              <h3>No products yet</h3>
              <p>Add an authorized product to start building your catalog.</p>
            </div>
          )}
          {products.data?.length === 100 && (
            <p>Showing the latest 100 products.</p>
          )}
        </div>
        <form
          key={p?.id || "new-product"}
          action={saveProduct}
          id="product-form"
          className="surface-panel admin-form"
        >
          <h2>{p ? "Edit product" : "Add product"}</h2>
          <input type="hidden" name="id" value={p?.id || ""} />
          <div className="admin-fields">
            <label>
              Product name
              <input
                name="name"
                required
                maxLength={200}
                defaultValue={p?.name}
              />
            </label>
            <label>
              Slug
              <input
                name="slug"
                required
                maxLength={100}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                defaultValue={p?.slug}
              />
            </label>
            <label>
              Category
              <select name="category_id" required defaultValue={p?.category_id}>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Price (NGN)
              <input
                name="price"
                type="number"
                required
                min="0"
                max="999999999"
                step="0.01"
                defaultValue={p ? p.price_minor / 100 : undefined}
              />
            </label>
            <label>
              Available quantity
              <input
                name="available_quantity"
                type="number"
                required
                min="0"
                max="1000000"
                step="1"
                defaultValue={inventory?.available_quantity || 0}
              />
            </label>
            <label>
              Authorized supplier
              <input
                name="supplier_name"
                required
                maxLength={200}
                defaultValue={p?.supplier_name}
              />
            </label>
            <label>
              Brand
              <input name="brand" maxLength={120} defaultValue={p?.brand} />
            </label>
            <label>
              Plan / license term
              <input name="term" maxLength={200} defaultValue={p?.term} />
            </label>
            <label>
              Fulfillment method
              <select name="delivery_type" defaultValue={p?.delivery_type}>
                {[
                  "Licensed digital download",
                  "Redemption code",
                  "Subscription activation",
                  "Manual fulfillment",
                ].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Status
              <select name="status" defaultValue={p?.status || "draft"}>
                {["draft", "active", "inactive"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label className="wide">
              Description
              <textarea
                name="description"
                required
                maxLength={10000}
                rows={4}
                defaultValue={p?.description}
              />
            </label>
            <label className="wide">
              Product image path (product-images bucket)
              <input
                name="image_path"
                placeholder="products/image.webp"
                maxLength={2048}
                defaultValue={p?.image_path || ""}
              />
            </label>
          </div>
          <label className="checkbox-label">
            <input
              name="authorized_resale"
              type="checkbox"
              defaultChecked={p?.authorized_resale}
            />
            I have verified authorization to distribute this product.
          </label>
          <p className="form-hint">
            Active listings require verified distribution rights. Image uploads
            and checkout are not yet enabled.
          </p>
          <button
            className="button button-orange"
            disabled={!categories.data?.length}
          >
            Save product
          </button>
          {p && (
            <Link href="/admin" className="text-link">
              Cancel editing
            </Link>
          )}
        </form>
        <form action={saveCategory} className="surface-panel admin-form">
          <h2>Add category</h2>
          <div className="admin-fields">
            <label>
              Name
              <input name="name" required maxLength={120} />
            </label>
            <label>
              Slug
              <input
                name="slug"
                required
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                maxLength={100}
              />
            </label>
            <label className="wide">
              Description
              <input name="description" maxLength={2000} />
            </label>
          </div>
          <button className="button button-orange">Add category</button>
        </form>
      </section>
    </Workspace>
  );
}
