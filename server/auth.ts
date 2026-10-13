import { adminActor } from '../workers/api/admin.ts'
import type { ApiEnv } from '../workers/api/types.ts'
export { HttpError,json } from '../workers/api/http.ts'
export interface Env extends ApiEnv { SUPPLIER_SCHEMA_VERIFIED?:string;SUPPLIER_API_URL?:string;SUPPLIER_API_KEY?:string;SUPPLIER_AUTHORIZED_PRODUCTS?:string;SUPPLIER_SYNC_ENABLED?:string;SCHEDULER_SHARED_SECRET?:string;CATALOG_SYNC_ENABLED?:string }
export const requireAdmin=adminActor
