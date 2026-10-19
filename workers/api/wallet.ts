import { HttpError, json } from './http.ts'
import { createBachsSession, getBachsSession } from '../../server/bachs.ts'
import { checkedPaidSandboxSession, parseNGNMinor } from '../../server/bachs-flow.ts'
import { assertAutomationQuotes } from './supplier-automation.ts'
import { runFulfillment } from './fulfillment.ts'
import { drainBusinessMail, drainMail } from './mail.ts'
import { adminActor } from './admin.ts'
import type { ApiEnv, Database, Statement } from './types.ts'

export interface WalletRecord {
  id: string
  customer_id: string
  currency: string
  balance_minor: number
  status: 'active' | 'frozen' | 'closed'
  created_at: number
  updated_at: number
}

export interface WalletTransactionRecord {
  id: string
  wallet_id: string
  customer_id: string
  reference: string
  type: 'funding' | 'purchase' | 'refund' | 'admin_adjustment' | 'reversal'
  direction: 'credit' | 'debit'
  amount_minor: number
  balance_before_minor: number
  balance_after_minor: number
  status: 'pending' | 'completed' | 'failed' | 'reversed' | 'refunded'
  order_id: string | null
  funding_attempt_id: string | null
  actor_id: string | null
  reason: string | null
  created_at: number
}

export interface FundingAttemptRecord {
  id: string
  customer_id: string
  wallet_id: string
  reference: string
  checkout_id: string | null
  provider_mode: 'sandbox' | 'live'
  amount_minor: number
  fee_minor: number
  credited_minor: number
  idempotency_key: string
  status: 'initiating' | 'open' | 'paid' | 'failed' | 'expired' | 'cancelled'
  created_at: number
  updated_at: number
}

export const MIN_WALLET_FUND_MINOR = 10_000 // ₦100.00
export const MAX_WALLET_FUND_MINOR = 100_000_000 // ₦1,000,000.00

function nowTooOld(created: number) { return Date.now() - created >= 23 * 60 * 60 * 1000 }

/** Environment isolation applies to credits as well as checkout creation. */
function fundingMode(env: ApiEnv): 'live' | 'sandbox' {
  const mode = env.ENVIRONMENT === 'production' ? 'live' : env.ENVIRONMENT === 'staging' ? 'sandbox' : null
  if (!mode || !env.BACHS_API_KEY?.trim().startsWith(mode === 'live' ? 'sk_live_' : 'sk_sandbox_') || !env.BACHS_WEBHOOK_SECRET || (mode === 'sandbox' && env.BACHS_SANDBOX_ENABLED !== 'true')) {
    throw new HttpError(503, 'Wallet payment environment is not configured safely.')
  }
  return mode
}

/**
 * Safely get or provision an NGN wallet for a registered customer.
 * Always initializes with ₦0.00 unless genuine credits exist.
 */
