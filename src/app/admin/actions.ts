"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/supabase/server";
import { validSlug } from "@/lib/catalog-api";
export async function saveProduct(form: FormData) {
  const { client } = await requireAdmin();
  const text = (key: string) => String(form.get(key) || "").trim();
  const price = text("price"),
    quantity = text("available_quantity");
  if (
    !/^\d{1,9}(\.\d{1,2})?$/.test(price) ||
    !/^\d{1,7}$/.test(quantity) ||
    !validSlug(text("slug"))
  )
    redirect("/admin?error=validation");
  const [whole, fraction = ""] = price.split(".");
  const priceMinor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  const { error } = await client.rpc("admin_save_product", {
    p: {
      id: text("id"),
      category_id: text("category_id"),
      slug: text("slug"),
      name: text("name"),
      brand: text("brand"),
      description: text("description"),
      price_minor: priceMinor,
      supplier_name: text("supplier_name"),
      authorized_resale: form.get("authorized_resale") === "on",
      status: text("status"),
      delivery_type: text("delivery_type"),
      image_path: text("image_path"),
      term: text("term"),
      available_quantity: Number(quantity),
    },
  });
  if (error) redirect("/admin?error=save");
  revalidatePath("/admin");
  revalidatePath("/marketplace");
  redirect("/admin?saved=1");
}
export async function saveCategory(form: FormData) {
  const { client } = await requireAdmin();
  const destination =
    form.get("managed") === "1" ? "/admin/categories" : "/admin";
  const name = String(form.get("name") || "").trim(),
    slug = String(form.get("slug") || "").trim();
  if (!validSlug(slug) || name.length < 1 || name.length > 120)
    redirect(`${destination}?error=validation`);
  const values = {
    slug,
    name,
    short_name: name,
    description: String(form.get("description") || "").trim(),
    active: form.get("managed") === "1" ? form.get("active") === "on" : true,
  };
  const id = String(form.get("id") || "");
  const { data, error } = id
    ? await client
        .from("categories")
        .update(values)
        .eq("id", id)
        .select("id")
        .maybeSingle()
    : await client
        .from("categories")
        .insert({ ...values, icon: "grid", color: "orange" })
        .select("id")
        .single();
  if (error || !data) redirect(`${destination}?error=category`);
  revalidatePath("/admin");
  revalidatePath("/admin/categories");
  revalidatePath("/marketplace");
  redirect(`${destination}?saved=1`);
}
