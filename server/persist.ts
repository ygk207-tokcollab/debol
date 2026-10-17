import { q, tx, dbEnabled } from './db';
import type * as DataModule from './data';

type Db = typeof DataModule.db;

const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const iso = (v: unknown): string => (v instanceof Date ? v.toISOString() : String(v ?? new Date().toISOString()));
const round = (v: unknown): number => Math.round(Number(v ?? 0) * 100) / 100;
const money = (v: unknown): number | null => (v == null ? null : round(v));
const r2 = (v: unknown): number => round(v);
const bool = (v: unknown): boolean => v === true || v === 'true' || v === 1;

/**
 * Load every collection out of Postgres and replace the in-memory state in place, so the handlers
 * keep reading db.products / db.orders exactly as before.
 */
export async function hydrate(target: Db): Promise<void> {
  if (!dbEnabled()) return;

  const [settings, telegram, categories, ageGroups, zones, guides, admins, products, variants, images, orders, items, history, carts, profiles, audit, banners, collections] =
    await Promise.all([
      q('select data from store_settings where id = 1'),
      q('select data from telegram_status where id = 1'),
      q('select * from categories order by sort_order, id'),
      q('select * from age_groups order by sort_order, id'),
      q('select * from delivery_zones order by id'),
      q('select * from size_guides order by ord'),
      q('select id, email, full_name, phone, role, active, password_hash, created_at from administrators order by id'),
      q('select * from products order by id'),
      q('select * from product_variants order by id'),
      // content is deliberately not selected: image bytes stay in Postgres and are served by id.
      q('select id, product_id, url, alt_en, is_primary, content_type, size_bytes, created_at from product_images order by id'),
      q('select * from orders order by id'),
      q('select * from order_items order by order_id, id'),
      q('select * from order_history order by order_id, at, id'),
      q('select key, data from carts'),
      q('select key, data from customer_profiles'),
      q('select * from audit_logs order by at desc'),
      q('select * from banners order by sort_order, id'),
      q('select * from collections order by ord'),
    ]);

  if (settings.rowCount) Object.assign(target.storeSettings, settings.rows[0].data);
  if (telegram.rowCount) Object.assign(target.telegramStatus, telegram.rows[0].data);

  target.categories = categories.rows.map((r: any) => ({
    id: r.id, slug: r.slug, nameEn: r.name_en, nameAm: r.name_am ?? undefined,
    descriptionEn: r.description_en ?? undefined, audience: r.audience,
    productCount: 0, sortOrder: r.sort_order, active: bool(r.active), isSample: bool(r.is_sample),
  }));

  target.ageGroups = ageGroups.rows.map((r: any) => ({
    id: r.id, code: r.code, label: r.label, minAge: numOrNull(r.min_age) ?? undefined,
    maxAge: numOrNull(r.max_age) ?? undefined, ageUnit: r.age_unit, sortOrder: r.sort_order, active: bool(r.active),
  }));

  target.deliveryZones = zones.rows.map((r: any) => ({
    id: r.id, nameEn: r.name_en, region: r.region, city: r.city, subCity: r.sub_city ?? undefined,
    fee: r2(r.fee), freeOver: money(r.free_over), estimatedDays: r.estimated_days, active: bool(r.active),
  }));

  target.sizeGuides = guides.rows.map((r: any) => ({
    sizingSystem: r.sizing_system, titleEn: r.title_en, titleAm: r.title_am ?? undefined,
    bodyEn: r.body_en ?? undefined, bodyAm: r.body_am ?? undefined,
  }));

  target.administrators = admins.rows.map((r: any) => ({
    id: r.id, email: r.email, fullName: r.full_name, phone: r.phone, role: r.role,
    active: bool(r.active), passwordHash: r.password_hash, createdAt: iso(r.created_at),
  }));

  const byProduct = new Map<number, any[]>();
  for (const v of variants.rows) {
    const list = byProduct.get(v.product_id) ?? [];
    list.push({
      id: Number(v.id), sizeLabel: v.size_label, colorName: v.color_name, colorHex: v.color_hex ?? undefined,
      sku: v.sku, effectivePrice: numOrNull(r2(v.effective_price)) ?? undefined, stock: v.stock,
      lowStockThreshold: v.low_stock_threshold, lowStock: v.stock <= v.low_stock_threshold, active: bool(v.active),
    });
    byProduct.set(v.product_id, list);
  }

  const imgsByProduct = new Map<number, any[]>();
  for (const i of images.rows) {
    const list = imgsByProduct.get(i.product_id) ?? [];
    list.push({ id: Number(i.id), url: i.url, altEn: i.alt_en ?? undefined, isPrimary: bool(i.is_primary), contentType: i.content_type, sizeBytes: i.size_bytes });
    imgsByProduct.set(i.product_id, list);
  }

  target.products = products.rows.map((r: any) => ({
    id: r.id, slug: r.slug, nameEn: r.name_en, nameAm: r.name_am ?? undefined,
    descriptionEn: r.description_en ?? undefined, descriptionAm: r.description_am ?? undefined,
    categoryId: numOrNull(r.category_id) ?? undefined, categorySlug: r.category_slug, categoryNameEn: r.category_name_en,
    audience: r.audience, gender: r.gender, ageGroups: r.age_groups ?? [], sizingSystem: r.sizing_system,
    basePrice: r2(r.base_price), price: r2(r.base_price), salePrice: money(r.sale_price),
    currency: r.currency, status: r.status, featured: bool(r.featured), isSample: bool(r.is_sample),
    totalStock: r.total_stock, lowStockVariants: 0,
    variants: byProduct.get(r.id) ?? [], images: imgsByProduct.get(r.id) ?? [],
    createdAt: iso(r.created_at), updatedAt: iso(r.updated_at), publishedAt: r.published_at ? iso(r.published_at) : undefined,
  }));
  for (const p of target.products) {
    p.totalStock = p.variants.reduce((acc: number, v: any) => acc + (v.stock || 0), 0);
    p.lowStockVariants = p.variants.filter((v: any) => v.stock <= v.lowStockThreshold).length;
  }

  const itemsByOrder = new Map<number, any[]>();
  for (const it of items.rows) {
    const list = itemsByOrder.get(it.order_id) ?? [];
    list.push({
      id: Number(it.id), variantId: Number(it.variant_id), productId: it.product_id, productSlug: it.product_slug,
      nameEn: it.name_en, sizeLabel: it.size_label, colorName: it.color_name,
      unitPrice: r2(it.unit_price), quantity: it.quantity, lineTotal: r2(it.line_total),
    });
    itemsByOrder.set(it.order_id, list);
  }

  const historyByOrder = new Map<number, any[]>();
  for (const h of history.rows) {
    const list = historyByOrder.get(h.order_id) ?? [];
    list.push({
      fromStatus: h.from_status ?? null, toStatus: h.to_status, note: h.note ?? null,
      actorType: h.actor_type, actor: h.actor ?? null, at: iso(h.at),
    });
    historyByOrder.set(h.order_id, list);
  }

  target.orders = orders.rows.map((r: any) => ({
    id: r.id, orderNumber: r.order_number, publicToken: r.public_token, status: r.status,
    paymentStatus: r.payment_status, paymentMethod: r.payment_method, currency: r.currency,
    subtotal: r2(r.subtotal), deliveryFee: r2(r.delivery_fee), totalAmount: r2(r.total_amount),
    amountCollected: r2(r.amount_collected), customerName: r.customer_name, customerPhone: r.customer_phone,
    secondaryPhone: r.secondary_phone ?? undefined, city: r.city ?? '', region: r.region ?? '',
    subCity: r.sub_city ?? undefined, neighborhood: r.neighborhood ?? undefined, addressLine: r.address_line ?? undefined,
    deliveryInstructions: r.delivery_instructions ?? undefined, preferredDeliveryTime: r.preferred_delivery_time ?? undefined,
    deliveryAddress: r.delivery_address ?? undefined, itemCount: r.item_count,
    items: itemsByOrder.get(r.id) ?? [], placedVia: r.placed_via, cancelRequested: bool(r.cancel_requested),
    cancelReason: r.cancel_reason ?? undefined, courierName: r.courier_name ?? null, courierPhone: r.courier_phone ?? null,
    history: historyByOrder.get(r.id) ?? [], createdAt: iso(r.created_at), updatedAt: iso(r.updated_at),
  }));

  target.carts = new Map(carts.rows.map((r: any) => [r.key, r.data as any]));
  target.customerProfiles = new Map(profiles.rows.map((r: any) => [r.key, r.data]));
  target.auditLogs = audit.rows.map((r: any) => ({ ...r.data, id: String(r.id) }));
  target.banners = banners.rows.map((r: any) => ({
    id: r.id, titleEn: r.title_en, subtitleEn: r.subtitle_en, linkType: r.link_type,
    linkValue: r.link_value, placement: r.placement, imageUrl: r.image_url, active: bool(r.active), sortOrder: r.sort_order,
  }));
  target.collections = collections.rows.map((r: any) => ({ slug: r.slug, nameEn: r.name_en, ...r.data }));

  console.log(`[db] hydrated ${target.products.length} products, ${target.orders.length} orders, ${target.carts.size} carts`);
}

