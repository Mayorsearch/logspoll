import Link from "next/link";
import { ArrowRight } from "lucide-react";

export function PublicPage({
  title,
  eyebrow,
  description,
  children,
}: {
  title: string;
  eyebrow: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="reference-page public-page">
      <header className="public-page-heading">
        <div className="breadcrumb">
          <Link href="/">Home</Link>
          <ArrowRight size={12} />
          <span>{title}</span>
        </div>
        <span className="access-label">{eyebrow}</span>
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      {children}
    </div>
  );
}
