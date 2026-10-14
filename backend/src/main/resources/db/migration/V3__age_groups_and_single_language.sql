-- V3: one-language catalogue plus structured age groups.
--
-- Part 1 removes the Amharic columns: the shop ships in English only, so the second half of
-- each bilingual pair goes away. telegram_account.language_code is kept - it is Telegram's own
-- metadata about a customer, not text we translate. Past orders keep their English product-name
-- snapshot, so order history stays readable.
--
-- Part 2 gives every product a real, admin-manageable set of age bands. The old free-text
-- product.age_group / category.age_group columns held display strings like '2-12y' that could
-- not be validated or filtered reliably, so they are replaced by an age_group lookup table and
-- a product_age_group join table, then dropped.
--
-- Part 3 adds the Children's toys category. It comes last so the new rows are written against
-- the single-language shape of the tables.

ALTER TABLE store_settings DROP COLUMN store_name_am, DROP COLUMN tagline_am, DROP COLUMN default_language;
ALTER TABLE delivery_zone  DROP COLUMN name_am;
ALTER TABLE category       DROP COLUMN name_am, DROP COLUMN description_am;
ALTER TABLE product        DROP COLUMN name_am, DROP COLUMN description_am;
ALTER TABLE product_image  DROP COLUMN alt_am;
ALTER TABLE customer       DROP COLUMN preferred_language;
ALTER TABLE order_item     DROP COLUMN product_name_am;
ALTER TABLE collection     DROP COLUMN name_am, DROP COLUMN description_am;
ALTER TABLE size_guide     DROP COLUMN title_am, DROP COLUMN body_am;
ALTER TABLE promo_banner   DROP COLUMN title_am, DROP COLUMN subtitle_am;

-- ---------------------------------------------------------------- age groups

CREATE TABLE age_group (
    id              BIGSERIAL PRIMARY KEY,
    code            VARCHAR(32)  NOT NULL UNIQUE,
    label           VARCHAR(80)  NOT NULL,
    min_age         INT,
    max_age         INT,
    age_unit        VARCHAR(8)   NOT NULL DEFAULT 'MONTH',
    sort_order      INT          NOT NULL DEFAULT 0,
    active          BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_age_group_unit CHECK (age_unit IN ('MONTH', 'YEAR')),
    CONSTRAINT ck_age_group_range CHECK (min_age IS NULL OR max_age IS NULL OR max_age >= min_age),
    CONSTRAINT ck_age_group_bounds CHECK (min_age IS NULL OR min_age >= 0)
);

CREATE INDEX idx_age_group_listing ON age_group (active, sort_order);

CREATE TABLE product_age_group (
    product_id      BIGINT       NOT NULL REFERENCES product (id) ON DELETE CASCADE,
    age_group_id    BIGINT       NOT NULL REFERENCES age_group (id) ON DELETE RESTRICT,
    PRIMARY KEY (product_id, age_group_id)
);

CREATE INDEX idx_product_age_group_band ON product_age_group (age_group_id, product_id);

INSERT INTO age_group (code, label, min_age, max_age, age_unit, sort_order)
VALUES
    ('NEWBORN_0_3M',    'Newborn (0-3 months)',   0,    3,    'MONTH', 10),
    ('INFANT_3_12M',    'Infant (3-12 months)',   3,    12,   'MONTH', 20),
    ('TODDLER_1_2Y',    'Toddler (1-2 years)',    1,    2,    'YEAR',  30),
    ('LITTLE_KID_3_4Y', 'Little kid (3-4 years)', 3,    4,    'YEAR',  40),
    ('PRESCHOOL_5_6Y',  'Preschool (5-6 years)',  5,    6,    'YEAR',  50),
    ('YOUNG_KID_7_9Y',  'Young kid (7-9 years)',  7,    9,    'YEAR',  60),
    ('PRETEEN_10_12Y',  'Preteen (10-12 years)',  10,   12,   'YEAR',  70),
    ('TEEN_13_17Y',     'Teen (13-17 years)',     13,   17,   'YEAR',  80),
    ('ADULT_18Y',       'Adult (18 and up)',      18,   NULL, 'YEAR',  90),
    ('ALL_AGES',        'All ages',               NULL, NULL, 'MONTH', 100)
ON CONFLICT (code) DO NOTHING;

-- Carry each product's free-text band across as real rows. A band that does not map to a known
-- group becomes ALL_AGES so the product stays reachable in the catalogue.
INSERT INTO product_age_group (product_id, age_group_id)
SELECT p.id, ag.id
FROM product p
JOIN LATERAL unnest(
    CASE lower(btrim(coalesce(p.age_group, '')))
        WHEN '0-24m'  THEN ARRAY['NEWBORN_0_3M', 'INFANT_3_12M', 'TODDLER_1_2Y']
        WHEN '1-12y'  THEN ARRAY['TODDLER_1_2Y', 'LITTLE_KID_3_4Y', 'PRESCHOOL_5_6Y', 'YOUNG_KID_7_9Y', 'PRETEEN_10_12Y']
        WHEN '2-12y'  THEN ARRAY['TODDLER_1_2Y', 'LITTLE_KID_3_4Y', 'PRESCHOOL_5_6Y', 'YOUNG_KID_7_9Y', 'PRETEEN_10_12Y']
        WHEN '5-12y'  THEN ARRAY['PRESCHOOL_5_6Y', 'YOUNG_KID_7_9Y', 'PRETEEN_10_12Y']
        WHEN '6-9y'   THEN ARRAY['PRESCHOOL_5_6Y', 'YOUNG_KID_7_9Y']
        WHEN 'adult'  THEN ARRAY['ADULT_18Y']
        ELSE ARRAY['ALL_AGES']
    END
) AS legacy(code) ON TRUE
JOIN age_group ag ON ag.code = legacy.code
ON CONFLICT (product_id, age_group_id) DO NOTHING;

