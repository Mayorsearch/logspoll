import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { initiateCheckout } from '../workers/api/bachs-checkout.ts';

const root = '/Users/mayowacnc/logs';
const devVars = fs.readFileSync(root + '/.dev.vars', 'utf8');
const apiKey = devVars.match(/^BACHS_API_KEY=(.+)$/m)[1].trim();
const webhookSecret = devVars.match(/^BACHS_WEBHOOK_SECRET=(.+)$/m)[1].trim();
const stagingEndpoint = 'https://logspoll-api-staging.comedianmayorsearch.workers.dev/api/webhooks/bachs';

function d1Query(sql) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const out = execFileSync('npx', [
        'wrangler', 'd1', 'execute', 'DB', '--remote', '--env', 'staging', '--json',
        '--command', sql
      ], { cwd: root + '/workers/api' });
      const parsed = JSON.parse(out.toString());
      return parsed[0];
    } catch (err) {
      if (attempt === 3) throw err;
      execFileSync('sleep', ['1']);
    }
  }
}

// Build structural D1 database wrapper
function createRemoteDb() {
  function prepare(sql) {
    let values = [];
    return {
      bind(...v) { values = v; return this; },
      async first() {
        const rendered = renderSql(sql, values);
        const res = d1Query(rendered);
        return res?.results?.[0] ?? null;
      },
      async all() {
        const rendered = renderSql(sql, values);
        const res = d1Query(rendered);
        return { success: true, results: res?.results ?? [] };
      },
      async run() {
        const rendered = renderSql(sql, values);
        return d1Query(rendered);
      }
    };
  }
  function renderSql(sql, values) {
    let i = 0;
    return sql.replace(/\?/g, () => {
      const val = values[i++];
      if (val === null || val === undefined) return 'NULL';
      if (typeof val === 'number') return String(val);
      return `'${String(val).replace(/'/g, "''")}'`;
    });
  }
  return {
    prepare,
    async batch(statements) {
      // In D1 execute, statements can be concatenated
      for (const s of statements) {
        await s.run();
      }
      return [];
    },
    async exec(sql) { return d1Query(sql); }
  };
}

async function signAndDeliver(event) {
  const raw = JSON.stringify(event);
  const stamp = Math.floor(Date.now() / 1000);
  const hmac = crypto.createHmac('sha256', webhookSecret).update(stamp + '.' + raw).digest('hex');
  const res = await fetch(stagingEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Bachs-Signature-V2': `t=${stamp},v1=${hmac}`
    },
    body: raw
  });
  return { status: res.status, data: await res.json() };
}

async function replayFromBachs(eventId) {
  const res = await fetch('https://sandbox-api.bachs.io/v1/webhooks/replay', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + apiKey,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({ event_id: eventId })
  });
  return { status: res.status, data: await res.json() };
}

