"use server";
import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/supabase/server";
export type ProfileState = { error?: string; message?: string };
export async function updateProfile(
  _state: ProfileState,
  form: FormData,
): Promise<ProfileState> {
  const { client } = await requireIdentity();
  const fullName = String(form.get("fullName") || "").trim();
  if (fullName.length < 2 || fullName.length > 120)
    return { error: "Enter a name between 2 and 120 characters." };
  const { error } = await client.auth.updateUser({
    data: { full_name: fullName },
  });
  if (error)
    return { error: "Your profile could not be updated. Please try again." };
  revalidatePath("/dashboard", "layout");
  revalidatePath("/marketplace");
  return { message: "Profile updated." };
}
