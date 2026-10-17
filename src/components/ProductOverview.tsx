import { FileText } from 'lucide-react'

// React escapes all supplier text; only explicit HTTP(S) URLs become links.
export function ProductOverview({description}:{description?:string|null}) {
 const text=description?.trim()
 return <section className="product-overview" aria-labelledby="product-overview-title"><h2 id="product-overview-title"><FileText size={23}/>Product Overview</h2><div className="product-description">{text ? text.split(/(https?:\/\/[^\s<>"']+)/g).map((part,index)=>{
  if(!/^https?:\/\//.test(part))return part
  const candidate=part.replace(/[.,;!?]+$/,'')
  try {const url=new URL(candidate);if(url.username||url.password)return part}
  catch{return part}
  return <span key={index}><a href={candidate} target="_blank" rel="noopener noreferrer nofollow">{candidate}</a>{part.slice(candidate.length)}</span>
 }) : <p>Product description is not available yet.</p>}</div></section>
}