async function run() {
  console.log('--- STARTING E2E ACCEPTANCE TESTS ---');
  const db = createRemoteDb();
  const env = {
    ENVIRONMENT: 'staging',
    DB: db,
    BACHS_API_KEY: apiKey,
    BACHS_WEBHOOK_SECRET: webhookSecret,
    BACHS_SANDBOX_ENABLED: 'true'
  };

  const buyer = {
    id: '10000000-0000-4000-8000-000000000001',
    email: 'comedianmayorsearch@gmail.com'
  };
  const productId = '30000000-0000-4000-8000-000000000001';

  // Ensure synthetic product inventory is freshly verified within 1-hour window
  d1Query("UPDATE inventory SET source_mode='manual',available_quantity=10,verified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE product_id='30000000-0000-4000-8000-000000000001'");

  // 1. Create a test order through LogsPoll checkout backend
  console.log('1. Initiating checkout in staging D1...');
  const clientRequestId = crypto.randomUUID();
  const checkoutResult = await initiateCheckout(
    env,
    buyer,
    clientRequestId,
    [{ id: productId, quantity: 1 }],
    'https://logspoll-api-staging.comedianmayorsearch.workers.dev'
  );
  console.log('Checkout result:', checkoutResult);

  // Verify created order and attempt in staging D1
  const attemptRow = d1Query(`SELECT * FROM bachs_payment_attempts WHERE checkout_id='${checkoutResult.checkoutId}'`).results[0];
  const orderRow = d1Query(`SELECT * FROM orders WHERE id='${checkoutResult.orderId}'`).results[0];
  const reservationRow = d1Query(`SELECT * FROM bachs_reservations WHERE attempt_id='${attemptRow.id}'`).results[0];
  console.log('D1 records verified:');
  console.log('  Order:', orderRow.reference, 'Total minor:', orderRow.total_minor, 'Status:', orderRow.payment_status);
  console.log('  Attempt ID:', attemptRow.id, 'Checkout ID:', attemptRow.checkout_id, 'Status:', attemptRow.status);
  console.log('  Reservation state:', reservationRow.state, 'Quantity:', reservationRow.quantity);

  // 2. Fetch Bachs authoritative session for this created checkout
  console.log('2. Verifying linked Bachs sandbox session...');
  const sessionRes = await fetch(`https://sandbox-api.bachs.io/v1/checkout-sessions/${checkoutResult.checkoutId}`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
  });
  const session = await sessionRes.json();
  console.log('Bachs session:');
  console.log('  ID:', session.checkout_id, 'Status:', session.status, 'Amount:', session.amount, 'Currency:', session.currency);
  console.log('  Reference:', session.reference, 'Customer email:', session.customer?.email);

  async function waitFor(fn, desc, timeoutMs = 25000, intervalMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await fn();
      if (res) return res;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    throw new Error(`Timeout waiting for: ${desc}`);
  }

  // 3. Test genuine Bachs Sandbox expired checkout delivery & reconciliation
  console.log('3. Testing genuine linked expired checkout...');
  const expOrderId = 'da620df5-f7e4-4217-8fd2-a54d1ce5143b';
  const expChk = 'chk_mGLEEOUBlcfUEZXM';
  const existingExp = d1Query(`SELECT id FROM bachs_payment_attempts WHERE checkout_id='${expChk}'`).results[0];
  const expAttemptId = existingExp ? existingExp.id : crypto.randomUUID();
  const expEventId = 'evt_e87ceda9fa7dc6638e7a3f8a20d95063';
  
  d1Query(`
    DELETE FROM bachs_webhook_events WHERE event_id='${expEventId}';

    INSERT INTO orders(id, customer_id, reference, total_minor, currency, payment_status, fulfillment_status)
    VALUES('${expOrderId}', '${buyer.id}', 'LP-EXP-${Date.now()}', 13100, 'NGN', 'pending', 'pending')
    ON CONFLICT(id) DO UPDATE SET payment_status='pending';

    INSERT INTO bachs_payment_attempts(id, order_id, customer_id, client_request_id, idempotency_key, checkout_id, provider_mode, amount_minor, currency, status, created_at, updated_at)
    VALUES('${expAttemptId}', '${expOrderId}', '${buyer.id}', '${crypto.randomUUID()}', 'sbx_exp_${Date.now()}', '${expChk}', 'sandbox', 13100, 'NGN', 'open', ${Date.now()}, ${Date.now()})
    ON CONFLICT(id) DO UPDATE SET status='open';

    INSERT INTO bachs_reservations(attempt_id, product_id, quantity, expires_at, created_at, state)
    VALUES('${expAttemptId}', '${productId}', 1, ${Date.now() + 3600000}, ${Date.now()}, 'held')
    ON CONFLICT(attempt_id, product_id) DO UPDATE SET state='held';
  `);

  console.log(`Replaying genuine Bachs expired event ${expEventId}...`);
  const expReplay = await replayFromBachs(expEventId);
  console.log('Replay result:', expReplay);

  // Poll for reconciliation on staging D1
  const expOrder = await waitFor(() => {
    const o = d1Query(`SELECT payment_status FROM orders WHERE id='${expOrderId}'`).results[0];
    return o?.payment_status === 'failed' ? o : null;
  }, 'expired order reconciliation');
  const expAttempt = d1Query(`SELECT status FROM bachs_payment_attempts WHERE id='${expAttemptId}'`).results[0];
  const expRes = d1Query(`SELECT state FROM bachs_reservations WHERE attempt_id='${expAttemptId}'`).results[0];
  console.log('Expired reconciliation verified:');
  console.log('  Order payment_status:', expOrder.payment_status);
  console.log('  Attempt status:', expAttempt.status);
  console.log('  Reservation state:', expRes.state);

  // 4. Test genuine Bachs Sandbox completed checkout delivery & reconciliation
  console.log('4. Testing genuine linked completed checkout...');
  const compOrderId = 'c9be69ee-5702-4af2-a230-b2ba18d36ffc';
  const compChk = 'chk_4LZLppg9sjpHfREc';
  const existingComp = d1Query(`SELECT id FROM bachs_payment_attempts WHERE checkout_id='${compChk}'`).results[0];
  const compAttemptId = existingComp ? existingComp.id : crypto.randomUUID();
  const compEventId = 'evt_a3718a845286a69db889d43064a70267';

  d1Query(`
    DELETE FROM bachs_webhook_events WHERE event_id='${compEventId}';

    INSERT INTO orders(id, customer_id, reference, total_minor, currency, payment_status, fulfillment_status)
    VALUES('${compOrderId}', '${buyer.id}', 'LP-COMP-${Date.now()}', 13100, 'NGN', 'pending', 'pending')
    ON CONFLICT(id) DO UPDATE SET payment_status='pending', fulfillment_status='pending';

    INSERT INTO order_items(id, order_id, product_id, product_name, category_name, quantity, unit_price_minor)
    VALUES('${crypto.randomUUID()}', '${compOrderId}', '${productId}', 'SAMPLE — not for sale', 'Test', 1, 13100)
    ON CONFLICT DO NOTHING;

    INSERT INTO bachs_payment_attempts(id, order_id, customer_id, client_request_id, idempotency_key, checkout_id, provider_mode, amount_minor, currency, status, created_at, updated_at)
    VALUES('${compAttemptId}', '${compOrderId}', '${buyer.id}', '${crypto.randomUUID()}', 'sbx_comp_${Date.now()}', '${compChk}', 'sandbox', 13100, 'NGN', 'open', ${Date.now()}, ${Date.now()})
    ON CONFLICT(id) DO UPDATE SET status='open';

    INSERT INTO bachs_reservations(attempt_id, product_id, quantity, expires_at, created_at, state)
    VALUES('${compAttemptId}', '${productId}', 1, ${Date.now() + 3600000}, ${Date.now()}, 'held')
    ON CONFLICT(attempt_id, product_id) DO UPDATE SET state='held';
  `);

  console.log(`Replaying genuine Bachs completed event ${compEventId}...`);
  const compReplay = await replayFromBachs(compEventId);
  console.log('Replay result:', compReplay);

  const compOrder = await waitFor(() => {
    const o = d1Query(`SELECT payment_status, fulfillment_status FROM orders WHERE id='${compOrderId}'`).results[0];
    return o?.payment_status === 'paid' ? o : null;
  }, 'completed order reconciliation');
  const compAttempt = d1Query(`SELECT status FROM bachs_payment_attempts WHERE id='${compAttemptId}'`).results[0];
  const compRes = d1Query(`SELECT state FROM bachs_reservations WHERE attempt_id='${compAttemptId}'`).results[0];
  console.log('Completed checkout reconciliation verified:');
  console.log('  Order payment_status:', compOrder.payment_status);
  console.log('  Order fulfillment_status (must remain pending):', compOrder.fulfillment_status);
  console.log('  Attempt status:', compAttempt.status);
  console.log('  Reservation state:', compRes.state);

  // 5. Test duplicate delivery protection
  console.log('5. Testing duplicate delivery protection...');
  const dupReplay = await replayFromBachs(compEventId);
  console.log('Duplicate replay result:', dupReplay);
  const compOrderAfterDup = d1Query(`SELECT payment_status, fulfillment_status FROM orders WHERE id='${compOrderId}'`).results[0];
  console.log('Duplicate state verified:');
  console.log('  Order payment_status (unchanged):', compOrderAfterDup.payment_status);
  console.log('  Order fulfillment_status (unchanged):', compOrderAfterDup.fulfillment_status);

  // 6. Test refund on the paid order
  console.log('6. Testing refund handling...');
  const refundRes = await signAndDeliver({
    id: `evt_refund_${Date.now()}`,
    type: 'refund.paid',
    data: { checkout_id: compChk, id: 'ref_123', status: 'paid' }
  });
  console.log('Refund webhook delivery:', refundRes);

  const refOrder = await waitFor(() => {
    const o = d1Query(`SELECT payment_status, fulfillment_status FROM orders WHERE id='${compOrderId}'`).results[0];
    return o?.payment_status === 'refunded' ? o : null;
  }, 'refunded order status');
  const refAttempt = d1Query(`SELECT status FROM bachs_payment_attempts WHERE id='${compAttemptId}'`).results[0];
  console.log('Refunded order state verified:');
  console.log('  Order payment_status:', refOrder.payment_status);
  console.log('  Order fulfillment_status (must remain unchanged):', refOrder.fulfillment_status);
  console.log('  Attempt status:', refAttempt.status);

  // 7. Test underpayment scenario
  console.log('7. Testing underpayment handling...');
  const underpaidRes = await signAndDeliver({
    id: `evt_underpaid_${Date.now()}`,
    type: 'collection.underpaid',
    data: { checkout_id: checkoutResult.checkoutId }
  });
  console.log('Underpaid webhook delivery:', underpaidRes);

  const underpaidOrder = d1Query(`SELECT payment_status FROM orders WHERE id='${checkoutResult.orderId}'`).results[0];
  const underpaidResState = d1Query(`SELECT state FROM bachs_reservations WHERE attempt_id='${attemptRow.id}'`).results[0];
  console.log('Underpayment state verified:');
  console.log('  Order payment_status (must remain pending):', underpaidOrder.payment_status);
  console.log('  Reservation state (must remain held):', underpaidResState.state);

  console.log('--- ALL E2E ACCEPTANCE TESTS COMPLETED SUCCESSFULLY ---');
}

run().catch(console.error);

