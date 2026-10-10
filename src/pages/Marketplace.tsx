import { Link, useSearchParams } from 'react-router-dom'
import { PackageOpen, Search, SlidersHorizontal, ArrowRight } from 'lucide-react'
import { categories } from '../components/Categories'

export function Marketplace() {
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const category = params.get('category') ?? ''
  const selected = categories.find(item => item.slug === category)
  function change(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value); else next.delete(key)
    setParams(next, { replace: true })
  }
  return <div className="container section catalog-page"><div className="page-heading"><span className="eyebrow">THE LOGSPOLL CATALOG</span><h1>Find the right digital service.</h1><p>Explore tools and services for your work, communication and everyday needs.</p></div>
    <div className="catalog-toolbar"><label className="search-input"><Search size={20} /><span className="sr-only">Search products</span><input type="search" value={query} onChange={e => change('q', e.target.value)} placeholder="Search products and services…" maxLength={120} /></label><span className="filter-label"><SlidersHorizontal size={17} /> Browse by category</span></div>
    <div className="category-tabs" aria-label="Product categories"><button aria-pressed={!category} onClick={() => change('category', '')}>All services</button>{categories.map(({ slug, name }) => <button key={slug} aria-pressed={category === slug} onClick={() => change('category', slug)}>{name}</button>)}</div>
    <div className="results-heading"><h2>{selected?.name ?? (category ? 'Unknown category' : 'All services')}</h2><span>Live catalog pending</span></div>
    <div className="empty-state" role="status"><span className="empty-icon"><PackageOpen size={34} /></span><h3>The catalog is getting ready</h3><p>{query ? `No live results are available for “${query}”. ` : ''}The product database is not connected in this preview. Products, availability and prices will appear here when the live catalog is ready.</p>{(query || category) && <button className="button button-outline" onClick={() => setParams({})}>Clear filters</button>}<Link className="text-link" to="/support">Have a question? <ArrowRight size={16} /></Link></div>
  </div>
}