ALTER TABLE product  DROP COLUMN age_group;
ALTER TABLE category DROP COLUMN age_group;

-- ---------------------------------------------------------------- children's toys

INSERT INTO category (slug, name_en, description_en, audience, sort_order, is_sample, active)
VALUES ('children-toys', 'Children''s toys',
        'Wooden puzzles, ride-ons, building sets and soft toys, filtered by age band',
        'CHILD', 55, FALSE, TRUE)
ON CONFLICT (slug) DO NOTHING;

-- Illustrative demo prices and stock, like the rest of the sample catalogue (is_sample = TRUE).
INSERT INTO product (slug, category_id, name_en, description_en, audience, gender,
                     sizing_system, base_price, sale_price, status, featured, is_sample, published_at)
VALUES
    ('wooden-shape-sorter',
     (SELECT id FROM category WHERE slug = 'children-toys'),
     'Wooden Shape Sorter', 'Nine solid-wood blocks in a framed sorter, sanded smooth and finished with water-based paint.',
     'CHILD', 'UNISEX', 'AGE', 980.00, NULL, 'PUBLISHED', TRUE, TRUE, now()),
    ('soft-building-blocks-40pc',
     (SELECT id FROM category WHERE slug = 'children-toys'),
     'Soft Building Blocks 40 Piece', 'Lightweight foam blocks in four colours, easy for small hands to grip.',
     'CHILD', 'UNISEX', 'AGE', 720.00, 640.00, 'PUBLISHED', FALSE, TRUE, now()),
    ('ride-on-tricycle',
     (SELECT id FROM category WHERE slug = 'children-toys'),
     'Ride-On Tricycle', 'Three-wheel tricycle with a padded seat, foot rest and a push handle for an adult.',
     'CHILD', 'UNISEX', 'AGE', 2450.00, NULL, 'PUBLISHED', TRUE, TRUE, now()),
    ('plush-bear-medium',
     (SELECT id FROM category WHERE slug = 'children-toys'),
     'Plush Bear 30 cm', 'Machine-washable plush bear with embroidered eyes, stuffed with fibre filling.',
     'CHILD', 'UNISEX', 'ONE_SIZE', 560.00, NULL, 'PUBLISHED', FALSE, TRUE, now()),
    ('magnetic-tile-set-36pc',
     (SELECT id FROM category WHERE slug = 'children-toys'),
     'Magnetic Tile Set 36 Piece', 'Translucent snap-together tiles with a storage box, for structured and free building.',
     'CHILD', 'UNISEX', 'AGE', 1890.00, 1650.00, 'PUBLISHED', FALSE, TRUE, now());

INSERT INTO product_variant (product_id, size_label, color_name, color_hex, sku, stock, low_stock_threshold)
SELECT p.id, v.size_label, v.color_name, v.color_hex, v.sku, v.stock, 3
FROM (VALUES
    ('wooden-shape-sorter',        '18m+',     'Natural',     '#D9C7A7', 'SS-TOY-SORT-1', 8),
    ('soft-building-blocks-40pc',  '40 piece', 'Multicolour', NULL,      'SS-TOY-BLK-40', 14),
    ('ride-on-tricycle',           'One size', 'Red',         '#C4453C', 'SS-TOY-TRI-R',  4),
    ('plush-bear-medium',          '30 cm',    'Brown',       '#8B6B4A', 'SS-TOY-BEAR-30', 11),
    ('magnetic-tile-set-36pc',     '36 piece', 'Pastel mix',  NULL,      'SS-TOY-MAG-36',  6)
) AS v(slug, size_label, color_name, color_hex, sku, stock)
JOIN product p ON p.slug = v.slug
WHERE NOT EXISTS (SELECT 1 FROM product_variant pv WHERE pv.sku = v.sku);

INSERT INTO product_age_group (product_id, age_group_id)
SELECT p.id, ag.id
FROM product p
JOIN LATERAL unnest(
    CASE p.slug
        WHEN 'wooden-shape-sorter'       THEN ARRAY['INFANT_3_12M', 'TODDLER_1_2Y']
        WHEN 'soft-building-blocks-40pc' THEN ARRAY['INFANT_3_12M', 'TODDLER_1_2Y', 'LITTLE_KID_3_4Y']
        WHEN 'ride-on-tricycle'          THEN ARRAY['TODDLER_1_2Y', 'LITTLE_KID_3_4Y']
        WHEN 'plush-bear-medium'         THEN ARRAY['NEWBORN_0_3M', 'INFANT_3_12M', 'TODDLER_1_2Y', 'LITTLE_KID_3_4Y', 'PRESCHOOL_5_6Y', 'YOUNG_KID_7_9Y', 'PRETEEN_10_12Y', 'TEEN_13_17Y', 'ADULT_18Y']
        WHEN 'magnetic-tile-set-36pc'    THEN ARRAY['LITTLE_KID_3_4Y', 'PRESCHOOL_5_6Y', 'YOUNG_KID_7_9Y']
        ELSE ARRAY[]::TEXT[]
    END
) AS band(code) ON TRUE
JOIN age_group ag ON ag.code = band.code
ON CONFLICT (product_id, age_group_id) DO NOTHING;
