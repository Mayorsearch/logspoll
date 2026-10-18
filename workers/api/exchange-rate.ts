import { adminActor, bodyJSON } from './admin.ts'
import { HttpError, json } from './http.ts'
import {
  fetchBybitP2PAds,
  calculateRepresentativeRate,
  isRateFresh,
  isRateJumpAbnormal,
  BybitP2PError,
  DEFAULT_FRESHNESS_LIMIT_MS,
} from '../../server/bybit-p2p.ts'
import type { ApiEnv, Statement, Database } from './types.ts'

export type ExchangeRateState = {
  current_rate: number
  source: 'bybit_p2p' | 'override' | 'fallback'
  status: 'active' | 'stale' | 'paused'
  updated_at: number
  is_fresh: boolean
  override_active: boolean
  override_rate: number | null
  bybit_configured: boolean
  bybit_api_key_masked: string | null
  markup_bps: number
}

function maskApiKey(key?: string | null): string | null {
  if (!key || typeof key !== 'string' || key.length < 6) return null
  return `${key.slice(0, 3)}...${key.slice(-3)}`
}

export async function recalculateAllUsdProducts(db: Database, usdRate: number, markupBps: number): Promise<number> {
  let updatedCount = 0
  const statements: Statement[] = []

  // 1. ShopViaClone22 items (stored with raw_metadata containing USD price)
  statements.push(
    db.prepare(`UPDATE shopviaclone22_catalog_items
      SET
        cost_minor = CAST(ROUND(CAST(json_extract(raw_metadata, '$.price') AS REAL) * ? * 100.0) AS INTEGER),
        selling_price_minor = CAST(ROUND(
          CAST(ROUND(CAST(json_extract(raw_metadata, '$.price') AS REAL) * ? * 100.0) AS INTEGER) * (1.0 + ? / 10000.0)
        ) AS INTEGER)
      WHERE json_valid(raw_metadata) AND CAST(json_extract(raw_metadata, '$.price') AS REAL) > 0`).bind(usdRate, usdRate, markupBps),
    db.prepare(`UPDATE products
      SET price_minor = (SELECT s3.selling_price_minor FROM shopviaclone22_catalog_items s3 WHERE s3.product_id=products.id)
      WHERE server_number = 3 AND pricing_mode = 'auto'
        AND EXISTS (SELECT 1 FROM shopviaclone22_catalog_items s3 WHERE s3.product_id=products.id AND s3.selling_price_minor > 0 AND s3.selling_price_minor <> products.price_minor)`)
  )

  // 2. HStora items (where metadata currency is USD)
  statements.push(
    db.prepare(`UPDATE hstora_catalog_items
      SET selling_price_minor = CAST(ROUND(
        CAST(json_extract(metadata, '$.price') AS REAL) * ? * 100.0 * (1.0 + ? / 10000.0)
      ) AS INTEGER)
      WHERE json_valid(metadata) AND json_extract(metadata, '$.currency') = 'USD'
        AND CAST(json_extract(metadata, '$.price') AS REAL) > 0`).bind(usdRate, markupBps),
    db.prepare(`UPDATE products
      SET price_minor = (SELECT h.selling_price_minor FROM hstora_catalog_items h WHERE h.product_id=products.id)
      WHERE server_number = 1 AND pricing_mode = 'auto'
        AND EXISTS (SELECT 1 FROM hstora_catalog_items h WHERE h.product_id=products.id AND json_extract(h.metadata, '$.currency') = 'USD' AND h.selling_price_minor > 0 AND h.selling_price_minor <> products.price_minor)`)
  )

  // 3. DigitalTop items (Server 4 AI tools, where raw_metadata contains price_usd)
  const dtopExists = await db.prepare("SELECT 1 FROM sqlite_master WHERE name='digitaltop_catalog_items'").first().catch(() => null)
  if (dtopExists) {
    statements.push(
      db.prepare(`UPDATE digitaltop_catalog_items
        SET
          cost_minor = CAST(ROUND(CAST(json_extract(raw_metadata, '$.price_usd') AS REAL) * ? * 100.0) AS INTEGER),
          selling_price_minor = CAST(ROUND(
            CAST(ROUND(CAST(json_extract(raw_metadata, '$.price_usd') AS REAL) * ? * 100.0) AS INTEGER) * (1.0 + ? / 10000.0)
          ) AS INTEGER)
        WHERE json_valid(raw_metadata) AND CAST(json_extract(raw_metadata, '$.price_usd') AS REAL) > 0`).bind(usdRate, usdRate, markupBps),
      db.prepare(`UPDATE products
        SET price_minor = (SELECT s4.selling_price_minor FROM digitaltop_catalog_items s4 WHERE s4.product_id=products.id)
        WHERE server_number = 4 AND pricing_mode = 'auto'
          AND EXISTS (SELECT 1 FROM digitaltop_catalog_items s4 WHERE s4.product_id=products.id AND s4.selling_price_minor > 0 AND s4.selling_price_minor <> products.price_minor)`)
    )
  }

  try {
    await db.batch(statements)
    const affected = await db.prepare("SELECT count(*) n FROM products WHERE server_number IN (1,3,4) AND pricing_mode='auto'").first<{ n: number }>().catch(() => ({ n: 0 }))
    updatedCount = affected?.n ?? 0
  } catch (err) {
    console.warn('recalculate_usd_products_error', err)
  }

  return updatedCount
}

