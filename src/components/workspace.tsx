import Link from "next/link";
import { LogOut, LockKeyhole, Bell, Wallet, Store } from "lucide-react";
import { Brand } from "./brand";
import { PanelNav } from "./panel-nav";
import { logout } from "@/app/account/actions";
import type { User } from "@supabase/supabase-js";
export function Workspace({
  children,
  title,
  user,
  admin = false,
}: {
  children: React.ReactNode;
  title: string;
  user: User;
  admin?: boolean;
}) {
  const name =
    typeof user.user_metadata.full_name === "string"
      ? user.user_metadata.full_name
      : user.email || "Your account";
  const localTesting =
    process.env.LOGSPOLL_LOCAL_PANEL_TEST === "1" &&
    process.env.SUPABASE_URL === "http://127.0.0.1:3101";
  const logoutForm = (
    <form action={logout}>
      <button className="panel-logout">
        <LogOut size={16} />
        <span>Log out</span>
      </button>
    </form>
  );
  const banner = localTesting && (
    <aside className="local-panel-banner">
      LOCAL TEST DATABASE · Test records only · Payments disabled{" "}
      <a href="http://127.0.0.1:3101/__test/panels">Switch test account</a>
    </aside>
  );
  if (admin)
    return (
      <div className="workspace admin-workspace">
        <aside className="workspace-sidebar">
          <Brand />
          <PanelNav variant="admin" />
          <Link href="/marketplace" className="admin-store-link">
            <Store size={17} /> Customer store
          </Link>
          {logoutForm}
        </aside>
        <div className="workspace-main">
          <header className="workspace-header">
            <span>Administration / {title}</span>
            <span className="workspace-user">
              <span>{name.slice(0, 1).toUpperCase()}</span>
              <span>
                <strong>{name}</strong>
                <small>Administrator</small>
              </span>
            </span>
          </header>
          {banner}
          {children}
          <div className="workspace-footnote">
            <LockKeyhole size={13} /> Protected administration
          </div>
        </div>
      </div>
    );
  return (
    <div className="workspace customer-workspace">
      <header className="account-header">
        <div className="account-header-inner">
          <Brand />
          <PanelNav />
          <div className="account-header-actions">
            <Link
              href="/dashboard/notifications"
              className="account-notifications"
              aria-label="Notifications"
            >
              <Bell size={20} />
            </Link>
            {logoutForm}
          </div>
        </div>
      </header>
      {banner}
      <div
        className={`account-body ${title === "Products" ? "account-store" : ""}`}
      >
        {title !== "Products" && (
          <div className="account-summary">
            <span className="account-avatar">
              {name.slice(0, 1).toUpperCase()}
            </span>
            <span>
              <strong>{name}</strong>
              <small>Verified account</small>
            </span>
            <Link href="/dashboard/wallet" className="account-wallet">
              <Wallet size={15} /> Wallet not enabled
            </Link>
          </div>
        )}
        {children}
      </div>
      <PanelNav variant="bottom" />
      <div className="customer-footnote">
        <LockKeyhole size={12} /> Private account area · LOGSPOLL
      </div>
    </div>
  );
}
