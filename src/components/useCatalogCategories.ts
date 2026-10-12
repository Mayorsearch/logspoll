import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthProvider'
import { supabase } from '../lib/supabase'
import { mergeCatalogCategories } from '../lib/category-navigation'
import type { CatalogCategory } from '../lib/category-navigation'

export function useCatalogCategories() {
  const { session } = useAuth()
  const [result, setResult] = useState<{ owner: string; records: CatalogCategory[]; error: string }>()
  const owner = session?.user.id
  useEffect(() => {
    if (!owner || !supabase) return
    let active = true
    void supabase.from('storefront_categories').select('slug,name,description,product_count').order('sort_order').then(({ data, error }) => {
      if (active) setResult({ owner, records: error ? [] : data ?? [], error: error ? 'Live category counts could not be loaded. Please refresh or contact support.' : '' })
    })
    return () => { active = false }
  }, [owner])
  const current = owner && result?.owner === owner ? result : undefined
  return { categories: mergeCatalogCategories(current?.records ?? []), categoryError: current?.error ?? '' }
}