export async function exchangeRateAdmin(request: Request, env: ApiEnv): Promise<Response> {
  await adminActor(request, env)
  const db = env.DB!

  if (request.method === 'GET') {
    const config = await db.prepare(
      `SELECT usd_to_ngn_rate, markup_bps,
        COALESCE(fx_source, 'bybit_p2p') fx_source,
        COALESCE(fx_updated_at, 0) fx_updated_at,
        COALESCE(fx_status, 'active') fx_status,
        COALESCE(fx_override_active, 0) fx_override_active,
        fx_override_rate,
        bybit_api_key,
        CASE WHEN bybit_api_secret IS NOT NULL AND length(trim(bybit_api_secret))>0 THEN 1 ELSE 0 END has_secret
       FROM global_pricing_config WHERE id='global'`
    ).first<{
      usd_to_ngn_rate: number
      markup_bps: number
      fx_source: string
      fx_updated_at: number
      fx_status: string
      fx_override_active: number
      fx_override_rate: number | null
      bybit_api_key: string | null
      has_secret: number
    }>().catch(() => null)

    const history = (
      await db.prepare('SELECT * FROM exchange_rate_history ORDER BY recorded_at DESC LIMIT 20')
        .all()
        .catch(() => ({ results: [] }))
    ).results

    const currentRate = config?.usd_to_ngn_rate ?? 1500.0
    const updatedAt = config?.fx_updated_at ?? 0
    const isFresh = isRateFresh(updatedAt, DEFAULT_FRESHNESS_LIMIT_MS)
    const overrideActive = config?.fx_override_active === 1
    const bybitConfigured = Boolean(config?.bybit_api_key?.trim() && config?.has_secret === 1)

    return json({
      rate_state: {
        current_rate: currentRate,
        source: overrideActive ? 'override' : (config?.fx_source || 'bybit_p2p'),
        status: isFresh ? (config?.fx_status || 'active') : 'stale',
        updated_at: updatedAt,
        is_fresh: isFresh,
        override_active: overrideActive,
        override_rate: config?.fx_override_rate ?? null,
        bybit_configured: bybitConfigured,
        bybit_api_key_masked: maskApiKey(config?.bybit_api_key),
        markup_bps: config?.markup_bps ?? 5000,
      },
      history,
    })
  }

  if (request.method !== 'POST') throw new HttpError(405, 'POST required.')
  const body = await bodyJSON(request, 8192)

  const config = await db.prepare(
    `SELECT usd_to_ngn_rate, markup_bps, fx_override_active, fx_override_rate, bybit_api_key, bybit_api_secret
     FROM global_pricing_config WHERE id='global'`
  ).first<{
    usd_to_ngn_rate: number
    markup_bps: number
    fx_override_active: number
    fx_override_rate: number | null
    bybit_api_key: string | null
    bybit_api_secret: string | null
  }>().catch(() => null)

  const currentRate = config?.usd_to_ngn_rate ?? 1500.0
  const markupBps = config?.markup_bps ?? 5000

  // Action 1: Refresh rate from Bybit P2P
  if (body.action === 'refresh') {
    const apiKey = config?.bybit_api_key?.trim()
    const apiSecret = config?.bybit_api_secret?.trim()

    if (!apiKey || !apiSecret) {
      return json({
        refreshed: false,
        error: 'Bybit API Key and Secret are not configured. Enter valid credentials or use Manual Override.',
        rate: currentRate,
        layer: 'configuration',
      }, 200)
    }

    try {
      const { ads } = await fetchBybitP2PAds({ apiKey, apiSecret })
      const valResult = calculateRepresentativeRate(ads)

      if (!valResult.valid) {
        await db.prepare(
          `INSERT INTO exchange_rate_history(id, rate, source, sample_size, raw_median, status, error_detail, recorded_at)
           VALUES(?, ?, 'bybit_p2p', ?, ?, 'rejected', ?, ?)`
        ).bind(crypto.randomUUID(), currentRate, valResult.sampleSize, valResult.rawMedian, valResult.details || 'Validation failed', Date.now()).run().catch(() => {})

        return json({
          refreshed: false,
          error: valResult.details || 'Bybit P2P returned insufficient valid ads.',
          rate: currentRate,
        }, 200)
      }

      // Check abnormal rate jump
      const isAbnormal = isRateJumpAbnormal(valResult.rate, currentRate)
      if (isAbnormal && body.confirm_jump !== true) {
        return json({
          refreshed: false,
          warning: 'abnormal_jump',
          new_rate: valResult.rate,
          current_rate: currentRate,
          percent_change: Math.round(Math.abs((valResult.rate - currentRate) / currentRate) * 1000) / 10,
          message: `Representative rate ₦${valResult.rate}/$1 differs by >15% from current rate ₦${currentRate}/$1. Confirmation required before applying.`,
        }, 200)
      }

      const now = Date.now()
      // If manual override is active, do not overwrite the active selling rate unless requested
      if (config?.fx_override_active !== 1) {
        await db.prepare(
          `UPDATE global_pricing_config
           SET usd_to_ngn_rate=?, fx_source='bybit_p2p', fx_updated_at=?, fx_status='active'
           WHERE id='global'`
        ).bind(valResult.rate, now).run()

        await recalculateAllUsdProducts(db, valResult.rate, markupBps)
      }

      await db.prepare(
        `INSERT INTO exchange_rate_history(id, rate, source, sample_size, raw_median, status, error_detail, recorded_at)
         VALUES(?, ?, 'bybit_p2p', ?, ?, 'active', NULL, ?)`
      ).bind(crypto.randomUUID(), valResult.rate, valResult.sampleSize, valResult.rawMedian, now).run()

      return json({
        refreshed: true,
        rate: valResult.rate,
        sample_size: valResult.sampleSize,
        raw_median: valResult.rawMedian,
        override_active: config?.fx_override_active === 1,
        message: config?.fx_override_active === 1
          ? `Bybit P2P rate ₦${valResult.rate} recorded. Manual override remains active at ₦${currentRate}.`
          : `Bybit P2P reference rate updated to ₦${valResult.rate}/$1. Products dynamically repriced with 50% markup.`,
      })
    } catch (error) {
      const msg = error instanceof BybitP2PError ? error.message : (error instanceof Error ? error.message : 'Bybit P2P request failed.')
      const now = Date.now()
      await db.prepare(
        `INSERT INTO exchange_rate_history(id, rate, source, sample_size, raw_median, status, error_detail, recorded_at)
         VALUES(?, ?, 'bybit_p2p', 0, 0, 'error', ?, ?)`
      ).bind(crypto.randomUUID(), currentRate, msg.slice(0, 500), now).run().catch(() => {})

      return json({
        refreshed: false,
        error: msg,
        rate: currentRate,
      }, 200)
    }
  }

  // Action 2: Set manual override
  if (body.action === 'set_override') {
    const enabled = body.enabled === true || body.enabled === 1
    const newRate = Number(body.rate)

    if (enabled) {
      if (!Number.isFinite(newRate) || newRate < 500 || newRate > 5000) {
        throw new HttpError(400, 'Exchange rate override must be between ₦500 and ₦5,000 per USD.')
      }
    }

    const now = Date.now()
    if (enabled) {
      await db.prepare(
        `UPDATE global_pricing_config
         SET fx_override_active=1, fx_override_rate=?, usd_to_ngn_rate=?, fx_source='override', fx_updated_at=?, fx_status='active'
         WHERE id='global'`
      ).bind(newRate, newRate, now).run()

      await recalculateAllUsdProducts(db, newRate, markupBps)

      await db.prepare(
        `INSERT INTO exchange_rate_history(id, rate, source, sample_size, raw_median, status, error_detail, recorded_at)
         VALUES(?, ?, 'override', 0, 0, 'active', 'Admin manual rate applied', ?)`
      ).bind(crypto.randomUUID(), newRate, now).run().catch(() => {})

      return json({
        saved: true,
        override_active: true,
        rate: newRate,
        message: `Manual exchange rate ₦${newRate}/$1 applied. All USD-denominated products repriced.`,
      })
    } else {
      await db.prepare(
        `UPDATE global_pricing_config
         SET fx_override_active=0, fx_source='bybit_p2p'
         WHERE id='global'`
      ).run()

      return json({
        saved: true,
        override_active: false,
        message: 'Manual override disabled. Active Bybit P2P rate will be used.',
      })
    }
  }

  // Action 3: Save Bybit credentials
  if (body.action === 'save_credentials') {
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    const apiSecret = typeof body.api_secret === 'string' ? body.api_secret.trim() : ''

    if (apiKey || apiSecret) {
      await db.prepare(
        `UPDATE global_pricing_config
         SET bybit_api_key=COALESCE(NULLIF(?,''), bybit_api_key),
             bybit_api_secret=COALESCE(NULLIF(?,''), bybit_api_secret)
         WHERE id='global'`
      ).bind(apiKey, apiSecret).run()
    }

    return json({
      saved: true,
      message: 'Bybit P2P credentials saved. Click Refresh Rate to verify connection.',
    })
  }

  throw new HttpError(400, 'Unknown exchange rate action.')
}

