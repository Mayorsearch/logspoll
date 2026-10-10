import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/supabase/server";
import { Workspace } from "@/components/workspace";
import { saveCategory } from "../actions";
export const metadata: Metadata = {
  title: "Category Administration",
  robots: { index: false, follow: false },
};
export default async function CategoryAdmin({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string; saved?: string; error?: string }>;
}) {
  const { client, user } = await requireAdmin();
  const params = await searchParams;
  const { data, error } = await client
    .from("categories")
    .select("*")
    .order("sort_order");
  if (error) throw new Error("Category administration is unavailable.");
  const category = data?.find((row) => row.id === params.edit);
  return (
    <Workspace title="Categories" user={user} admin>
      <section className="workspace-content">
        <h1>Categories</h1>
        <p>Create, edit or deactivate service categories.</p>
        {params.saved && (
          <p className="form-message" role="status">
            Category saved.
          </p>
        )}
        {params.error && (
          <p className="form-error" role="alert">
            Could not save the category. Check its name, unique slug and
            description.
          </p>
        )}
        <div className="surface-panel admin-table">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>URL slug</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {data?.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.slug}</td>
                  <td>{row.active ? "Active" : "Inactive"}</td>
                  <td>
                    <Link
                      href={`/admin/categories?edit=${row.id}#category-form`}
                    >
                      Edit category
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <form
          action={saveCategory}
          id="category-form"
          className="surface-panel admin-form"
          key={category?.id || "new"}
        >
          <h2>{category ? "Edit category" : "Add category"}</h2>
          <input type="hidden" name="id" value={category?.id || ""} />
          <input type="hidden" name="managed" value="1" />
          <div className="admin-fields">
            <label>
              Name
              <input
                name="name"
                required
                maxLength={120}
                defaultValue={category?.name}
              />
            </label>
            <label>
              Slug
              <input
                name="slug"
                required
                maxLength={100}
                pattern="[a-z0-9]+(-[a-z0-9]+)*"
                defaultValue={category?.slug}
              />
            </label>
            <label className="wide">
              Description
              <textarea
                name="description"
                maxLength={2000}
                rows={3}
                defaultValue={category?.description}
              />
            </label>
          </div>
          <label className="checkbox-label">
            <input
              name="active"
              type="checkbox"
              defaultChecked={category?.active ?? true}
            />
            Category is active
          </label>
          <button className="button button-orange">Save category</button>
          {category && (
            <Link href="/admin/categories" className="text-link">
              Cancel editing
            </Link>
          )}
        </form>
      </section>
    </Workspace>
  );
}
