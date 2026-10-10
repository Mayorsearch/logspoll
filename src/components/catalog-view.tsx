import Form from "next/form";
import Link from "next/link";
import { Search, ArrowRight, ArrowLeft, X, PackageSearch } from "lucide-react";
import { catalogHref, pageSize, type SearchParams } from "@/lib/catalog";
import { loadCatalog } from "@/lib/storefront";
import { ProductCard } from "./product-card";
import { CatalogNotice } from "./catalog-notice";
import { CatalogFiltersPanel } from "./catalog-filters";

export async function CatalogView({ params }: { params: SearchParams }) {
  const { storefront, filters, result } = await loadCatalog(params);
  const category = storefront.categories.find(
    (c) => c.slug === filters.category,
  );
  const chips = [
    ...(filters.q
      ? [
          {
            label: `“${filters.q}”`,
            href: catalogHref({ ...filters, q: "", page: 1 }),
          },
        ]
      : []),
    ...(category
      ? [
          {
            label: category.name,
            href: catalogHref({ ...filters, category: "", page: 1 }),
          },
        ]
      : []),
    ...(filters.min || filters.max
      ? [
          {
            label: `₦${filters.min || "0"} – ${filters.max ? `₦${filters.max}` : "Any"}`,
            href: catalogHref({ ...filters, min: "", max: "", page: 1 }),
          },
        ]
      : []),
    ...(filters.availability
      ? [
          {
            label:
              filters.availability === "in-stock" ? "In stock" : "Out of stock",
            href: catalogHref({ ...filters, availability: "", page: 1 }),
          },
        ]
      : []),
  ];
  return (
    <div className="container catalog-container">
      <CatalogNotice mode={storefront.mode} />
      <Form
        action="/marketplace"
        id="catalog-form"
        key={JSON.stringify(filters)}
        className="catalog-layout"
      >
        <div className="catalog-results">
          <div className="catalog-toolbar">
            <div className="catalog-search">
              <Search size={18} aria-hidden="true" />
              <label htmlFor="catalog-search" className="sr-only">
                Search products
              </label>
              <input
                id="catalog-search"
                name="q"
                placeholder="Search digital products…"
                maxLength={120}
                defaultValue={filters.q}
              />
              <button type="submit" aria-label="Search products">
                <ArrowRight size={17} />
              </button>
            </div>
            <CatalogFiltersPanel
              filters={filters}
              categories={storefront.categories}
              total={storefront.total}
            />
            <div className="catalog-sort">
              <label htmlFor="catalog-sort">Sort by</label>
              <select id="catalog-sort" name="sort" defaultValue={filters.sort}>
                <option value="featured">Featured</option>
                <option value="newest">Newest</option>
                <option value="price-asc">Price: low to high</option>
                <option value="price-desc">Price: high to low</option>
                <option value="name">Name: A–Z</option>
              </select>
              <button
                type="submit"
                className="sort-go"
                aria-label="Apply sorting"
              >
                <ArrowRight size={16} />
              </button>
            </div>
          </div>
          <div className="results-summary">
            <p role="status">
              {result.total ? (
                <>
                  Showing{" "}
                  <strong>
                    {(result.page - 1) * pageSize + 1}–
                    {Math.min(result.page * pageSize, result.total)}
                  </strong>{" "}
                  of <strong>{result.total}</strong> products
                </>
              ) : (
                "No matching products"
              )}
              {category ? ` in ${category.name}` : ""}
            </p>
            <span className="results-currency">Prices in NGN</span>
          </div>
          {!!chips.length && (
            <div className="active-filters">
              {chips.map((chip) => (
                <Link
                  href={chip.href}
                  key={chip.label}
                  aria-label={`Remove filter: ${chip.label}`}
                >
                  {chip.label} <X size={12} />
                </Link>
              ))}
            </div>
          )}
          {filters.min &&
            filters.max &&
            Number(filters.min) > Number(filters.max) && (
              <p className="filter-warning" role="alert">
                The minimum price exceeds the maximum. Adjust your price range
                to see matching products.
              </p>
            )}
          {result.total ? (
            <div className="product-grid catalog-product-grid">
              {result.products.map((product) => (
                <ProductCard key={product.id} product={product} />
              ))}
            </div>
          ) : (
            <div className="catalog-empty">
              <span className="notice-icon">
                <PackageSearch size={32} strokeWidth={1.4} />
              </span>
              <h2>No finds this time.</h2>
              <p>
                Try a different search or adjust your filters. There’s more to
                discover.
              </p>
              <Link href="/marketplace" className="button button-dark">
                Clear search & filters <ArrowRight size={15} />
              </Link>
            </div>
          )}
          {result.pages > 1 && (
            <nav aria-label="Catalog pages" className="pagination">
              {result.page > 1 ? (
                <Link
                  href={catalogHref({ ...filters, page: result.page - 1 })}
                  className="pagination-direction"
                >
                  <ArrowLeft size={15} /> Previous
                </Link>
              ) : (
                <span className="pagination-direction disabled">
                  <ArrowLeft size={15} /> Previous
                </span>
              )}
              <div>
                {Array.from(
                  { length: Math.min(7, result.pages) },
                  (_, offset) => {
                    const index =
                      Math.min(
                        Math.max(0, result.page - 4),
                        Math.max(0, result.pages - 7),
                      ) + offset;
                    return (
                      <Link
                        key={index}
                        href={catalogHref({ ...filters, page: index + 1 })}
                        aria-label={`Page ${index + 1}`}
                        aria-current={
                          result.page === index + 1 ? "page" : undefined
                        }
                      >
                        {index + 1}
                      </Link>
                    );
                  },
                )}
              </div>
              {result.page < result.pages ? (
                <Link
                  href={catalogHref({ ...filters, page: result.page + 1 })}
                  className="pagination-direction"
                >
                  Next <ArrowRight size={15} />
                </Link>
              ) : (
                <span className="pagination-direction disabled">
                  Next <ArrowRight size={15} />
                </span>
              )}
            </nav>
          )}
        </div>
      </Form>
    </div>
  );
}
