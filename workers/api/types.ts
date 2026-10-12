// Minimal structural D1 types; no new runtime dependency.
export interface Statement {
  bind(...values: (string | number | null)[]): Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>
  run(): Promise<unknown>
}
export interface Database { prepare(sql: string): Statement }
export interface ApiEnv {
  ENVIRONMENT: 'staging' | 'locked'
  DB?: Database
  STAGING_SUPABASE_URL?: string
  STAGING_SUPABASE_PUBLISHABLE_KEY?: string
  LEGACY_SUPABASE_ORIGIN?: string
}
