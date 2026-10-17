import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

/**
 * Postgres is optional: with no DATABASE_URL the app keeps the original in-memory behaviour, so
 * `npm run dev` still works on a machine without a database.
 */
export const dbEnabled = (): boolean => Boolean(process.env.DATABASE_URL?.trim());

let pool: Pool | null = null;

/**
 * Neon hands out `?sslmode=require&channel_binding=require`. node-postgres does not understand either
 * parameter - it only reads the `ssl` option - so TLS would silently stay off and Neon would reject
 * the connection. These libpq spellings are translated here and stripped from the string we hand to
 * the driver. sslmode=require means "encrypt, do not verify the chain"; verify-ca/verify-full verify.
 * A bare host with no sslmode falls back to inference: managed hosts need TLS, localhost usually
 * does not and answers "The server does not support SSL connections" when asked. DB_SSL=true|false
 * and DB_SSL_VERIFY=false override both.
 */
export function poolConfig(connectionString: string) {
  const raw = connectionString.trim();
  let url: URL | null = null;
  try {
    url = new URL(raw);
  } catch {
    /* not a URL - use it verbatim */
  }

  const sslmode = url?.searchParams.get('sslmode')?.toLowerCase() ?? '';
  const flag = process.env.DB_SSL?.trim().toLowerCase();

  let ssl: boolean | { rejectUnauthorized: boolean } | undefined;
  if (flag === 'false' || flag === '0') ssl = false;
  else if (flag === 'true' || flag === '1') ssl = { rejectUnauthorized: process.env.DB_SSL_VERIFY !== 'false' };
  else if (sslmode === 'disable') ssl = false;
  else if (['require', 'prefer', 'allow'].includes(sslmode)) ssl = { rejectUnauthorized: false };
  else if (['verify-ca', 'verify-full'].includes(sslmode)) ssl = { rejectUnauthorized: process.env.DB_SSL_VERIFY !== 'false' };
  else {
    const host = url?.hostname ?? 'localhost';
    const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local');
    ssl = local ? false : { rejectUnauthorized: process.env.DB_SSL_VERIFY !== 'false' };
  }

  for (const param of ['sslmode', 'channel_binding']) url?.searchParams.delete(param);
  return { connectionString: url ? url.toString() : raw, ssl };
}

export function getPool(): Pool {
  if (!pool) {
    if (!dbEnabled()) throw new Error('DATABASE_URL is not set');
    const { connectionString, ssl } = poolConfig(process.env.DATABASE_URL!);
    pool = new Pool({
      connectionString,
      ssl,
      max: Number(process.env.DB_POOL_MAX || 5),
      connectionTimeoutMillis: 10_000,
      idleTimeoutMillis: 30_000,
    });
    pool.on('error', (err) => console.error('[db] idle client error', err.message));
  }
  return pool;
}

export const q = <T extends QueryResultRow = any>(text: string, params?: unknown[]): Promise<QueryResult<T>> => getPool().query<T>(text, params);

export async function tx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Commerce entities get real columns so constraints and lookups work; low-traffic configuration
 * buckets are jsonb, which matches how the handlers already treat them.
 */