/**
 * Write the whole in-memory state back. Every table is upserted and then trimmed to the ids the app
 * still references — never truncated, because deleting a product would cascade and destroy the
 * uploaded image bytes that only live in Postgres.
 */
export async function persistAll(source: Db): Promise<void> {
  if (!dbEnabled()) return;

  await tx(async (c) => {
    const run = (sql: string, params?: unknown[]) => c.query(sql, params);
    const keep = async (
      table: string,
      ids: (number | bigint | string)[],
      cast: string,
      column = 'id',
    ) => {
      if (!ids.length) {
        await run(`delete from ${table}`);
        return;
      }
      await run(`delete from ${table} where ${column} <> all($1::${cast}[])`, [ids.map(String)]);
    };

    await run(
      'insert into store_settings (id, data) values (1, $1) on conflict (id) do update set data = excluded.data',
      [JSON.stringify(source.storeSettings)],
    );
    await run(
      'insert into telegram_status (id, data) values (1, $1) on conflict (id) do update set data = excluded.data',
      [JSON.stringify(source.telegramStatus)],
    );

    for (const x of source.categories) {
      await run(
        `insert into categories (id, slug, name_en, name_am, description_en, audience, sort_order, active, is_sample)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (id) do update set slug=excluded.slug, name_en=excluded.name_en, name_am=excluded.name_am,
           description_en=excluded.description_en, audience=excluded.audience, sort_order=excluded.sort_order,
           active=excluded.active, is_sample=excluded.is_sample`,
        [x.id, x.slug, x.nameEn, x.nameAm ?? null, x.descriptionEn ?? null, x.audience, x.sortOrder ?? 0, x.active ?? true, x.isSample ?? false],
      );
    }
    await keep('categories', source.categories.map((x) => x.id), 'int');

    for (const x of source.ageGroups) {
      await run(
        `insert into age_groups (id, code, label, min_age, max_age, age_unit, sort_order, active)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (id) do update set code=excluded.code, label=excluded.label, min_age=excluded.min_age,
           max_age=excluded.max_age, age_unit=excluded.age_unit, sort_order=excluded.sort_order, active=excluded.active`,
        [x.id, x.code, x.label, x.minAge ?? null, x.maxAge ?? null, x.ageUnit, x.sortOrder ?? 0, x.active ?? true],
      );
    }
    await keep('age_groups', source.ageGroups.map((x) => x.id), 'int');

    for (const x of source.deliveryZones) {
      await run(
        `insert into delivery_zones (id, name_en, region, city, sub_city, fee, free_over, estimated_days, active)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (id) do update set name_en=excluded.name_en, region=excluded.region, city=excluded.city,
           sub_city=excluded.sub_city, fee=excluded.fee, free_over=excluded.free_over,
           estimated_days=excluded.estimated_days, active=excluded.active`,
        [x.id, x.nameEn, x.region, x.city, x.subCity ?? null, r2(x.fee), money(x.freeOver), x.estimatedDays ?? 2, x.active ?? true],
      );
    }
    await keep('delivery_zones', source.deliveryZones.map((x) => x.id), 'int');

    for (const [idx, x] of source.sizeGuides.entries()) {
      await run(
        `insert into size_guides (sizing_system, title_en, title_am, body_en, body_am, ord)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (sizing_system) do update set title_en=excluded.title_en, title_am=excluded.title_am,
           body_en=excluded.body_en, body_am=excluded.body_am, ord=excluded.ord`,
        [x.sizingSystem, x.titleEn, x.titleAm ?? null, x.bodyEn ?? null, x.bodyAm ?? null, idx],
      );
    }
    await keep('size_guides', source.sizeGuides.map((x: any) => x.sizingSystem), 'text', 'sizing_system');

    for (const p of source.products) {
      await run(
        `insert into products (id, slug, name_en, name_am, description_en, description_am, category_id, category_slug,
            category_name_en, audience, gender, age_groups, sizing_system, base_price, sale_price, currency, status,
            featured, is_sample, total_stock, created_at, updated_at, published_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         on conflict (id) do update set slug=excluded.slug, name_en=excluded.name_en, name_am=excluded.name_am,
           description_en=excluded.description_en, description_am=excluded.description_am,
           category_id=excluded.category_id, category_slug=excluded.category_slug,
           category_name_en=excluded.category_name_en, audience=excluded.audience, gender=excluded.gender,
           age_groups=excluded.age_groups, sizing_system=excluded.sizing_system, base_price=excluded.base_price,
           sale_price=excluded.sale_price, currency=excluded.currency, status=excluded.status,
           featured=excluded.featured, is_sample=excluded.is_sample, total_stock=excluded.total_stock,
           updated_at=excluded.updated_at, published_at=excluded.published_at`,
        [p.id, p.slug, p.nameEn, p.nameAm ?? null, p.descriptionEn ?? null, p.descriptionAm ?? null,
         p.categoryId ?? null, p.categorySlug, p.categoryNameEn, p.audience, p.gender, p.ageGroups ?? [],
         p.sizingSystem, r2(p.basePrice), money(p.salePrice), p.currency, p.status, p.featured ?? false,
         p.isSample ?? false, p.totalStock ?? 0, p.createdAt, p.updatedAt, p.publishedAt ?? null],
      );
    }
    await keep('products', source.products.map((p) => p.id), 'int');

    const liveVariants: number[] = [];
    for (const p of source.products) {
      for (const v of p.variants) {
        liveVariants.push(v.id);
        await run(
          `insert into product_variants (id, product_id, size_label, color_name, color_hex, sku, effective_price,
              stock, low_stock_threshold, active)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
           on conflict (id) do update set product_id=excluded.product_id, size_label=excluded.size_label,
             color_name=excluded.color_name, color_hex=excluded.color_hex, sku=excluded.sku,
             effective_price=excluded.effective_price, stock=excluded.stock,
             low_stock_threshold=excluded.low_stock_threshold, active=excluded.active`,
          [v.id, p.id, v.sizeLabel, v.colorName, v.colorHex ?? null, v.sku, money(v.effectivePrice),
           Math.max(0, v.stock ?? 0), v.lowStockThreshold ?? 3, v.active ?? true],
        );
      }
    }
    await keep('product_variants', liveVariants, 'bigint');

    const liveImages: number[] = [];
    for (const p of source.products) {
      for (const i of p.images ?? []) {
        liveImages.push(Number(i.id));
        // content is never written here: only the upload route owns bytes.
        await run(
          `insert into product_images (id, product_id, url, alt_en, is_primary, content_type, size_bytes)
           values ($1,$2,$3,$4,$5,$6,$7)
           on conflict (id) do update set product_id=excluded.product_id, url=excluded.url,
             alt_en=excluded.alt_en, is_primary=excluded.is_primary`,
          [i.id, p.id, i.url, i.altEn ?? null, i.isPrimary ?? false, i.contentType ?? null, i.sizeBytes ?? null],
        );
      }
    }
    await keep('product_images', liveImages, 'bigint');

    for (const a of source.administrators) {
      await run(
        `insert into administrators (id, email, full_name, phone, role, active, password_hash, created_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (id) do update set email=excluded.email, full_name=excluded.full_name, phone=excluded.phone,
           role=excluded.role, active=excluded.active, password_hash=excluded.password_hash`,
        [a.id, a.email, a.fullName, a.phone ?? null, a.role, a.active ?? true, a.passwordHash ?? null, a.createdAt],
      );
    }
    await keep('administrators', source.administrators.map((a) => a.id), 'int');

    for (const o of source.orders) {
      await run(
        `insert into orders (id, order_number, public_token, status, payment_status, payment_method, currency,
            subtotal, delivery_fee, total_amount, amount_collected, customer_name, customer_phone, secondary_phone,
            city, region, sub_city, neighborhood, address_line, delivery_instructions, preferred_delivery_time,
            delivery_address, item_count, placed_via, cancel_requested, cancel_reason, courier_name, courier_phone,
            created_at, updated_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30)
         on conflict (id) do update set status=excluded.status, payment_status=excluded.payment_status,
           amount_collected=excluded.amount_collected, cancel_requested=excluded.cancel_requested,
           cancel_reason=excluded.cancel_reason, courier_name=excluded.courier_name,
           courier_phone=excluded.courier_phone, delivery_address=excluded.delivery_address,
           address_line=excluded.address_line, neighborhood=excluded.neighborhood, sub_city=excluded.sub_city,
           city=excluded.city, region=excluded.region, delivery_instructions=excluded.delivery_instructions,
           preferred_delivery_time=excluded.preferred_delivery_time, item_count=excluded.item_count,
           subtotal=excluded.subtotal, delivery_fee=excluded.delivery_fee, total_amount=excluded.total_amount,
           updated_at=excluded.updated_at`,
        [o.id, o.orderNumber, o.publicToken, o.status, o.paymentStatus, o.paymentMethod, o.currency,
         r2(o.subtotal), r2(o.deliveryFee), r2(o.totalAmount), r2(o.amountCollected), o.customerName,
         o.customerPhone, o.secondaryPhone ?? null, o.city, o.region, o.subCity ?? null, o.neighborhood ?? null,
         o.addressLine ?? null, o.deliveryInstructions ?? null, o.preferredDeliveryTime ?? null,
         o.deliveryAddress ?? null, o.itemCount, o.placedVia, o.cancelRequested ?? false, o.cancelReason ?? null,
         o.courierName ?? null, o.courierPhone ?? null, o.createdAt, o.updatedAt],
      );

      await run('delete from order_items where order_id = $1', [o.id]);
      for (const [idx, it] of o.items.entries()) {
        await run(
          `insert into order_items (id, order_id, variant_id, product_id, product_slug, name_en, size_label, color_name,
              unit_price, quantity, line_total) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          // Seeded items all share id 1, so the line id is derived from its order instead of reused.
          [o.id * 1000 + idx + 1, o.id, it.variantId, it.productId, it.productSlug ?? null, it.nameEn, it.sizeLabel, it.colorName,
           r2(it.unitPrice), it.quantity, r2(it.lineTotal)],
        );
      }

      await run('delete from order_history where order_id = $1', [o.id]);
      for (const h of o.history ?? []) {
        await run(
          `insert into order_history (order_id, from_status, to_status, note, actor_type, actor, at)
           values ($1,$2,$3,$4,$5,$6,$7)`,
          [o.id, h.fromStatus ?? null, h.toStatus, h.note ?? null, h.actorType ?? 'SYSTEM', h.actor ?? null, h.at],
        );
      }
    }
    await keep('orders', source.orders.map((o) => o.id), 'int');

    for (const [key, items] of source.carts) {
      await run(
        'insert into carts (key, data) values ($1,$2) on conflict (key) do update set data=excluded.data, updated_at=now()',
        [key, JSON.stringify(items)],
      );
    }
    if (source.carts.size) {
      await run('delete from carts where key <> all($1::text[])', [[...source.carts.keys()]]);
    } else {
      await run('delete from carts');
    }

    for (const [key, profile] of source.customerProfiles) {
      await run('insert into customer_profiles (key, data) values ($1,$2) on conflict (key) do update set data=excluded.data', [key, JSON.stringify(profile)]);
    }
    if (source.customerProfiles.size) {
      await run('delete from customer_profiles where key <> all($1::text[])', [[...source.customerProfiles.keys()]]);
    } else {
      await run('delete from customer_profiles');
    }

    for (const a of source.auditLogs) {
      await run(
        `insert into audit_logs (id, actor, actor_type, action, entity, entity_id, detail, ip, at, data)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         on conflict (id) do update set actor=excluded.actor, actor_type=excluded.actor_type, action=excluded.action,
           entity=excluded.entity, entity_id=excluded.entity_id, detail=excluded.detail, ip=excluded.ip,
           at=excluded.at, data=excluded.data`,
        [BigInt(String(a.id ?? 0)), a.actor ?? null, a.actorType ?? null, a.action ?? null, a.entity ?? null,
         a.entityId ?? null, a.detail ?? null, a.ip ?? null, a.at ?? new Date().toISOString(), JSON.stringify(a)],
      );
    }
    await keep('audit_logs', source.auditLogs.map((a) => a.id), 'bigint');

    for (const b of source.banners ?? []) {
      await run(
        `insert into banners (id, title_en, subtitle_en, link_type, link_value, placement, image_url, active, sort_order)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (id) do update set title_en=excluded.title_en, subtitle_en=excluded.subtitle_en,
           link_type=excluded.link_type, link_value=excluded.link_value, placement=excluded.placement,
           image_url=excluded.image_url, active=excluded.active, sort_order=excluded.sort_order`,
        [b.id, b.titleEn ?? null, b.subtitleEn ?? null, b.linkType ?? null, b.linkValue ?? null,
         b.placement ?? null, b.imageUrl ?? null, b.active ?? true, b.sortOrder ?? 0],
      );
    }
    await keep('banners', (source.banners ?? []).map((b: any) => b.id), 'int');

    for (const [idx, col] of (source.collections ?? []).entries()) {
      const { slug, nameEn, ...rest } = col;
      await run(
        `insert into collections (slug, name_en, ord, data) values ($1,$2,$3,$4)
         on conflict (slug) do update set name_en=excluded.name_en, ord=excluded.ord, data=excluded.data`,
        [slug, nameEn ?? null, idx, JSON.stringify(rest)],
      );
    }
    await keep('collections', (source.collections ?? []).map((c: any) => c.slug), 'text', 'slug');
  });
}

let chain: Promise<void> = Promise.resolve();

/**
 * Mutating handlers are synchronous and run one at a time per instance, so writes are serialised here
 * rather than diffed. Never reject to the caller: a failed write must not turn a good response into a 500.
 */
export function schedulePersist(source: Db): Promise<void> {
  if (!dbEnabled()) return Promise.resolve();
  const next = chain
    .then(() => persistAll(source))
    .catch((err: Error) => console.error('[db] persist failed:', err.message));
  chain = next;
  return next;
}

/** True when the database has no catalogue yet, i.e. the first boot against an empty branch. */
export async function isEmpty(): Promise<boolean> {
  if (!dbEnabled()) return false;
  const r = await q('select (select count(*) from products) as p, (select count(*) from categories) as c');
  return Number(r.rows[0].p) === 0 && Number(r.rows[0].c) === 0;
}

/** Await any queued writes; used by tests and graceful shutdown. */
export const flushPersist = (): Promise<void> => chain;
