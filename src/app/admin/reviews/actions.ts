"use server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/supabase/server";
import { isUuid } from "@/lib/purchases";
export async function moderateReview(form: FormData) {
  const { client } = await requireAdmin();
  const id = String(form.get("review_id") || ""),
    decision = String(form.get("decision") || "");
  if (!isUuid(id) || !["approved", "rejected"].includes(decision))
    redirect("/admin/reviews?error=validation");
  const { error } = await client.rpc("moderate_review", {
    review_uuid: id,
    decision,
  });
  if (error) redirect("/admin/reviews?error=unavailable");
  revalidatePath("/");
  revalidatePath("/admin/reviews");
  revalidatePath("/dashboard/purchases");
  redirect("/admin/reviews?saved=1");
}
