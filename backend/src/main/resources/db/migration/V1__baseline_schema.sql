-- Kids Store baseline schema (PostgreSQL 14+)
-- Money is stored as NUMERIC; never floating point.

CREATE TABLE administrator (
    id              BIGSERIAL PRIMARY KEY,
    email           VARCHAR(255) NOT NULL UNIQUE,
    full_name       VARCHAR(255) NOT NULL,
    phone           VARCHAR(32),
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(32)  NOT NULL DEFAULT 'OWNER',
    active          BOOLEAN      NOT NULL DEFAULT TRUE,
    token_version   INT          NOT NULL DEFAULT 0,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_administrator_role CHECK (role IN ('OWNER', 'MANAGER', 'DELIVERY_STAFF'))
);

CREATE TABLE store_settings (
    id                              BIGINT PRIMARY KEY,
    store_name_en                   VARCHAR(255) NOT NULL,
    store_name_am                   VARCHAR(255) NOT NULL,
    tagline_en                      VARCHAR(255),
    tagline_am                      VARCHAR(255),
    logo_url                        VARCHAR(1024),
    contact_phone                   VARCHAR(32)  NOT NULL,
    contact_secondary_phone         VARCHAR(32),
    contact_email                   VARCHAR(255),
    contact_telegram_username       VARCHAR(64),
    currency                        VARCHAR(8)   NOT NULL DEFAULT 'ETB',
    default_language                VARCHAR(8)   NOT NULL DEFAULT 'en',
    low_stock_threshold             INT          NOT NULL DEFAULT 3,
    allow_customer_cancel_until     VARCHAR(32)  NOT NULL DEFAULT 'PROCESSING',
    restore_stock_on_cancellation   BOOLEAN      NOT NULL DEFAULT TRUE,
    require_admin_confirmation      BOOLEAN      NOT NULL DEFAULT TRUE,
    free_delivery_over              NUMERIC(12, 2),
    mini_app_url                    VARCHAR(1024),
    bot_username                    VARCHAR(64),
    admin_notify_url                VARCHAR(1024),
    telegram_enabled                BOOLEAN      NOT NULL DEFAULT TRUE,
    telegram_admin_contact_phone    VARCHAR(32),
    telegram_chat_id                BIGINT,
    telegram_user_id                BIGINT,
    telegram_setup_complete         BOOLEAN      NOT NULL DEFAULT FALSE,
    updated_at                      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE delivery_zone (
    id              BIGSERIAL PRIMARY KEY,
    name_en         VARCHAR(255) NOT NULL,
    name_am         VARCHAR(255) NOT NULL,
    region          VARCHAR(120) NOT NULL,
    city            VARCHAR(120) NOT NULL,
    sub_city        VARCHAR(120),
    fee             NUMERIC(12, 2) NOT NULL DEFAULT 0,
    free_over       NUMERIC(12, 2),
    estimated_days  INT          NOT NULL DEFAULT 2,
    active          BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_delivery_zone_fee CHECK (fee >= 0)
);
CREATE INDEX idx_delivery_zone_lookup ON delivery_zone (region, city, active);

CREATE TABLE category (
    id              BIGSERIAL PRIMARY KEY,
    slug            VARCHAR(120) NOT NULL UNIQUE,
    name_en         VARCHAR(255) NOT NULL,
    name_am         VARCHAR(255) NOT NULL,
    description_en  TEXT,
    description_am  TEXT,
    parent_id       BIGINT REFERENCES category (id) ON DELETE SET NULL,
    audience        VARCHAR(16)  NOT NULL DEFAULT 'CHILD',
    age_group       VARCHAR(64),
    image_url       VARCHAR(1024),
    sort_order      INT          NOT NULL DEFAULT 0,
    active          BOOLEAN      NOT NULL DEFAULT TRUE,
    is_sample       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_category_audience CHECK (audience IN ('CHILD', 'ADULT', 'FAMILY'))
);
CREATE INDEX idx_category_active_sort ON category (active, sort_order);

CREATE TABLE product (
    id              BIGSERIAL PRIMARY KEY,
    slug            VARCHAR(160) NOT NULL UNIQUE,
    category_id     BIGINT       NOT NULL REFERENCES category (id) ON DELETE RESTRICT,
    name_en         VARCHAR(255) NOT NULL,
    name_am         VARCHAR(255) NOT NULL,
    description_en  TEXT,
    description_am  TEXT,
    audience        VARCHAR(16)  NOT NULL DEFAULT 'CHILD',
    age_group       VARCHAR(64),
    gender          VARCHAR(16)  NOT NULL DEFAULT 'UNISEX',
    sizing_system   VARCHAR(24)  NOT NULL DEFAULT 'NUMERIC',
    base_price      NUMERIC(12, 2) NOT NULL,
    sale_price      NUMERIC(12, 2),
    status          VARCHAR(16)  NOT NULL DEFAULT 'DRAFT',
    featured        BOOLEAN      NOT NULL DEFAULT FALSE,
    is_sample       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    published_at    TIMESTAMPTZ,
    archived_at     TIMESTAMPTZ,
    CONSTRAINT ck_product_audience CHECK (audience IN ('CHILD', 'ADULT', 'FAMILY')),
    CONSTRAINT ck_product_gender CHECK (gender IN ('BOY', 'GIRL', 'UNISEX', 'WOMAN', 'MAN')),
    CONSTRAINT ck_product_sizing CHECK (sizing_system IN ('AGE', 'NUMERIC', 'SHOE', 'LETTER', 'ONE_SIZE')),
    CONSTRAINT ck_product_status CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    CONSTRAINT ck_product_price CHECK (base_price >= 0 AND (sale_price IS NULL OR (sale_price >= 0 AND sale_price < base_price)))
);
CREATE INDEX idx_product_listing ON product (status, category_id, created_at);
CREATE INDEX idx_product_featured ON product (featured, status);
CREATE INDEX idx_product_audience ON product (audience, status);

CREATE TABLE product_image (
    id              BIGSERIAL PRIMARY KEY,
    product_id      BIGINT       NOT NULL REFERENCES product (id) ON DELETE CASCADE,
    url             VARCHAR(1024) NOT NULL,
    storage_key     VARCHAR(512),
    alt_en          VARCHAR(255),
    alt_am          VARCHAR(255),
    sort_order      INT          NOT NULL DEFAULT 0,
    is_primary      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_product_image_product ON product_image (product_id, sort_order);

CREATE TABLE product_variant (
    id                  BIGSERIAL PRIMARY KEY,
    product_id          BIGINT       NOT NULL REFERENCES product (id) ON DELETE CASCADE,
    size_label          VARCHAR(64)  NOT NULL,
    color_name          VARCHAR(64)  NOT NULL DEFAULT 'Default',
    color_hex           VARCHAR(9),
    sku                 VARCHAR(120) UNIQUE,
    price_override      NUMERIC(12, 2),
    stock               INT          NOT NULL DEFAULT 0,
    low_stock_threshold INT,
    active              BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_variant_stock CHECK (stock >= 0),
    CONSTRAINT uq_variant_combo UNIQUE (product_id, size_label, color_name)
);
CREATE INDEX idx_variant_product ON product_variant (product_id, active);
CREATE INDEX idx_variant_low_stock ON product_variant (stock);

CREATE TABLE customer (
    id                  BIGSERIAL PRIMARY KEY,
    full_name           VARCHAR(255) NOT NULL,
    phone               VARCHAR(32)  NOT NULL UNIQUE,
    secondary_phone     VARCHAR(32),
    preferred_language  VARCHAR(8)   NOT NULL DEFAULT 'en',
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_order_at       TIMESTAMPTZ
);

CREATE TABLE telegram_account (
    id                  BIGSERIAL PRIMARY KEY,
    customer_id         BIGINT       NOT NULL REFERENCES customer (id) ON DELETE CASCADE,
    telegram_user_id    BIGINT       NOT NULL UNIQUE,
    telegram_username   VARCHAR(64),
    first_name          VARCHAR(120),
    last_name           VARCHAR(120),
    language_code       VARCHAR(8),
    photo_url           VARCHAR(1024),
    verified_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_telegram_account_customer ON telegram_account (customer_id);

CREATE TABLE customer_address (
    id              BIGSERIAL PRIMARY KEY,
    customer_id     BIGINT       NOT NULL REFERENCES customer (id) ON DELETE CASCADE,
    label           VARCHAR(64),
    region          VARCHAR(120) NOT NULL,
    city            VARCHAR(120) NOT NULL,
    sub_city        VARCHAR(120),
    neighborhood    VARCHAR(120),
    address_line    VARCHAR(512) NOT NULL,
    instructions    VARCHAR(512),
    is_default      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_customer_address_customer ON customer_address (customer_id);

CREATE TABLE customer_session (
    id              BIGSERIAL PRIMARY KEY,
    customer_id     BIGINT       NOT NULL REFERENCES customer (id) ON DELETE CASCADE,
    token_hash      VARCHAR(128) NOT NULL UNIQUE,
    source          VARCHAR(16)  NOT NULL,
    telegram_user_id BIGINT,
    expires_at      TIMESTAMPTZ  NOT NULL,
    revoked         BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_customer_session_source CHECK (source IN ('TELEGRAM', 'WEB_PHONE'))
);

CREATE TABLE cart (
    id              BIGSERIAL PRIMARY KEY,
    cart_key        VARCHAR(64)  NOT NULL UNIQUE,
    customer_id     BIGINT       REFERENCES customer (id) ON DELETE SET NULL,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE cart_item (
    id              BIGSERIAL PRIMARY KEY,
    cart_id         BIGINT       NOT NULL REFERENCES cart (id) ON DELETE CASCADE,
    variant_id      BIGINT       NOT NULL REFERENCES product_variant (id) ON DELETE CASCADE,
    quantity        INT          NOT NULL,
    added_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_cart_item_quantity CHECK (quantity > 0),
    CONSTRAINT uq_cart_variant UNIQUE (cart_id, variant_id)
);

CREATE SEQUENCE order_number_seq START 1;

CREATE TABLE orders (
    id                          BIGSERIAL PRIMARY KEY,
    order_number                VARCHAR(32)  NOT NULL UNIQUE,
    public_token                VARCHAR(64)  NOT NULL UNIQUE,
    customer_id                 BIGINT       REFERENCES customer (id) ON DELETE SET NULL,
    cart_key                    VARCHAR(64),
    telegram_user_id            BIGINT,
    status                      VARCHAR(32)  NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    payment_status              VARCHAR(16)  NOT NULL DEFAULT 'UNPAID',
    payment_method              VARCHAR(32)  NOT NULL DEFAULT 'CASH_ON_DELIVERY',
    currency                    VARCHAR(8)   NOT NULL DEFAULT 'ETB',
    subtotal                    NUMERIC(12, 2) NOT NULL,
    delivery_fee                NUMERIC(12, 2) NOT NULL,
    discount_amount             NUMERIC(12, 2) NOT NULL DEFAULT 0,
    total_amount                NUMERIC(12, 2) NOT NULL,
    amount_collected            NUMERIC(12, 2) NOT NULL DEFAULT 0,
    customer_name               VARCHAR(255) NOT NULL,
    customer_phone              VARCHAR(32)  NOT NULL,
    secondary_phone             VARCHAR(32),
    region                      VARCHAR(120) NOT NULL,
    city                          VARCHAR(120) NOT NULL,
    sub_city                      VARCHAR(120),
    neighborhood                  VARCHAR(120),
    address_line                  VARCHAR(512) NOT NULL,
    delivery_instructions         VARCHAR(512),
    preferred_delivery_time       VARCHAR(120),
    delivery_zone_id              BIGINT       REFERENCES delivery_zone (id) ON DELETE SET NULL,
    courier_name                  VARCHAR(120),
    courier_phone                 VARCHAR(32),
    placement_source              VARCHAR(16)  NOT NULL DEFAULT 'WEB',
    idempotency_key               VARCHAR(128) UNIQUE,
    cancel_requested_at           TIMESTAMPTZ,
    cancelled_at                  TIMESTAMPTZ,
    cancellation_reason           VARCHAR(512),
    cancelled_by                  VARCHAR(120),
    stock_restored                BOOLEAN      NOT NULL DEFAULT FALSE,
    confirmed_at                  TIMESTAMPTZ,
    processing_at                 TIMESTAMPTZ,
    out_for_delivery_at           TIMESTAMPTZ,
    delivered_at                  TIMESTAMPTZ,
    failed_delivery_count         INT          NOT NULL DEFAULT 0,
    payment_collected_at          TIMESTAMPTZ,
    payment_collected_by          VARCHAR(120),
    created_at                    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at                    TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_orders_status CHECK (status IN
        ('PENDING_CONFIRMATION', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED_DELIVERY', 'CANCELLED')),
    CONSTRAINT ck_orders_payment_status CHECK (payment_status IN ('UNPAID', 'PAID', 'REFUNDED')),
    CONSTRAINT ck_orders_payment_method CHECK (payment_method = 'CASH_ON_DELIVERY'),
    CONSTRAINT ck_orders_placement CHECK (placement_source IN ('TELEGRAM', 'WEB')),
    CONSTRAINT ck_orders_totals CHECK (subtotal >= 0 AND delivery_fee >= 0 AND total_amount >= 0)
);
CREATE INDEX idx_orders_status_created ON orders (status, created_at);
CREATE INDEX idx_orders_payment_status ON orders (payment_status, created_at);
CREATE INDEX idx_orders_phone ON orders (customer_phone);
CREATE INDEX idx_orders_customer ON orders (customer_id, created_at);
CREATE INDEX idx_orders_created ON orders (created_at);

CREATE TABLE order_item (
    id                  BIGSERIAL PRIMARY KEY,
    order_id            BIGINT       NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    product_id          BIGINT       REFERENCES product (id) ON DELETE SET NULL,
    variant_id          BIGINT       REFERENCES product_variant (id) ON DELETE SET NULL,
    product_slug        VARCHAR(160),
    product_name_en     VARCHAR(255) NOT NULL,
    product_name_am     VARCHAR(255) NOT NULL,
    size_label          VARCHAR(64)  NOT NULL,
    color_name          VARCHAR(64)  NOT NULL,
    unit_price          NUMERIC(12, 2) NOT NULL,
    quantity            INT          NOT NULL,
    line_total          NUMERIC(12, 2) NOT NULL,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_order_item_quantity CHECK (quantity > 0),
    CONSTRAINT ck_order_item_price CHECK (unit_price >= 0)
);
CREATE INDEX idx_order_item_order ON order_item (order_id);
CREATE INDEX idx_order_item_product ON order_item (product_id);

CREATE TABLE order_status_event (
    id                  BIGSERIAL PRIMARY KEY,
    order_id            BIGINT       NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
    from_status         VARCHAR(32),
    to_status           VARCHAR(32)  NOT NULL,
    from_payment_status VARCHAR(16),
    to_payment_status   VARCHAR(16),
    note                VARCHAR(512),
    actor_type          VARCHAR(24)  NOT NULL,
    actor_email         VARCHAR(255),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_order_event_actor CHECK (actor_type IN ('ADMIN', 'CUSTOMER', 'SYSTEM', 'TELEGRAM_BUTTON'))
);
CREATE INDEX idx_order_event_order ON order_status_event (order_id, created_at);

CREATE TABLE inventory_movement (
    id              BIGSERIAL PRIMARY KEY,
    variant_id      BIGINT       NOT NULL REFERENCES product_variant (id) ON DELETE CASCADE,
    product_id      BIGINT       NOT NULL REFERENCES product (id) ON DELETE CASCADE,
    change_qty      INT          NOT NULL,
    balance_after   INT          NOT NULL,
    reason          VARCHAR(32)  NOT NULL,
    reference_type  VARCHAR(32),
    reference_id    BIGINT,
    actor_type      VARCHAR(24)  NOT NULL DEFAULT 'SYSTEM',
    actor_email     VARCHAR(255),
    note            VARCHAR(512),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_inventory_reason CHECK (reason IN
        ('ORDER_RESERVED', 'CANCEL_RESTORED', 'ADMIN_ADJUST', 'STOCK_SET', 'INITIAL_STOCK')),
    CONSTRAINT ck_inventory_actor CHECK (actor_type IN ('ADMIN', 'SYSTEM'))
);
CREATE INDEX idx_inventory_variant ON inventory_movement (variant_id, created_at);
CREATE INDEX idx_inventory_reference ON inventory_movement (reference_type, reference_id);

CREATE TABLE audit_log (
    id              BIGSERIAL PRIMARY KEY,
    admin_id        BIGINT       REFERENCES administrator (id) ON DELETE SET NULL,
    actor_email     VARCHAR(255),
    actor_type      VARCHAR(24)  NOT NULL DEFAULT 'ADMIN',
    action          VARCHAR(64)  NOT NULL,
    entity_type     VARCHAR(64)  NOT NULL,
    entity_id       VARCHAR(64),
    summary         VARCHAR(512),
    changes         TEXT,
    ip_address      VARCHAR(64),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_audit_actor CHECK (actor_type IN ('ADMIN', 'SYSTEM', 'TELEGRAM_BUTTON', 'CUSTOMER'))
);
CREATE INDEX idx_audit_created ON audit_log (created_at);
CREATE INDEX idx_audit_entity ON audit_log (entity_type, entity_id);

CREATE TABLE notification_outbox (
    id                  BIGSERIAL PRIMARY KEY,
    event_type          VARCHAR(40)  NOT NULL,
    aggregate_type      VARCHAR(40)  NOT NULL,
    aggregate_id        BIGINT,
    order_id            BIGINT       REFERENCES orders (id) ON DELETE CASCADE,
    idempotency_key     VARCHAR(200) NOT NULL UNIQUE,
    chat_id             BIGINT,
    message             TEXT         NOT NULL,
    parse_mode          VARCHAR(16),
    admin_link          VARCHAR(1024),
    inline_actions      BOOLEAN      NOT NULL DEFAULT FALSE,
    status              VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
    attempts            INT          NOT NULL DEFAULT 0,
    max_attempts        INT          NOT NULL DEFAULT 8,
    next_attempt_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
    last_attempt_at     TIMESTAMPTZ,
    locked_until        TIMESTAMPTZ,
    sent_at             TIMESTAMPTZ,
    telegram_message_id BIGINT,
    last_error          VARCHAR(1000),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_outbox_status CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'RETRY', 'DEAD_LETTER', 'CANCELLED')),
    CONSTRAINT ck_outbox_event CHECK (event_type IN
        ('NEW_ORDER', 'CANCEL_REQUEST', 'ORDER_CANCELLED', 'FAILED_DELIVERY', 'ORDER_DELIVERED',
         'CASH_COLLECTED', 'LOW_STOCK', 'OUT_OF_STOCK', 'TEST', 'ORDER_CONFIRMED'))
);
CREATE INDEX idx_outbox_dispatch ON notification_outbox (status, next_attempt_at);
CREATE INDEX idx_outbox_order ON notification_outbox (order_id, created_at);

CREATE TABLE telegram_pairing_code (
    id                      BIGSERIAL PRIMARY KEY,
    code                    VARCHAR(16)  NOT NULL UNIQUE,
    requested_contact_phone VARCHAR(32)  NOT NULL,
    created_by_email        VARCHAR(255),
    status                  VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    telegram_user_id        BIGINT,
    telegram_chat_id        BIGINT,
    expires_at              TIMESTAMPTZ  NOT NULL,
    consumed_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_pairing_status CHECK (status IN ('PENDING', 'CONSUMED', 'EXPIRED', 'REJECTED'))
);

CREATE TABLE telegram_callback_log (
    id                  BIGSERIAL PRIMARY KEY,
    callback_id         VARCHAR(128) NOT NULL UNIQUE,
    telegram_user_id    BIGINT       NOT NULL,
    chat_id             BIGINT,
    action              VARCHAR(64)  NOT NULL,
    order_id            BIGINT,
    authorized          BOOLEAN      NOT NULL,
    result              VARCHAR(512),
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE promo_banner (
    id              BIGSERIAL PRIMARY KEY,
    title_en        VARCHAR(255) NOT NULL,
    title_am        VARCHAR(255) NOT NULL,
    subtitle_en     VARCHAR(512),
    subtitle_am     VARCHAR(512),
    image_url       VARCHAR(1024),
    link_type       VARCHAR(24)  NOT NULL DEFAULT 'CATEGORY',
    link_value      VARCHAR(255),
    placement       VARCHAR(24)  NOT NULL DEFAULT 'HERO',
    sort_order      INT          NOT NULL DEFAULT 0,
    active          BOOLEAN      NOT NULL DEFAULT TRUE,
    starts_at       TIMESTAMPTZ,
    ends_at         TIMESTAMPTZ,
    is_sample       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT ck_banner_placement CHECK (placement IN ('HERO', 'GRID', 'HOME')),
    CONSTRAINT ck_banner_link_type CHECK (link_type IN ('CATEGORY', 'PRODUCT', 'COLLECTION', 'NONE'))
);

CREATE TABLE collection (
    id              BIGSERIAL PRIMARY KEY,
    slug            VARCHAR(120) NOT NULL UNIQUE,
    name_en         VARCHAR(255) NOT NULL,
    name_am         VARCHAR(255) NOT NULL,
    description_en  TEXT,
    description_am  TEXT,
    sort_order      INT          NOT NULL DEFAULT 0,
    active          BOOLEAN      NOT NULL DEFAULT TRUE,
    is_sample       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE collection_item (
    id              BIGSERIAL PRIMARY KEY,
    collection_id   BIGINT       NOT NULL REFERENCES collection (id) ON DELETE CASCADE,
    product_id      BIGINT       NOT NULL REFERENCES product (id) ON DELETE CASCADE,
    sort_order      INT          NOT NULL DEFAULT 0,
    CONSTRAINT uq_collection_product UNIQUE (collection_id, product_id)
);

CREATE TABLE size_guide (
    id              BIGSERIAL PRIMARY KEY,
    sizing_system   VARCHAR(24)  NOT NULL UNIQUE,
    title_en        VARCHAR(255) NOT NULL,
    title_am        VARCHAR(255) NOT NULL,
    body_en         TEXT,
    body_am         TEXT,
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE stock_alert_read (
    id              BIGSERIAL PRIMARY KEY,
    variant_id      BIGINT       NOT NULL REFERENCES product_variant (id) ON DELETE CASCADE,
    alert_type      VARCHAR(24)  NOT NULL,
    stock_at_notice INT          NOT NULL,
    acknowledged    BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_stock_alert UNIQUE (variant_id, alert_type, stock_at_notice)
);
