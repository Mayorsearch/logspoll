import { resolveMainCategory } from '../lib/main-storefront-categories';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PackageOpen, Search, ArrowRight, Heart, ShoppingBag } from 'lucide-react';
import { useCatalogCategories } from '../components/useHomeCategories';
import { ProductArtwork } from '../components/ProductArtwork';
import { BrandIcon } from '../components/BrandIcon';
import { cloudflareRequest } from '../lib/cloudflare-auth';
import { useFavorites } from '../lib/favorites';
import { useCurrency } from '../lib/currency';
import { useCart } from '../lib/cart';
import { useAuth } from '../auth/AuthProvider';
import { PrivateCatalogGate } from '../components/PrivateCatalogGate';

interface Product {
  id: string;
  slug: string;
  name: string;
  description: string;
  category_name: string;
  price_minor: number;
  currency: string;
  available_quantity: number;
  image_path?: string | null;
  supplier_image_urls?: string[];
  server_number?: number;
}

export function Marketplace() {
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const { favorites, toggleFavorite } = useFavorites();
  const { formatPrice } = useCurrency();
  const { add } = useCart();
  const [cardQuantities, setCardQuantities] = useState<Record<string, number>>({});
  const [addedId, setAddedId] = useState<string | null>(null);
  const favoritesOnly = params.get('favorites') === '1';
  const [statistics, setStatistics] = useState<{ total: number; stock: number; outOfStock: number } | null>(null);
  const [showGuestCatalog, setShowGuestCatalog] = useState(() => typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('preview') === '1');

  useEffect(() => {
    let active = true;
    void Promise.all([
      cloudflareRequest<{ total: number }>('/api/products'),
      cloudflareRequest<{ total: number }>('/api/products?availability=in-stock'),
    ])
      .then(([all, stock]) => {
        if (active) {
          setStatistics({
            total: all.total,
            stock: stock.total,
            outOfStock: Math.max(0, all.total - stock.total),
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const [products, setProducts] = useState<Product[]>([]);
  const { categories } = useCatalogCategories();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);

  const query = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const sort = params.get('sort') ?? 'featured';
  const availability = params.get('availability') ?? '';
  const server = params.get('server') ?? '';
  const pageSize = params.get('size') === '40' ? 40 : 20;
  const page = Math.min(10000, Math.max(1, Math.floor(Number(params.get('page')) || 1)));

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setLoading(true);
        setError('');
      }
    });

    const timer = setTimeout(() => {
      if (favoritesOnly && !favorites.length) {
        setProducts([]);
        setTotal(0);
        setPages(1);
        setLoading(false);
        return;
      }
      const search = new URLSearchParams({
        q: query,
        category,
        sort,
        availability,
        page: String(favoritesOnly ? 1 : (page - 1) * (pageSize / 20) + 1),
      });
      if (category) {
        const main = resolveMainCategory(category);
        if (main) {
          search.delete('category');
          search.set('main_category', main);
        }
      }
      if (favoritesOnly) search.set('ids', favorites.join(','));
      if (server) search.set('server', server);

      void cloudflareRequest<{
        products: Product[];
        total: number;
        pages: number;
      }>(`/api/products?${search}`)
        .then(async (data) => {
          let items = data.products ?? [];
          if (!favoritesOnly && pageSize === 40 && data.total > (page - 1) * pageSize + 20) {
            const next = new URLSearchParams(search);
            next.set('page', String(Number(next.get('page')) + 1));
            const more = await cloudflareRequest<{ products: Product[] }>(`/api/products?${next}`);
            items = [...items, ...(more.products ?? [])];
          }
          if (active) {
            setProducts(favoritesOnly ? items.slice((page - 1) * pageSize, page * pageSize) : items);
            setTotal(data.total);
            setPages(Math.max(1, Math.ceil(data.total / pageSize)));
          }
        })
        .catch((problem) => {
          if (active) {
            setError(problem.message);
            setProducts([]);
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [query, category, sort, availability, server, page, pageSize, favoritesOnly, favorites]);

  function change(key: string, value: string) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  }

  return (
    <div className="container section store-page-wrapper">
      {/* Screen 3 Reference: Private Catalog Gate for Guests */}
      {!session && !showGuestCatalog && (
        <PrivateCatalogGate 
          onUnlockPreview={() => setShowGuestCatalog(true)} 
          showExploreOption={true} 
        />
      )}

      {/* Products Store Header matching Target Reference */}
      {(session || showGuestCatalog) && (
        <>
          <div className="store-header">
          <div className="store-header-title-box">
            <div className="store-header-icon" aria-hidden="true">
              <ShoppingBag size={24} />
            </div>
            <div>
              <h1 className="store-title">Products Store</h1>
              <p className="store-subtitle">Browse our extensive catalog of verified digital accounts and tools.</p>
            </div>
          </div>

        {/* Real Status Metrics Row */}
        <div className="catalog-status-pills" role="region" aria-label="Catalog Overview Statistics">
          <span className="status-pill-item total">
            TOTAL <strong>{statistics?.total ?? total}</strong>
          </span>
          <span className="status-pill-item in-stock">
            <span className="pill-dot green" /> IN STOCK <strong>{statistics?.stock ?? (total > 0 ? total : 0)}</strong>
          </span>
          <span className="status-pill-item out-of-stock">
            <span className="pill-dot red" /> OUT OF STOCK <strong>{statistics?.outOfStock ?? 0}</strong>
          </span>
          <span className="status-pill-item page">
            PAGE <strong>{page} OF {pages}</strong>
          </span>
        </div>
      </div>

      {/* Filter Card: Search + 3 Dropdowns */}
      <div className="store-filter-card">
        <div className="store-search-bar">
          <Search size={18} className="store-search-icon" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(event) => change('q', event.target.value)}
            placeholder="Search by title, keyword, or service..."
            maxLength={120}
            aria-label="Search by title, keyword, or service"
          />
        </div>

        <div className="store-dropdowns-row">
          <div className="store-select-wrap">
            <select
              value={category}
              onChange={(e) => change('category', e.target.value)}
              aria-label="Filter by category"
            >
              <option value="">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.slug} value={cat.slug}>
                  {cat.name} {cat.product_count !== undefined ? `(${cat.product_count})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="store-select-wrap">
            <select
              value={availability}
              onChange={(e) => change('availability', e.target.value)}
              aria-label="Filter by availability"
            >
              <option value="">All Availability</option>
              <option value="in-stock">In Stock</option>
              <option value="out-of-stock">Out of Stock</option>
            </select>
          </div>

          <div className="store-select-wrap">
            <select
              value={String(pageSize)}
              onChange={(e) => change('size', e.target.value)}
              aria-label="Results per page"
            >
              <option value="20">20 / page</option>
              <option value="40">40 / page</option>
            </select>
          </div>
        </div>
      </div>

      {/* Two-Tier Filter Pills (PadiLogs Reference Architecture) */}
      <div className="store-pills-container" role="region" aria-label="Catalog Filter Pills">
        {/* Row 1: Source & Server Filter Pills */}
        <div className="store-pills-row" role="tablist" aria-label="Source and Server filters">
          <button
            type="button"
            className={`store-filter-pill ${!server && !favoritesOnly ? 'active' : ''}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              next.delete('server');
              next.delete('favorites');
              next.delete('page');
              setParams(next, { replace: true });
            }}
          >
            <span>All Sources &amp; Tools</span>
            {statistics && <span className="pill-count-badge">{statistics.total}</span>}
          </button>

          <button
            type="button"
            className={`store-filter-pill store-pill-fav ${favoritesOnly ? 'active' : ''}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (favoritesOnly) {
                next.delete('favorites');
              } else {
                next.set('favorites', '1');
                next.delete('server');
              }
              next.delete('page');
              setParams(next, { replace: true });
            }}
          >
            <Heart size={14} fill={favoritesOnly ? 'currentColor' : 'none'} />
            <span>Favourites</span>
            <span className="pill-count-badge">{favorites.length}</span>
          </button>

          <button
            type="button"
            className={`store-filter-pill ${server === '1' ? 'active' : ''}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (server === '1') next.delete('server');
              else next.set('server', '1');
              next.delete('favorites');
              next.delete('page');
              setParams(next, { replace: true });
            }}
          >
            <span>Server 1</span>
          </button>

          <button
            type="button"
            className={`store-filter-pill ${server === '2' ? 'active' : ''}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (server === '2') next.delete('server');
              else next.set('server', '2');
              next.delete('favorites');
              next.delete('page');
              setParams(next, { replace: true });
            }}
          >
            <span>Server 2</span>
          </button>

          <button
            type="button"
            className={`store-filter-pill ${server === '3' ? 'active' : ''}`}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (server === '3') next.delete('server');
              else next.set('server', '3');
              next.delete('favorites');
              next.delete('page');
              setParams(next, { replace: true });
            }}
          >
            <span>Server 3</span>
          </button>
        </div>

        {/* Row 2: Category Filter Pills with Brand Icons */}
        <div className="store-pills-row" role="tablist" aria-label="Category filters">
          <button
            type="button"
            className={`store-filter-pill store-pill-cat ${!category ? 'active-blue' : ''}`}
            onClick={() => change('category', '')}
          >
            <span>All Categories</span>
            {statistics && <span className="pill-count-badge">{statistics.total}</span>}
          </button>
          {categories.map((cat) => {
            const isSelected = resolveMainCategory(category) === cat.slug;
            return (
              <button
                key={cat.slug}
                type="button"
                className={`store-filter-pill store-pill-cat ${isSelected ? 'active-blue' : ''}`}
                onClick={() => change('category', isSelected ? '' : cat.slug)}
              >
                <BrandIcon name={cat.name} size={15} />
                <span>{cat.name}</span>
                {cat.product_count !== undefined && (
                  <span className="pill-count-badge">{cat.product_count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Results Header */}
      <div className="store-results-heading" id="shop-results">
        <h2>
          {server ? `Server ${server} · ` : ''}
          {categories.find((item) => item.slug === category)?.name ?? 'All Products'}
        </h2>
        <span>{loading ? 'Loading…' : error ? 'Unavailable' : `${total} products found`}</span>
      </div>

      {/* High-Density Compact Product Grid matching Target 48_product-cards.jpg */}
      {loading ? (
        <div className="compact-product-grid skeleton-mode" role="status" aria-label="Loading products">
          <span className="sr-only">Loading products…</span>
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="compact-product-card skeleton-card" aria-hidden="true">
              <div className="skeleton-thumb" />
              <div className="skeleton-line" />
              <div className="skeleton-line short" />
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="form-error" role="alert">{error}</p>
      ) : products.length ? (
        <div className="compact-product-grid">
          {products.map((product) => {
            const maximum = Math.min(1000, product.available_quantity);
            const isFav = favorites.includes(product.id);

            return (
              <article className="compact-product-card" key={product.id}>
                {/* Media Thumbnail Container with absolute Heart button */}
                <div className="compact-card-media-wrapper">
                  <button
                    type="button"
                    className={`compact-fav-btn ${isFav ? 'is-fav' : ''}`}
                    aria-label={`${isFav ? 'Remove' : 'Add'} ${product.name} ${isFav ? 'from' : 'to'} favorites`}
                    aria-pressed={isFav}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      toggleFavorite(product.id);
                    }}
                  >
                    <Heart size={15} fill={isFav ? '#ef4444' : 'none'} color={isFav ? '#ef4444' : '#64748b'} />
                  </button>

                  <Link to={`/products/${product.slug}`} className="compact-card-media-link" tabIndex={-1} aria-hidden="true">
                    <ProductArtwork
                      path={product.image_path}
                      name={product.name}
                      category={product.category_name}
                      images={product.supplier_image_urls}
                    />
                  </Link>
                </div>

                {/* Card Body */}
                <div className="compact-card-body">
                  <h3 className="compact-card-title">
                    <Link to={`/products/${product.slug}`} title={product.name}>
                      {product.name}
                    </Link>
                  </h3>

                  {/* Badges: SERVER X + Stock */}
                  <div className="compact-badges-row">
                    <span className="compact-server-badge">
                      SERVER {product.server_number ?? 1}
                    </span>
                    <span className={`compact-stock-badge ${maximum < 1 ? 'out' : ''}`}>
                      <span className="stock-dot-indicator" />
                      {maximum > 0 ? `${product.available_quantity} left` : 'Out of stock'}
                    </span>
                  </div>

                  {/* Price */}
                  <div className="compact-pricing-row">
                    <strong className="compact-price-amount">{formatPrice(product.price_minor)}</strong>
                    <span className="compact-price-unit">per unit</span>
                  </div>

                  {/* Quantity Stepper & Add to Cart */}
                  <div className="compact-stepper-row">
                    <div className="compact-stepper">
                      <button
                        type="button"
                        disabled={(cardQuantities[product.id] ?? 1) <= 1 || maximum < 1}
                        onClick={(e) => {
                          e.preventDefault();
                          const current = cardQuantities[product.id] ?? 1;
                          setCardQuantities((prev) => ({ ...prev, [product.id]: Math.max(1, current - 1) }));
                        }}
                        aria-label={`Decrease quantity for ${product.name}`}
                      >
                        −
                      </button>
                      <span className="compact-stepper-qty">{cardQuantities[product.id] ?? 1}</span>
                      <button
                        type="button"
                        disabled={(cardQuantities[product.id] ?? 1) >= maximum || maximum < 1}
                        onClick={(e) => {
                          e.preventDefault();
                          const current = cardQuantities[product.id] ?? 1;
                          setCardQuantities((prev) => ({ ...prev, [product.id]: Math.min(maximum, current + 1) }));
                        }}
                        aria-label={`Increase quantity for ${product.name}`}
                      >
                        +
                      </button>
                    </div>

                    <button
                      type="button"
                      className="compact-add-cart-btn"
                      disabled={maximum < 1}
                      onClick={(e) => {
                        e.preventDefault();
                        const qty = cardQuantities[product.id] ?? 1;
                        add(product.id, qty, maximum);
                        setAddedId(product.id);
                        setTimeout(() => setAddedId(null), 1800);
                      }}
                    >
                      {addedId === product.id ? 'Added!' : (
                        <>
                          <ShoppingBag size={13} /> Add
                        </>
                      )}
                    </button>
                  </div>

                  {/* View Details Action */}
                  <Link to={`/products/${product.slug}`} className="compact-view-btn">
                    View Details <ArrowRight size={13} />
                  </Link>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state" role="status">
          <PackageOpen size={36} />
          <h3>
            {category
              ? `No published ${categories.find((item) => item.slug === resolveMainCategory(category))?.name ?? 'matching'} products`
              : 'No matching products'}
          </h3>
          <p>Try another search or category. Available products will appear here when published.</p>
          <button className="button button-outline" onClick={() => setParams({})}>
            Clear filters
          </button>
        </div>
      )}

      {/* Pagination */}
      {!loading && !error && pages > 1 && (
        <div className="pagination">
          <button
            className="button button-outline"
            disabled={page <= 1}
            onClick={() => change('page', String(page - 1))}
          >
            Previous
          </button>
          <span>
            Page {Math.min(page, pages)} of {pages}
          </span>
          <button
            className="button button-outline"
            disabled={page >= pages}
            onClick={() => change('page', String(page + 1))}
          >
            Next
          </button>
        </div>
      )}
        </>
      )}
    </div>
  );
}
