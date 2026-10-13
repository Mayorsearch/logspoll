import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PackageOpen, Search, SlidersHorizontal, ArrowRight } from 'lucide-react';
import { useCatalogCategories } from '../components/useCatalogCategories';
import { ProductArtwork } from '../components/ProductArtwork';
import { cloudflareRequest } from '../lib/cloudflare-auth';
import { useCart } from '../lib/cart';
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
}
export function Marketplace() {
    const [params, setParams] = useSearchParams();
    const [products, setProducts] = useState<Product[]>([]);
    const { categories, categoryError } = useCatalogCategories();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [total, setTotal] = useState(0);
    const [pages, setPages] = useState(1);
    const [notice, setNotice] = useState('');
    const { add } = useCart();
    const [quantities, setQuantities] = useState<Record<string, number>>({});
    const query = params.get('q') ?? '', category = params.get('category') ?? '', sort = params.get('sort') ?? 'featured', availability = params.get('availability') ?? '';
    const page = Math.min(10000, Math.max(1, Math.floor(Number(params.get('page')) || 1)));
    useEffect(() => {
        let active = true;
        queueMicrotask(() => { if(active) { setLoading(true); setError('') } });
        const timer = setTimeout(() => {
            {
                const search = new URLSearchParams({ q: query, category, sort, availability, page: String(page) });
                void cloudflareRequest<{
                    products: Product[];
                    total: number;
                    pages: number;
                }>(`/api/products?${search}`).then(data => { if (active) {
                    setProducts(data.products);
                    setTotal(data.total);
                    setPages(data.pages);
                } }).catch(problem => { if (active) {
                    setError(problem.message);
                    setProducts([]);
                } }).finally(() => { if (active)
                    setLoading(false); });
                return;
            }
        }, 200);
        return () => { active = false; clearTimeout(timer); };
    }, [query, category, sort, availability, page]);
    function change(key: string, value: string) { const next = new URLSearchParams(params); if (value)
        next.set(key, value);
    else
        next.delete(key); if (key !== 'page')
        next.delete('page'); setParams(next, { replace: true }); }
    return <div className="container section catalog-page"><div className="page-heading"><h1><PackageOpen size={25}/> Products Store</h1><p>Browse our catalog of approved digital products and tools.</p></div><div className="catalog-toolbar"><label className="search-input"><Search size={20}/><span className="sr-only">Search products</span><input type="search" value={query} onChange={event => change('q', event.target.value)} placeholder="Search products and services…" maxLength={120}/></label><Link className="text-link" to="/cart">View cart <ArrowRight size={16}/></Link></div><div className="category-tabs" aria-label="Product categories"><button aria-pressed={!category} onClick={() => change('category', '')}>All Categories</button>{categories.map(item => <button key={item.slug} aria-pressed={category === item.slug} onClick={() => change('category', item.slug)}>{item.name} {item.product_count !== undefined && <span className="category-count">{item.product_count}</span>}</button>)}</div>{categoryError && <p className="preview-note" role="status">{categoryError}</p>}<div className="catalog-toolbar catalog-sort"><label className="filter-label"><SlidersHorizontal size={17}/>Sort<select value={sort} onChange={event => change('sort', event.target.value)}><option value="featured">Featured</option><option value="price-asc">Price: low to high</option><option value="price-desc">Price: high to low</option><option value="newest">Newest</option><option value="name">Name</option></select></label><label className="filter-label">Availability<select value={availability} onChange={event => change('availability', event.target.value)}><option value="">All</option><option value="in-stock">In stock</option><option value="out-of-stock">Out of stock</option></select></label></div><div className="results-heading"><h2>{categories.find(item => item.slug === category)?.name ?? 'All services'}</h2><span>{loading ? 'Loading…' : error ? 'Unavailable' : `${total} products`}</span></div>{notice && <p className="form-success" role="status">{notice} <Link to="/cart">Open cart →</Link></p>}
    {loading ? <p className="empty-state" role="status">Loading approved products…</p> : error ? <p className="form-error" role="alert">{error}</p> : products.length ? <div className="live-product-grid">{products.map(product => {
                const maximum = Math.min(1000, product.available_quantity);
                const quantity = Math.min(Math.max(1, maximum), quantities[product.id] ?? 1);
                return <article className="live-product-card" key={product.id}><Link className="live-product-icon" to={`/products/${product.slug}`} aria-label={`View ${product.name}`}><ProductArtwork path={product.image_path} name={product.name} images={product.supplier_image_urls}/></Link><div className="live-product-body"><span className="sr-only">{product.category_name}</span><h3><Link to={`/products/${product.slug}`}>{product.name}</Link></h3><p className="sr-only">{product.description.slice(0, 150)}</p><small className={`stock-badge ${maximum < 1 ? 'out-of-stock' : ''}`}>{maximum > 0 ? 'In Stock' : 'Out of Stock'}</small><strong>{new Intl.NumberFormat('en-NG', { style: 'currency', currency: product.currency }).format(product.price_minor / 100)}</strong><div className="product-purchase-row"><div className="quantity-stepper" role="group" aria-label={`Quantity for ${product.name}`}><button aria-label={`Decrease quantity for ${product.name}`} disabled={quantity <= 1 || maximum < 1} onClick={() => setQuantities(values => ({ ...values, [product.id]: quantity - 1 }))}>−</button><output aria-label="Quantity">{quantity}</output><button aria-label={`Increase quantity for ${product.name}`} disabled={quantity >= maximum} onClick={() => setQuantities(values => ({ ...values, [product.id]: quantity + 1 }))}>+</button></div><button className="button button-navy" disabled={maximum < 1} onClick={() => { add(product.id, quantity, product.available_quantity); setNotice(`${product.name} added to cart (subject to available quantity).`); }}>Add to cart</button></div></div></article>;
            })}</div> : <div className="empty-state" role="status"><PackageOpen size={36}/><h3>No matching approved products</h3><p>Try another search or category. Listings appear after resale authorization and administrator approval.</p><button className="button button-outline" onClick={() => setParams({})}>Clear filters</button></div>}
    {!loading && !error && pages > 1 && <div className="pagination"><button className="button button-outline" disabled={page <= 1} onClick={() => change('page', String(page - 1))}>Previous</button><span>Page {Math.min(page, pages)} of {pages}</span><button className="button button-outline" disabled={page >= pages} onClick={() => change('page', String(page + 1))}>Next</button></div>}
  </div>;
}
