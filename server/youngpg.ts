import { HttpError } from "./auth.ts";
import { productImages } from '../src/lib/product-images.ts';
export const YOUNGPG_ORIGIN = "https://youngpgmedia.com.ng";
export type Metadata = Record<string, unknown>;
export const record = (value: unknown): Metadata => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(502, "Supplier response structure is unsupported.");
  return value as Metadata;
};
export function supplierOrigin(value: unknown) {
  // Only the documented origin is permitted. No arbitrary host, port, path or redirect.
  // Additional providers require a separately reviewed adapter; credentials never select an adapter.
  if (value !== YOUNGPG_ORIGIN)
    throw new HttpError(
      400,
      "This adapter permits only https://youngpgmedia.com.ng. Other providers require a reviewed adapter.",
    );
  return YOUNGPG_ORIGIN;
}
export function minorPrice(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number")
    throw new HttpError(502, "Invalid supplier price_ngn.");
  const text = String(value);
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(text))
    throw new HttpError(502, "Invalid supplier price_ngn.");
  const [whole, fraction = ""] = text.split(".");
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(result) || result > 99999999900)
    throw new HttpError(502, "Supplier price exceeds the supported range.");
  return result;
}
export const identifier = (value: unknown) => {
  if (
    !["string", "number"].includes(typeof value) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/.test(String(value))
  )
    throw new HttpError(502, "Invalid supplier identifier.");
  return String(value);
};
// YoungPG emits public listing slugs longer than its short identifiers. Keep
// route-safe characters while allowing the provider's observed 120-char slug.
export const listingSlug = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,254}$/.test(value))
    throw new HttpError(502, 'Invalid supplier listing slug.');
  return value;
};
const label = (value: unknown, max: number, allowLines = false) => {
  const reason =
    typeof value !== "string"
      ? "not_a_string"
      : !value.trim()
        ? "empty_text"
        : value.length > max
          ? "too_long"
          : [...value].some(character => character.charCodeAt(0) < 32 && !(allowLines && [9, 10, 13].includes(character.charCodeAt(0))))
            ? "control_character"
            : /ypg_[a-fA-F0-9]{48}/.test(value)
              ? "credential_pattern"
              : null;

  if (reason) {
    throw new HttpError(
      502,
      "Invalid supplier metadata; credentials are not permitted in catalog fields.",
    );
  }

  return (value as string).trim();
};

