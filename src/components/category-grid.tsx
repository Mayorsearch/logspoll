import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { categories } from "@/lib/categories";
import { CategoryIcon } from "./category-icon";
// Public service descriptions only: no private product names, prices or inventory counts.
export function CategoryGrid({ detailed = false }: { detailed?: boolean }) {
  return (
    <div
      className={`category-grid ${detailed ? "category-grid-detailed" : ""}`}
    >
      {categories.map((c) => (
        <Link
          key={c.slug}
          href={`/categories/${c.slug}`}
          className="category-card"
          aria-label={c.name}
        >
          <span className={`category-icon color-${c.color}`}>
            <CategoryIcon icon={c.icon} size={25} />
          </span>
          <div>
            <h3>{c.shortName}</h3>
            {detailed && <p>{c.description}</p>}
          </div>
          <ArrowUpRight size={14} className="category-arrow" />
        </Link>
      ))}
    </div>
  );
}
