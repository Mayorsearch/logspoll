import { resolveMainCategory } from '../lib/main-storefront-categories';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PackageOpen, Search, SlidersHorizontal, ArrowRight, Heart, Grid2X2, ShoppingBag } from 'lucide-react';
import { useCatalogCategories } from '../components/useHomeCategories';
import { ProductArtwork } from '../components/ProductArtwork';
import { HomeCategories } from '../components/HomeCategories';
import { cloudflareRequest } from '../lib/cloudflare-auth';
import { useFavorites } from '../lib/favorites';
import { useCart } from '../lib/cart';
import { useCurrency } from '../lib/currency';

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
  const [params, setParams] = useSearchParams();
  const { favorites, toggleFavorite } = useFavorites();
  const { formatPrice } = useCurrency();
  const favoritesOnly = params.get('favorites') === '1';
  const [statistics, setStatistics] = useState<{ total: number; stock: number; outOfStock: number } | null>(null);

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
  const { categories, categoryError } = useCatalogCategories();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [total, setTotal] = useState(0);
  const [pages, setPages] = useState(1);
  const [notice, setNotice] = useState('');
  const { add } = useCart();
  const [quantities, setQuantities] = useState<Record<string, number>>({});

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
          let items = data.products;
          if (!favoritesOnly && pageSize === 40 && data.total > (page - 1) * pageSize + 20) {
            const next = new URLSearchParams(search);
            next.set('page', String(Number(next.get('page')) + 1));
            const more = await cloudflareRequest<{ products: Product[] }>(`/api/products?${next}`);
            items = [...items, ...more.products];
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
    <div className="container section catalog-page premium-marketplace">
      {/* Intro Header */}
      <div className="marketplace-intro">
        <span className="marketplace-eyebrow">DIGITAL ESSENTIALS MARKETPLACE</span>
        <h1>Explore Products</h1>
        <p>Discover verified digital products, services, and accounts across all server tiers.</p>
      </div>

      {/* Statistics Bar (Requirement 3: Total products, available stock, out-of-stock counts) */}
      {statistics && (
        <div className="catalog-statistics" role="region" aria-label="Catalog Overview Statistics">
          <div className="stat-card">
            <span className="stat-label">Total Listed Products</span>
            <strong className="stat-value">{statistics.total}</strong>
          </div>
          <div className="stat-card in-stock">
            <span className="stat-label">In-Stock Verified</span>
            <strong className="stat-value">{statistics.stock}</strong>
          </div>
          <div className="stat-card out-of-stock">
            <span className="stat-label">Currently Out of Stock</span>
            <strong className="stat-value">{statistics.outOfStock}</strong>
          </div>
        </div>
      )}

      {/* Search Input */}
      <div className="catalog-toolbar marketplace-search">
        <label className="search-input">
          <Search size={20} />
          <span className="sr-only">Search products</span>
          <input
            type="search"
            value={query}
            onChange={(event) => change('q', event.target.value)}
            placeholder="Search products by title, platform or service..."
            maxLength={120}
          />
        </label>
      </div>

      {/* Quick Explore Features */}
      <div className="marketplace-featured">
        <button
          className="marketplace-feature"
          onClick={() => {
            setParams({});
            document.getElementById('shop-results')?.scrollIntoView({ block: 'start' });
          }}
        >
          <span className="feature-icon"><ShoppingBag size={22} /></span>
          <span>
            <strong>Explore All Products</strong>
            <small>{statistics ? `${statistics.total} verified products available` : 'Find your digital essentials'}</small>
          </span>
          <ArrowRight size={18} />
        </button>
        <a className="marketplace-feature" href="#shop-categories">
          <span className="feature-icon"><Grid2X2 size={22} /></span>
          <span>
            <strong>Unified Categories</strong>
            <small>Browse Facebook, Instagram, Gmail &amp; VPN</small>
          </span>
          <ArrowRight size={18} />
        </a>
      </div>

      {/* Category Section */}
      <section id="shop-categories" className="shop-categories" aria-label="Browse categories">
        <div className="shop-section-heading">
          <h2>Find your essentials</h2>
          <span>Unified across all servers</span>
        </div>
        <HomeCategories
          items={categories}
          error={categoryError}
          selected={resolveMainCategory(category)}
          onSelect={(slug) => change('category', resolveMainCategory(category) === slug ? '' : slug)}
        />
      </section>

      {/* Source & Favorites Tabs */}
      <div className="catalog-source-tabs">
        <button
          aria-pressed={!favoritesOnly}
          onClick={() => {
            const next = new URLSearchParams(params);
            next.delete('favorites');
            next.delete('category');
            next.delete('page');
            setParams(next, { replace: true });
          }}
        >
          All Products
        </button>
        <button aria-pressed={favoritesOnly} onClick={() => change('favorites', '1')}>
          <Heart size={16} /> Favorites ({favorites.length})
        </button>
      </div>

      {/* Filter and Sort Toolbar */}
      <div className="catalog-toolbar catalog-sort">
        <label className="filter-label">
          <SlidersHorizontal size={17} />
          Sort
          <select value={sort} onChange={(event) => change('sort', event.target.value)}>
            <option value="featured">Featured</option>
            <option value="price-asc">Price: low to high</option>
            <option value="price-desc">Price: high to low</option>
            <option value="newest">Newest</option>
            <option value="name">Name</option>
          </select>
        </label>

        <label className="filter-label">
          Availability
          <select value={availability} onChange={(event) => change('availability', event.target.value)}>
            <option value="">All Availability</option>
            <option value="in-stock">In stock only</option>
            <option value="out-of-stock">Out of stock</option>
          </select>
        </label>

        {/* Server Filter: Strict Anonymity Requirement */}
        <label className="filter-label">
          Server
          <select
            value={server}
            onChange={(e) =>
              setParams((p) => {
                const n = new URLSearchParams(p);
                if (e.target.value) n.set('server', e.target.value);
                else n.delete('server');
                n.delete('page');
                return n;
              })
            }
          >
            <option value="">All Servers</option>
            <option value="1">Server 1</option>
            <option value="2">Server 2</option>
            <option value="3">Server 3</option>
          </select>
        </label>

        <label className="filter-label page-size-filter">
          Show
          <select
            value={String(pageSize)}
            onChange={(event) => change('size', event.target.value)}
            aria-label="Results per page"
          >
            <option value="20">20 per page</option>
            <option value="40">40 per page</option>
          </select>
        </label>
      </div>

      {/* Results Header */}
      <div className="results-heading" id="shop-results">
        <h2>
          {server ? `Server ${server} · ` : ''}
          {categories.find((item) => item.slug === category)?.name ?? 'All products'}
        </h2>
        <span>{loading ? 'Loading…' : error ? 'Unavailable' : `${total} products found`}</span>
      </div>

      {notice && (
        <p className="form-success" role="status">
          {notice} <Link to="/cart">Open cart →</Link>
        </p>
      )}

      {/* Product Grid */}
      {loading ? (
        <div className="live-product-grid product-skeleton-grid" role="status" aria-label="Loading products">
          <span className="sr-only">Loading products…</span>
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="product-skeleton" aria-hidden="true">
              <div />
              <span />
              <span />
              <span />
            </div>
          ))}
        </div>
      ) : error ? (
        <p className="form-error" role="alert">{error}</p>
      ) : products.length ? (
        <div className="live-product-grid">
          {products.map((product) => {
            const maximum = Math.min(1000, product.available_quantity);
            const quantity = Math.min(Math.max(1, maximum), quantities[product.id] ?? 1);

            return (
              <article className="live-product-card" key={product.id}>
                {/* Favorite Button */}
                <button
                  className="favorite-button"
                  aria-label={`${
                    favorites.includes(product.id) ? 'Remove' : 'Add'
                  } ${product.name} ${favorites.includes(product.id) ? 'from' : 'to'} favorites`}
                  aria-pressed={favorites.includes(product.id)}
                  onClick={() => toggleFavorite(product.id)}
                >
                  <Heart size={18} fill={favorites.includes(product.id) ? 'currentColor' : 'none'} />
                </button>

                {/* Artwork */}
                <Link className="live-product-icon" to={`/products/${product.slug}`} aria-label={`View ${product.name}`}>
                  <ProductArtwork
                    path={product.image_path}
                    name={product.name}
                    category={product.category_name}
                    images={product.supplier_image_urls}
                  />
                </Link>

                {/* Body */}
                <div className="live-product-body">
                  <div className="product-badges-row">
                    <span className="product-category-badge">{product.category_name}</span>
                    {product.server_number ? (
                      <span className={`server-badge server-badge-${product.server_number}`}>
                        Server {product.server_number}
                      </span>
                    ) : null}
                  </div>

                  <h3>
                    <Link to={`/products/${product.slug}`}>{product.name}</Link>
                  </h3>
                  <p className="product-summary">{product.description.slice(0, 150)}</p>

                  <small className={`stock-badge ${maximum < 1 ? 'out-of-stock' : ''}`}>
                    {maximum > 0 ? `${product.available_quantity} available` : 'Out of stock'}
                  </small>

                  {/* Multi-Currency Price Formatting */}
                  <strong className="product-price">{formatPrice(product.price_minor)}</strong>

                  <Link className="product-details-link" to={`/products/${product.slug}`}>
                    View Details <ArrowRight size={14} />
                  </Link>

                  <div className="product-purchase-row">
                    <div className="quantity-stepper" role="group" aria-label={`Quantity for ${product.name}`}>
                      <button
                        aria-label={`Decrease quantity for ${product.name}`}
                        disabled={quantity <= 1 || maximum < 1}
                        onClick={() => setQuantities((values) => ({ ...values, [product.id]: quantity - 1 }))}
                      >
                        −
                      </button>
                      <output aria-label="Quantity">{quantity}</output>
                      <button
                        aria-label={`Increase quantity for ${product.name}`}
                        disabled={quantity >= maximum}
                        onClick={() => setQuantities((values) => ({ ...values, [product.id]: quantity + 1 }))}
                      >
                        +
                      </button>
                    </div>
                    <button
                      className="button button-navy"
                      disabled={maximum < 1}
                      onClick={() => {
                        add(product.id, quantity, product.available_quantity);
                        setNotice(`${product.name} added to cart (subject to available quantity).`);
                      }}
                    >
                      Add to cart
                    </button>
                  </div>
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
    </div>
  );
}
