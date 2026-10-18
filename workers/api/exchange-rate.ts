import { adminActor, bodyJSON } from './admin.ts'
import { HttpError, json } from './http.ts'
import {
  fetchRemitanoP2POffers,
  calculateRepresentativeRate as calculateRemitanoRate,
  isRateFresh,
  isRateJumpAbnormal,
  RemitanoP2PError,
  DEFAULT_REMITANO_BASE_URL,
  DEFAULT_FRESHNESS_LIMIT_MS,
} from '../../server/remitano-p2p.ts'
import {
  fetchQuidaxUsdtNgnTicker,
  QuidaxSpotError,
} from '../../server/quidax-spot.ts'
import type { ApiEnv, Statement, Database } from './types.ts'

export type ExchangeRateState = {
  current_rate: number
  source: 'remitano_p2p' | 'quidax_spot_proxy' | 'override' | 'fallback'
  status: 'active' | 'stale' | 'paused'
  updated_at: number
  is_fresh: boolean
  override_active: boolean
  override_rate: number | null
  remitano_configured: boolean
  remitano_access_key_masked: string | null
  remitano_base_url: string
  quidax_backup_enabled: boolean
  markup_bps: number
  proxy_asset: 'USDT'
  proxy_note: string
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
        COALESCE(fx_source, 'remitano_p2p') fx_source,
        COALESCE(fx_updated_at, 0) fx_updated_at,
        COALESCE(fx_status, 'active') fx_status,
        COALESCE(fx_override_active, 0) fx_override_active,
        fx_override_rate,
        remitano_access_key,
        COALESCE(remitano_base_url, 'https://api.remitano.com') remitano_base_url,
        COALESCE(quidax_backup_enabled, 0) quidax_backup_enabled,
        CASE WHEN remitano_secret_key IS NOT NULL AND length(trim(remitano_secret_key))>0 THEN 1 ELSE 0 END has_secret
       FROM global_pricing_config WHERE id='global'`
    ).first<{
      usd_to_ngn_rate: number
      markup_bps: number
      fx_source: string
      fx_updated_at: number
      fx_status: string
      fx_override_active: number
      fx_override_rate: number | null
      remitano_access_key: string | null
      remitano_base_url: string
      quidax_backup_enabled: number
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
    const remitanoConfigured = Boolean(config?.remitano_access_key?.trim() && config?.has_secret === 1)

    return json({
      rate_state: {
        current_rate: currentRate,
        source: overrideActive ? 'override' : (config?.fx_source || 'remitano_p2p'),
        status: isFresh ? (config?.fx_status || 'active') : 'stale',
        updated_at: updatedAt,
        is_fresh: isFresh,
        override_active: overrideActive,
        override_rate: config?.fx_override_rate ?? null,
        remitano_configured: remitanoConfigured,
        remitano_access_key_masked: maskApiKey(config?.remitano_access_key),
        remitano_base_url: config?.remitano_base_url || DEFAULT_REMITANO_BASE_URL,
        quidax_backup_enabled: config?.quidax_backup_enabled === 1,
        markup_bps: config?.markup_bps ?? 5000,
        proxy_asset: 'USDT',
        proxy_note: 'USDT/NGN market rate used as proxy for USD equivalent.',
      },
      history,
    })
  }

  if (request.method !== 'POST') throw new HttpError(405, 'POST required.')
  const body = await bodyJSON(request, 8192)

  const config = await db.prepare(
    `SELECT usd_to_ngn_rate, markup_bps, fx_override_active, fx_override_rate,
            remitano_access_key, remitano_secret_key, remitano_base_url, quidax_backup_enabled
     FROM global_pricing_config WHERE id='global'`
  ).first<{
    usd_to_ngn_rate: number
    markup_bps: number
    fx_override_active: number
    fx_override_rate: number | null
    remitano_access_key: string | null
    remitano_secret_key: string | null
    remitano_base_url: string | null
    quidax_backup_enabled: number | null
  }>().catch(() => null)

  const currentRate = config?.usd_to_ngn_rate ?? 1500.0
  const markupBps = config?.markup_bps ?? 5000
  const accessKey = config?.remitano_access_key?.trim()
  const secretKey = config?.remitano_secret_key?.trim()
  const baseUrl = config?.remitano_base_url?.trim() || DEFAULT_REMITANO_BASE_URL
  const quidaxBackupEnabled = config?.quidax_backup_enabled === 1

  // Action 1: Refresh rate from Remitano P2P (with Quidax Spot secondary backup if configured)
  if (body.action === 'refresh') {
    let resolvedRate: number = 0
    let sampleSize: number = 0
    let rawMedian: number = 0
    let rateSource: 'remitano_p2p' | 'quidax_spot_proxy' = 'remitano_p2p'
    let details: string | undefined
    let remitanoError: string | null = null

    // 1. Attempt primary: Remitano P2P
    try {
      const { offers, ratesAds } = await fetchRemitanoP2POffers({
        accessKey,
        secretKey,
        baseUrl,
      })
      const valResult = calculateRemitanoRate(offers, ratesAds)
      if (valResult.valid) {
        resolvedRate = valResult.rate
        sampleSize = valResult.sampleSize
        rawMedian = valResult.rawMedian
        details = valResult.details
        rateSource = 'remitano_p2p'
      } else {
        remitanoError = valResult.details || 'Remitano offers did not satisfy validation criteria.'
      }
    } catch (err) {
      remitanoError = err instanceof RemitanoP2PError ? err.message : (err instanceof Error ? err.message : 'Remitano connection failed.')
    }

    // 2. If Remitano failed and Quidax Spot is configured as backup:
    if (resolvedRate <= 0 && quidaxBackupEnabled) {
      try {
        const quidaxResult = await fetchQuidaxUsdtNgnTicker()
        if (quidaxResult.valid) {
          resolvedRate = quidaxResult.rate
          sampleSize = 1
          rawMedian = quidaxResult.rate
          rateSource = 'quidax_spot_proxy'
          details = `Quidax Spot Orderbook Ticker (Ask: ₦${quidaxResult.rate}/USDT) utilized as secondary spot proxy backup. (Remitano status: ${remitanoError})`
        }
      } catch (qErr) {
        // Both failed
      }
    }

    // If rate could not be resolved
    if (resolvedRate <= 0) {
      const errorMsg = remitanoError || 'Unable to retrieve valid market rate from Remitano P2P.'
      await db.prepare(
        `INSERT INTO exchange_rate_history(id, rate, source, sample_size, raw_median, status, error_detail, recorded_at)
         VALUES(?, ?, 'remitano_p2p', ?, ?, 'rejected', ?, ?)`
      ).bind(crypto.randomUUID(), currentRate, sampleSize, rawMedian, errorMsg, Date.now()).run().catch(() => {})

      return json({
        refreshed: false,
        error: errorMsg,
        rate: currentRate,
        quidax_backup_attempted: quidaxBackupEnabled,
      }, 200)
    }

    // Check abnormal rate jump
    const isAbnormal = isRateJumpAbnormal(resolvedRate, currentRate)
    if (isAbnormal && body.confirm_jump !== true) {
      return json({
        refreshed: false,
        warning: 'abnormal_jump',
        new_rate: resolvedRate,
        current_rate: currentRate,
        source: rateSource,
        percent_change: Math.round(Math.abs((resolvedRate - currentRate) / currentRate) * 1000) / 10,
        message: `Market rate ₦${resolvedRate}/$1 (${rateSource === 'quidax_spot_proxy' ? 'Quidax Spot Proxy' : 'Remitano P2P'}) differs by >15% from current rate ₦${currentRate}/$1. Confirmation required before applying.`,
      }, 200)
    }

    const now = Date.now()
    if (config?.fx_override_active !== 1) {
      await db.prepare(
        `UPDATE global_pricing_config
         SET usd_to_ngn_rate=?, fx_source=?, fx_updated_at=?, fx_status='active'
         WHERE id='global'`
      ).bind(resolvedRate, rateSource, now).run()

      await recalculateAllUsdProducts(db, resolvedRate, markupBps)
    }

    await db.prepare(
      `INSERT INTO exchange_rate_history(id, rate, source, sample_size, raw_median, status, error_detail, recorded_at)
       VALUES(?, ?, ?, ?, ?, 'active', ?, ?)`
    ).bind(crypto.randomUUID(), resolvedRate, rateSource, sampleSize, rawMedian, details || null, now).run()

    return json({
      refreshed: true,
      rate: resolvedRate,
      sample_size: sampleSize,
      raw_median: rawMedian,
      source: rateSource,
      override_active: config?.fx_override_active === 1,
      message: config?.fx_override_active === 1
        ? `${rateSource === 'quidax_spot_proxy' ? 'Quidax Spot Proxy' : 'Remitano P2P'} rate ₦${resolvedRate} recorded. Manual override remains active at ₦${currentRate}.`
        : `${rateSource === 'quidax_spot_proxy' ? 'Quidax Spot Proxy' : 'Remitano P2P'} rate updated to ₦${resolvedRate}/$1. Products dynamically repriced with 50% markup.`,
    })
  }

  // Action 2: Test Connection
  if (body.action === 'test_connection') {
    const testAccessKey = typeof body.api_key === 'string' && body.api_key.trim() ? body.api_key.trim() : accessKey
    const testSecretKey = typeof body.api_secret === 'string' && body.api_secret.trim() ? body.api_secret.trim() : secretKey
    const testBaseUrl = typeof body.base_url === 'string' && body.base_url.trim() ? body.base_url.trim() : baseUrl

    const results: Record<string, unknown> = {
      remitano: { success: false },
      quidax: { success: false },
    }

    // 1. Test Remitano
    try {
      const { offers, ratesAds, baseUrlUsed } = await fetchRemitanoP2POffers({
        accessKey: testAccessKey,
        secretKey: testSecretKey,
        baseUrl: testBaseUrl,
      })
      const val = calculateRemitanoRate(offers, ratesAds)
      results.remitano = {
        success: val.valid,
        base_url_used: baseUrlUsed,
        offers_count: offers.length,
        rate: val.rate,
        raw_median: val.rawMedian,
        details: val.details || 'Connection to Remitano API succeeded.',
      }
    } catch (err) {
      results.remitano = {
        success: false,
        error: err instanceof Error ? err.message : 'Remitano connection failed.',
        code: err instanceof RemitanoP2PError ? err.code : 'unknown_error',
      }
    }

    // 2. Test Quidax if enabled or requested
    if (quidaxBackupEnabled || body.test_quidax === true) {
      try {
        const qRes = await fetchQuidaxUsdtNgnTicker()
        results.quidax = {
          success: qRes.valid,
          rate: qRes.rate,
          buy: qRes.buy,
          sell: qRes.sell,
          label: qRes.label,
        }
      } catch (err) {
        results.quidax = {
          success: false,
          error: err instanceof Error ? err.message : 'Quidax ticker failed.',
        }
      }
    }

    return json({
      tested: true,
      results,
    })
  }

  // Action 3: Set manual override
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
         SET fx_override_active=0, fx_source='remitano_p2p'
         WHERE id='global'`
      ).run()

      return json({
        saved: true,
        override_active: false,
        message: 'Manual override disabled. Active Remitano P2P rate will be used.',
      })
    }
  }

  // Action 4: Save credentials and settings
  if (body.action === 'save_credentials') {
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : ''
    const apiSecret = typeof body.api_secret === 'string' ? body.api_secret.trim() : ''
    const newBaseUrl = typeof body.base_url === 'string' && body.base_url.trim() ? body.base_url.trim() : DEFAULT_REMITANO_BASE_URL
    const quidaxEnabled = body.quidax_backup_enabled === true || body.quidax_backup_enabled === 1 ? 1 : 0

    await db.prepare(
      `UPDATE global_pricing_config
       SET remitano_access_key = COALESCE(NULLIF(?, ''), remitano_access_key),
           remitano_secret_key = COALESCE(NULLIF(?, ''), remitano_secret_key),
           remitano_base_url = ?,
           quidax_backup_enabled = ?,
           fx_backup_source = CASE WHEN ? = 1 THEN 'quidax_spot' ELSE 'none' END
       WHERE id='global'`
    ).bind(apiKey, apiSecret, newBaseUrl, quidaxEnabled, quidaxEnabled).run()

    return json({
      saved: true,
      message: 'Remitano P2P credentials & Quidax backup settings saved. Click Test Connection or Refresh Rate to verify.',
    })
  }

  throw new HttpError(400, 'Unknown exchange rate action.')
}

