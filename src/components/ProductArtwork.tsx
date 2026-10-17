import { useId, useState } from 'react'
import { safeProductImage } from '../lib/product-images'
import { detectBrand, artworkLines } from '../lib/storefront-branding'
import { BrandIcon } from './BrandIcon'
import './product-artwork.css'

export function ProductArtwork({ 
  path, 
  name, 
  category = '', 
  images = [] 
}: { 
  path?: string | null; 
  name: string; 
  category?: string; 
  images?: string[] 
}) {
  const gradientId = 'art-' + useId().replace(/:/g, '')
  const [failedPaths, setFailedPaths] = useState<string[]>([])
  const valid = path && path.length <= 2048 && /^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.(png|jpg|jpeg|webp)$/.test(path) && !path.includes('//')
  const source = [safeProductImage(path), valid ? `/${path}` : null, ...images.slice(0, 12).map(safeProductImage)].find(value => value && !failedPaths.includes(value))
  const brand = detectBrand(name, category)
  // Wrap lines to fit ~32 characters per line, up to 3 lines max
  const lines = artworkLines(name, 32, 3)
  const startY = lines.length === 1 ? 194 : lines.length === 2 ? 182 : 172
  const lineSpacing = lines.length === 1 ? 0 : lines.length === 2 ? 22 : 20
  const orangeBarY = startY + (lines.length - 1) * lineSpacing + 24

  return (
    <svg
      className="product-artwork generated-product-artwork"
      viewBox="0 0 400 320"
      role="img"
      aria-label={name}
      style={{ display: 'block', width: '100%', height: '100%' }}
    >
      <title>{name}</title>
      <defs>
        <radialGradient id={gradientId} cx="40%" cy="30%" r="85%">
          <stop offset="0%" stopColor={brand.color} />
          <stop offset="55%" stopColor={brand.color} stopOpacity="0.8" />
          <stop offset="100%" stopColor="#0b1120" />
        </radialGradient>
      </defs>
      <rect width="400" height="320" fill={`url(#${gradientId})`} />

      {/* Subtle Faceted Shadows matching Reference Images */}
      <path d="M 210 0 L 400 0 L 400 320 L 70 320 Z" fill="#000000" fillOpacity="0.20" />
      <path d="M 310 0 L 400 0 L 400 320 L 210 320 Z" fill="#000000" fillOpacity="0.18" />

      {/* If an authorized source image exists, show subtle background texture */}
      {source && (
        <image
          href={source}
          width="400"
          height="320"
          preserveAspectRatio="xMidYMid slice"
          opacity="0.16"
          onError={() => setFailedPaths(prev => [...prev, source])}
        />
      )}
      
      {/* Top Brand & Watermark Accents */}
      <rect x="22" y="18" width="46" height="4" rx="2" fill="#FF5A0A" />
      <text 
        x="378" 
        y="25" 
        textAnchor="end" 
        fill="#ffffff" 
        fillOpacity="0.75" 
        fontSize="12" 
        fontWeight="700" 
        letterSpacing="-0.01em"
      >
        LogsPoll
      </text>

      {/* Centered White Squircle with Brand Icon */}
      <rect
        x="156"
        y="42"
        width="88"
        height="88"
        rx="24"
        fill="#ffffff"
        fillOpacity="0.98"
      />
      <BrandIcon name={name} category={category} x={172} y={58} size={56} />

      {/* Category / Brand Subtitle */}
      <text 
        x="200" 
        y="152" 
        textAnchor="middle" 
        fill="#ffffff" 
        fillOpacity="0.88" 
        fontSize="12.5" 
        fontWeight="800" 
        letterSpacing="0.02em"
      >
        {brand.label}
      </text>

      {/* Product Title inside Artwork (2-3 lines max, prominent & bold) */}
      {lines.map((line, idx) => (
        <text
          key={idx}
          x="200"
          y={startY + idx * lineSpacing}
          textAnchor="middle"
          fill="#ffffff"
          fillOpacity="0.98"
          fontSize={lines.length > 2 ? '13.5' : '14.5'}
          fontWeight="800"
          letterSpacing="-0.01em"
        >
          {line}
        </text>
      ))}

      {/* Centered Orange Accent Bar below Title */}
      <rect 
        x="165" 
        y={orangeBarY} 
        width="70" 
        height="3.5" 
        rx="1.75" 
        fill="#FF5A0A" 
        fillOpacity="0.9" 
      />
    </svg>
  )
}

