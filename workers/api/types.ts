// Minimal structural D1 types; no new runtime dependency.
export interface Statement {
  bind(...values: (string | number | null)[]): Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; success: boolean }>
  run(): Promise<unknown>
}
export interface Database {
  prepare(sql: string): Statement
  batch(statements: Statement[]): Promise<unknown[]>
  exec(query: string): Promise<unknown>
}
export interface ApiEnv {
  ENVIRONMENT: 'staging' | 'locked'
  DB?: Database
  AUTH_ENABLED?: string
  AUTH_ORIGIN?: string
  AUTH_SECRET?: string
  RESEND_API_KEY?: string
}
export interface Execution { waitUntil(promise: Promise<unknown>): void }
