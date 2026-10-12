-- Read-only verification. Run only against the isolated staging binding.
SELECT key,value FROM migration_metadata ORDER BY key;
PRAGMA foreign_key_check;
PRAGMA quick_check;
SELECT (SELECT count(*) FROM users) AS users,
       (SELECT count(*) FROM profiles) AS profiles,
       (SELECT count(*) FROM categories) AS categories,
       (SELECT count(*) FROM products) AS products,
       (SELECT count(*) FROM inventory) AS inventory,
       (SELECT count(*) FROM orders) AS orders;
SELECT p.id,p.price_minor,typeof(p.price_minor) AS price_type,i.available_quantity AS stored_stock,s.available_quantity AS sellable_stock
FROM products p JOIN inventory i ON i.product_id=p.id LEFT JOIN staging_storefront_products s ON s.id=p.id;
