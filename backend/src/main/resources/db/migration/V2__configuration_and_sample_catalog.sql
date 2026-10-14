-- V2: required configuration rows + clearly labelled SAMPLE catalogue for local development.
-- Everything inserted here with is_sample = TRUE is disposable demo data (see docs/DATA.md).

INSERT INTO store_settings (id, store_name_en, store_name_am, tagline_en, tagline_am,
                            contact_phone, contact_email, default_language, currency,
                            low_stock_threshold, telegram_admin_contact_phone, telegram_enabled,
                            telegram_setup_complete, require_admin_confirmation,
                            restore_stock_on_cancellation, allow_customer_cancel_until,
                            free_delivery_over)
VALUES (1, 'Selam Kids & Family', 'ሰላም ልጆችና ቤተሰብ',
        'Children''s clothing and shoes, delivered across Ethiopia',
        'የልጆች ልብስና ጫማ፣ በኢትዮጵያ ውስጥ እናደርስዎለታለን',
        '0911526922', 'orders@example.com', 'en', 'ETB',
        3, '0911526922', TRUE, FALSE, TRUE,
        TRUE, 'PROCESSING', 3000)
ON CONFLICT (id) DO NOTHING;

INSERT INTO delivery_zone (name_en, name_am, region, city, sub_city, fee, free_over, estimated_days)
VALUES
    ('Addis Ababa - central', 'አዲስ አበባ - ማዕከል', 'Addis Ababa', 'Addis Ababa', 'Bole',        150.00, 3000.00, 1),
    ('Addis Ababa - outer',   'አዲስ አበባ - ውጫዊ',  'Addis Ababa', 'Addis Ababa', 'Akaki',       200.00, 4000.00, 2),
    ('Oromia - Adama',        'ኦሮሚያ - አዳማ',      'Oromia',      'Adama',        NULL,          350.00, NULL,    3),
    ('Amhara - Bahir Dar',    'አማራ - ባህር ዳር',    'Amhara',      'Bahir Dar',    NULL,          450.00, NULL,    4),
    ('Tigray - Mekelle',      'ትግራይ - መቀሌ',      'Tigray',      'Mekelle',      NULL,          550.00, NULL,    5);

INSERT INTO category (slug, name_en, name_am, description_en, description_am, audience, age_group, sort_order, is_sample)
VALUES
    ('baby-clothing',      'Baby clothing',           'የህጻን ልብስ',        'Bodysuits, sets and soft knits for 0-24 months', 'ለወንድና ለሴት ህጻኖች ከ0 እስከ 24 ወራት', 'CHILD', '0-24m',  10, TRUE),
    ('girls-clothing',     'Girls clothing',          'የሴት ልጅ ልብስ',      'Dresses, tops and sets for girls',              'ለሴት ልጆች ልብስ',                    'CHILD', '2-12y',  20, TRUE),
    ('boys-clothing',      'Boys clothing',           'የወንድ ልጅ ልብስ',     'T-shirts, jeans and sets for boys',             'ለወንድ ልጆች ልብስ',                   'CHILD', '2-12y',  30, TRUE),
    ('children-shoes',     'Children''s shoes',       'የልጆች ጫማ',          'Sneakers, sandals and school shoes',            'የልጆች ጫማ',                        'CHILD', '1-12y',  40, TRUE),
    ('baby-shoes',         'Baby shoes',              'የህጻን ጫማ',         'First-walker shoes and booties',                'የህጻን ጫማ',                        'CHILD', '0-24m',  50, TRUE),
    ('accessories',        'Baby & kid accessories',  'የህጻን ጌጣጌጥ',       'Blankets, caps, bibs and bags',                 'የህጻንና የልጆች ጌጣጌጥ',               'CHILD', 'all',    60, TRUE),
    ('school-clothing',    'School clothing',         'የትምህርት ቤት ልብስ',   'Uniforms and school shoes',                     'የትምህርት ቤት ልብስና ጫማ',            'CHILD', '5-15y',  70, TRUE),
    ('adult-womens',       'Adult womens clothing',   'የአዋቂ ሴት ልብስ',     'A small edit of dresses and tops',              'የአዋቂ ሴቶች ልብስ',                   'ADULT', 'adult',  80, TRUE),
    ('adult-mens',         'Adult mens clothing',     'የአዋቂ ወንድ ልብስ',    'Shirts and trousers',                           'የአዋቂ ወንዶች ልብስ',                  'ADULT', 'adult',  90, TRUE),
    ('family-collections', 'Family & seasonal',       'የቤተሰብና ወቅታዊ',    'Coordinated family sets and holiday edits',     'የቤተሰብና ወቅታዊ ልብስ',              'FAMILY', 'all',   100, TRUE);

