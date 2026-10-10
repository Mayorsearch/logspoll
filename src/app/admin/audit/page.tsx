import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/supabase/server";
import { Workspace } from "@/components/workspace";
export const metadata: Metadata = {
  title: "Admin Audit Log",
  robots: { index: false, follow: false },
};
export default async function Audit({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { client, user } = await requireAdmin();
  const requested = Number((await searchParams).page || 1);
  const page =
    Number.isSafeInteger(requested) && requested > 0
      ? Math.min(requested, 10000)
      : 1;
  const { data, error } = await client
    .from("audit_logs")
    .select("id,actor_id,table_name,record_id,action,created_at")
    .order("created_at", { ascending: false })
    .order("id")
    .range((page - 1) * 50, page * 50);
  if (error) throw new Error("Audit log is unavailable.");
  return (
    <Workspace title="Audit log" user={user} admin>
      <section className="workspace-content">
        <h1>Audit log</h1>
        <p>
          Recorded catalog and order changes. Delivery secrets are never
          included.
        </p>
        <div className="surface-panel admin-table">
          <table>
            <thead>
              <tr>
                <th>Time (UTC)</th>
                <th>Action</th>
                <th>Table</th>
                <th>Record</th>
                <th>Actor</th>
              </tr>
            </thead>
            <tbody>
              {data?.slice(0, 50).map((row) => (
                <tr key={row.id}>
                  <td>
                    {new Date(row.created_at)
                      .toISOString()
                      .slice(0, 19)
                      .replace("T", " ")}
                  </td>
                  <td>{row.action}</td>
                  <td>{row.table_name}</td>
                  <td>{row.record_id}</td>
                  <td>{row.actor_id || "Trusted backend"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.length && (
            <div className="honest-empty">
              <h2>No recorded changes</h2>
              <p>Catalog and order mutations will appear here.</p>
            </div>
          )}
        </div>
        {(page > 1 || (data?.length || 0) > 50) && (
          <nav className="panel-pagination" aria-label="Audit pages">
            {page > 1 && (
              <Link href={`/admin/audit?page=${page - 1}`}>Previous</Link>
            )}
            <span>Page {page}</span>
            {(data?.length || 0) > 50 && (
              <Link href={`/admin/audit?page=${page + 1}`}>Next</Link>
            )}
          </nav>
        )}
      </section>
    </Workspace>
  );
}