export function resaleAllowlist(value: unknown): Record<string, string> {
  const entries = Object.entries(record(value));
  if (entries.length > 500)
    throw new HttpError(400, "At most 500 authorized products are supported.");
  return Object.fromEntries(
    entries
      .map(([key, evidence]) => [key === '*' ? '*' : identifier(key), label(evidence, 1000)])
      .map(([key, evidence]) => {
        if (evidence.length < 5)
          throw new HttpError(
            400,
            "Provide product-specific license/transfer evidence, not an unverified approval.",
          );
        return [key, evidence];
      }),
  );
}
export const youngpgRequestTimeout = (resource: string) => resource === 'listings' ? 20000 : resource.startsWith('listings/') ? 15000 : 10000;
export async function youngpgGet(
  base: string,
  key: string,
  resource: "categories" | "listings" | `categories/${string}/subcategories` | `listings/${string}`,
  page = 1,
) {
  supplierOrigin(base);
  if (!/^(categories|listings|categories\/[a-zA-Z0-9_-]{1,100}\/subcategories|listings\/[a-zA-Z0-9_-]{1,255})$/.test(resource))
    throw new HttpError(400, 'Only documented catalog read endpoints are permitted.');
  if (!/^ypg_[a-fA-F0-9]{48}$/.test(key))
    throw new HttpError(
      400,
      "YoungPG requires a ypg_ key followed by 48 hexadecimal characters.",
    );
  const url = new URL(`/api/v1/${resource}`, base);
  if (resource === "listings") {
    url.searchParams.set("per_page", "100");
    url.searchParams.set("page", String(page));
  }
  const context = resource === 'listings' ? `Listing page ${page}` : resource.startsWith('listings/') ? 'Product detail' : resource.endsWith('/subcategories') ? 'Subcategories' : 'Categories';
  const timeoutMs = youngpgRequestTimeout(resource);
  const signal = AbortSignal.timeout(timeoutMs);
  const networkFailure = (error: unknown) => {
    // Only fixed diagnostics are exposed: never upstream messages, URLs or causes.
    const name = error instanceof Error ? error.name : '';
    const cause = error instanceof Error ? error.cause as { code?: unknown } | undefined : undefined;
    const code = typeof cause?.code === 'string' ? cause.code : '';
    const timedOut = signal.aborted || ['TimeoutError', 'AbortError'].includes(name) || ['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(code);
    const reason = timedOut ? `request timed out (${timeoutMs / 1000}s limit)` : ['ENOTFOUND', 'EAI_AGAIN'].includes(code) ? 'DNS lookup failed' : code === 'ECONNRESET' ? 'connection reset' : code === 'ECONNREFUSED' ? 'connection refused' : 'network request failed';
    return new SupplierReadError(timedOut ? 504 : 502, `${context}: supplier ${reason}. Retry later.`, 2000, 'network');
  };
  let response: Response;
  try {
    response = await fetch(url, {
      redirect: "manual",
      signal,
      headers: { Accept: "application/json", "X-API-Key": key },
    });
  } catch (error) {
    throw networkFailure(error);
  }
  if (response.status === 429) {
    const delay = Number(response.headers.get('Retry-After') ?? 60);
    throw new SupplierReadError(429, `${context}: supplier rate limit reached; retry later.`, Number.isFinite(delay) && delay >= 0 ? Math.ceil(delay * 1000) : 60000);
  }
  if (response.status >= 500) throw new SupplierReadError(502, `${context}: supplier returned HTTP ${response.status}; temporarily unavailable.`, 2000);
  if ([401, 403].includes(response.status))
    throw new HttpError(
      502,
      `${context}: supplier rejected the key or listings:read scope. Replace or correct the key.`,
    );
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  )
    throw new HttpError(
      502,
      `${context}: supplier returned HTTP ${response.status} or an unsupported response.`,
    );
  const reader = response.body?.getReader();
  if (!reader) throw new HttpError(502, `${context}: supplier response is empty.`);
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.length;
      if (size > 2_000_000) {
        await reader.cancel().catch(() => {});
        throw new HttpError(502, `${context}: supplier response exceeded the safe size limit.`);
      }
      chunks.push(chunk.value);
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw networkFailure(error);
  } finally {
    reader.releaseLock();
  }
  try {
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const source = new TextDecoder().decode(bytes);
    const result = record(JSON.parse(source));
    if (JSON.stringify(result).includes(key)) throw new Error(); // Also catches escaped credential echoes.
    if (result.success !== true) throw new Error();
    return result;
  } catch {
    throw new HttpError(502, `${context}: supplier JSON response could not be validated.`);
  }
}
export function collection(payload: Metadata) {
  const nested = !Array.isArray(payload.data) ? record(payload.data) : null;
  const data = nested ? nested.data : payload.data;
  if (!Array.isArray(data) || data.length > 5000)
    throw new HttpError(
      502,
      "Supplier data must contain a supported collection.",
    );
  return { rows: data, meta: payload.meta ?? nested };
}
export function categoriesFrom(payload: Metadata) {
  const seen = new Set<string>();
  return collection(payload).rows.map((value) => {
    const item = record(value);
    const id = identifier(item.id);
    if (seen.has(id))
      throw new HttpError(502, "Duplicate supplier category IDs.");
    seen.add(id);
    return { id, slug: identifier(item.slug), name: label(item.title, 120) };
  });
}
export function subcategoriesFrom(payload: Metadata, parentId: string) {
  // Verified live response: data = { category: { id,slug,title }, subcategories: [...] }.
  const data = record(payload.data)
  if (identifier(record(data.category).id) !== parentId) throw new HttpError(502, 'Supplier subcategory parent mismatch.')
  return categoriesFrom({ data: data.subcategories }).map(sub => ({ ...sub, parent_id: parentId }))
}
export function pageIsComplete(
  payload: Metadata,
  page: number,
  rowCount: number,
) {
  if (!Number.isInteger(rowCount) || rowCount < 0 || rowCount > 100)
    throw new HttpError(502, "Supplier returned an invalid page size.");
  const raw = collection(payload).meta;
  const meta = raw && typeof raw === "object" ? record(raw) : {};
  if (meta.last_page !== undefined) {
    const last = Number(meta.last_page);
    if (
      !Number.isInteger(last) ||
      last < 1 ||
      last > 1000 ||
      Number(meta.current_page) !== page ||
      page > last
    )
      throw new HttpError(
        502,
        "Unsupported supplier pagination. No partial snapshot was imported.",
      );
    return page === last;
  }
  // Even a short page can be partial. Do not infer a complete inventory snapshot.
  throw new HttpError(
    502,
    "Validated current_page/last_page supplier pagination metadata is required.",
  );
}
// The listing endpoint embeds { category: {slug,title} } instead of category_id.
// A subset of these categories is absent from /categories; stage it separately for
// admin assignment rather than inventing a match in the customer's catalog.
export const DESCRIPTION_REQUIRED = 'Description not supplied by supplier; administrator review required.';
export const missingDescription = (value: unknown) => value == null || (typeof value === 'string' && !value.trim());
const normalized = (value: string) => value.normalize('NFKC').trim().toLowerCase();

