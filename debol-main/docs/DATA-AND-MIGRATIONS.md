# Data and migrations

## Flyway owns the schema

`backend/src/main/resources/application.yml`:

```yaml
spring:
  flyway:
    enabled: true
    baseline-on-migrate: false
    locations: classpath:db/migration
  jpa:
    open-in-view: false
    hibernate:
      ddl-auto: validate   # Flyway owns the schema; Hibernate only verifies mappings
```

Consequences:

- The only DDL that reaches the database is `backend/src/main/resources/db/migration/*.sql`.
  Hibernate will never create, alter or drop a table; if an entity and the schema disagree the
  application fails to start during `EntityManagerFactory` initialization.
- Migrations run **on application startup**. There is no Flyway Gradle plugin in
  `backend/build.gradle.kts` (only `flyway-core` + `flyway-database-postgresql` as runtime deps), so
  there is no `./gradlew flywayMigrate`. UNVERIFIED: any standalone Flyway CLI usage - it is not
  configured or documented anywhere in this repo.
- `baseline-on-migrate: false` means Flyway refuses to migrate a **non-empty** schema that has no
  `flyway_schema_history` table. Create empty databases and let the app fill them.

Applied files (verified by reading them and by the startup log in `data/backend.log`):

| File | Creates |
| --- | --- |
| `V1__baseline_schema.sql` | 26 tables + indexes + `order_number_seq` (PostgreSQL 14+ syntax, `TIMESTAMPTZ`, `NUMERIC(12,2)` money, `CHECK` constraints for every enum column) |
| `V2__configuration_and_sample_catalog.sql` | `store_settings` singleton (id 1), 5 delivery zones, 10 sample categories, 14 sample products, 38 sample variants, 3 sample collections + 9 links, 5 size guides, 2 sample promo banners |

