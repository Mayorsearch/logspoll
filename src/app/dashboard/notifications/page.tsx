import type { Metadata } from "next";
import Link from "next/link";
import { Bell } from "lucide-react";
import { requireIdentity } from "@/lib/supabase/server";
import { purchaseDate } from "@/lib/purchases";
import { Workspace } from "@/components/workspace";
import { markNotificationsRead } from "./actions";
export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false, follow: false },
};
export default async function Notifications() {
  const { client, user } = await requireIdentity();
  const { data, error } = await client
    .from("notifications")
    .select("id,title,message,order_id,read_at,created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error("Notifications are unavailable.");
  return (
    <Workspace title="Notifications" user={user}>
      <section className="purchase-panel">
        <div className="panel-section-heading">
          <h1>Notifications</h1>
          {data?.some((row) => !row.read_at) && (
            <form action={markNotificationsRead}>
              <button className="button button-outline">
                Mark all as read
              </button>
            </form>
          )}
        </div>
        {data?.length ? (
          data.map((row) => (
            <article
              key={row.id}
              className={`notification-item ${row.read_at ? "" : "unread"}`}
            >
              <Bell size={21} />
              <div>
                <h2>{row.title}</h2>
                <p>{row.message}</p>
                <small>
                  {purchaseDate(row.created_at)} ·{" "}
                  {row.read_at ? "Read" : "Unread"}
                </small>
                {row.order_id && (
                  <Link href={`/dashboard/purchases/${row.order_id}`}>
                    View order
                  </Link>
                )}
              </div>
            </article>
          ))
        ) : (
          <div className="honest-empty">
            <Bell size={33} />
            <h2>You’re all caught up</h2>
            <p>
              Order updates will appear here when there’s something to share.
            </p>
          </div>
        )}
        {data?.length === 50 && <p>Showing your latest 50 notifications.</p>}
      </section>
    </Workspace>
  );
}
