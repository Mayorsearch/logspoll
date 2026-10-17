// Operator-only real integration check. Never imported by the application.
// Reads legacy configuration; writes ONLY the explicitly named staging D1.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { syncCatalogBatch } from '../workers/api/catalog-sync.ts'
import type { Database,Statement,ApiEnv } from '../workers/api/types.ts'

if (!process.argv.includes('--staging-write-test')) throw new Error('Explicit --staging-write-test required.')
const account='5e8a9eaedf9f8e42d2eaa4aea44bd3da'
const database='d337160c-36e3-4a1d-9908-76a6873b4188'
const credentials=readFileSync(homedir()+'/Library/Preferences/.wrangler/config/default.toml','utf8')
const token=credentials.match(/^oauth_token\s*=\s*"([^"\n]+)"/m)?.[1]
if (!token) throw new Error('Wrangler authentication required.')
const base=`https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${database}`
const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'}
type Result={results:Record<string,unknown>[];success:boolean}
let lastApiCall=0
async function api(path:string,body?:unknown) {
  // The operator REST test has management-API limits; deployed Workers use native D1.
  let response:Response|undefined
  for(let attempt=0;attempt<3;attempt++) {
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,lastApiCall+1000-Date.now())))
    lastApiCall=Date.now()
    response=await fetch(base+path,{headers,signal:AbortSignal.timeout(30000),...(body?{method:'POST',body:JSON.stringify(body)}:{})})
    if(response.status!==429||attempt===2)break
    const retry=Number(response.headers.get('Retry-After')??60)
    await response.body?.cancel()
    console.error('Cloudflare REST rate limit; waiting before safe HTTP 429 retry.')
    await new Promise(resolve=>setTimeout(resolve,Math.min(60000,Math.max(1000,Number.isFinite(retry)?retry*1000:60000))))
  }
  if(!response)throw new Error('Staging API unavailable')
  const data=await response.json().catch(()=>({success:false,result:null})) as {success:boolean;result:unknown;errors?:{code?:number;message?:string}[]}
  if (!response.ok||!data.success) {
    const text=(data.errors??[]).map(e=>e.message??'').join(' ')
    const category=/CHECK constraint/i.test(text)?'check_constraint':/UNIQUE constraint/i.test(text)?'duplicate':/FOREIGN KEY/i.test(text)?'foreign_key':/syntax/i.test(text)?'syntax':/no such table|no such column/i.test(text)?'schema':/too (?:many|large)|SQLITE_TOOBIG/i.test(text)?'size_limit':'request_rejected'
    console.error('D1_DIAGNOSTIC',JSON.stringify({status:response.status,codes:(data.errors??[]).map(e=>e.code),category}))
    throw new Error('Staging D1 request rejected; inspect private Cloudflare diagnostics.')
  }
  return data.result
}
// REST batch SQL has no per-statement binding arrays. Encode only typed values;
// do not accept user-provided SQL. Production uses native D1 prepared statements.
function literal(value:string|number|null) {
  if(value===null)return 'NULL'
  if(typeof value==='number'){if(!Number.isSafeInteger(value))throw new Error('Unsafe SQL number');return String(value)}
  if(value.includes('\0'))throw new Error('NUL in SQL value')
  return "'"+value.replaceAll("'","''")+"'"
}
function encode(sql:string,params:(string|number|null)[]) {
  let index=0;let quote='';let result=''
  for(let i=0;i<sql.length;i++) {
    const char=sql[i]
    if(quote){result+=char;if(char===quote){if(sql[i+1]===quote){result+=sql[++i]}else quote=''};continue}
    if(char==="'"||char==='"'){quote=char;result+=char}
    else if(char==='?'){if(index>=params.length)throw new Error('Missing SQL binding');result+=literal(params[index++])}
    else result+=char
  }
  if(index!==params.length)throw new Error('Unused SQL binding')
  return result
}
type Remote=Statement&{sql:string;params:(string|number|null)[]}
const db:Database={
  prepare(sql:string){
    const statement={sql,params:[] as (string|number|null)[],bind(...params:(string|number|null)[]){statement.params=params;return statement},
      async all(){return(await api('/query',{sql,params:statement.params}) as Result[])[0]},
      async first(){return(await statement.all()).results[0]??null},async run(){return statement.all()}}
    return statement as Remote
  },
  async batch(statements:Statement[]){return api('/query',{sql:statements.map(s=>{const q=s as Remote;return encode(q.sql,q.params)}).join(';\n')}) as Promise<Result[]>},
  async exec(sql:string){return api('/query',{sql})},
}
const envFile=Object.fromEntries(readFileSync('.dev.vars','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return[l.slice(0,i),l.slice(i+1).replace(/^['"]|['"]$/g,'')]}))
const legacyHeaders={apikey:envFile.SUPABASE_SERVICE_ROLE_KEY,Authorization:`Bearer ${envFile.SUPABASE_SERVICE_ROLE_KEY}`}
async function legacy(path:string) {
  if(!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(envFile.SUPABASE_URL))throw new Error('Invalid legacy database origin')
  const response=await fetch(envFile.SUPABASE_URL+'/rest/v1/'+path,{headers:legacyHeaders,signal:AbortSignal.timeout(15000)})
  if(!response.ok)throw new Error('Legacy read-only export unavailable')
  return response.json()
}
let stage='target verification'
try {
  const info=await api('') as {name:string}
  if(info.name!=='logspoll-d1-staging-20261012')throw new Error('Unexpected D1 target')
  stage='atomic rollback verification'
  // Prove this REST adapter rolls back an entire failed batch before real ingestion.
  const probe=crypto.randomUUID()
  try{await db.batch([db.prepare('INSERT INTO supplier_sync_fences(owner,valid) VALUES(?,1)').bind(probe),db.prepare('INSERT INTO supplier_sync_fences(owner,valid) VALUES(?,0)').bind(probe+'-invalid')])}catch{/* Expected CHECK failure. */}
  const partial=await db.prepare('SELECT owner FROM supplier_sync_fences WHERE owner=?').bind(probe).first()
  if(partial){await db.prepare('DELETE FROM supplier_sync_fences WHERE owner=?').bind(probe).run();throw new Error('REST adapter is not atomic; integration stopped safely')}
  stage='preservation baseline'
  const baseline=JSON.stringify(await api('/query',{sql:'SELECT * FROM products ORDER BY id;SELECT * FROM inventory ORDER BY product_id;SELECT * FROM orders ORDER BY id'}))
  // Compare rows only; API timings change between requests.
  const before=(JSON.parse(baseline) as Result[]).map(x=>x.results)
  stage='legacy read-only configuration'
  const original=await legacy('supplier_feed_items?select=connection_id,external_id,approval,product_id,supplier_cost_minor,description&order=connection_id,external_id')
  const [config]=await legacy('supplier_connections?select=id,name,encrypted_key,key_nonce,authorized_products&provider=eq.youngpg&enabled=eq.true&limit=1') as {id:string;name:string;encrypted_key:string;key_nonce:string;authorized_products:object}[]
  if(!config)throw new Error('Enabled YoungPG configuration required')
  stage='staging configuration preservation'
  const existing=await db.prepare('SELECT encrypted_key,key_nonce,authorized_products FROM staging_supplier_connections WHERE id=?').bind(config.id).first()
  if(existing&&(existing.encrypted_key!==config.encrypted_key||existing.key_nonce!==config.key_nonce||existing.authorized_products!==JSON.stringify(config.authorized_products)))throw new Error('Existing staging supplier differs; no overwrite permitted')
  if(!existing)await db.prepare(`INSERT INTO staging_supplier_connections(id,provider,name,enabled,encrypted_key,key_nonce,authorized_products) VALUES(?,'youngpg',?,1,?,?,?)`)
    .bind(config.id,config.name,config.encrypted_key,config.key_nonce,JSON.stringify(config.authorized_products)).run()
  const env:ApiEnv={ENVIRONMENT:'staging',DB:db,CATALOG_SYNC_ENABLED:'true',SUPPLIER_ENCRYPTION_KEY:envFile.SUPPLIER_ENCRYPTION_KEY}
  stage='YoungPG ingestion'
  let done=false
  const deadline=Date.now()+30*60000
  for(let batch=0;batch<2000;batch++) {
    if(Date.now()>deadline)throw new Error('Operator test deadline reached; rerun to resume')
    const result=await syncCatalogBatch(env,config.id)
    if(batch%5===0||result.done)console.log(JSON.stringify({phase:result.phase,scanned:result.scanned,done:result.done}))
    if(result.done){done=true;break}
    if(result.skipped){await new Promise(resolve=>setTimeout(resolve,30000));continue}
    await new Promise(resolve=>setTimeout(resolve,1600))
  }
  if(!done)throw new Error('Integration stopped at batch bound; rerun to resume')
  stage='record preservation verification'
  const after=(await api('/query',{sql:'SELECT * FROM products ORDER BY id;SELECT * FROM inventory ORDER BY product_id;SELECT * FROM orders ORDER BY id'}) as Result[]).map(x=>x.results)
  if(JSON.stringify(before)!==JSON.stringify(after))throw new Error('Existing D1 business records changed unexpectedly')
  const retained=await legacy('supplier_feed_items?select=connection_id,external_id,approval,product_id,supplier_cost_minor,description&order=connection_id,external_id')
  if(JSON.stringify(original)!==JSON.stringify(retained))throw new Error('Legacy source changed; investigate before migration')
  console.log('REAL_STAGING_RESULT',JSON.stringify((await db.prepare(`SELECT count(*) eligible,sum(stock_quantity>0) in_stock,sum(approval='pending') pending,sum(json_array_length(supplier_image_urls)>0) with_images FROM staging_supplier_feed_items WHERE connection_id=?`).bind(config.id).all()).results))
  console.log('PRESERVATION_PASS: legacy reviews and existing D1 products/inventory/orders unchanged')
} catch {
  console.error(`Staging integration paused at ${stage}. No production write or deployment performed.`)
  process.exitCode=1
}
