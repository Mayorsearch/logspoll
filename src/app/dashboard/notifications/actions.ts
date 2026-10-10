"use server";
import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/supabase/server";
export async function markNotificationsRead() {
  const { client, user } = await requireIdentity();
  const { error } = await client
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .is("read_at", null);
  if (error) throw new Error("Notifications could not be updated.");
  revalidatePath("/dashboard/notifications");
}
