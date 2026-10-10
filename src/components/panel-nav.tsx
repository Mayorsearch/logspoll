"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Home,
  Package,
  Wallet,
  History,
  UserRound,
  LifeBuoy,
  LayoutDashboard,
  Tags,
  ClipboardList,
  ShieldCheck,
  Star,
} from "lucide-react";
const customerLinks = [
  { href: "/dashboard", label: "Dashboard", Icon: Home },
  { href: "/marketplace", label: "Store", Icon: Package },
  { href: "/dashboard/wallet", label: "Wallet", Icon: Wallet },
  { href: "/dashboard/purchases", label: "Purchase History", Icon: History },
  { href: "/dashboard/profile", label: "Profile", Icon: UserRound },
];
const adminLinks = [
  { href: "/admin/overview", label: "Overview", Icon: LayoutDashboard },
  { href: "/admin", label: "Products", Icon: Package },
  { href: "/admin/categories", label: "Categories", Icon: Tags },
  { href: "/admin/orders", label: "Orders", Icon: ClipboardList },
  { href: "/admin/reviews", label: "Reviews", Icon: Star },
  { href: "/admin/audit", label: "Audit log", Icon: ShieldCheck },
];
export function PanelNav({
  variant = "top",
}: {
  variant?: "top" | "bottom" | "admin";
}) {
  const pathname = usePathname();
  const links =
    variant === "admin"
      ? adminLinks
      : variant === "bottom"
        ? [
            customerLinks[0],
            customerLinks[1],
            { href: "/support", label: "Support", Icon: LifeBuoy },
            customerLinks[2],
            { ...customerLinks[3], label: "History" },
          ]
        : customerLinks;
  return (
    <nav
      className={`panel-nav panel-nav-${variant}`}
      aria-label={
        variant === "admin"
          ? "Admin navigation"
          : variant === "bottom"
            ? "Quick navigation"
            : "Account navigation"
      }
    >
      {links.map(({ href, label, Icon }) => {
        const active =
          pathname === href ||
          (href === "/dashboard/purchases" &&
            pathname.startsWith(href + "/")) ||
          (href === "/marketplace" &&
            (pathname.startsWith("/products/") ||
              pathname.startsWith("/categories/")));
        return (
          <Link
            key={href}
            href={href}
            className={active ? "selected" : ""}
            aria-current={active ? "page" : undefined}
          >
            <Icon size={18} />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
