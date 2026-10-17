import test from 'node:test'
import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync } from 'node:fs'

const schema = readFileSync(new URL('../workers/api/migrations/0010_bachs_payment_foundation.sql', import.meta.url), 'utf8')
const foundation = readFileSync(new URL('../workers/api/migrations/0001_staging_foundation.sql', import.meta.url), 'utf8')

test('D1 Bachs ledger migration is additive, preserves existing orders, and enforces unique idempotency', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec('PRAGMA foreign_keys=ON')
    db.exec(foundation)
    const user='00000000-0000-4000-8000-000000000001'
    const order='00000000-0000-4000-8000-000000000002'
    const attempt='00000000-0000-4000-8000-000000000003'
    db.prepare('INSERT INTO users(id) VALUES(?)').run(user)
    db.prepare('INSERT INTO orders(id,customer_id,reference,total_minor) VALUES(?,?,?,?)').run(order,user,'synthetic-order-1',250000)
    const before = db.prepare('SELECT * FROM orders').all()
    db.exec(schema)
    assert.deepEqual(db.prepare('SELECT * FROM orders').all(),before)
    const insert=db.prepare(`INSERT INTO bachs_payment_attempts(id,order_id,customer_id,client_request_id,idempotency_key,provider_mode,amount_minor,created_at,updated_at) VALUES(?,?,?,?,?,'sandbox',?,?,?)`)
    insert.run(attempt,order,user,'00000000-0000-4000-8000-000000000004','unique-synthetic-idempotency-1',250000,42,42)
    assert.throws(()=>insert.run('00000000-0000-4000-8000-000000000005',order,user,'00000000-0000-4000-8000-000000000004','another-unique-idempotency',250000,42,42), /UNIQUE/)
    assert.throws(()=>insert.run('00000000-0000-4000-8000-000000000006',order,user,'00000000-0000-4000-8000-000000000007','unique-synthetic-idempotency-1',250000,42,42), /UNIQUE/)
    assert.throws(()=>insert.run('00000000-0000-4000-8000-000000000008',order,user,'00000000-0000-4000-8000-000000000009','negative-price-test-1',-1,42,42), /CHECK/)
    db.prepare('INSERT INTO bachs_reservations(attempt_id,product_id,quantity,expires_at,created_at) VALUES(?,?,?,?,?)')
    db.prepare("INSERT INTO bachs_webhook_events(event_id,event_type,attempt_id,received_at) VALUES('evt_synthetic_1','collection.succeeded',?,?)").run(attempt,43)
    assert.throws(()=>db.prepare("INSERT INTO bachs_webhook_events(event_id,event_type,attempt_id,received_at) VALUES('evt_synthetic_1','collection.succeeded',?,?)").run(attempt,44), /UNIQUE/)
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length,0)
    assert.equal(db.prepare('SELECT count(*) AS n FROM bachs_payment_attempts').get()!.n,1)
    assert.equal(db.prepare('SELECT count(*) AS n FROM bachs_webhook_events').get()!.n,1)
  } finally { db.close() }
})
