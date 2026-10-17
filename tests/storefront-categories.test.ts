import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {storefrontCategories,categoryCase} from '../workers/api/storefront-categories.ts'
import type {ApiEnv,Database} from '../workers/api/types.ts'
function setup(){const sqlite=new DatabaseSync(':memory:');sqlite.exec("CREATE TABLE categories(id TEXT,name TEXT,slug TEXT); CREATE TABLE products(id TEXT,category_id TEXT,slug TEXT,name TEXT,brand TEXT DEFAULT '',description TEXT DEFAULT '',price_minor INTEGER DEFAULT 120000,currency TEXT DEFAULT 'NGN',delivery_type TEXT DEFAULT 'Manual fulfillment',image_path TEXT,term TEXT,features TEXT DEFAULT '[]',supplier_image_urls TEXT DEFAULT '[]',featured INTEGER DEFAULT 0,available_quantity INTEGER DEFAULT 2,published INTEGER DEFAULT 1,server_number INTEGER DEFAULT 2,supplier_name TEXT DEFAULT 'YoungPG Media'); CREATE VIEW storefront_products AS SELECT * FROM products WHERE published=1;");sqlite.exec("INSERT INTO categories VALUES('social','Social Media Services','social-media-services'),('gmail','Gmail','gmail'),('fb','Country Facebook','country-facebook')");const db={prepare(sql:string){let values:unknown[]=[];const statement={bind(...input:unknown[]){values=input;return statement},async all(){return {results:sqlite.prepare(sql).all(...values as never[]),success:true}},async first(){return sqlite.prepare(sql).get(...values as never[])??null}};return statement}} as Database;return {sqlite,env:{DB:db} as ApiEnv}}
test('SQL groups supplier aliases and keeps unrelated Google services outside Gmail',()=>{const db=new DatabaseSync(':memory:');const classify=(title:string,category='',slug='')=>db.prepare(`WITH normalized AS (SELECT ? title_key,? category_key,? slug_key) SELECT ${categoryCase} category FROM normalized`).get(' '+title.toLowerCase().replace(/[-_/().,:]/g,' ')+' ',' '+category.toLowerCase().replace(/[-_/().,:]/g,' ')+' ',' '+slug.toLowerCase().replace(/[-_/().,:]/g,' ')+' ')!.category;for(const [title,category,expected] of [['🇺🇸Facebook🇺🇸 profile','Social','facebook'],['GoogleDrive storage with Gmail','Google',null],['Country Facebook account','Facebook Accounts','facebook'],['Facebook profile with Gmail','Social','facebook'],['Instagram verified','Social','instagram'],['2006-2026-X-10 real followers','Social','twitter'],['Generic profile','X','twitter'],['Tik Tok profile','Social','tiktok'],['HMA VPN subscription','Tools','vpn'],['Astrill subscription','Tools','vpn'],['Gmail inbox','Emails','gmail'],['Generic inbox','Gmail','gmail'],['Google Workspace account','Google',null],['Google Drive 5TB with Gmail','Google',null],['Gemini PRO','Gmail',null],['Generic Google account','Google',null]] as const)assert.equal(classify(title,category),expected,title);assert.equal(classify('Generic profile','Country Facebook'),'facebook');assert.equal(classify('Generic profile','Other','facebook-accounts'),'facebook')})
test('counts and filters read only published products, preserve prices, and paginate',async()=>{const {sqlite,env}=setup();for(let n=0;n<26;n++)sqlite.prepare('INSERT INTO products(id,category_id,slug,name,available_quantity) VALUES(?,?,?,?,?)').run(`50000000-0000-4000-8000-${String(n).padStart(12,'0')}`,'fb','fb-'+n,'Country Facebook '+n,n===0?0:2);sqlite.exec("INSERT INTO products(id,category_id,slug,name,published) VALUES('private','social','private','Gmail private',0);INSERT INTO products(id,category_id,slug,name) VALUES('google','social','workspace','Google Workspace account')");const before=sqlite.prepare('SELECT total_changes() n').get()!.n;const invoke=async(path:string)=>(await storefrontCategories(new Request('https://logspoll.com'+path),env))!;const response=await invoke('/api/storefront/categories');const body=await response.json() as {records:{slug:string;product_count:number;in_stock_count:number}[]};assert.equal(body.records.length,6);assert.equal(body.records.find(c=>c.slug==='facebook')!.product_count,26);assert.equal(body.records.find(c=>c.slug==='facebook')!.in_stock_count,25);assert.equal(body.records.find(c=>c.slug==='gmail')!.product_count,0);for(const [page,count] of [[1,20],[2,6]]){const r=await (await invoke('/api/products?main_category=facebook&page='+page)).json() as {total:number;products:{name:string;price_minor:number}[]};assert.equal(r.total,26);assert.equal(r.products.length,count);assert(r.products.every(p=>p.name.includes('Facebook')&&p.price_minor===120000))}const stock=await(await invoke('/api/products?main_category=facebook&availability=in-stock')).json() as {total:number};assert.equal(stock.total,25);assert.equal(await storefrontCategories(new Request('https://logspoll.com/api/products'),env),null);assert.equal(sqlite.prepare('SELECT total_changes() n').get()!.n,before);assert.equal(sqlite.prepare('SELECT count(*) n FROM products').get()!.n,28)})

test('filters by server_number accurately across suppliers', async () => {
  const {sqlite, env} = setup();
  sqlite.prepare('INSERT INTO products(id,category_id,slug,name,available_quantity,server_number) VALUES(?,?,?,?,?,?)').run('s1-1','fb','fb-s1','HStora Facebook 1',5,1);
  sqlite.prepare('INSERT INTO products(id,category_id,slug,name,available_quantity,server_number) VALUES(?,?,?,?,?,?)').run('s2-1','fb','fb-s2','YoungPG Facebook 1',5,2);
  sqlite.prepare('INSERT INTO products(id,category_id,slug,name,available_quantity,server_number) VALUES(?,?,?,?,?,?)').run('s3-1','fb','fb-s3','Shopvia Facebook 1',5,3);
  const invoke = async (path: string) => (await storefrontCategories(new Request('https://logspoll.com' + path), env))!;
  const s1 = await (await invoke('/api/products?main_category=facebook&server=1')).json() as {total:number;products:{name:string;server_number:number}[]};
  assert.equal(s1.total, 1);
  assert.equal(s1.products[0].server_number, 1);
  const s2 = await (await invoke('/api/products?main_category=facebook&server=2')).json() as {total:number;products:{name:string;server_number:number}[]};
  assert.equal(s2.total, 1);
  assert.equal(s2.products[0].server_number, 2);
  const all = await (await invoke('/api/products?main_category=facebook')).json() as {total:number;products:Record<string,unknown>[]};
  assert.equal(all.total, 3);
  for (const p of all.products) {
    assert.equal(p.supplier_name, undefined);
    assert.equal(p.supplier_cost, undefined);
    assert.equal(p.supplier_product_id, undefined);
  }
  const v1Resp = await invoke('/api/v1/products?main_category=facebook&server=2');
  const v1Data = await v1Resp.json() as {total:number;products:{name:string;server_number:number}[]};
  assert.equal(v1Data.total, 1);
  assert.equal(v1Data.products[0].server_number, 2);
  const v1Cat = await (await invoke('/api/v1/storefront/categories')).json() as {records:{slug:string}[]};
  assert.equal(v1Cat.records.length, 6);
});

