import Link from "next/link";
import { ArrowRight, LockKeyhole } from "lucide-react";
import { Brand } from "./brand";

export function Footer({ signedIn = false }: { signedIn?: boolean }) {
  const groups = [
    {
      title: "Explore",
      links: [
        ["Private marketplace", "/marketplace"],
        ["Service categories", "/categories"],
        ["How it works", "/how-it-works"],
      ],
    },
    {
      title: "Your account",
      links: signedIn
        ? [
            ["Dashboard", "/dashboard"],
            ["Account security", "/account?mode=reset"],
            ["Help center", "/support"],
          ]
        : [
            ["Create an account", "/signup"],
            ["Login", "/login"],
            ["Help center", "/support"],
          ],
    },
    {
      title: "Good to know",
      links: [
        ["Marketplace guidelines", "/guidelines"],
        ["Privacy & account access", "/privacy"],
        ["Frequently asked questions", "/support#support-questions"],
      ],
    },
  ];
  return (
    <footer className="site-footer">
      <div className="footer-inner">
        <div className="footer-invitation">
          <div>
            <span className="footer-eyebrow">YOUR NEXT DIGITAL ESSENTIAL</span>
            <h2>
              {signedIn
                ? "Find the tools that work for you."
                : "Your digital world starts here."}
            </h2>
            <p>
              {signedIn
                ? "Explore services and manage your account in one place."
                : "One account. Access to our private digital services catalog."}
            </p>
          </div>
          <Link
            href={signedIn ? "/marketplace" : "/signup"}
            className="button button-orange"
          >
            {signedIn ? "Explore the catalog" : "Create your account"}
            <ArrowRight size={17} />
          </Link>
        </div>
        <div className="footer-top">
          <div className="footer-brand">
            <Brand />
            <p>
              A private marketplace for authorized digital subscriptions,
              licensed software and business tools.
            </p>
            <span className="footer-access">
              <LockKeyhole size={14} /> Account-only catalog access
            </span>
          </div>
          {groups.map(({ title, links }) => (
            <nav key={title} aria-label={`Footer ${title.toLowerCase()}`}>
              <h3>{title}</h3>
              {links.map(([label, href]) => (
                <Link key={href} href={href}>
                  {label}
                </Link>
              ))}
            </nav>
          ))}
        </div>
        <div className="footer-bottom">
          <p>© {new Date().getFullYear()} LOGSPOLL. All rights reserved.</p>
          <p>Authorized services. Clear product information.</p>
          <Link href="#main-content" className="footer-back">
            Back to top <ArrowRight size={13} />
          </Link>
        </div>
      </div>
    </footer>
  );
}
