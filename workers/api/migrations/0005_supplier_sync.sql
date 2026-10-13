-- Additive D1 catalog ingestion. Existing reviews, products and inventory stay intact.
ALTER TABLE staging_supplier_connections ADD COLUMN enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1));
ALTER TABLE staging_supplier_connections ADD COLUMN encrypted_key TEXT;
ALTER TABLE staging_supplier_connections ADD COLUMN key_nonce TEXT;
ALTER TABLE staging_supplier_connections ADD COLUMN authorized_products TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(authorized_products) AND json_type(authorized_products)='object');
ALTER TABLE staging_supplier_connections ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
ALTER TABLE staging_supplier_connections ADD COLUMN lease_owner TEXT;
ALTER TABLE staging_supplier_connections ADD COLUMN lease_until INTEGER;
ALTER TABLE staging_supplier_connections ADD COLUMN next_attempt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE staging_supplier_connections ADD COLUMN last_status TEXT NOT NULL DEFAULT 'Not synchronized';
ALTER TABLE staging_supplier_feed_items ADD COLUMN supplier_description TEXT NOT NULL DEFAULT '';
ALTER TABLE staging_supplier_feed_items ADD COLUMN supplier_image_urls TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(supplier_image_urls) AND json_type(supplier_image_urls)='array');
ALTER TABLE staging_supplier_feed_items ADD COLUMN supplier_category_id TEXT;
ALTER TABLE staging_supplier_feed_items ADD COLUMN supplier_subcategory_id TEXT;
ALTER TABLE staging_supplier_feed_items ADD COLUMN snapshot_id TEXT;

CREATE TABLE supplier_sync_jobs (
 id TEXT PRIMARY KEY NOT NULL,
 connection_id TEXT NOT NULL UNIQUE REFERENCES staging_supplier_connections(id),
 revision INTEGER NOT NULL,
 phase TEXT NOT NULL CHECK(phase IN ('categories','subcategories','listings','details','finalize','complete')),
 page INTEGER NOT NULL DEFAULT 1, subcategory_index INTEGER NOT NULL DEFAULT 0,
 categories TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(categories)),
 started_at INTEGER NOT NULL, scanned INTEGER NOT NULL DEFAULT 0,
 total INTEGER, last_page INTEGER, completed_at INTEGER,
 CHECK(total IS NULL OR total BETWEEN 0 AND 100000),
 CHECK(last_page IS NULL OR last_page BETWEEN 1 AND 1000)
) STRICT;
CREATE TABLE supplier_sync_seen (
 job_id TEXT NOT NULL REFERENCES supplier_sync_jobs(id) ON DELETE CASCADE,
 external_id TEXT NOT NULL, PRIMARY KEY(job_id,external_id)
) STRICT;
CREATE TABLE supplier_sync_items (
 job_id TEXT NOT NULL REFERENCES supplier_sync_jobs(id) ON DELETE CASCADE,
 external_id TEXT NOT NULL, metadata TEXT NOT NULL CHECK(json_valid(metadata)),
 detail_done INTEGER NOT NULL DEFAULT 0 CHECK(detail_done IN (0,1)),
 PRIMARY KEY(job_id,external_id)
) STRICT;
CREATE TABLE supplier_source_categories (
 connection_id TEXT NOT NULL REFERENCES staging_supplier_connections(id),
 kind TEXT NOT NULL CHECK(kind IN ('category','subcategory')),
 external_id TEXT NOT NULL, parent_id TEXT, slug TEXT NOT NULL, name TEXT NOT NULL,
 snapshot_id TEXT NOT NULL, PRIMARY KEY(connection_id,kind,external_id)
) STRICT;
CREATE TABLE supplier_sync_subcategories (
 job_id TEXT NOT NULL REFERENCES supplier_sync_jobs(id) ON DELETE CASCADE,
 external_id TEXT NOT NULL, parent_id TEXT NOT NULL, slug TEXT NOT NULL, name TEXT NOT NULL,
 PRIMARY KEY(job_id,external_id)
) STRICT;
-- A failed assertion rolls back the entire D1 batch, including all staged writes.
CREATE TABLE supplier_sync_fences (owner TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid=1)) STRICT;