-- Sample products. Prices are illustrative demo prices, not real business data.
INSERT INTO product (slug, category_id, name_en, name_am, description_en, description_am,
                     audience, age_group, gender, sizing_system, base_price, sale_price,
                     status, featured, is_sample, published_at)
VALUES
    ('baby-bodysuit-3pack',
     (SELECT id FROM category WHERE slug = 'baby-clothing'),
     'Baby Bodysuit 3 Pack', 'የህጻን ቦዲ ሱት 3 ጥቅልል',
     'Three soft cotton bodysuits with envelope necks and snap closures.',
     'ሦስት ለስላሳ የጥጃ ቦዲ ሱት።',
     'CHILD', '0-24m', 'UNISEX', 'AGE', 890.00, 750.00, 'PUBLISHED', TRUE, TRUE, now()),
    ('baby-knit-set',
     (SELECT id FROM category WHERE slug = 'baby-clothing'),
     'Baby Knit Cardigan Set', 'የህጻን ሱፍ ልብስ ስብስብ',
     'Warm knitted cardigan with matching trousers for cool mornings.',
     'ለቀዘቀዘ ጠዋት የሚሆን ሙቀት መከላከያ ልብስ።',
     'CHILD', '0-24m', 'UNISEX', 'AGE', 1250.00, NULL, 'PUBLISHED', FALSE, TRUE, now()),
    ('girls-floral-dress',
     (SELECT id FROM category WHERE slug = 'girls-clothing'),
     'Girls Floral Dress', 'የሴት ልጅ አበባ ልብስ',
     'Lightweight cotton dress with a lined bodice and flare skirt.',
     'ቀላል የጥጃ ልብስ ለበጋ ወቅት።',
     'CHILD', '2-12y', 'GIRL', 'AGE', 1150.00, 980.00, 'PUBLISHED', TRUE, TRUE, now()),
    ('girls-legging-pack',
     (SELECT id FROM category WHERE slug = 'girls-clothing'),
     'Girls Cotton Leggings 2 Pack', 'የሴት ልጅ ሌግጊንግ 2 ጥቅልል',
     'Stretchy everyday leggings with flat seams.',
     'ለዕለት ተዕለት ሕይወት የሚሆን ሌግጊንግ።',
     'CHILD', '2-12y', 'GIRL', 'AGE', 640.00, NULL, 'PUBLISHED', FALSE, TRUE, now()),
    ('boys-tee-shorts-set',
     (SELECT id FROM category WHERE slug = 'boys-clothing'),
     'Boys T-Shirt and Shorts Set', 'የወንድ ልጅ ቴ-ሸሚዝና ሱርል ስብስብ',
     'Two-piece printed set in breathable cotton jersey.',
     'ሁለት ቁራጭ የጥጃ ልብስ ስብስብ።',
     'CHILD', '2-12y', 'BOY', 'AGE', 780.00, NULL, 'PUBLISHED', TRUE, TRUE, now()),
    ('boys-jeans',
     (SELECT id FROM category WHERE slug = 'boys-clothing'),
     'Boys Denim Trousers', 'የወንድ ልጅ ጂንስ',
     'Durable denim with adjustable inner waistband.',
     'ጠንካራ ዴንም ልብስ።',
     'CHILD', '2-12y', 'BOY', 'NUMERIC', 990.00, 850.00, 'PUBLISHED', FALSE, TRUE, now()),
    ('kids-sneakers',
     (SELECT id FROM category WHERE slug = 'children-shoes'),
     'Children Sneakers', 'የልጆች ስፖርት ጫማ',
     'Lightweight trainers with hook-and-loop straps and a non-slip sole.',
     'ቀላልና ደህንነቱ የተጠበቀ የልጆች ጫማ።',
     'CHILD', '1-12y', 'UNISEX', 'SHOE', 1450.00, 1290.00, 'PUBLISHED', TRUE, TRUE, now()),
    ('kids-sandals',
     (SELECT id FROM category WHERE slug = 'children-shoes'),
     'Children Sandals', 'የልጆች ሳንዳል',
     'Cushioned summer sandals with an adjustable back strap.',
     'ለበጋ ወቅት የሚሆን ሳንዳል።',
     'CHILD', '1-12y', 'UNISEX', 'SHOE', 720.00, NULL, 'PUBLISHED', FALSE, TRUE, now()),
    ('baby-first-walker',
     (SELECT id FROM category WHERE slug = 'baby-shoes'),
     'Baby First Walker Shoes', 'የህጻን መራሒ ጫማ',
     'Soft sole first shoes with an elastic opening.',
     'ለመጀመሪያ እርካናቸው የሚሆን ለስላሳ ጫማ።',
     'CHILD', '0-24m', 'UNISEX', 'SHOE', 640.00, NULL, 'PUBLISHED', FALSE, TRUE, now()),
    ('baby-blanket',
     (SELECT id FROM category WHERE slug = 'accessories'),
     'Baby Muslin Blanket', 'የህጻን ብላንኬት',
     'Breathable layered muslin blanket, 90 x 90 cm.',
     'ተነፋፊ የጥጃ ብላንኬት።',
     'CHILD', '0-24m', 'UNISEX', 'ONE_SIZE', 520.00, NULL, 'PUBLISHED', FALSE, TRUE, now()),
    ('school-pinafore',
     (SELECT id FROM category WHERE slug = 'school-clothing'),
     'School Pinafore', 'የትምህርት ቤት ልብስ',
     'Navy pinafore with white collar for primary school girls.',
     'ለመጀመሪያ ደረጃ ትምህርት ቤት የሚሆን ልብስ።',
     'CHILD', '5-12y', 'GIRL', 'AGE', 1080.00, NULL, 'PUBLISHED', FALSE, TRUE, now()),
    ('womens-cotton-dress',
     (SELECT id FROM category WHERE slug = 'adult-womens'),
     'Womens Cotton Midi Dress', 'የአዋቂ ሴት ልብስ',
     'A simple midi dress in washed cotton with side pockets.',
     'ቀላል የአዋቂ ሴት ልብስ።',
     'ADULT', 'adult', 'WOMAN', 'LETTER', 1650.00, 1420.00, 'PUBLISHED', TRUE, TRUE, now()),
    ('mens-casual-shirt',
     (SELECT id FROM category WHERE slug = 'adult-mens'),
     'Mens Casual Shirt', 'የአዋቂ ወንድ ሸሚዝ',
     'Brushed cotton shirt in three colours, regular fit.',
     'ለዕለት ተዕለት የሚሆን ሸሚዝ።',
     'ADULT', 'adult', 'MAN', 'LETTER', 1180.00, NULL, 'PUBLISHED', FALSE, TRUE, now()),
    ('family-matching-set',
     (SELECT id FROM category WHERE slug = 'family-collections'),
     'Family Matching Shirts', 'የቤተሰብ ተመሳሳይ ልብስ',
     'Coordinated shirts for the whole family, sold per person.',
     'ለመላው ቤተሰብ የሚሆን ተመሳሳይ ልብስ።',
     'FAMILY', 'all', 'UNISEX', 'AGE', 950.00, NULL, 'PUBLISHED', TRUE, TRUE, now());

