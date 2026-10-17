import { useId, useState } from 'react'
import { safeProductImage } from '../lib/product-images'
import {detectBrand} from '../lib/storefront-branding'
import {BrandIcon} from './BrandIcon'
import './product-artwork.css'

export function ProductArtwork({ path, name, category='', images = [] }: { path?: string | null; name: string; category?:string; images?: string[] }) {
  const gradientId='art-'+useId().replace(/:/g,'')
  const [failedPaths, setFailedPaths] = useState<string[]>([])
  const valid = path && path.length <= 2048 && /^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.(png|jpg|jpeg|webp)$/.test(path) && !path.includes('//')
  const source = [safeProductImage(path),valid ? `/${path}` : null, ...images.slice(0,12).map(safeProductImage)].find(value => value && !failedPaths.includes(value))
  const brand=detectBrand(name,category)
  return source ? (
    <span className="product-artwork-frame">
      <img
        className="product-artwork"
        src={source}
        alt={name}
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailedPaths((values) => [...values, source])}
      />
      <span className="artwork-brand-badge">
        <BrandIcon name={name} category={category} size={18} />
        {brand.label}
      </span>
    </span>
  ) : (
    <svg
      className="product-artwork generated-product-artwork"
      viewBox="0 0 400 300"
      role="img"
      aria-label={name}
    >
      <title>{name}</title>
      <defs>
        <radialGradient id={gradientId} cx="50%" cy="40%" r="65%">
          <stop offset="0%" stopColor={brand.color} />
          <stop offset="60%" stopColor={brand.color} stopOpacity="0.75" />
          <stop offset="100%" stopColor="#0b1120" />
        </radialGradient>
      </defs>
      <rect width="400" height="300" fill={`url(#${gradientId})`} />
      <circle cx="200" cy="150" r="115" fill="#ffffff" fillOpacity="0.04" />
      <circle cx="200" cy="150" r="85" fill="#ffffff" fillOpacity="0.06" />
      
      {/* Centered Frosted-Glass Squircle */}
      <rect
        x="130"
        y="80"
        width="140"
        height="140"
        rx="36"
        fill="#ffffff"
        fillOpacity="0.18"
        stroke="#ffffff"
        strokeOpacity="0.28"
        strokeWidth="1.5"
      />
      <BrandIcon name={name} category={category} x={158} y={108} size={84} />
    </svg>
  )
}
