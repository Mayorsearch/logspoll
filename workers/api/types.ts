// Minimal structural D1 types; no new runtime dependency.
export interface Statement {
  bind(...values: (string | number | null | undefined)[]): Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean; meta?: { changes?: number; last_row_id?: number } }>
  run(): Promise<unknown>
}
export interface Database {
  prepare(sql: string): Statement
  batch(statements: Statement[]): Promise<unknown[]>
  exec(query: string): Promise<unknown>
}
export interface ApiEnv {
  ENVIRONMENT: 'staging' | 'production' | 'locked'
  PRODUCTION_CUTOVER_ENABLED?: string
  DB?: Database
  AUTH_ENABLED?: string
  APP_ORIGIN?: string
  AUTH_ORIGIN?: string
  AUTH_SECRET?: string
  RESEND_API_KEY?: string
  HSTORA_WEBHOOK_SECRET?: string
  BACHS_API_KEY?: string
  BACHS_WEBHOOK_SECRET?: string
  BACHS_SANDBOX_ENABLED?: string
  BACHS_LIVE_CHECKOUT_ENABLED?: string
  BACHS_LIVE_VERIFIED?: string
  BACHS_FULFILLMENT_VERIFIED?: string
  SUPPLIER_ENCRYPTION_KEY?: string
  AUTOMATION_ENABLED?: string
  AUTO_FULFILLMENT_ENABLED?: string
  CATALOG_SYNC_ENABLED?: string
  CATALOG_RESUME_AT?: string
  WALLET_LIVE_FUNDING_ENABLED?: string
}
export interface Execution { waitUntil(promise: Promise<unknown>): void }