/**
 * 10-Minute automated cron background refresh:
 * Triggered by the Cloudflare scheduler; gracefully skips if credentials are not ready
 * or if manual override is active.
 */
export async function refreshExchangeRateCron(env: ApiEnv): Promise<void> {
  if (!env.DB) return
  const db = env.DB
  const now = Date.now()

  const config = await db.prepare(
    `SELECT usd_to_ngn_rate, markup_bps, fx_updated_at, fx_override_active, bybit_api_key, bybit_api_secret
     FROM global_pricing_config WHERE id='global'`
  ).first<{
    usd_to_ngn_rate: number
    markup_bps: number
    fx_updated_at: number
    fx_override_active: number
    bybit_api_key: string | null
    bybit_api_secret: string | null
  }>().catch(() => null)

  if (!config) return

  // Check 10-minute cadence: 600,000 ms
  if (now - (config.fx_updated_at || 0) < 600000) return

  // If manual override is active, do not overwrite the active rate
  if (config.fx_override_active === 1) return

  const apiKey = config.bybit_api_key?.trim()
  const apiSecret = config.bybit_api_secret?.trim()
  if (!apiKey || !apiSecret) {
    // If rate is older than 60 minutes and cannot be refreshed, mark as stale
    if (now - (config.fx_updated_at || 0) > DEFAULT_FRESHNESS_LIMIT_MS) {
      await db.prepare("UPDATE global_pricing_config SET fx_status='stale' WHERE id='global'").run().catch(() => {})
    }
    return
  }

  try {
    const { ads } = await fetchBybitP2PAds({ apiKey, apiSecret })
    const valResult = calculateRepresentativeRate(ads)

    if (valResult.valid && !isRateJumpAbnormal(valResult.rate, config.usd_to_ngn_rate)) {
      await db.prepare(
        `UPDATE global_pricing_config
         SET usd_to_ngn_rate=?, fx_source='bybit_p2p', fx_updated_at=?, fx_status='active'
         WHERE id='global'`
      ).bind(valResult.rate, now).run()

      await recalculateAllUsdProducts(db, valResult.rate, config.markup_bps || 5000)

      await db.prepare(
        `INSERT INTO exchange_rate_history(id, rate, source, sample_size, raw_median, status, error_detail, recorded_at)
         VALUES(?, ?, 'bybit_p2p', ?, ?, 'active', NULL, ?)`
      ).bind(crypto.randomUUID(), valResult.rate, valResult.sampleSize, valResult.rawMedian, now).run()
    }
  } catch (err) {
    console.warn('bybit_cron_refresh_error', err)
  }
}

