// OFFLINE ONLY. Uses synthetic records in an in-memory PostgreSQL runtime.
// Supply LOGSPOLL_PGLITE_MODULE pointing to an independently installed PGlite.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const { PGlite } = await import(process.env.LOGSPOLL_PGLITE_MODULE || '@electric-sql/pglite')
const sql = async name => readFile(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), 'utf8')
const connection = '11111111-1111-4111-8111-111111111111'
const categoryId = '22222222-2222-4222-8222-222222222222'
const productId = '33333333-3333-4333-8333-333333333333'
const adminId = '44444444-4444-4444-8444-444444444444'
const cats = [{ id: '1', slug: 'licensed-utilities', name: 'Licensed utilities' }]
const product = id => ({ id, category_id: '1', name: 'Licensed utility', description: 'Verified supplier description for resale.', cost_minor: 2005, currency: 'NGN', stock: 4, authorization_ref: `license-evidence-${id}` })

for (const pricing of ['before', 'after', 'absent']) {
 const db = new PGlite()
 const scalar = async (statement, params = []) => Object.values((await db.query(statement, params)).rows[0])[0]
 const run = (statement, params = []) => db.query(statement, params)
 await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
  create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth to authenticated,service_role;`)
 for (const migration of ['202610090001_catalog','202610100001_private_catalog','202610110002_configurable_suppliers','202610110003_youngpg_reviewed_approvals']) await db.exec(await sql(migration))
 await run(`insert into public.categories(id,slug,name,short_name) values($1,'licensed-utilities','Licensed utilities','Utilities')`, [categoryId])
 await run(`insert into public.supplier_connections(id,provider,name,base_url,enabled,encrypted_key,key_nonce,authorized_products,last_sync_at,last_sync_revision)
  values($1,'youngpg','Synthetic supplier','https://youngpgmedia.com.ng',true,'synthetic','synthetic',$2,now(),1)`, [connection, { '1': 'license-evidence-1', '2': 'license-evidence-2' }])
 await run(`insert into public.products(id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type)
  values($1,$2,'licensed-utility','Licensed utility','Admin verified public description.',7777,'Synthetic supplier',true,'active','Manual fulfillment')`, [productId, categoryId])
 await run(`insert into public.inventory(product_id,available_quantity) values($1,5)`, [productId])
 await run(`insert into public.supplier_feed_categories(connection_id,external_id,name) values($1,'1','Licensed utilities')`, [connection])
 await run(`insert into public.supplier_feed_items(connection_id,external_id,external_category_id,name,description,supplier_cost_minor,currency,stock_quantity,authorization_ref,approval,product_id)
  values($1,'1','1','Licensed utility','Verified supplier description for resale.',2005,'NGN',5,'license-evidence-1','approved',$2)`, [connection, productId])
 const baseline = await scalar(`select jsonb_build_array(price_minor,description,status,(select available_quantity from public.inventory where product_id=$1)) from public.products where id=$1`, [productId])
 if (pricing === 'before') await db.exec(await sql('202610120001_catalog_refresh_pricing'))
 await db.exec(await sql('202610120002_resumable_supplier_sync'))
 if (pricing === 'after') await db.exec(await sql('202610120001_catalog_refresh_pricing'))
 assert.deepEqual(await scalar(`select jsonb_build_array(price_minor,description,status,(select available_quantity from public.inventory where product_id=$1)) from public.products where id=$1`, [productId]), baseline)
 for (const table of ['supplier_catalog_jobs','supplier_catalog_rows']) {
  assert.equal(await scalar(`select has_table_privilege('authenticated',$1,'select')`, [table]), false)
  assert.equal(await scalar(`select relrowsecurity from pg_class where oid=$1::regclass`, [table]), true)
 }
 for (const fn of ['claim_supplier_sync_batch(uuid,uuid)','commit_supplier_sync_batch(uuid,uuid,uuid,jsonb)','finish_supplier_connection(uuid,uuid,jsonb,text)']) {
  assert.equal(await scalar(`select has_function_privilege('authenticated',$1,'execute')`, [fn]), false)
  assert.equal(await scalar(`select has_function_privilege('service_role',$1,'execute')`, [fn]), true)
 }
 await run(`insert into auth.users(id) values($1)`, [adminId])
 await run(`insert into public.user_roles(user_id,role) values($1,'admin')`, [adminId])
 await run(`select set_config('request.jwt.claim.sub',$1,false)`, [adminId])
 await run(`update public.products set price_minor=8888,description='Admin edited description must survive every sync.' where id=$1`, [productId])
 await run(`select set_config('request.jwt.claim.sub','',false)`)
 const claim = expected => scalar(`select public.claim_supplier_sync_batch($1,$2)`, [connection, expected ?? null])
 const commit = (job, batch) => scalar(`select public.commit_supplier_sync_batch($1,$2,$3,$4)`, [connection, job.token, job.job_id, batch])
 const cooldown = () => run(`update public.supplier_connections set next_attempt_at=null where id=$1`, [connection])
 let job = await claim()
 assert.equal(job.phase, 'categories')
 assert.equal(await claim(), null, 'Concurrent claim must be rejected')
 const originalToken = job.token
 await run(`update public.supplier_connections set lease_until=now()-interval '1 second' where id=$1`, [connection])
 await assert.rejects(commit(job, { phase: 'categories', categories: cats }), /lease expired/)
 // Expired owner can clean up; no newer owner can be affected.
 assert.equal(await scalar(`select public.finish_supplier_connection($1,$2,null,'Synthetic interrupted batch')`, [connection, originalToken]), 0)
 await cooldown()
 job = await claim(job.job_id)
 assert.notEqual(job.token, originalToken)
 await assert.rejects(scalar(`select public.finish_supplier_connection($1,$2,null,'Obsolete worker')`, [connection, originalToken]), /lease expired/)
 assert.equal(await scalar(`select lease_token::text from public.supplier_connections where id=$1`, [connection]), job.token)
 await commit(job, { phase: 'categories', categories: cats })
 await cooldown(); job = await claim(job.job_id)
 assert.equal(job.phase, 'listings'); assert.equal(job.page, 1)
 const page1 = { phase: 'listings', page: 1, last_page: 2, total: 3, categories: cats, rows: [{ id: '1', product: product('1') }, { id: '99', product: null }] }
 await commit(job, page1)
 await assert.rejects(commit(job, page1), /lease expired/, 'A replay cannot advance a committed checkpoint')
 await cooldown(); job = await claim(job.job_id)
 assert.equal(job.page, 2, 'Interrupted client resumes next page, never restarts page one')
 await assert.rejects(commit(job, { ...page1, page: 2, rows: [{ id: '1', product: product('1') }] }), /duplicate key/)
 assert.equal(await scalar(`select count(*)::integer from public.supplier_catalog_rows`), 2, 'Duplicate page transaction rolls back')
 await assert.rejects(commit(job, { ...page1, page: 2, last_page: 3, rows: [] }), /pagination changed/)
 await assert.rejects(commit(job, { phase: 'finalize' }), /phase mismatch/)
 const second = { ...product('2'), slug: 'licensed-two' }
 await commit(job, { ...page1, page: 2, rows: [{ id: '2', product: second }] })
 assert.equal(await scalar(`select count(*)::integer from public.supplier_feed_items`), 1, 'Partial pages never enter public feed')
 assert.equal(await scalar(`select available_quantity from public.inventory where product_id=$1`, [productId]), 0)
 await cooldown(); job = await claim(job.job_id)
 assert.equal(job.phase, 'details'); assert.equal(job.detail.id, '2')
 await commit(job, { phase: 'details', skip_network: true })
 await cooldown(); job = await claim(job.job_id)
 assert.equal(job.phase, 'finalize')
 // A real table constraint failure must roll back the entire final publication.
 await run(`update public.supplier_catalog_rows set product=jsonb_set(product,'{currency}','"USD"') where external_id='2'`)
 await assert.rejects(commit(job, { phase: 'finalize' }), /check constraint/)
 assert.equal(await scalar(`select count(*)::integer from public.supplier_feed_items`), 1)
 assert.equal(await scalar(`select phase from public.supplier_catalog_jobs`), 'finalize')
 await run(`update public.supplier_catalog_rows set product=jsonb_set(product,'{currency}','"NGN"') where external_id='2'`)
 const receipt = await commit(job, { phase: 'finalize' })
 assert.equal(receipt.done, true); assert.equal(receipt.imported, 2); assert.equal(receipt.detail_enrichment_skipped, 1)
 assert.equal((await claim(job.job_id)).done, true, 'Lost final response returns the completed receipt idempotently')
 assert.equal(await scalar(`select count(*)::integer from public.products`), 1, 'Pending rows are never auto-published')
 assert.equal(await scalar(`select approval from public.supplier_feed_items where external_id='1'`), 'approved')
 assert.equal(await scalar(`select approval from public.supplier_feed_items where external_id='2'`), 'pending')
 assert.equal(Number(await scalar(`select price_minor from public.products where id=$1`, [productId])), 8888)
 assert.equal(await scalar(`select description from public.products where id=$1`, [productId]), 'Admin edited description must survive every sync.')
 // Approval remains explicit. Pricing wrapper defaults NEW approvals to auto.
 await run(`select set_config('request.jwt.claim.sub',$1,false)`, [adminId])
 const secondId = await scalar(`select public.approve_supplier_feed_item($1,'2',$2,$3,'Manual fulfillment','Administrator reviewed licensed utility description.')`, [connection, categoryId, pricing === 'absent' ? 2005 : null])
 assert.equal(Number(await scalar(`select price_minor from public.products where id=$1`, [secondId])), 2005)
 await run(`select set_config('request.jwt.claim.sub','',false)`)
 async function refreshCost(cost) {
  await cooldown(); let next = await claim()
  await commit(next, { phase: 'categories', categories: cats })
  await cooldown(); next = await claim(next.job_id)
  await commit(next, { phase: 'listings', page: 1, last_page: 1, total: 2, categories: cats, rows: [{ id: '1', product: product('1') }, { id: '2', product: { ...product('2'), cost_minor: cost } }] })
  await cooldown(); next = await claim(next.job_id)
  await commit(next, { phase: 'details' })
  await cooldown(); next = await claim(next.job_id)
  await commit(next, { phase: 'finalize' })
 }
 await refreshCost(3505)
 assert.equal(Number(await scalar(`select price_minor from public.products where id=$1`, [secondId])), pricing === 'absent' ? 2005 : 3505)
 await run(`select set_config('request.jwt.claim.sub',$1,false)`, [adminId])
 await run(`update public.products set price_minor=9999 where id=$1`, [secondId])
 await run(`select set_config('request.jwt.claim.sub','',false)`)
 await refreshCost(4505)
 assert.equal(Number(await scalar(`select price_minor from public.products where id=$1`, [secondId])), 9999, 'Admin override survives later supplier-cost changes')
 assert.equal(Number(await scalar(`select price_minor from public.products where id=$1`, [productId])), 8888)
 // Authorized, approved, fresh inventory is visible to a real database customer role.
 await db.exec(`set role authenticated`)
 assert.equal(Number(await scalar(`select available_quantity from public.storefront_products where id=$1`, [productId])), 4)
 await db.exec(`reset role`)
 await run(`update public.supplier_connections set last_sync_at=now()-interval '2 hours' where id=$1`, [connection])
 await db.exec(`set role authenticated`)
 assert.equal(Number(await scalar(`select available_quantity from public.storefront_products where id=$1`, [productId])), 0, 'Stale supplier stock is never offered to customers')
 await db.exec(`reset role`)
 // Changed configuration or an over-age job cannot publish old checkpoints.
 await cooldown(); let stale = await claim()
 await commit(stale, { phase: 'categories', categories: cats })
 await cooldown(); stale = await claim(stale.job_id)
 await run(`update public.supplier_connections set revision=revision+1 where id=$1`, [connection])
 await assert.rejects(commit(stale, page1), /checkpoint changed/)
 await scalar(`select public.finish_supplier_connection($1,$2,null,'Synthetic revision change')`, [connection, stale.token])
 await cooldown(); let replacement = await claim()
 assert.notEqual(replacement.job_id, stale.job_id)
 await run(`update public.supplier_connections set lease_until=now()-interval '1 second' where id=$1`, [connection])
 const reclaimed = await claim(replacement.job_id)
 assert.notEqual(reclaimed.token, replacement.token)
 await assert.rejects(commit(replacement, { phase: 'categories', categories: cats }), /lease expired/)
 await run(`update public.supplier_catalog_jobs set started_at=now()-interval '16 minutes'`)
 await run(`update public.supplier_connections set lease_until=now()-interval '1 second' where id=$1`, [connection])
 replacement = await claim(reclaimed.job_id)
 assert.notEqual(replacement.job_id, reclaimed.job_id)
 assert.equal(await scalar(`select count(*)::integer from public.supplier_feed_items`), 2)
 console.log(`PASS: PostgreSQL migration, resume/replay, expired-token cleanup, atomic rollback, pricing/descriptions, approvals and customer RLS (pricing ${pricing})`)
 await db.close()
}
