# HStora Gateway HTTP 403 Diagnostic Report & Support Escalation

**Date**: 2026-10-17  
**Merchant**: LogsPoll (`https://logspoll.com`)  
**Supplier Integration**: Server 1 — HStora API  
**Status**: Gateway rejection (HTTP 403 Forbidden with Cloudflare Ray ID `a4ba8e6b8da5beeb-LHR`)

---

## 1. Technical Analysis

### Endpoints Called
- Catalog sync: `GET https://hstora.com/api/v1/catalog?page=1&limit=50`
- Product detail: `GET https://hstora.com/api/v1/products/{id}`

### Request Headers Sent
Currently generated in `server/hstora.ts` (`hstoraHeaders`):
- `X-API-Key`: `hs_pk_...` (Documented public key)
- `X-Timestamp`: Unix epoch seconds (`String(Math.floor(Date.now() / 1000))`)
- `X-Nonce`: 32-character hexadecimal UUID (`crypto.randomUUID().replaceAll('-', '')`)
- `X-Signature`: HMAC-SHA256 signature of canonical string `GET\n{path}\n{query}\n{timestamp}\n{nonce}\n` using `hs_sk_...`
- `Accept`: `application/json`
- `Origin`: `https://logspoll.com` (when `allowedOrigin` configured)

### Missing Headers & Root Causes
1. **Missing `User-Agent` Header**:
   - `server/hstora.ts` does not specify a `User-Agent` header in outgoing fetch requests.
   - Cloudflare Bot Management / Bot Fight Mode running on `hstora.com` automatically blocks HTTP requests without browser or legitimate client `User-Agent` headers with a non-JSON HTTP 403 page.
2. **Cloudflare WAF / IP / Managed Challenge**:
   - The response header `CF-Ray: a4ba8e6b8da5beeb-LHR` confirms the request was terminated at Cloudflare's London edge datacenter before reaching HStora's application server.
   - The response body was HTML (non-JSON gateway rejection), not an application-level JSON error such as `{"error": {"code": "invalid_signature"}}`.
3. **Origin & IP Domain Restriction**:
   - If HStora's partner dashboard enforces an IP whitelist or specific allowed domains for API keys, Cloudflare Worker outbound IPs may be flagged unless whitelisted or exempted.

---

## 2. Immediate Code Fix

Add a standard identification `User-Agent` header to `hstoraHeaders` in `server/hstora.ts`:
```typescript
'User-Agent': 'LogsPoll/1.0 (+https://logspoll.com; support@logspoll.com)'
```
Note: The HMAC canonical signature in `server/hstora.ts` signs `[method, path, query, timestamp, nonce, ''].join('\n')`. It does **not** include `User-Agent` in the HMAC signature string, so adding `User-Agent` preserves signature validity.

---

## 3. Support Escalation Template for HStora

Send the following email/ticket to HStora technical support:

```text
Subject: API Gateway 403 Rejection - Merchant LogsPoll (CF-Ray: a4ba8e6b8da5beeb-LHR)

Hello HStora Support Team,

Our marketplace (LogsPoll, https://logspoll.com) is integrating with HStora's REST API for catalog synchronization.

Our automated GET requests to https://hstora.com/api/v1/catalog are receiving an immediate HTTP 403 Forbidden rejection from your Cloudflare edge gateway before reaching your application servers.

Request details:
- Timestamp: 2026-10-15T04:17:00Z / 2026-10-16
- Endpoint: GET https://hstora.com/api/v1/catalog?page=1&limit=50
- Cloudflare Ray ID: a4ba8e6b8da5beeb-LHR
- Headers Sent:
  - X-API-Key: hs_pk_... [our assigned public key]
  - X-Timestamp: [current Unix epoch]
  - X-Nonce: [32-char UUID]
  - X-Signature: [HMAC-SHA256 hex]
  - Accept: application/json
  - Origin: https://logspoll.com
  - User-Agent: LogsPoll/1.0 (+https://logspoll.com)

Error Observed:
Non-JSON gateway HTTP 403 rejection from Cloudflare edge.

Could you please:
1. Check your Cloudflare WAF / Security Events log for CF-Ray: a4ba8e6b8da5beeb-LHR to see the specific WAF rule or Bot Management rule triggered.
2. Ensure our API key (hs_pk_...) and domain (https://logspoll.com) are allowlisted to bypass Bot Fight Mode / Managed Challenges on /api/v1/*.
3. Confirm if any specific outbound IP ranges or custom headers are required for server-to-server synchronization.

Thank you,
Technical Operations Team
LogsPoll (SwiftNova Labs)
https://logspoll.com
```

