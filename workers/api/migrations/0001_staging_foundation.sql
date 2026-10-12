-- Isolated synthetic D1 ONLY. Not a complete PostgreSQL/RPC migration.
-- No production imports, password hashes, supplier credentials, or payment writes.
CREATE TABLE migration_metadata (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL) STRICT;
INSERT INTO migration_metadata VALUES ('dataset','synthetic-staging'),('schema_version','1');
CREATE TABLE users (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),
 status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','restricted')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE external_identities (
 issuer TEXT NOT NULL, subject TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 PRIMARY KEY(issuer,subject), UNIQUE(issuer,user_id)
) STRICT;
CREATE TABLE profiles (
 id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 full_name TEXT NOT NULL DEFAULT '' CHECK(length(full_name)<=120),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE user_roles (
 user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 role TEXT NOT NULL CHECK(role IN ('customer','admin')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE categories (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36), slug TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 120), short_name TEXT NOT NULL CHECK(length(short_name) BETWEEN 1 AND 120),
 description TEXT NOT NULL DEFAULT '' CHECK(length(description)<=2000), icon TEXT NOT NULL DEFAULT 'grid',color TEXT NOT NULL DEFAULT 'orange',sort_order INTEGER NOT NULL DEFAULT 0,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE products (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
 slug TEXT NOT NULL UNIQUE,name TEXT NOT NULL CHECK(length(name) BETWEEN 1 AND 200),brand TEXT NOT NULL DEFAULT '' CHECK(length(brand)<=120),
 description TEXT NOT NULL CHECK(length(description) BETWEEN 1 AND 10000),price_minor INTEGER NOT NULL CHECK(price_minor BETWEEN 0 AND 99999999900),
 currency TEXT NOT NULL DEFAULT 'NGN' CHECK(currency='NGN'),supplier_name TEXT NOT NULL CHECK(length(supplier_name) BETWEEN 1 AND 200),
 authorized_resale INTEGER NOT NULL DEFAULT 0 CHECK(authorized_resale IN (0,1)),status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','inactive')),
 delivery_type TEXT NOT NULL CHECK(delivery_type IN ('Licensed digital download','Redemption code','Subscription activation','Manual fulfillment')),
 image_path TEXT,term TEXT NOT NULL DEFAULT '',features TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(features) AND json_type(features)='array'),
 supplier_image_urls TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(supplier_image_urls) AND json_type(supplier_image_urls)='array'),featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0,1)),
 -- New independent staging publication gate. Never infer approval from imported status.
 publication_verified INTEGER NOT NULL DEFAULT 0 CHECK(publication_verified IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(status<>'active' OR authorized_resale=1)
) STRICT;
CREATE INDEX products_category_status ON products(category_id,status);
CREATE TABLE inventory (
 product_id TEXT PRIMARY KEY NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 available_quantity INTEGER NOT NULL DEFAULT 0 CHECK(available_quantity BETWEEN 0 AND 1000000),
 source_mode TEXT NOT NULL DEFAULT 'unverified' CHECK(source_mode IN ('manual','supplier','unverified')),verified_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE orders (
 id TEXT PRIMARY KEY NOT NULL CHECK(length(id)=36),customer_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 reference TEXT NOT NULL UNIQUE CHECK(length(reference) BETWEEN 1 AND 100),payment_status TEXT NOT NULL DEFAULT 'pending' CHECK(payment_status IN ('pending','paid','failed','refunded')),
 fulfillment_status TEXT NOT NULL DEFAULT 'pending' CHECK(fulfillment_status IN ('pending','processing','delivered')),
 total_minor INTEGER NOT NULL CHECK(total_minor BETWEEN 0 AND 99999999900),currency TEXT NOT NULL DEFAULT 'NGN' CHECK(currency='NGN'),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 CHECK(fulfillment_status<>'delivered' OR payment_status IN ('paid','refunded'))
) STRICT;
CREATE INDEX orders_customer_created ON orders(customer_id,created_at DESC);
CREATE TABLE order_items (
 id TEXT PRIMARY KEY NOT NULL,order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,product_id TEXT NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
 product_name TEXT NOT NULL CHECK(length(product_name) BETWEEN 1 AND 200),category_name TEXT NOT NULL CHECK(length(category_name) BETWEEN 1 AND 120),
 quantity INTEGER NOT NULL CHECK(quantity BETWEEN 1 AND 1000),unit_price_minor INTEGER NOT NULL CHECK(unit_price_minor BETWEEN 0 AND 99999999900),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(order_id,product_id)
) STRICT;
CREATE TABLE product_entitlements (
 id TEXT PRIMARY KEY NOT NULL,order_item_id TEXT NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
 instructions TEXT NOT NULL CHECK(length(instructions) BETWEEN 1 AND 20000),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE support_tickets (
 id TEXT PRIMARY KEY NOT NULL,user_id TEXT NOT NULL REFERENCES users(id),subject TEXT NOT NULL CHECK(length(trim(subject)) BETWEEN 1 AND 200),
 message TEXT NOT NULL CHECK(length(trim(message)) BETWEEN 10 AND 2000),status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved')),
 reply TEXT NOT NULL DEFAULT '' CHECK(length(reply)<=2000),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE reviews (
 id TEXT PRIMARY KEY NOT NULL,author_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,order_item_id TEXT NOT NULL UNIQUE REFERENCES order_items(id) ON DELETE CASCADE,
 display_name TEXT NOT NULL CHECK(length(trim(display_name)) BETWEEN 2 AND 80),rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5),
 message TEXT NOT NULL CHECK(length(trim(message)) BETWEEN 20 AND 2000),location TEXT NOT NULL DEFAULT '' CHECK(length(location)<=100),
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),reviewed_at TEXT
) STRICT;
CREATE TABLE notifications (
 id TEXT PRIMARY KEY NOT NULL,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 message TEXT NOT NULL CHECK(length(message) BETWEEN 1 AND 2000),order_id TEXT REFERENCES orders(id) ON DELETE CASCADE,read_at TEXT,
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),UNIQUE(user_id,order_id,title)
) STRICT;
CREATE TABLE website_settings (key TEXT PRIMARY KEY NOT NULL CHECK(key='general'),value TEXT NOT NULL CHECK(json_valid(value) AND json_type(value)='object')) STRICT;
CREATE TABLE audit_logs (
 id TEXT PRIMARY KEY NOT NULL,actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,table_name TEXT NOT NULL,record_id TEXT NOT NULL,action TEXT NOT NULL CHECK(action IN ('INSERT','UPDATE','DELETE')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
) STRICT;
CREATE TABLE request_limits (subject TEXT NOT NULL,window INTEGER NOT NULL,hits INTEGER NOT NULL CHECK(hits>0),PRIMARY KEY(subject,window)) STRICT;
-- Fail closed: supplier inventory cannot become sellable until the D1 sync port passes.
CREATE VIEW staging_storefront_products AS
 SELECT p.id,p.category_id,p.slug,p.name,p.brand,p.description,p.price_minor,p.currency,p.delivery_type,p.image_path,p.term,p.features,p.supplier_image_urls,p.featured,
 CASE WHEN i.source_mode='manual' AND julianday(i.verified_at)<=julianday('now') AND julianday(i.verified_at)>julianday('now','-1 hour') THEN i.available_quantity ELSE 0 END AS available_quantity
 FROM products p JOIN categories c ON c.id=p.category_id LEFT JOIN inventory i ON i.product_id=p.id
 WHERE p.status='active' AND p.authorized_resale=1 AND p.publication_verified=1 AND c.active=1;