-- Variants carry the stock. Sample stock levels are illustrative.
INSERT INTO product_variant (product_id, size_label, color_name, color_hex, sku, stock, low_stock_threshold)
SELECT p.id, v.size_label, v.color_name, v.color_hex, v.sku, v.stock, 3
FROM (VALUES
    -- baby bodysuit
    ('baby-bodysuit-3pack', '0-3m',  'White',   '#F5F5F0', 'SS-BBS-03-W', 12),
    ('baby-bodysuit-3pack', '3-6m',  'White',   '#F5F5F0', 'SS-BBS-06-W', 9),
    ('baby-bodysuit-3pack', '6-12m', 'Soft pink', '#F4C7C3', 'SS-BBS-12-P', 6),
    ('baby-bodysuit-3pack', '12-24m', 'Sage',   '#B7C9A8', 'SS-BBS-24-S', 2),
    -- baby knit set
    ('baby-knit-set',       '6-12m', 'Cream',   '#EFE6D6', 'SS-BKS-12-C', 5),
    ('baby-knit-set',       '12-24m','Cream',   '#EFE6D6', 'SS-BKS-24-C', 4),
    -- girls dress
    ('girls-floral-dress',  '2-3y',  'Blue floral', '#9FB8D1', 'SS-GFD-02-B', 7),
    ('girls-floral-dress',  '4-5y',  'Blue floral', '#9FB8D1', 'SS-GFD-04-B', 5),
    ('girls-floral-dress',  '6-7y',  'Terracotta', '#D08B63', 'SS-GFD-06-T', 3),
    ('girls-floral-dress',  '8-9y',  'Terracotta', '#D08B63', 'SS-GFD-08-T', 0),
    -- leggings
    ('girls-legging-pack',  '2-3y',  'Charcoal', '#3F3F42', 'SS-GLP-02-C', 15),
    ('girls-legging-pack',  '4-5y',  'Charcoal', '#3F3F42', 'SS-GLP-04-C', 11),
    -- boys set
    ('boys-tee-shorts-set', '3-4y',  'Forest',  '#2F4F3E', 'SS-BTS-03-F', 8),
    ('boys-tee-shorts-set', '5-6y',  'Forest',  '#2F4F3E', 'SS-BTS-05-F', 6),
    ('boys-tee-shorts-set', '7-8y',  'Navy',    '#26405C', 'SS-BTS-07-N', 4),
    -- boys jeans
    ('boys-jeans',          '4',     'Indigo',  '#3B4E6B', 'SS-BJ-04-I', 6),
    ('boys-jeans',          '6',     'Indigo',  '#3B4E6B', 'SS-BJ-06-I', 5),
    ('boys-jeans',          '8',     'Black',   '#22252A', 'SS-BJ-08-K', 1),
    -- sneakers
    ('kids-sneakers',       '28',    'White',   '#F2F2EF', 'SS-KSN-28-W', 5),
    ('kids-sneakers',       '30',    'White',   '#F2F2EF', 'SS-KSN-30-W', 4),
    ('kids-sneakers',       '32',    'Grey',    '#8C9196', 'SS-KSN-32-G', 3),
    ('kids-sneakers',       '34',    'Grey',    '#8C9196', 'SS-KSN-34-G', 0),
    -- sandals
    ('kids-sandals',        '26',    'Tan',     '#C89B6C', 'SS-KSA-26-T', 9),
    ('kids-sandals',        '29',    'Tan',     '#C89B6C', 'SS-KSA-29-T', 7),
    ('kids-sandals',        '31',    'Blue',    '#4A72A8', 'SS-KSA-31-B', 2),
    -- baby first walker
    ('baby-first-walker',   '17',    'Cream',   '#EFE6D6', 'SS-BFW-17-C', 10),
    ('baby-first-walker',   '19',    'Cream',   '#EFE6D6', 'SS-BFW-19-C', 8),
    -- blanket
    ('baby-blanket',        'One size', 'Ivory', '#F6F1E7', 'SS-BBL-OS-I', 14),
    -- school pinafore
    ('school-pinafore',     '6-7y',  'Navy',    '#26405C', 'SS-SPN-06-N', 12),
    ('school-pinafore',     '8-9y',  'Navy',    '#26405C', 'SS-SPN-08-N', 9),
    -- womens dress
    ('womens-cotton-dress', 'S',     'Olive',   '#6B7A4F', 'SS-WCD-S-O', 4),
    ('womens-cotton-dress', 'M',     'Olive',   '#6B7A4F', 'SS-WCD-M-O', 3),
    ('womens-cotton-dress', 'L',     'Rust',    '#A65B3A', 'SS-WCD-L-R', 2),
    -- mens shirt
    ('mens-casual-shirt',   'M',     'Light blue', '#B9CEE0', 'SS-MCS-M-B', 6),
    ('mens-casual-shirt',   'L',     'White',   '#F5F5F0', 'SS-MCS-L-W', 5),
    ('mens-casual-shirt',   'XL',    'White',   '#F5F5F0', 'SS-MCS-XL-W', 0),
    -- family set
    ('family-matching-set', 'Kids 6-7y', 'Sage', '#B7C9A8', 'SS-FMS-K-S', 8),
    ('family-matching-set', 'Adult M',   'Sage', '#B7C9A8', 'SS-FMS-AM-S', 6)
) AS v (slug, size_label, color_name, color_hex, sku, stock)
JOIN product p ON p.slug = v.slug;

