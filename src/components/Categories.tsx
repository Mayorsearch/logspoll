import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router-dom'
import { homeCategories } from '../lib/category-navigation'
import { useCatalogCategories } from './useCatalogCategories'
import {BrandIcon} from './BrandIcon'

export function Categories() {
  const { categories, categoryError } = useCatalogCategories()
  return <><div className="category-grid">{homeCategories.map((reference) => {
    const category = categories.find(item => item.name === reference.name || item.slug === reference.slug) ?? reference
    return <Link to={`/marketplace?category=${encodeURIComponent(category.slug)}`} className="category-card" key={reference.slug}><span className="category-icon"><BrandIcon name={category.name} size={29}/></span>{category.product_count !== undefined && <span className="home-category-count">{category.product_count}</span>}<h3>{reference.name}</h3><p>{reference.description}</p><span className="category-listings">View Listings <ArrowRight size={18} /></span></Link>
  })}</div><nav className="category-directory" aria-label="All marketplace categories">{categories.map(category => <Link key={category.slug} to={`/marketplace?category=${encodeURIComponent(category.slug)}`}><BrandIcon name={category.name} size={18}/>{category.name}{category.product_count !== undefined && <span className="category-count">{category.product_count}</span>}</Link>)}</nav>{categoryError && <p className="preview-note" role="status">{categoryError}</p>}</>
}
