"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useState } from "react";
import { Brand } from "./brand";

const navigation = [
  { label: "Home", href: "/" },
  { label: "Products", href: "/marketplace" },
  { label: "Pricing", href: "/marketplace?view=pricing" },
  { label: "Support", href: "/support" },
];
export function Header({ signedIn = false }: { signedIn?: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const home = pathname === "/";
  const account = ["/account", "/login", "/signup"].includes(pathname);
  const links = home
    ? navigation
    : navigation.filter((item) => item.label !== "Home");
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Brand />
        <nav aria-label="Main navigation" className="desktop-nav">
          {links.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={pathname === item.href ? "active" : ""}
              aria-current={pathname === item.href ? "page" : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="header-actions">
          {!signedIn && !account && (
            <Link href="/login" className="header-login">
              Login
            </Link>
          )}
          {!account && (
            <Link
              href={signedIn ? "/dashboard" : "/signup"}
              className="button header-register"
            >
              {signedIn ? "Dashboard" : "Sign Up"}
            </Link>
          )}
          <button
            className="icon-button menu-button"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            aria-controls="mobile-navigation"
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={23} /> : <Menu size={23} />}
          </button>
        </div>
      </div>
      {open && (
        <nav
          id="mobile-navigation"
          aria-label="Mobile navigation"
          className="mobile-nav container"
          onClick={() => setOpen(false)}
        >
          {links.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
          <Link href={signedIn ? "/dashboard" : "/login"}>
            {signedIn ? "Dashboard" : "Login"}
          </Link>
          {!signedIn && <Link href="/signup">Sign Up</Link>}
        </nav>
      )}
    </header>
  );
}
