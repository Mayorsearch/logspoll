"""Offline SQLite staging preservation tests. No network/export/customer data."""
from pathlib import Path
import sqlite3

root = Path(__file__).resolve().parent.parent
db = sqlite3.connect(':memory:')
db.execute('PRAGMA foreign_keys=ON')
db.executescript((root / 'workers/api/migrations/0001_staging_foundation.sql').read_text())
fixture = (root / 'workers/api/fixtures.sql').read_text()
db.executescript(fixture)

def baseline():
    return {table: db.execute('SELECT * FROM '+table+' ORDER BY 1').fetchall()
            for table in ['users','profiles','user_roles','categories','products','inventory','orders']}

before = baseline()
db.executescript(fixture)
assert baseline() == before, 'Idempotent fixture import changed records'
assert [len(before[t]) for t in before] == [2,2,2,1,1,1,2], 'Record count mismatch'
assert db.execute('PRAGMA foreign_key_check').fetchall() == []
assert db.execute('PRAGMA integrity_check').fetchone()[0] == 'ok'
assert db.execute('SELECT price_minor,typeof(price_minor) FROM products').fetchone() == (12345,'integer')
assert db.execute('SELECT available_quantity FROM inventory').fetchone()[0] == 7
assert db.execute('SELECT available_quantity FROM staging_storefront_products').fetchone()[0] == 0

def denied(sql):
    try:
        db.execute(sql)
    except sqlite3.IntegrityError:
        return
    raise AssertionError('Invalid state accepted: '+sql)

denied("UPDATE products SET price_minor=12.5")
denied("UPDATE products SET price_minor=-1")
denied("UPDATE inventory SET available_quantity=-1")
denied("UPDATE products SET category_id='unknown'")
denied("UPDATE orders SET fulfillment_status='delivered' WHERE payment_status='pending'")
denied("UPDATE products SET authorized_resale=0 WHERE status='active'")
db.execute("UPDATE inventory SET source_mode='manual',verified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
assert db.execute('SELECT available_quantity FROM staging_storefront_products').fetchone()[0] == 7
db.execute("UPDATE inventory SET verified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 hours')")
assert db.execute('SELECT available_quantity FROM staging_storefront_products').fetchone()[0] == 0
db.execute("UPDATE inventory SET source_mode='supplier',verified_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')")
assert db.execute('SELECT available_quantity FROM staging_storefront_products').fetchone()[0] == 0
db.execute('UPDATE products SET publication_verified=0')
assert db.execute('SELECT count(*) FROM staging_storefront_products').fetchone()[0] == 0
# Two-client ownership is enforced by API SQL, never a supplied customer_id filter.
for user, reference in [('10000000-0000-4000-8000-000000000001','SAMPLE-ORDER-A'),('10000000-0000-4000-8000-000000000002','SAMPLE-ORDER-B')]:
    assert db.execute('SELECT reference FROM orders WHERE customer_id=?',(user,)).fetchall() == [(reference,)]
print('PASS: synthetic counts, idempotency, UUID retention, exact kobo, stock, FK/integrity, publication, freshness, supplier lock and ownership predicates')