export function listingsFrom(
  values: unknown[],
  categories: { id: string; slug: string; name: string }[],
  approved: Record<string, string>,
) {
  const seen = new Set<string>();
  const extra = new Map<string, { id: string; slug: string; name: string }>();
  const excluded =
    /\b(accounts?|logs?|cookies?|sessions?|passwords?|credentials?|compromised|stolen|hacked|facebook|instagram|twitter|tiktok|snapchat|inbox|tokens?|fake.bank.balance)\b/i;
  const products = [];
  for (const value of values) {
    const item = record(value);
    const id = identifier(item.id);
    if (seen.has(id)) throw new HttpError(502, 'Duplicate supplier listing IDs.');
    seen.add(id);
    const authorization = approved[id] ?? approved['*'];
    if (!authorization) continue;

    // Reject restricted inventory before validating display-field limits. Such
    // inventory must never block ingestion of independently eligible listings.
    if (typeof item.title === 'string' &&
        excluded.test(`${item.title} ${typeof item.description === 'string' ? item.description : ''}`)) continue;
    const name = label(item.title, 200);
    const description = missingDescription(item.description) ? DESCRIPTION_REQUIRED : label(item.description, 10000, true);
    // Never automatically stage credential or compromised-account inventory.
    if (excluded.test(`${name} ${description}`)) continue;

    const nestedCategory = record(item.category);
    const slug = identifier(nestedCategory.slug);
    const title = label(nestedCategory.title, 120);
    const slugMatches = categories.filter(c => normalized(c.slug) === normalized(slug));
    const titleMatches = categories.filter(c => normalized(c.name) === normalized(title));
    let categoryId: string;
    if (slugMatches.length === 1) categoryId = slugMatches[0].id;
    else if (titleMatches.length === 1) categoryId = titleMatches[0].id;
    else {
      // Supplier omitted or ambiguously listed the category. It remains staged
      // with its own source label, NOT linked to any public LOGSPOLL category.
      categoryId = `unmatched-${slug}`;
      const prior = extra.get(categoryId);
      if (prior && prior.name !== title) throw new HttpError(502, 'Conflicting supplier category metadata.');
      extra.set(categoryId, { id: categoryId, slug, name: title });
    }
    const stock = item.available_stock;
    if (
      !['number', 'string'].includes(typeof stock) ||
      !/^\d+$/.test(String(stock)) ||
      !Number.isSafeInteger(Number(stock)) ||
      Number(stock) > 1000000
    ) throw new HttpError(502, 'Invalid supplier available_stock.');
    products.push({
      id, category_id: categoryId, name, description,
      cost_minor: minorPrice(item.price_ngn), currency: 'NGN',
      stock: ['inactive', 'unavailable', 'discontinued', 'sold_out'].includes(String(item.status)) ? 0 : Number(stock), authorization_ref: authorization,
      ...listingMetadata(item),
    });
  }
  if (products.length > 500) throw new HttpError(502, 'Eligible catalog exceeds 500 products.');
  return { products, categories: [...categories, ...extra.values()] };
}

export class SupplierReadError extends HttpError {
  readonly retryAfterMs: number
  readonly failureKind: 'network' | 'other'
  constructor(status: number, message: string, retryAfterMs: number, failureKind: 'network' | 'other' = 'other') {
    super(status, message); this.retryAfterMs = retryAfterMs; this.failureKind = failureKind
  }
}

// Explicit projection only: never store arbitrary detail responses or fulfillment fields.
export function listingMetadata(item: Metadata) {
  const result: { slug?: string; image_url?: string; image_urls?: string[]; supplier_status?: string; subcategory_id?: string; sold_count?: number } = {}
  if (item.slug != null) result.slug = listingSlug(item.slug)
  const images = productImages(item)
  if (images.length) { result.image_urls = images; result.image_url = images[0] }
  if (typeof item.status === 'string' && ['active', 'inactive', 'available', 'unavailable', 'discontinued', 'sold_out'].includes(item.status)) result.supplier_status = item.status
  if (Number.isSafeInteger(item.sold) && Number(item.sold) >= 0 && Number(item.sold) <= 1000000000) result.sold_count = Number(item.sold)
  if (item.subcategory && typeof item.subcategory === 'object' && !Array.isArray(item.subcategory)) {
    const id = record(item.subcategory).id
    if (id != null) result.subcategory_id = identifier(id)
  }
  return result
}
