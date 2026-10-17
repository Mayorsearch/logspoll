import { useId, useState } from 'react'
import { safeProductImage } from '../lib/product-images'
import {artworkAccent,artworkLines,detectBrand} from '../lib/storefront-branding'
import {BrandIcon} from './BrandIcon'
import './product-artwork.css'

export function ProductArtwork({ path, name, category='', images = [] }: { path?: string | null; name: string; category?:string; images?: string[] }) {
  const gradientId='art-'+useId().replace(/:/g,'')
  const [failedPaths, setFailedPaths] = useState<string[]>([])
  const valid = path && path.length <= 2048 && /^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.(png|jpg|jpeg|webp)$/.test(path) && !path.includes('//')
  const source = [safeProductImage(path),valid ? `/${path}` : null, ...images.slice(0,12).map(safeProductImage)].find(value => value && !failedPaths.includes(value))
  const brand=detectBrand(name,category),lines=artworkLines(name),accent=artworkAccent(name+' '+category)
  return source ? <span className="product-artwork-frame"><img className="product-artwork" src={source} alt={name} loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedPaths(values => [...values, source])}/><span className="artwork-brand-badge"><BrandIcon name={name} category={category} size={18}/>{brand.label}</span></span> : <svg className="product-artwork generated-product-artwork" viewBox="0 0 640 512" role="img" aria-label={name}>
    <title>{name}</title><defs><linearGradient id={gradientId} x2="1" y2="1"><stop stopColor={brand.color}/><stop offset="1" stopColor="#101828"/></linearGradient></defs><rect width="640" height="512" fill={`url(#${gradientId})`}/><path d={`M${460+accent} 0H640V${190+accent}Z`} fill="#FFFFFF" fillOpacity=".07"/><path d={`M0 ${370+accent}L${accent+160} 512H0Z`} fill="#FFFFFF" fillOpacity=".05"/>
    <rect x="34" y="30" width="82" height="6" rx="3" fill="#FF5A0A"/><text x="606" y="40" textAnchor="end" fill="#FFFFFF" fillOpacity=".8" fontSize="16" fontWeight="700">LogsPoll</text>
    <rect x="248" y="64" width="144" height="144" rx="36" fill="white" stroke="#F0DFD4" strokeWidth="2"/><BrandIcon name={name} category={category} x={280} y={96} size={80}/>
    <text x="320" y="253" textAnchor="middle" fill="#FFFFFF" fontSize="19" fontWeight="800">{brand.label}</text>
    <text x="320" y={lines.length===1?344:318} textAnchor="middle" fill="#FFFFFF" fontSize="27" fontWeight="800">{lines.map((line,i)=><tspan key={i} x="320" dy={i?38:0}>{line}</tspan>)}</text>
    <path d="M252 465H388" stroke="#FF5A0A" strokeWidth="3" strokeLinecap="round"/>
  </svg>
}