export const SCHEMA = `
create table if not exists categories (
  id            int primary key,
  slug          text not null unique,
  name_en       text not null,
  name_am       text,
  description_en text,
  audience      text not null default 'CHILD',
  sort_order    int not null default 0,
  active        boolean not null default true,
  is_sample     boolean not null default false
);

create table if not exists age_groups (
  id         int primary key,
  code       text not null unique,
  label      text not null,
  min_age    int,
  max_age    int,
  age_unit   text not null default 'MONTH',
  sort_order int not null default 0,
  active     boolean not null default true
);

create table if not exists delivery_zones (
  id             int primary key,
  name_en        text not null,
  region         text not null,
  city           text not null,
  sub_city       text,
  fee            numeric(12,2) not null default 0,
  free_over      numeric(12,2),
  estimated_days int not null default 2,
  active         boolean not null default true
);

-- Keyed by sizing system: the captured API rows carry no id, and /size-guides returns them as-is.
-- ord preserves the catalogue order across a restart because those rows have no id or sort field.
create table if not exists size_guides (
  sizing_system text primary key,
  title_en      text not null,
  title_am      text,
  body_en       text,
  body_am       text,
  ord           int not null default 0
);

create table if not exists products (
  id               int primary key,
  slug             text not null unique,
  name_en          text not null,
  name_am          text,
  description_en   text,
  description_am   text,
  category_id      int references categories(id) on delete set null,
  category_slug    text not null,
  category_name_en text not null,
  audience         text not null default 'CHILD',
  gender           text not null default 'UNISEX',
  age_groups       text[] not null default '{}',
  sizing_system    text not null default 'AGE',
  base_price       numeric(12,2) not null,
  sale_price       numeric(12,2),
  currency         text not null default 'ETB',
  status           text not null default 'DRAFT',
  featured         boolean not null default false,
  is_sample        boolean not null default false,
  total_stock      int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  published_at     timestamptz
);
create index if not exists products_status_idx on products(status);
create index if not exists products_category_idx on products(category_slug);

create table if not exists product_variants (
  id                bigint primary key,
  product_id        int not null references products(id) on delete cascade,
  size_label        text not null,
  color_name        text not null,
  color_hex         text,
  sku               text not null unique,
  effective_price   numeric(12,2),
  stock             int not null default 0 check (stock >= 0),
  low_stock_threshold int not null default 3,
  active            boolean not null default true
);
create index if not exists product_variants_product_idx on product_variants(product_id);

-- Uploaded bytes live here rather than on disk: Render's filesystem is wiped on every deploy.
create table if not exists product_images (
  id           bigint primary key,
  product_id   int not null references products(id) on delete cascade,
  url          text not null,
  alt_en       text,
  is_primary   boolean not null default false,
  content      bytea,
  content_type text,
  size_bytes   int,
  created_at   timestamptz not null default now()
);
create index if not exists product_images_product_idx on product_images(product_id);
create index if not exists product_images_primary_idx on product_images(product_id, is_primary);

create table if not exists administrators (
  id            int primary key,
  email         text not null unique,
  full_name     text not null,
  phone         text,
  role          text not null default 'OWNER',
  active        boolean not null default true,
  password_hash text,
  created_at    timestamptz not null default now()
);

create table if not exists admin_sessions (
  token      text primary key,
  admin_id   int not null references administrators(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table if not exists orders (
  id                      int primary key,
  order_number            text not null unique,
  public_token            text not null,
  status                  text not null,
  payment_status          text not null,
  payment_method          text not null,
  currency                text not null default 'ETB',
  subtotal                numeric(12,2) not null,
  delivery_fee            numeric(12,2) not null,
  total_amount            numeric(12,2) not null,
  amount_collected        numeric(12,2) not null default 0,
  customer_name           text not null,
  customer_phone          text not null,
  secondary_phone         text,
  city                    text,
  region                  text,
  sub_city                text,
  neighborhood            text,
  address_line            text,
  delivery_instructions   text,
  preferred_delivery_time text,
  delivery_address        text,
  item_count              int not null default 0,
  placed_via              text not null default 'WEB',
  cancel_requested        boolean not null default false,
  cancel_reason           text,
  courier_name            text,
  courier_phone           text,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists orders_token_idx on orders(public_token);
create index if not exists orders_phone_idx on orders(customer_phone);
create index if not exists orders_created_idx on orders(created_at desc);

create table if not exists order_items (
  id           bigserial primary key,
  order_id     int not null references orders(id) on delete cascade,
  variant_id   bigint,
  product_id   int,
  product_slug text,
  name_en      text not null,
  size_label   text,
  color_name   text,
  unit_price   numeric(12,2) not null,
  quantity     int not null,
  line_total   numeric(12,2) not null
);
create index if not exists order_items_order_idx on order_items(order_id);

create table if not exists order_history (
  id          bigserial primary key,
  order_id    int not null references orders(id) on delete cascade,
  from_status text,
  to_status   text not null,
  note        text,
  actor_type  text not null default 'SYSTEM',
  actor       text,
  at          timestamptz not null default now()
);
create index if not exists order_history_order_idx on order_history(order_id, at);

create table if not exists carts (
  key       text primary key,
  data      jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists customer_profiles (
  key  text primary key,
  data jsonb not null default '{}'::jsonb
);

create table if not exists audit_logs (
  id        bigint primary key,
  actor     text,
  actor_type text,
  action    text,
  entity    text,
  entity_id text,
  detail    text,
  ip        text,
  at        timestamptz not null default now(),
  data      jsonb not null default '{}'::jsonb
);
create index if not exists audit_logs_at_idx on audit_logs(at desc);

create table if not exists banners (
  id     int primary key,
  title_en    text,
  subtitle_en text,
  link_type   text,
  link_value  text,
  placement   text,
  image_url   text,
  active      boolean not null default true,
  sort_order  int not null default 0
);

-- Keyed by slug: the captured collection rows have no id.
create table if not exists collections (
  slug    text primary key,
  name_en text,
  ord     int not null default 0,
  data    jsonb not null default '{}'::jsonb
);

-- Single-row configuration buckets.
create table if not exists store_settings (
  id    int primary key check (id = 1),
  data  jsonb not null default '{}'::jsonb
);
create table if not exists telegram_status (
  id    int primary key check (id = 1),
  data  jsonb not null default '{}'::jsonb
);
`;

/**
 * POST /admin/products mints variant ids from Date.now(), which does not fit an int4. Databases
 * created before those columns were widened are corrected in place.
 */
async function widen(table: string, column: string, type: string): Promise<void> {
  const found = await q(
    'select data_type from information_schema.columns where table_name = $1 and column_name = $2',
    [table, column],
  );
  if (found.rowCount && found.rows[0].data_type === 'integer') {
    await q(`alter table ${table} alter column ${column} type ${type}`);
    console.log(`[db] widened ${table}.${column} to ${type}`);
  }
}

export async function migrate(): Promise<void> {
  if (!dbEnabled()) return;
  const statements = SCHEMA.split(';').map((s) => s.trim()).filter(Boolean);
  for (const statement of statements) await q(statement);
  await widen('product_variants', 'id', 'bigint');
  await widen('order_items', 'variant_id', 'bigint');
}

export async function closePool(): Promise<void> {
  if (pool) await pool.end();
  pool = null;
}
