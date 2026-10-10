"use server";
import { revalidatePath } from "next/cache";
import { requireIdentity } from "@/lib/supabase/server";
import { isUuid } from "@/lib/purchases";
export type ReviewState = { error?: string; message?: string };
export async function submitReview(
  _state: ReviewState,
  form: FormData,
): Promise<ReviewState> {
  const { client } = await requireIdentity();
  const item = String(form.get("item_id") || ""),
    name = String(form.get("display_name") || "").trim(),
    message = String(form.get("message") || "").trim(),
    location = String(form.get("location") || "").trim(),
    rating = Number(form.get("rating"));
  if (form.get("website"))
    return { error: "Your review could not be submitted." };
  if (
    !isUuid(item) ||
    name.length < 2 ||
    name.length > 80 ||
    message.length < 20 ||
    message.length > 2000 ||
    location.length > 100 ||
    !Number.isInteger(rating) ||
    rating < 1 ||
    rating > 5
  )
    return {
      error:
        "Enter a display name, a rating from 1–5 and feedback between 20 and 2,000 characters.",
    };
  const { error } = await client.rpc("submit_review", {
    item_uuid: item,
    stars: rating,
    feedback: message,
    customer_name: name,
    customer_location: location,
  });
  if (error)
    return {
      error:
        error.code === "23505"
          ? "You have already reviewed this purchase."
          : error.code === "P0001"
            ? "You can submit up to three reviews per day. Please try again tomorrow."
            : error.code === "42501"
              ? "Only your verified, paid and delivered purchases can be reviewed."
              : "Reviews are unavailable. Please try again later.",
    };
  revalidatePath("/dashboard/purchases");
  revalidatePath("/admin/reviews");
  return { message: "Thank you. Your review is awaiting moderation." };
}
