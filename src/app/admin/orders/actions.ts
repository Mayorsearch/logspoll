"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/supabase/server";
import { isUuid } from "@/lib/purchases";
export async function fulfillOrder(form: FormData) {
  const { client } = await requireAdmin();
  const id = String(form.get("order_id") || "");
  if (!isUuid(id)) redirect("/admin/orders");
  const delivery: Record<string, string> = {};
  for (const [key, value] of form.entries())
    if (key.startsWith("item:")) {
      const itemId = key.slice(5);
      const instructions = String(value).trim();
      if (
        !isUuid(itemId) ||
        instructions.length < 1 ||
        instructions.length > 20000
      )
        redirect(`/admin/orders/${id}?error=validation`);
      delivery[itemId] = instructions;
    }
  const { error } = await client.rpc("admin_fulfill_order", {
    order_uuid: id,
    delivery,
  });
  if (error) redirect(`/admin/orders/${id}?error=delivery`);
  revalidatePath("/admin/orders");
  revalidatePath("/admin/overview");
  revalidatePath("/dashboard/purchases");
  revalidatePath("/dashboard/notifications");
  redirect(`/admin/orders/${id}?delivered=1`);
}