The 26 tables: `administrator`, `store_settings`, `delivery_zone`, `category`, `product`,
`product_image`, `product_variant`, `customer`, `telegram_account`, `customer_address`,
`customer_session`, `cart`, `cart_item`, `orders`, `order_item`, `order_status_event`,
`inventory_movement`, `audit_log`, `notification_outbox`, `telegram_pairing_code`,
`telegram_callback_log`, `promo_banner`, `collection`, `collection_item`, `size_guide`,
`stock_alert_read` (plus Flyway's own `flyway_schema_history`).

Note the order table is named `orders` (plural) because `order` is reserved.

## Adding a migration

1. Name it `V3__<description>.sql` in `backend/src/main/resources/db/migration/`. Numbers must be
   strictly increasing; never reuse or edit an already-applied file (see checksum errors in
   `docs/TROUBLESHOOTING.md`).
2. Write plain PostgreSQL DDL. Follow existing conventions: `BIGSERIAL PRIMARY KEY`, `TIMESTAMPTZ NOT
   NULL DEFAULT now()`, `NUMERIC(12,2)` for money, `VARCHAR` + `CHECK (col IN ('A','B'))` for enums
   (the app stores enum names as strings - see `V1` and `domain/Enums.kt`), explicit index names
   `idx_*`, constraint names `ck_*` / `uq_*`.
3. Add the matching `open var` mappings in `backend/src/main/kotlin/com/kidsstore/domain/*.kt`.
   Columns are snake_case, Kotlin properties camelCase (`@Column(name = "low_stock_threshold")`).
4. Start the backend against a scratch database; `ddl-auto: validate` is the test that the two agree.

## Checking migration state

```bash
PSQL="C:/Program Files/PostgreSQL/18/bin/psql.exe"
PGPASSWORD=... "$PSQL" -h 127.0.0.1 -p 5433 -U kidsstore -d kidsstore_dev -c \
  "SELECT * FROM flyway_schema_history ORDER BY installed_rank;"
```

A healthy database shows one row per migration with `success = t` and `version` 1 and 2 (the recorded
run printed `now at version v2`). Also useful:

```sql
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';  -- 27 incl. flyway_schema_history
SELECT pg_size_pretty(pg_database_size(current_database()));
```

## Resetting a database

The supported reset is "drop it and let the app rebuild it" (destructive - double-check `DB_NAME`):

```bash
PGDIR="C:/Program Files/PostgreSQL/18/bin"
PGPASSWORD=... "$PGDIR/dropdb.exe"   -h 127.0.0.1 -p 5433 -U kidsstore --if-exists kidsstore_dev
PGPASSWORD=... "$PGDIR/createdb.exe" -h 127.0.0.1 -p 5433 -U kidsstore -O kidsstore kidsstore_dev
# then start the backend: Flyway applies V1 + V2, AdminBootstrap may create the OWNER again
```

- Uploaded images live on disk, not in the database (`product_image.url` / `.storage_key` point at
  `/api/v1/media/...`). A database reset orphans them; clear `data/uploads/` in the same step if you
  want a truly clean slate.
- After a reset the `administrator` table is empty, so `AdminBootstrap` will create the OWNER from
  `ADMIN_BOOTSTRAP_*` again on the next start (it only acts when `administrators.count() == 0`).
- `store_settings` id 1 must exist: `StoreConfigService.settings()` throws
  `IllegalStateException("store_settings row 1 is missing - run the Flyway migrations")` otherwise,
  which breaks almost every request. Never delete that row; only update it
  (`PUT /api/v1/admin/settings`).
- A "soft" reset (keep the schema, drop transactional data) is possible but is *not* automated
  anywhere in this repo; the FK cascade map below tells you what each deletion takes with it.

UNVERIFIED: `data/kidsstore_demo-preseed.dump` cannot be loaded into a freshly migrated database
because it is data-only and the seed rows would collide. See `docs/SETUP-LOCAL.md` section 5.

## The sample catalogue (labelled, disposable)

`V2__configuration_and_sample_catalog.sql` header, verbatim:

```sql
-- V2: required configuration rows + clearly labelled SAMPLE catalogue for local development.
-- Everything inserted here with is_sample = TRUE is disposable demo data (see docs/DATA.md).
```

(The referenced `docs/DATA.md` does not exist; this file is the documentation it meant.)

### How to identify sample rows

`is_sample BOOLEAN NOT NULL DEFAULT FALSE` exists on exactly four tables (verified in V1):
`category`, `product`, `collection`, `promo_banner`. V2 sets it to `TRUE` for every row it inserts into
those four tables. Nothing else is sample data:

- `store_settings` (id 1) - real configuration, bilingual store identity, `currency ETB`,
  `low_stock_threshold 3`, `telegram_enabled TRUE`, `telegram_setup_complete FALSE`,
  `require_admin_confirmation TRUE`, `restore_stock_on_cancellation TRUE`,
  `allow_customer_cancel_until 'PROCESSING'`, `free_delivery_over 3000`.
- `delivery_zone` (5 rows: Addis Ababa Bole/Akaki, Adama, Bahir Dar, Mekelle) and `size_guide`
  (5 rows) have **no** `is_sample` column - they are editable configuration, not demo noise.
- `product_image` rows: V2 inserts none. All sample products have no images, which is why the
  storefront falls back to its placeholder.

Because the column defaults to `FALSE`, real rows are distinguishable at any time:

```sql
SELECT id, slug, name_en, base_price, is_sample FROM product ORDER BY is_sample DESC, id;
SELECT count(*) FILTER (WHERE is_sample) AS sample, count(*) AS total FROM product;
SELECT count(*) FILTER (WHERE is_sample) AS sample, count(*) AS total FROM category;
```

The flag is also part of the API contract, so it is visible without SQL: `isSample` in
`GET /api/v1/admin/products` items, in the public `GET /api/v1/products` / `/api/v1/products/{slug}`
payload, and as a "Sample catalogue item" badge on the product page
(`frontend/src/pages/storefront/ProductPage.tsx` renders it when `product.isSample`). New products
inherit the flag from their category (`AdminCatalogService.create`: `this.isSample = category.isSample`),
so creating a product inside a sample category marks it as sample too - move it to a real category
before going live if that is wrong.

### Safe removal before going live

The FK directions below are read straight out of `V1__baseline_schema.sql`, and the order of the
deletes follows them:

| Referencing table | Column | On delete |
| --- | --- | --- |
| `product_image`, `product_variant`, `collection_item`, `inventory_movement`, `stock_alert_read` | `product_id` / `variant_id` | `CASCADE` (removed with the product/variant) |
| `order_item` | `product_id`, `variant_id` | `SET NULL` (order history survives, denormalised name/size/colour/price stay) |
| `cart_item` | `variant_id` | `CASCADE` (**in-flight carts lose those lines**) |
| `product` | `category_id` | `RESTRICT` (a category cannot be deleted while any product points at it) |
| `category` | `parent_id` | `SET NULL` |

Pre-checks (run first; both must return what you expect):

```sql
-- what would be removed
SELECT 'category' t, count(*) FROM category  WHERE is_sample
UNION ALL SELECT 'product',   count(*) FROM product   WHERE is_sample
UNION ALL SELECT 'variant',   count(*) FROM product_variant v JOIN product p ON p.id = v.product_id WHERE p.is_sample
UNION ALL SELECT 'collection',count(*) FROM collection WHERE is_sample
UNION ALL SELECT 'banner',    count(*) FROM promo_banner WHERE is_sample;

-- blockers: non-sample products still sitting in a sample category
SELECT p.id, p.slug, p.name_en, c.slug AS sample_category
  FROM product p JOIN category c ON c.id = p.category_id
 WHERE NOT p.is_sample AND c.is_sample;

-- live carts that would lose sample lines
SELECT count(*) FROM cart_item ci
  JOIN product_variant v ON v.id = ci.variant_id
  JOIN product p ON p.id = v.product_id
 WHERE p.is_sample;
```

Removal, in one transaction, in this order (`collection_item` rows go with `collection`/`product` by
cascade, so they need no separate delete):

```sql
BEGIN;
DELETE FROM collection WHERE is_sample;      -- cascades to collection_item
DELETE FROM promo_banner WHERE is_sample;
DELETE FROM product    WHERE is_sample;      -- cascades to product_image, product_variant,
                                             -- cart_item lines, stock_alert_read, inventory_movement
DELETE FROM category  WHERE is_sample;       -- allowed only now: product.category_id is RESTRICT
                                             -- (self-referencing parent_id is SET NULL)
COMMIT;
```

Then verify:

```sql
SELECT count(*) FROM product WHERE is_sample;   -- 0
SELECT count(*) FROM category WHERE is_sample;  -- 0
SELECT count(*) FROM orders;                    -- unchanged
SELECT count(*) FROM order_item WHERE product_id IS NULL;  -- old sample-order lines kept, ids nulled
```

Two honest caveats:

1. `inventory_movement` history for sample variants is deleted with them (`ON DELETE CASCADE`), so any
   stock ledger tied to demo products disappears. Export it first if you need it.
2. **The samples come back on any fresh database**, because V2 inserts them. If you want production
   installs to start clean, add `V3__remove_sample_catalog.sql` containing the same four `DELETE`s
   (guarded by `WHERE is_sample`). Do **not** edit `V2` to remove them - V2 has already been applied
   locally, and changing it breaks Flyway's checksum (`docs/TROUBLESHOOTING.md`).

There is no admin UI or endpoint that performs this removal; it is a maintenance operation.
