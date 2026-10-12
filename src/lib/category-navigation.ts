export interface CatalogCategory { slug: string; name: string; description?: string; product_count?: number; connected?: boolean }
// Navigation labels transcribed from the supplied screenshots; these are not inventory records.
const screenshotNames = ['Google', 'Snapchat', 'Twitter', 'Instagram', 'Facebook', 'Threads', 'Spotify', 'Mail.com', 'Telegram', 'Microsoft', 'GMX', 'Other AI Accounts', 'TikTok', 'Pinterest', 'Tools/AI Subscriptions', 'LinkedIn', 'Other Accounts', 'Reddit', 'Firstmail.ltd', 'Mega', 'Mail.tm', 'Apple TV Plus', 'Discord', 'Other Emails', 'YouTube', 'Haromail', 'Apple iTunes Gift Card', 'Twitch']
export const screenshotCategories: CatalogCategory[] = screenshotNames.map(name => ({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }))
export const homeCategories: CatalogCategory[] = [
  { slug: 'social-media-services', name: 'Social Media Tools', description: 'Analytics and management tools' },
  { slug: 'vpn-services', name: 'VPN Services', description: 'Secure browsing & privacy' },
  { slug: 'ai-productivity', name: 'AI Productivity', description: 'Writing and coding assistants' },
  { slug: 'marketing-seo', name: 'Marketing & SEO', description: 'Traffic and optimization' },
]
const legacyCategories: CatalogCategory[] = [{ slug: 'virtual-numbers', name: 'Virtual Numbers' }, { slug: 'us-emails', name: 'US Emails' }]
function key(value: string) { const normalized = value.toLowerCase().replace(/[^a-z0-9]/g, ''); return ({ socialmediatools: 'socialmediaservices', x: 'twitter' } as Record<string, string>)[normalized] ?? normalized }
export function mergeCatalogCategories(records: CatalogCategory[]) {
  const used = new Set<string>()
  const result = [...screenshotCategories, ...homeCategories, ...legacyCategories].map(reference => {
    const matches = records.filter(record => key(record.name) === key(reference.name) || key(record.slug) === key(reference.slug))
    if (matches.length !== 1 || used.has(matches[0].slug)) return reference
    const record = matches[0]; used.add(record.slug)
    return { ...reference, ...record, name: reference.name, connected: true }
  })
  return [...new Map([...result, ...records.filter(record => !used.has(record.slug)).map(record => ({ ...record, connected: true }))].map(category => [category.slug, category])).values()]
}