INSERT INTO collection (slug, name_en, name_am, description_en, description_am, sort_order, is_sample)
VALUES
    ('new-arrivals',     'New arrivals',      'አዲስ የመጡ',        'Fresh pieces added this season',            'በዚህ ወቅት የተጨመሩ ልብሶች',        10, TRUE),
    ('back-to-school',   'Back to school',    'ወደ ትምህርት ቤት',   'Uniforms and school shoes',                 'የትምህርት ቤት ልብስና ጫማ',          20, TRUE),
    ('baby-essentials',  'Baby essentials',   'የህጻን አስፈላጊ',   'Everything for the first year',             'ለመጀመሪያ አመት የሚያስፈልግ',        30, TRUE);

INSERT INTO collection_item (collection_id, product_id, sort_order)
SELECT c.id, p.id, row_number
FROM (VALUES
    ('new-arrivals', 'girls-floral-dress', 1),
    ('new-arrivals', 'kids-sneakers', 2),
    ('new-arrivals', 'family-matching-set', 3),
    ('back-to-school', 'school-pinafore', 1),
    ('back-to-school', 'kids-sneakers', 2),
    ('back-to-school', 'boys-jeans', 3),
    ('baby-essentials', 'baby-bodysuit-3pack', 1),
    ('baby-essentials', 'baby-first-walker', 2),
    ('baby-essentials', 'baby-blanket', 3)
) AS seed (collection_slug, product_slug, row_number)
JOIN collection c ON c.slug = seed.collection_slug
JOIN product p ON p.slug = seed.product_slug;

