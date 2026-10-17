import {useEffect,useState} from 'react'
import {cloudflareRequest} from '../lib/cloudflare-auth'
import {mainStorefrontCategories} from '../lib/main-storefront-categories'
export type HomeCategory = (typeof mainStorefrontCategories)[number] & {product_count?:number;in_stock_count?:number}
export function useCatalogCategories(enabled=true){
 const [result,setResult]=useState<{records:HomeCategory[];error:string}>({records:[],error:''})
 useEffect(()=>{if(!enabled)return;let active=true;void cloudflareRequest<{records:HomeCategory[]}>('/api/storefront/categories').then(({records})=>{if(active)setResult({records,error:''})}).catch(error=>{if(active)setResult({records:[],error:error instanceof Error?error.message:'Categories unavailable.'})});return()=>{active=false}},[enabled])
 return {categories:mainStorefrontCategories.map<HomeCategory>(category=>({...category,...result.records.find(record=>record.slug===category.slug)})),categoryError:result.error}
}
