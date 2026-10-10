"use client";
import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import type { CatalogFilters } from "@/lib/catalog";
import type { Category } from "@/lib/categories";
export function CatalogFiltersPanel({
  filters,
  categories,
}: {
  filters: CatalogFilters;
  categories: Category[];
  total: number;
}) {
  return (
    <div className="compact-filters">
      <label className="sr-only" htmlFor="catalog-category">
        Category
      </label>
      <select
        id="catalog-category"
        name="category"
        defaultValue={filters.category}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category.slug} value={category.slug}>
            {category.name}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="catalog-availability">
        Availability
      </label>
      <select
        id="catalog-availability"
        name="availability"
        defaultValue={filters.availability}
        onChange={(event) => event.currentTarget.form?.requestSubmit()}
      >
        <option value="">All availability</option>
        <option value="in-stock">In stock</option>
        <option value="out-of-stock">Out of stock</option>
      </select>
      <details className="compact-price">
        <summary>
          <SlidersHorizontal size={15} /> Price
        </summary>
        <div>
          <label>
            Minimum (NGN)
            <input
              name="min"
              type="number"
              min="0"
              max="999999999"
              step="1"
              defaultValue={filters.min}
              placeholder="0"
            />
          </label>
          <label>
            Maximum (NGN)
            <input
              name="max"
              type="number"
              min="0"
              max="999999999"
              step="1"
              defaultValue={filters.max}
              placeholder="No limit"
            />
          </label>
          <button type="submit" className="button button-dark">
            Apply prices
          </button>
          <Link href="/marketplace">Reset filters</Link>
        </div>
      </details>
    </div>
  );
}