export async function getOrCreateWallet(db: Database, customerId: string): Promise<WalletRecord> {
  const existing = await db.prepare('SELECT id, customer_id, currency, balance_minor, status, created_at, updated_at FROM wallets WHERE customer_id = ?').bind(customerId).first<WalletRecord>()
  if (existing) return existing

  const id = crypto.randomUUID()
  const now = Date.now()
  await db.prepare('INSERT OR IGNORE INTO wallets (id, customer_id, currency, balance_minor, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(id, customerId, 'NGN', 0, 'active', now, now).run()

  const created = await db.prepare('SELECT id, customer_id, currency, balance_minor, status, created_at, updated_at FROM wallets WHERE customer_id = ?').bind(customerId).first<WalletRecord>()
  if (!created) throw new HttpError(500, 'Unable to initialize customer wallet.')
  return created
}

/**
 * Returns full wallet state including transactions, pending deposits, and virtual account availability status.
 */
export async function getWalletOverview(db: Database, customerId: string, env?: ApiEnv) {
  const wallet = await getOrCreateWallet(db, customerId)

  const transactions = await db.prepare(
    `SELECT t.id, t.reference, t.type, t.direction, t.amount_minor, t.balance_before_minor, t.balance_after_minor,
            t.status, t.order_id, t.funding_attempt_id, t.reason, t.created_at, o.reference AS order_reference
     FROM wallet_transactions t
     LEFT JOIN orders o ON o.id = t.order_id
     WHERE t.customer_id = ?
     ORDER BY t.created_at DESC LIMIT 50`
  ).bind(customerId).all<WalletTransactionRecord & { order_reference?: string | null }>()

  const pendingAttempts = await db.prepare(
    `SELECT id, reference, checkout_id, amount_minor, fee_minor, credited_minor, status, created_at
     FROM wallet_funding_attempts
     WHERE customer_id = ? AND status IN ('initiating', 'open')
     ORDER BY created_at DESC LIMIT 10`
  ).bind(customerId).all<FundingAttemptRecord>()

  return json({
    wallet: {
      id: wallet.id,
      currency: wallet.currency,
      balance_minor: wallet.balance_minor,
      balance: wallet.balance_minor / 100,
      status: wallet.status,
      created_at: wallet.created_at,
      updated_at: wallet.updated_at,
    },
    transactions: transactions.results.map((tx) => ({
      ...tx,
      amount: tx.amount_minor / 100,
      balance_before: tx.balance_before_minor / 100,
      balance_after: tx.balance_after_minor / 100,
    })),
    pending_deposits: pendingAttempts.results.map((p) => ({
      ...p,
      amount: p.amount_minor / 100,
      fee: p.fee_minor / 100,
      credited_amount: p.credited_minor / 100,
    })),
    virtual_account: {
      status: 'UNVERIFIED',
      reason: 'Dedicated virtual accounts have not been verified for this merchant.',
    },
    funding: {
      enabled: Boolean(env && (() => { try { return fundingMode(env) === 'sandbox' || env.WALLET_LIVE_FUNDING_ENABLED === 'true' } catch { return false } })()),
      reason: 'Wallet funding requires verified provider configuration and prepaid-wallet approval. Existing balances remain available.',
    },
    deposit_limits: {
      min_ngn: MIN_WALLET_FUND_MINOR / 100,
      max_ngn: MAX_WALLET_FUND_MINOR / 100,
      fee_percent: 0,
    }
  })
}

/**
 * Initiates a standalone wallet funding transaction with Bachs.
 * Gated by WALLET_LIVE_FUNDING_ENABLED in production until provider approval verified.
 */
export async function initiateWalletFunding(request: Request, env: ApiEnv, user: { id: string; email: string }) {
  if (request.method !== 'POST') throw new HttpError(405, 'POST required.')
  const db = env.DB!
  const url = new URL(request.url)

  let body: Record<string, unknown>
  try {
    body = await request.json()
  } catch {
    throw new HttpError(400, 'Invalid JSON body.')
  }

  if (!/^\d+(?:\.\d{1,2})?$/.test(String(body.amount ?? ''))) throw new HttpError(400, 'Amount must have at most two decimal places.')
  const rawAmount = Number(body.amount)
  if (!Number.isFinite(rawAmount) || rawAmount <= 0) {
    throw new HttpError(400, 'Valid deposit amount required.')
  }

  const amountMinor = parseNGNMinor(String(body.amount)) ?? 0
  if (amountMinor < MIN_WALLET_FUND_MINOR) {
    throw new HttpError(400, `Minimum wallet deposit is ₦${(MIN_WALLET_FUND_MINOR / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}.`)
  }
  if (amountMinor > MAX_WALLET_FUND_MINOR) {
    throw new HttpError(400, `Maximum wallet deposit is ₦${(MAX_WALLET_FUND_MINOR / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })}.`)
  }

  const wallet = await getOrCreateWallet(db, user.id)
  if (wallet.status !== 'active') {
    throw new HttpError(403, 'Your wallet is currently frozen or restricted. Please contact support.')
  }

  const key = env.BACHS_API_KEY?.trim() ?? ''
  const mode = fundingMode(env)

  // Stored-value compliance safeguard: live wallet deposits gated behind feature flag
  if (mode === 'live' && env.WALLET_LIVE_FUNDING_ENABLED !== 'true') {
    throw new HttpError(403, 'Live wallet deposits are temporarily disabled while merchant account approval and stored-value compliance checks are finalized.')
  }

  const feeMinor = 0
  const creditedMinor = amountMinor - feeMinor
  const requestId = body.requestId ?? crypto.randomUUID()
  if (typeof requestId !== 'string' || !/^[0-9a-f-]{36}$/i.test(requestId)) throw new HttpError(400,'Valid funding request ID required.')
  const idempotencyKey = 'wf_' + user.id + '_' + requestId
  const previous = await db.prepare('SELECT * FROM wallet_funding_attempts WHERE idempotency_key=? AND customer_id=?').bind(idempotencyKey,user.id).first<FundingAttemptRecord>()
  if (previous && (previous.amount_minor !== amountMinor || previous.provider_mode !== mode)) throw new HttpError(409,'Funding request does not match the original amount or environment.')
  if (previous && !['initiating','open'].includes(previous.status)) return json({ok:true,attemptId:previous.id,reference:previous.reference,status:previous.status})
  if (previous && nowTooOld(previous.created_at)) throw new HttpError(409,'Funding request requires provider reconciliation before another checkout.')
  const attemptId = previous?.id ?? crypto.randomUUID()
  const reference = previous?.reference ?? 'WF-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomUUID().slice(0, 8).toUpperCase()
  const now = Date.now()

  if (!previous) await db.prepare(
    `INSERT INTO wallet_funding_attempts (id, customer_id, wallet_id, reference, provider_mode, amount_minor, fee_minor, credited_minor, idempotency_key, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'initiating', ?, ?)`
  ).bind(attemptId, user.id, wallet.id, reference, mode, amountMinor, feeMinor, creditedMinor, idempotencyKey, now, now).run()

  const origin = url.origin
  const successUrl = `${origin}/dashboard/wallet?funding_status=success&attempt_id=${encodeURIComponent(attemptId)}`
  const cancelUrl = `${origin}/dashboard/wallet?funding_status=cancelled&attempt_id=${encodeURIComponent(attemptId)}`

  // Ambiguous failures retain this request key for safe retries.
  const session = await createBachsSession({
      key,
      amountMinor,
      buyerEmail: user.email,
      orderId: attemptId,
      idempotencyKey,
      successUrl,
      cancelUrl,
    }, mode)
  if (previous?.checkout_id && previous.checkout_id !== session.checkoutId) throw new HttpError(503,'Provider checkout identity changed; reconciliation required.')

  await db.prepare(
    "UPDATE wallet_funding_attempts SET checkout_id=?, status='open', updated_at=? WHERE id=? AND status IN ('initiating','open')"
  ).bind(session.checkoutId, Date.now(), attemptId).run()

  return json({
    ok: true,
    attemptId,
    reference,
    checkoutId: session.checkoutId,
    checkoutUrl: session.checkoutUrl,
    amountMinor,
    feeMinor,
    creditedMinor,
    amount: amountMinor / 100,
    creditedAmount: creditedMinor / 100,
  })
}

/**
 * Reconciles a pending wallet funding attempt with Bachs.
 * Ensures strict idempotency and append-only ledger transaction recording.
 */
export async function reconcileWalletFundingAttempt(
  env: ApiEnv,
  attempt: FundingAttemptRecord,
  eventId = '',
  eventType = '',
  verifiedSession?: Record<string, unknown>
) {
  const db = env.DB!
  const now = Date.now()
  const key = env.BACHS_API_KEY?.trim() ?? ''
  const mode = fundingMode(env)
  if (attempt.provider_mode !== mode) throw new HttpError(503, 'Payment environment mismatch.')

  if (!attempt.checkout_id) return { status: attempt.status }

  const session = verifiedSession ?? await getBachsSession(key, attempt.checkout_id)
  const sessionId = (session.checkout_id ?? session.id) as string
  const sessionAmount = parseNGNMinor(session.amount)
  const matches = sessionId === attempt.checkout_id &&
    (session.reference === attempt.id || session.reference === attempt.reference) &&
    session.currency === 'NGN' &&
    sessionAmount === attempt.amount_minor

  const paid = matches && checkedPaidSandboxSession(session, attempt.checkout_id) &&
    Number.isSafeInteger(attempt.credited_minor) && attempt.credited_minor > 0 &&
    attempt.amount_minor === attempt.fee_minor + attempt.credited_minor
  const terminal = matches && ['expired', 'cancelled'].includes(String(session.status))

  if (eventType.startsWith('refund.') || eventType.startsWith('dispute.') || ['refunded','partially_refunded'].includes(String(session.payment_status))) {
    // Never interpret a refund as a new credit. Freeze spending until authoritative reversal review.
    await db.prepare("UPDATE wallets SET status='frozen',updated_at=? WHERE id=? AND status='active'").bind(now,attempt.wallet_id).run()
    if (eventId) await db.prepare("UPDATE bachs_webhook_events SET processing_status='needs_review',processed_at=? WHERE event_id=?").bind(now,eventId).run()
    return {status:'needs_review'}
  }
  if (paid) {
    const existing = await db.prepare("SELECT id FROM wallet_transactions WHERE funding_attempt_id=? AND type='funding' AND status='completed'").bind(attempt.id).first()
    if (!existing) {
      const wallet = await db.prepare('SELECT id, customer_id, balance_minor, status FROM wallets WHERE id=?').bind(attempt.wallet_id).first<WalletRecord>()
      if (!wallet || wallet.customer_id !== attempt.customer_id || wallet.status !== 'active') throw new HttpError(409, 'Confirmed deposit awaits an active matching wallet. Retry reconciliation after review.')
      const after = wallet.balance_minor + attempt.credited_minor
      if (!Number.isSafeInteger(after)) throw new HttpError(409, 'Wallet balance limit exceeded.')
      // The CHECK constraint on balance_after_minor aborts the entire batch if either CAS misses.
      const writes = [
        db.prepare("UPDATE wallet_funding_attempts SET status='paid',updated_at=? WHERE id=? AND status IN ('initiating','open') AND EXISTS(SELECT 1 FROM wallets WHERE id=? AND customer_id=? AND status='active' AND balance_minor=?)").bind(now, attempt.id, wallet.id, attempt.customer_id, wallet.balance_minor),
        db.prepare("UPDATE wallets SET balance_minor=?,updated_at=? WHERE id=? AND status='active' AND balance_minor=? AND changes()=1").bind(after, now, wallet.id, wallet.balance_minor),
        db.prepare(`INSERT INTO wallet_transactions(id,wallet_id,customer_id,reference,type,direction,amount_minor,balance_before_minor,balance_after_minor,status,funding_attempt_id,reason,created_at)
          VALUES(?,?,?,?,'funding','credit',?,?,CASE WHEN changes()=1 THEN ? ELSE -1 END,'completed',?,'Wallet funding via Bachs',?)`).bind(crypto.randomUUID(),wallet.id,attempt.customer_id,'TX-FND-'+attempt.id,attempt.credited_minor,wallet.balance_minor,after,attempt.id,now),
      ]
      const hasMail = Boolean(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_mail_events'").first())
      if (hasMail) writes.push(db.prepare("INSERT INTO business_mail_events(id,kind,user_id,created_at) VALUES(?,'wallet_funded',?,?) ON CONFLICT(id) DO NOTHING").bind(attempt.id+':wallet_funded',attempt.customer_id,now))
      try { await db.batch(writes) } catch { throw new HttpError(409, 'Deposit remains recoverable. Retry reconciliation after concurrent wallet activity.') }
      if (hasMail) {
        await drainBusinessMail(env).catch(() => undefined)
        await drainMail(env).catch(() => undefined)
      }
    }

    if (eventId) {
      await db.prepare("UPDATE bachs_webhook_events SET processing_status='processed', processed_at=? WHERE event_id=?").bind(now, eventId).run()
    }
    return { status: 'paid' }
  } else if (terminal) {
    await db.prepare("UPDATE wallet_funding_attempts SET status='failed', updated_at=? WHERE id=? AND status IN ('initiating', 'open')").bind(now, attempt.id).run()
    if (eventId) {
      await db.prepare("UPDATE bachs_webhook_events SET processing_status='processed', processed_at=? WHERE event_id=?").bind(now, eventId).run()
    }
    return { status: 'failed' }
  } else {
    if (eventId) {
      await db.prepare("UPDATE bachs_webhook_events SET processing_status='needs_review', processed_at=? WHERE event_id=?").bind(now, eventId).run()
    }
    return { status: attempt.status }
  }
}

/**
 * Executes an atomic "Pay with Wallet" order checkout.
 * Enforces sufficient-funds constraint, deduces balance atomically, creates paid order,
 * writes ledger entry, and triggers immediate automated fulfillment.
 */
export async function payOrderWithWallet(
  request: Request,
  env: ApiEnv,
  user: { id: string; email: string; name?: string }
) {
  if (request.method !== 'POST') throw new HttpError(405, 'POST required.')
  const db = env.DB!

  let body: { requestId?: string; items?: Array<{ id: string; quantity: number }> }
  try {
    body = await request.json()
  } catch {
    throw new HttpError(400, 'Invalid JSON body.')
  }

  const { requestId, items } = body
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

  if (!requestId || !uuidRegex.test(requestId) || !items || !Array.isArray(items) || !items.length || items.length > 20) {
    throw new HttpError(400, 'Invalid order request or item selection.')
  }

  for (const item of items) {
    if (!item || !uuidRegex.test(item.id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 1000) {
      throw new HttpError(400, 'Invalid item specification.')
    }
  }

  if (new Set(items.map(i => i.id)).size !== items.length) {
    throw new HttpError(400, 'Duplicate product IDs in checkout.')
  }

  const txRef = 'TX-ORD-' + user.id + '-' + requestId
  const priorOrder = async () => {
    const prior = await db.prepare("SELECT o.id,o.reference,o.total_minor,t.balance_after_minor FROM wallet_transactions t JOIN orders o ON o.id=t.order_id WHERE t.reference=? AND t.customer_id=? AND t.type='purchase' AND t.status='completed' AND o.payment_status='paid'").bind(txRef,user.id).first<{id:string;reference:string;total_minor:number;balance_after_minor:number}>()
    if (!prior) return null
    const saved = await db.prepare('SELECT product_id AS id,quantity FROM order_items WHERE order_id=? ORDER BY product_id').bind(prior.id).all<{id:string;quantity:number}>()
    const canonical = (list: Array<{id:string;quantity:number}>) => JSON.stringify([...list].sort((a,b)=>a.id.localeCompare(b.id)).map(i=>[i.id,i.quantity]))
    if (canonical(items) !== canonical(saved.results)) throw new HttpError(409,'Idempotency request does not match the original wallet order.')
    return json({ok:true,orderId:prior.id,reference:prior.reference,totalMinor:prior.total_minor,balanceAfterMinor:prior.balance_after_minor,paymentMethod:'wallet'})
  }
  const previous = await priorOrder()
  if (previous) return previous

  // Check if wallet is active and available
  const wallet = await getOrCreateWallet(db, user.id)
  if (wallet.status !== 'active') {
    throw new HttpError(403, 'Your wallet is currently frozen or restricted. Please contact support.')
  }

  // Fetch real-time products from storefront
  const itemIds = items.map(i => i.id)
  const rows = await db.prepare(
    `SELECT p.id, p.name, p.price_minor, p.currency, p.available_quantity, c.name AS category_name
     FROM storefront_products p
     JOIN categories c ON c.id = p.category_id
     WHERE p.id IN (${itemIds.map(() => '?').join(',')})`
  ).bind(...itemIds).all<{ id: string; name: string; price_minor: number; currency: string; available_quantity: number; category_name: string }>()

  if (rows.results.length !== items.length) {
    throw new HttpError(409, 'One or more selected products are no longer available in the catalog.')
  }

  for (const item of items) {
    const product = rows.results.find(p => p.id === item.id)!
    if (product.currency !== 'NGN' || product.price_minor <= 0) {
      throw new HttpError(409, `Invalid pricing configuration for ${product.name}.`)
    }
    if (product.available_quantity < item.quantity) {
      throw new HttpError(409, `Insufficient stock for "${product.name}". Only ${product.available_quantity} available.`)
    }
  }

  // Calculate order total
  const totalMinor = items.reduce((sum, item) => {
    const product = rows.results.find(p => p.id === item.id)!
    return sum + product.price_minor * item.quantity
  }, 0)

  if (!Number.isSafeInteger(totalMinor)) throw new HttpError(409, 'Invalid order total.')
  if (wallet.balance_minor < totalMinor) {
    const needed = (totalMinor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })
    const available = (wallet.balance_minor / 100).toLocaleString('en-NG', { minimumFractionDigits: 2 })
    throw new HttpError(400, `Insufficient wallet balance. Total: ₦${needed}, Available: ₦${available}. Please fund your wallet.`)
  }

  // Enforce automation quotes and supplier resale policies
  await assertAutomationQuotes(env, itemIds)

  const orderId = crypto.randomUUID()
  const orderRef = 'LP-' + orderId
  const txId = crypto.randomUUID()
  const now = Date.now()
  const balanceBefore = wallet.balance_minor
  const balanceAfter = balanceBefore - totalMinor

  const hasMail = Boolean(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_mail_events'").first())
  const statements: Statement[] = [
    db.prepare(`INSERT INTO orders(id,customer_id,reference,payment_status,fulfillment_status,total_minor,currency,payment_method)
      VALUES(?,?,?,'pending','pending',?,'NGN','wallet')`).bind(orderId,user.id,orderRef,totalMinor),
    db.prepare("UPDATE wallets SET balance_minor=?,updated_at=? WHERE id=? AND status='active' AND balance_minor=? AND balance_minor>=?").bind(balanceAfter,now,wallet.id,balanceBefore,totalMinor),
    db.prepare(`INSERT INTO wallet_transactions(id,wallet_id,customer_id,reference,type,direction,amount_minor,balance_before_minor,balance_after_minor,status,order_id,reason,created_at)
      VALUES(?,?,?,?,'purchase','debit',?,?,CASE WHEN changes()=1 THEN ? ELSE -1 END,'completed',?,?,?)`).bind(txId,wallet.id,user.id,txRef,totalMinor,balanceBefore,balanceAfter,orderId,`Wallet purchase: ${items.length} item(s)`,now),
  ]

  if (hasMail) {
    statements.push(
      db.prepare("INSERT INTO business_mail_events (id, kind, user_id, created_at) VALUES (?, 'wallet_payment', ?, ?) ON CONFLICT(id) DO NOTHING").bind(orderId + ':wallet_payment', user.id, now),
      db.prepare("INSERT INTO business_mail_events (id, kind, user_id, created_at) VALUES (?, 'purchase_success', ?, ?) ON CONFLICT(id) DO NOTHING").bind(orderId + ':purchase_success', user.id, now)
    )
  }

  for (const item of items) {
    const product = rows.results.find(p => p.id === item.id)!
    const itemId = crypto.randomUUID()
    statements.push(
      db.prepare(
        `INSERT INTO order_items (id, order_id, product_id, product_name, category_name, quantity, unit_price_minor)
         VALUES (?, ?, ?, ?, ?, CASE WHEN EXISTS(SELECT 1 FROM storefront_products p WHERE p.id=? AND p.currency='NGN' AND p.price_minor=? AND p.available_quantity>=?+
           COALESCE((SELECT sum(r.quantity) FROM bachs_reservations r WHERE r.product_id=p.id AND r.state IN ('held','consumed')),0)+
           COALESCE((SELECT sum(i.quantity) FROM order_items i JOIN orders o ON o.id=i.order_id JOIN wallet_transactions t ON t.order_id=o.id AND t.type='purchase' AND t.status='completed' WHERE i.product_id=p.id AND o.payment_method='wallet' AND o.payment_status='paid'),0)) THEN ? ELSE 0 END, ?)`
      ).bind(itemId,orderId,product.id,product.name,product.category_name,product.id,product.price_minor,item.quantity,item.quantity,product.price_minor)
    )
    statements.push(
      db.prepare(
        `INSERT OR IGNORE INTO fulfillment_jobs (order_item_id, order_id, request_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).bind(itemId, orderId, 'delivery_' + itemId, now, now)
    )
  }

  statements.push(db.prepare("UPDATE orders SET payment_status='paid',updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND payment_status='pending'").bind(orderId))
  try {
    await db.batch(statements)
  } catch {
    const concurrent = await priorOrder()
    if (concurrent) return concurrent
    throw new HttpError(409, 'Wallet checkout failed due to concurrent balance change or stock movement. No funds were debited.')
  }

  // Trigger automated fulfillment immediately
  if (env.AUTO_FULFILLMENT_ENABLED === 'true') {
    await runFulfillment(env, orderId).catch(() => undefined)
    if (hasMail) {
      await drainBusinessMail(env).catch(() => undefined)
      await drainMail(env).catch(() => undefined)
    }
  }

  return json({
    ok: true,
    orderId,
    reference: orderRef,
    totalMinor,
    total: totalMinor / 100,
    balanceAfterMinor: balanceAfter,
    balanceAfter: balanceAfter / 100,
    paymentMethod: 'wallet',
  }, 201)
}

/**
 * Admin view: List customer wallets, total system liability, and audit histories.
 */
export async function adminGetWallets(request: Request, env: ApiEnv) {
  await adminActor(request, env)
  const db = env.DB!
  const url = new URL(request.url)
  const query = (url.searchParams.get('q') ?? '').trim()
  const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10))
  const limit = 50
  const offset = (page - 1) * limit

  // Calculate total system liabilities (sum of all customer balances)
  const stats = await db.prepare(
    `SELECT COALESCE(sum(balance_minor), 0) AS total_liabilities_minor,
            count(*) AS total_wallets,
            sum(CASE WHEN status='frozen' THEN 1 ELSE 0 END) AS frozen_wallets
     FROM wallets`
  ).first<{ total_liabilities_minor: number; total_wallets: number; frozen_wallets: number }>()

  let sql = `
    SELECT w.id, w.customer_id, w.currency, w.balance_minor, w.status, w.created_at, w.updated_at,
           COALESCE(u.email, 'unknown') AS email,
           COALESCE(p.full_name, u.name, 'Customer') AS customer_name,
           (SELECT count(*) FROM wallet_transactions WHERE wallet_id = w.id) AS transaction_count,
           (SELECT count(*) FROM orders WHERE customer_id = w.customer_id AND payment_method = 'wallet' AND payment_status = 'paid') AS wallet_orders_count
    FROM wallets w
    LEFT JOIN auth_user u ON u.id = w.customer_id
    LEFT JOIN profiles p ON p.id = w.customer_id
  `
  const params: (string | number)[] = []

  if (query) {
    sql += ` WHERE instr(lower(u.email), lower(?)) > 0 OR instr(lower(w.customer_id), lower(?)) > 0 OR instr(lower(p.full_name), lower(?)) > 0`
    params.push(query, query, query)
  }

  sql += ` ORDER BY w.balance_minor DESC, w.updated_at DESC LIMIT ? OFFSET ?`
  params.push(limit, offset)

  const wallets = await db.prepare(sql).bind(...params).all<WalletRecord & {email:string;customer_name:string;transaction_count:number;wallet_orders_count:number}>()

  // Recent transactions ledger
  const recentTransactions = await db.prepare(
    `SELECT t.id, t.wallet_id, t.customer_id, t.reference, t.type, t.direction, t.amount_minor,
            t.balance_before_minor, t.balance_after_minor, t.status, t.order_id, t.reason, t.created_at,
            COALESCE(u.email, 'unknown') AS customer_email
     FROM wallet_transactions t
     LEFT JOIN auth_user u ON u.id = t.customer_id
     ORDER BY t.created_at DESC LIMIT 50`
  ).all<WalletTransactionRecord & {customer_email:string}>()

  return json({
    stats: {
      total_liabilities_minor: stats?.total_liabilities_minor ?? 0,
      total_liabilities: (stats?.total_liabilities_minor ?? 0) / 100,
      total_wallets: stats?.total_wallets ?? 0,
      frozen_wallets: stats?.frozen_wallets ?? 0,
    },
    wallets: wallets.results.map((w) => ({
      ...w,
      balance: w.balance_minor / 100,
    })),
    recent_transactions: recentTransactions.results.map((t) => ({
      ...t,
      amount: t.amount_minor / 100,
      balance_before: t.balance_before_minor / 100,
      balance_after: t.balance_after_minor / 100,
    })),
  })
}

/**
 * Admin action: Freeze or unfreeze a customer's wallet with mandatory reason and audit log.
 */
export async function adminFreezeWallet(request: Request, env: ApiEnv) {
  const actor = await adminActor(request, env)
  if (request.method !== 'POST') throw new HttpError(405, 'POST required.')
  const db = env.DB!

  const body = await request.json() as { customerId?: string; freeze?: boolean; reason?: string }
  const { customerId, freeze, reason } = body

  if (!customerId || typeof freeze !== 'boolean' || !reason || reason.trim().length < 5 || reason.trim().length > 1000) {
    throw new HttpError(400, 'Customer ID, boolean freeze flag, and detailed justification reason (min 5 chars) required.')
  }

  const wallet = await db.prepare('SELECT id, status FROM wallets WHERE customer_id = ?').bind(customerId).first<{ id: string; status: string }>()
  if (!wallet) throw new HttpError(404, 'Wallet not found for this customer.')

  if (wallet.status === 'closed') throw new HttpError(409, 'Closed wallets cannot be reopened by a freeze action.')
  const newStatus = freeze ? 'frozen' : 'active'
  const now = Date.now()
  const auditId = crypto.randomUUID()

  await db.batch([
    db.prepare('UPDATE wallets SET status = ?, updated_at = ? WHERE id = ?').bind(newStatus, now, wallet.id),
    db.prepare(
      "INSERT INTO audit_logs (id, actor_id, table_name, record_id, action, created_at) VALUES (?, ?, 'wallets', ?, 'UPDATE', strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
    ).bind(auditId, actor.id, wallet.id),
    db.prepare('INSERT INTO wallet_admin_actions(id,actor_id,wallet_id,action,reason,created_at) VALUES(?,?,?,?,?,?)').bind(auditId,actor.id,wallet.id,freeze?'freeze':'unfreeze',reason.trim(),now),
  ])

  return json({ ok: true, walletId: wallet.id, customerId, status: newStatus })
}

/**
 * Admin action: Authorized adjustment (credit or debit) with strict audit trail.
 */
export async function adminAdjustWallet(request: Request, env: ApiEnv) {
  const actor = await adminActor(request, env)
  if (request.method !== 'POST') throw new HttpError(405, 'POST required.')
  const db = env.DB!

  const body = await request.json() as { customerId?: string; direction?: 'credit' | 'debit'; amountMinor?: number; reason?: string }
  const { customerId, direction, amountMinor, reason } = body

  if (!customerId || !direction || !['credit', 'debit'].includes(direction) || !amountMinor || !Number.isSafeInteger(amountMinor) || amountMinor <= 0 || !reason || reason.trim().length < 5 || reason.trim().length > 1000) {
    throw new HttpError(400, 'Valid customer ID, direction (credit/debit), positive integer amountMinor, and detailed audit reason required.')
  }

  const wallet = await db.prepare('SELECT id, balance_minor, status FROM wallets WHERE customer_id = ?').bind(customerId).first<WalletRecord>()
  if (!wallet) throw new HttpError(404, 'Wallet not found.')
  if (wallet.status !== 'active') throw new HttpError(403, 'Cannot adjust a frozen or closed wallet.')

  if (direction === 'debit' && wallet.balance_minor < amountMinor) {
    throw new HttpError(400, `Cannot debit more than available balance. Current balance: ₦${wallet.balance_minor / 100}.`)
  }

  const now = Date.now()
  const balanceBefore = wallet.balance_minor
  const balanceAfter = direction === 'credit' ? balanceBefore + amountMinor : balanceBefore - amountMinor
  if (!Number.isSafeInteger(balanceAfter)) throw new HttpError(400, 'Wallet balance limit exceeded.')
  const txId = crypto.randomUUID()
  const txRef = 'TX-ADJ-' + Date.now().toString(36).toUpperCase() + '-' + crypto.randomUUID().slice(0, 6).toUpperCase()
  const auditId = crypto.randomUUID()

  const hasMail = Boolean(await db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='business_mail_events'").first().catch(() => null))
  const statements: Statement[] = [
    direction === 'credit'
      ? db.prepare("UPDATE wallets SET balance_minor = balance_minor + ?, updated_at = ? WHERE id = ? AND status = 'active' AND balance_minor=?").bind(amountMinor, now, wallet.id, balanceBefore)
      : db.prepare("UPDATE wallets SET balance_minor = balance_minor - ?, updated_at = ? WHERE id = ? AND status = 'active' AND balance_minor >= ? AND balance_minor=?").bind(amountMinor, now, wallet.id, amountMinor, balanceBefore),
    db.prepare(
      `INSERT INTO wallet_transactions (id, wallet_id, customer_id, reference, type, direction, amount_minor, balance_before_minor, balance_after_minor, status, actor_id, reason, created_at)
       VALUES (?, ?, ?, ?, 'admin_adjustment', ?, ?, ?, CASE WHEN changes()=1 THEN ? ELSE -1 END, 'completed', ?, ?, ?)`
    ).bind(txId, wallet.id, customerId, txRef, direction, amountMinor, balanceBefore, balanceAfter, actor.id, reason.trim(), now),
    db.prepare(
      "INSERT INTO audit_logs (id, actor_id, table_name, record_id, action, created_at) VALUES (?, ?, 'wallets', ?, 'UPDATE', strftime('%Y-%m-%dT%H:%M:%fZ','now'))"
    ).bind(auditId, actor.id, wallet.id),
    db.prepare('INSERT INTO wallet_admin_actions(id,actor_id,wallet_id,action,amount_minor,reason,created_at) VALUES(?,?,?,?,?,?,?)').bind(auditId,actor.id,wallet.id,direction,amountMinor,reason.trim(),now),
  ]

  if (hasMail) {
    statements.push(
      db.prepare("INSERT INTO business_mail_events (id, kind, user_id, created_at) VALUES (?, 'wallet_adjustment', ?, ?) ON CONFLICT(id) DO NOTHING").bind(txId + ':wallet_adjustment', customerId, now)
    )
  }

  await db.batch(statements)

  if (hasMail) {
    await drainBusinessMail(env).catch(() => undefined)
    await drainMail(env).catch(() => undefined)
  }

  return json({
    ok: true,
    txId,
    txRef,
    direction,
    amountMinor,
    balanceBeforeMinor: balanceBefore,
    balanceAfterMinor: balanceAfter,
    balance: balanceAfter / 100,
  })
}