/**
 * 10-Minute automated cron background refresh:
 * Triggered by the Cloudflare scheduler; gracefully refreshes Remitano P2P (or Quidax backup if configured).
 */
export async function refreshExchangeRateCron(env: ApiEnv): Promise<void> {
  if (!env.DB) return
  const db = env.DB
  const now = Date.now()

  const config = await db.prepare(
    `SELECT usd_to_ngn_rate, markup_bps, fx_updated_at, fx_override_active,
            remitano_access_key, remitano_secret_key, remitano_base_url, quidax_backup_enabled
     FROM global_pricing_config WHERE id='global'`
  ).first<{
    usd_to_ngn_rate: number
    markup_bps: number
    fx_updated_at: number
    fx_override_active: number
    remitano_access_key: string | null
    remitano_secret_key: string | null
    remitano_base_url: string | null
    quidax_backup_enabled: number | null
  }>().catch(() => null)

  if (!config) return

  // Check 10-minute cadence: 600,000 ms
  if (now - (config.fx_updated_at || 0) < 600000) return

  // If manual override is active, do not overwrite the active rate
  if (config.fx_override_active === 1) return

  const accessKey = config.remitano_access_key?.trim()
  const secretKey = config.remitano_secret_key?.trim()
  const baseUrl = config.remitano_base_url?.trim() || DEFAULT_REMITANO_BASE_URL
  const quidaxEnabled = config.quidax_backup_enabled === 1

  let resolvedRate: number = 0
  let sampleSize: number = 0
  let rawMedian: number = 0
  let rateSource: 'remitano_p2p' | 'quidax_spot_proxy' = 'remitano_p2p'
  let details: string | undefined

  try {
    const { offers, ratesAds } = await fetchRemitanoP2POffers({
      accessKey,
      secretKey,
      baseUrl,
    })
    const valResult = calculateRemitanoRate(offers, ratesAds)
    if (valResult.valid) {
      resolvedRate = valResult.rate
      sampleSize = valResult.sampleSize
      rawMedian = valResult.rawMedian
      rateSource = 'remitano_p2p'
    }
  } catch (err) {
    // Try Quidax backup if enabled
    if (quidaxEnabled) {
      try {
        const qRes = await fetchQuidaxUsdtNgnTicker()
        if (qRes.valid) {
          resolvedRate = qRes.rate
          sampleSize = 1
          rawMedian = qRes.rate
          rateSource = 'quidax_spot_proxy'
          details = 'Quidax Spot Orderbook Ticker secondary proxy (Remitano unavailable during cron)'
        }
      } catch {}
    }
  }

  if (resolvedRate > 0 && !isRateJumpAbnormal(resolvedRate, config.usd_to_ngn_rate)) {
    await db.prepare(
      `UPDATE global_pricing_config
       SET usd_to_ngn_rate=?, fx_source=?, fx_updated_at=?, fx_status='active'
       WHERE id='global'`
    ).bind(resolvedRate, rateSource, now).run()

    await recalculateAllUsdProducts(db, resolvedRate, config.markup_bps || 5000)

    await db.prepare(
      `INSERT INTO exchange_rate_history(id, rate, source, sample_size, raw_median, status, error_detail, recorded_at)
       VALUES(?, ?, ?, ?, ?, 'active', ?, ?)`
    ).bind(crypto.randomUUID(), resolvedRate, rateSource, sampleSize, rawMedian, details || null, now).run()
  } else if (now - (config.fx_updated_at || 0) > DEFAULT_FRESHNESS_LIMIT_MS) {
    // If rate is older than 60 minutes and could not be refreshed, mark as stale
    await db.prepare("UPDATE global_pricing_config SET fx_status='stale' WHERE id='global'").run().catch(() => {})
  }
}
