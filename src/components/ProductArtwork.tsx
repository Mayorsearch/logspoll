import { useState } from 'react'
import { PackageOpen } from 'lucide-react'
import { safeProductImage } from '../lib/product-images'

export function ProductArtwork({ path, name, images = [] }: { path?: string | null; name: string; images?: string[] }) {
  const [failedPaths, setFailedPaths] = useState<string[]>([])
  const valid = path && path.length <= 2048 && /^[a-zA-Z0-9][a-zA-Z0-9/_-]*\.(png|jpg|jpeg|webp)$/.test(path) && !path.includes('//')
  const source = [valid ? `/${path}` : null, ...images.map(safeProductImage)].find(value => value && !failedPaths.includes(value))
  return source ? <img className="product-artwork" src={source} alt={name} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedPaths(values => [...values, source])} /> : <span className="product-artwork-placeholder" aria-hidden="true"><PackageOpen size={52} /></span>
}
