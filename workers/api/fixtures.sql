-- SYNTHETIC STAGING ONLY. These are not customer accounts, approvals or real orders.
INSERT INTO users(id) VALUES('10000000-0000-4000-8000-000000000001'),('10000000-0000-4000-8000-000000000002') ON CONFLICT DO NOTHING;
INSERT INTO profiles(id,full_name) VALUES('10000000-0000-4000-8000-000000000001','Synthetic Customer A'),('10000000-0000-4000-8000-000000000002','Synthetic Customer B') ON CONFLICT DO NOTHING;
INSERT INTO user_roles(user_id,role) VALUES('10000000-0000-4000-8000-000000000001','customer'),('10000000-0000-4000-8000-000000000002','customer') ON CONFLICT DO NOTHING;
INSERT INTO categories(id,slug,name,short_name) VALUES('20000000-0000-4000-8000-000000000001','synthetic-staging','Synthetic staging category','Synthetic') ON CONFLICT DO NOTHING;
INSERT INTO products(id,category_id,slug,name,description,price_minor,supplier_name,authorized_resale,status,delivery_type,publication_verified)
VALUES('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','synthetic-product','SAMPLE — not for sale','Synthetic fixture. No supplier, purchase or delivery.',12345,'Synthetic fixture',1,'active','Manual fulfillment',1) ON CONFLICT DO NOTHING;
-- Fixture stock is deliberately unverified, and cannot be purchased or published.
INSERT INTO inventory(product_id,available_quantity) VALUES('30000000-0000-4000-8000-000000000001',7) ON CONFLICT DO NOTHING;
INSERT INTO orders(id,customer_id,reference,total_minor) VALUES('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','SAMPLE-ORDER-A',12345),('40000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002','SAMPLE-ORDER-B',67890) ON CONFLICT DO NOTHING;
