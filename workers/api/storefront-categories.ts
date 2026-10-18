import {mainStorefrontCategories} from '../../src/lib/main-storefront-categories.ts'
import {HttpError,json} from './http.ts'
import type {ApiEnv} from './types.ts'
const normalize=(column:string)=>['-','_','/','(',')','.',',',':'].reduce((sql,char)=>`replace(${sql},'${char}',' ')`,`lower(' '||${column}||' ')`)
const words=(column:string,values:string[])=>values.map(word=>`${column} GLOB '*[^a-z0-9]${word}[^a-z0-9]*'`).join(' OR ')
const nonMail=words('title_key',['workspace','drive','gemini','youtube','photos','adsense','adwords','google one','google play','google cloud','googleworkspace','googledrive','googlephotos','googleone','googleplay','googlecloud'])
function match(key:string,title:boolean){const column=title?'title_key':"(category_key || ' ' || slug_key)";switch(key){case 'instagram':return words(column,['instagram','insta']);case 'facebook':return words(column,['facebook','fb']);case 'tiktok':return words(column,['tiktok','tik tok']);case 'vpn':return words(column,['vpn','astrill','hma','hide my ass','hidemyass','nordvpn','expressvpn','surfshark','protonvpn','windscribe','cyberghost']);case 'gmail':return `(${words(column,['gmail','google mail'])}) AND NOT (${nonMail})`;case 'twitter':return title?`(${words(column,['twitter','x account','x accounts','x premium','x blue'])} OR title_key GLOB '*19[0-9][0-9] x *' OR title_key GLOB '*20[0-9][0-9] x *')`:`(${words(column,['twitter'])} OR trim(category_key) IN ('x','x account','x accounts') OR trim(slug_key) IN ('x','x account','x accounts'))`;default:throw Error('Unsupported main category')}}
const priority=['instagram','facebook','twitter','tiktok','vpn','gmail']
export const categoryCase='CASE '+[true,false].flatMap(title=>priority.map(key=>`WHEN (${match(key,title)}) THEN '${key}'`)).join(' ')+' ELSE NULL END'
const columns='p.id,p.category_id,p.slug,p.name,p.brand,p.description,p.price_minor,p.currency,p.delivery_type,p.image_path,p.term,p.features,p.supplier_image_urls,p.featured,p.available_quantity,p.server_number,c.name AS category_name,c.slug AS category_slug'
const catalog=`WITH normalized AS (SELECT ${columns},${normalize('p.name')} title_key,${normalize('c.name')} category_key,${normalize('c.slug')} slug_key FROM storefront_products p JOIN categories c ON c.id=p.category_id), grouped AS (SELECT normalized.*,${categoryCase} main_category FROM normalized)`
export async function storefrontCategories(request:Request,env:ApiEnv):Promise<Response|null>{
 const url=new URL(request.url),isCategories=url.pathname==='/api/storefront/categories'||url.pathname==='/api/v1/storefront/categories',isFilter=(url.pathname==='/api/products'||url.pathname==='/api/v1/products')&&url.searchParams.has('main_category')
 if(!isCategories&&!isFilter)return null
 if(request.method!=='GET')throw new HttpError(405,'Read-only storefront endpoint.')
 if(!env.DB)throw new HttpError(503,'Production storefront database unavailable.')
 if(isCategories){const rows=await env.DB.prepare(`${catalog} SELECT main_category,count(*) product_count,sum(available_quantity>0) in_stock_count FROM grouped WHERE main_category IS NOT NULL GROUP BY main_category`).all<{main_category:string;product_count:number;in_stock_count:number}>();return json({records:mainStorefrontCategories.map(category=>({...category,product_count:0,in_stock_count:0,...rows.results.find(row=>row.main_category===category.slug)}))})}
 const category=url.searchParams.get('main_category')??''
 if(!mainStorefrontCategories.some(item=>item.slug===category))throw new HttpError(400,'Choose a supported storefront category.')
 const conditions=['main_category=?'],values:(string|number)[]=[category],params=url.searchParams,q=(params.get('q')??'').trim().slice(0,200)
 if(q){conditions.push('(instr(lower(name),lower(?))>0 OR instr(lower(description),lower(?))>0)');values.push(q,q)}
 const availability=params.get('availability');if(availability==='in-stock')conditions.push('available_quantity>0');if(availability==='out-of-stock')conditions.push('available_quantity=0')
 const server=params.get('server');if(server&&['1','2','3','4'].includes(server)){conditions.push('server_number=?');values.push(Number(server))}
 const ids=params.get('ids');if(ids){const list=[...new Set(ids.split(','))];if(list.length>100||list.some(id=>!/^[a-f\d-]{36}$/i.test(id)))throw new HttpError(400,'Invalid product selection.');conditions.push(`id IN (${list.map(()=>'?').join(',')})`);values.push(...list)}
 const page=Math.min(10000,Math.max(1,Math.floor(Number(params.get('page'))||1))),limit=ids?100:20,where=conditions.join(' AND '),order=({'price-asc':'price_minor ASC,id','price-desc':'price_minor DESC,id',newest:'id DESC',name:'name,id'} as Record<string,string>)[params.get('sort')??'']??'featured DESC,name,id'
 const total=Number((await env.DB.prepare(`${catalog} SELECT count(*) n FROM grouped WHERE ${where}`).bind(...values).first<{n:number}>())!.n)
 const rows=await env.DB.prepare(`${catalog} SELECT * FROM grouped WHERE ${where} ORDER BY ${order} LIMIT ? OFFSET ?`).bind(...values,limit,ids?0:(page-1)*limit).all()
 const products=rows.results.map(row=>{const {title_key,category_key,slug_key,supplier_name,supplier_cost_minor,supplier_cost,supplier_product_id,...product}=row as Record<string,unknown>;void title_key;void category_key;void slug_key;void supplier_name;void supplier_cost_minor;void supplier_cost;void supplier_product_id;return {...product,features:JSON.parse(String(row.features??'[]')),supplier_image_urls:JSON.parse(String(row.supplier_image_urls??'[]'))}})
 return json({records:products,products,total,pages:Math.max(1,Math.ceil(total/limit))})
}