INSERT INTO size_guide (sizing_system, title_en, title_am, body_en, body_am)
VALUES
    ('AGE', 'Children''s clothing sizes', 'የልጆች ልብስ መጠን',
     'Sizes are by age range. Children grow at different rates, so check the garment measurements in the description when between sizes.',
     'መጠኖች በዕድሜ ይሰጣሉ። ልጆች በተለያዩ ፍጥነት ስለያድጉ፣ በሁለት መጠኖች መካከል ሲሆኑ የልብሱን ልኬት ይፈትሹ።'),
    ('SHOE', 'Children''s shoe sizes', 'የልጆች ጫማ መጠን',
     'Measure the foot from heel to longest toe while standing, add 1 cm of growing room, then match to the chart.',
     'እግሩን ከዱሊቱ እስከ ረጅሙ ጣት በቆመ ሁኔታ ይለኩ፣ 1 ሴ.ሜ ቦታ ይጨምሩ፣ ከዚያ ከሰጥኑ ጋር ያዛምዱ።'),
    ('NUMERIC', 'Numeric sizes', 'በቁጥር መጠን',
     'Numeric sizes follow the EU children''s scale.', 'የቁጥር መጠኖች በአውሮፓ ደረጃ ነው።'),
    ('LETTER', 'Adult letter sizes', 'የአዋቂ የፊደል መጠን',
     'S = 86-90 cm chest, M = 91-96 cm, L = 97-102 cm, XL = 103-108 cm.',
     'S = 86-90 ሴ.ሜ ደረት፣ M = 91-96 ሴ.ሜ፣ L = 97-102 ሴ.ሜ፣ XL = 103-108 ሴ.ሜ።'),
    ('ONE_SIZE', 'One size', 'አንድ መጠን',
     'This item is made in a single size.', 'ይህ እቃ በአንድ መጠን ብቻ ይመረታል።');

INSERT INTO promo_banner (title_en, title_am, subtitle_en, subtitle_am, link_type, link_value, placement, sort_order, active, is_sample)
VALUES
    ('School season essentials', 'የትምህርት ቤት ወቅት ልብስ',
     'Uniforms, pinafores and school shoes with 1-2 day delivery in Addis Ababa.',
     'የትምህርት ቤት ልብሶች በአዲስ አበባ በ1-2 ቀናት ይደርሳሉ።',
     'COLLECTION', 'back-to-school', 'HERO', 1, TRUE, TRUE),
    ('Little feet, first steps', 'ትንሽ እግሮች፣ የመጀመሪያ እርምጃ',
     'Soft sole baby shoes from ETB 640.',
     'የህጻን ለስላሳ ጫማ ከ640 ብር።',
     'CATEGORY', 'baby-shoes', 'HOME', 2, TRUE, TRUE);
