import {Link} from 'react-router-dom'
import {Mail,ShieldCheck} from 'lucide-react'
import {useCatalogCategories} from './useHomeCategories'
import {BrandIcon} from './BrandIcon'
import type {HomeCategory as CatalogCategory} from './useHomeCategories'
export function HomeCategories({items,error,selected,onSelect}:{items?:CatalogCategory[];error?:string;selected?:string;onSelect?:(slug:string)=>void}={}){
 const fetched=useCatalogCategories(!items),categories=items??fetched.categories,message=error??fetched.categoryError
 return <><div className="category-grid main-storefront-categories" aria-label="Storefront categories">{categories.map(category=>{const content=<><span className="category-icon" data-category={category.slug}>{category.slug==='gmail'?<Mail size={26}/>:category.slug==='vpn'?<ShieldCheck size={26}/>:<BrandIcon name={category.name} size={26}/>}</span><h3>{category.name}</h3><span className="main-category-count">{category.product_count===undefined?(message?'Count unavailable':'Loading…'):`${category.product_count} products`}</span>{category.in_stock_count!==undefined&&<small>{category.in_stock_count} in stock</small>}</>;const className=`category-card storefront-category-card${selected===category.slug?' selected':''}`;return onSelect?<button className={className} key={category.slug} aria-pressed={selected===category.slug} onClick={()=>onSelect(category.slug)}>{content}</button>:<Link className={className} key={category.slug} to={`/marketplace?category=${category.slug}`}>{content}</Link>})}</div>{message&&<p className="preview-note" role="status">{message}</p>}</>
}
