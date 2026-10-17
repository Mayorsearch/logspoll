import {useId,useState} from 'react'
import {Globe2,Heart,Mail,MessageCircle,ShieldCheck} from 'lucide-react'
import {brandAsset,detectBrand} from '../lib/storefront-branding'
const failedAssets=new Set<string>()
export function BrandIcon({name,category='',size=24,x,y}:{name:string;category?:string;size?:number;x?:number;y?:number}){
 const brand=detectBrand(name,category),source=brandAsset(brand),[failed,setFailed]=useState<string|null>(null),id='brand-'+useId().replace(/:/g,'')
 const Fallback=brand.kind==='vpn'?ShieldCheck:brand.kind==='mail'?Mail:brand.kind==='dating'?Heart:brand.kind==='social'?MessageCircle:Globe2
 const rgb=brand.color.match(/\w\w/g)!.map(v=>parseInt(v,16)/255)
 return <svg className="brand-category-icon" x={x} y={y} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" style={{color:brand.color}}>
  {brand.symbol?<use href={`/icons.svg#${brand.symbol}`} width="24" height="24"/>:source&&failed!==source&&!failedAssets.has(source)?<><defs><filter id={id} colorInterpolationFilters="sRGB"><feColorMatrix type="matrix" values={`0 0 0 0 ${rgb[0]} 0 0 0 0 ${rgb[1]} 0 0 0 0 ${rgb[2]} 0 0 0 1 0`}/></filter></defs><image href={source} width="24" height="24" filter={brand.slug?`url(#${id})`:undefined} onError={()=>{failedAssets.add(source);setFailed(source)}}/></>:<Fallback size={24}/>}
 </svg>
}
