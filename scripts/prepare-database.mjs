// Generate a reviewable manual bootstrap; NEVER connect to or execute against a database.
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const names = [
  '202610090001_catalog.sql', '202610100001_private_catalog.sql',
  '202610100002_customer_panels.sql', '202610100003_profiles_reviews.sql',
  '202610100004_api_integrations.sql', '202610110001_live_marketplace.sql',
]
const sections = []
const relations = []
for (const name of names) {
  const source = (await readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')).replace(/^(?:--[^\n]*\n|\s)*/, '')
  if (!/^begin;\s/i.test(source) || !/commit;\s*$/i.test(source) || (source.match(/^begin;|^commit;/gmi) ?? []).length !== 2) throw new Error(`Unexpected transaction structure: ${name}`)
  relations.push(...[...source.matchAll(/create (?:table|view) (public\.[a-z_]+)/g)].map(match => match[1]))
  sections.push(`-- SOURCE: ${name}\n${source.replace(/^begin;\s*/i, '').replace(/commit;\s*$/i, '')}`)
}
const guard = relations.map(name => `'${name}'`).join(',\n    ')
const sql = `-- GENERATED from retained migrations. REVIEW before manual execution in Supabase SQL Editor.
-- EMPTY LOGSPOLL SCHEMA ONLY. Existing/partially migrated installations must be reconciled separately.
-- One transaction prevents the original public catalog permissions being committed before private RLS.
-- No drop/truncate of tables or customer records. Does not assign admin accounts or import products.
begin;
set local lock_timeout = '5s';
do $guard$
declare object_name text;
begin
  foreach object_name in array array[
    ${guard}
  ] loop
    if to_regclass(object_name) is not null then
      raise exception 'STOP: existing application object %. Inspect migration history; do not replay bootstrap.', object_name;
    end if;
  end loop;
end;
$guard$;
${sections.join('\n')}
notify pgrst, 'reload schema';
commit;
`
const output = new URL('../supabase/manual/bootstrap_empty_project.sql', import.meta.url)
await writeFile(output, sql)
console.log(`Prepared ${fileURLToPath(output)}. NOT executed. Run diagnose.sql first; operator review required.`)
