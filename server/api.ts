import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import Busboy from 'busboy';
import { db, Product, Order } from './data';
import { dbEnabled, q } from './db';
import { flushPersist, schedulePersist } from './persist';
import {
  bearerToken, createSession, destroySession, devLoginAllowed,
  hashPassword, isAdminPath, isPublicAdminPath, resolveSession, verifyPassword,
} from './auth';

export const apiRouter = Router();

// The in-memory objects are the working set; Postgres is written back after each successful mutation.
apiRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    res.on('finish', () => {
      if (res.statusCode < 400) void schedulePersist(db);
    });
  }
  next();
});

apiRouter.use(async (req: Request, res: Response, next: NextFunction) => {
  if (!isAdminPath(req.path) || isPublicAdminPath(req.path)) return next();
  try {
    const adminId = await resolveSession(bearerToken(req));
    if (!adminId) {
      return res.status(401).json({ error: 'unauthorized', message: 'Admin session is required or has expired' });
    }
    const admin = db.administrators.find((a) => a.id === adminId);
    if (!admin || admin.active === false) {
      return res.status(403).json({ error: 'forbidden', message: 'This administrator account is not active' });
    }
    req.admin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
});

const UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const UPLOAD_TYPES = new Map<string, string>([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
]);

/** Holds uploaded bytes when there is no DATABASE_URL, so the dev demo can still serve them. */
const memoryImages = new Map<string, { content: Buffer; contentType: string }>();

// Helper to get or generate cart key
function getCartKey(req: Request): string {
  const headerKey = req.headers['x-cart-key'];
  if (typeof headerKey === 'string' && headerKey.trim().length >= 8) {
    return headerKey.trim();
  }
  return `guest_${Math.random().toString(36).substring(2, 12)}`;
}

// Helper to compute cart view
function getCartView(cartKey: string) {
  const items = db.carts.get(cartKey) || [];
  let subtotal = 0;
  const renderedItems = [];

  for (const item of items) {
    let matchedVariant = null;
    let matchedProduct: Product | null = null;
    for (const p of db.products) {
      const v = p.variants.find((vr) => vr.id === item.variantId);
      if (v) {
        matchedVariant = v;
        matchedProduct = p;
        break;
      }
    }

    if (matchedVariant && matchedProduct) {
      const unitPrice = matchedVariant.effectivePrice ?? matchedProduct.salePrice ?? matchedProduct.basePrice ?? matchedProduct.price ?? 0;
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;
      const primaryImage = (matchedProduct.images || []).find((im) => im.isPrimary) || (matchedProduct.images || [])[0];
      renderedItems.push({
        variantId: matchedVariant.id,
        productId: matchedProduct.id,
        productSlug: matchedProduct.slug,
        nameEn: matchedProduct.nameEn,
        sizeLabel: matchedVariant.sizeLabel,
        colorName: matchedVariant.colorName,
        colorHex: matchedVariant.colorHex ?? null,
        unitPrice,
        listPrice: matchedProduct.basePrice ?? unitPrice,
        quantity: item.quantity,
        lineTotal,
        stock: matchedVariant.stock,
        imageUrl: primaryImage ? primaryImage.url : null,
      });
    }
  }

  return {
    cartKey,
    items: renderedItems,
    subtotal,
    currency: db.storeSettings.currency || 'ETB',
  };
}

// Quote and checkout must price the same basket the same way, so both resolve the zone here.
// Matching on subCity only when the shopper supplied one keeps Addis Ababa's central/outer zones apart.
function resolveZone(region?: string, city?: string, subCity?: string) {
  const zones = db.deliveryZones;
  return (
    zones.find((z) => z.region === region && z.city === city && (!subCity || z.subCity === subCity)) ||
    zones.find((z) => z.region === region && (!subCity || !z.subCity || z.subCity === subCity)) ||
    zones.find((z) => z.region === region) ||
    zones[0] || { nameEn: null, fee: 150, freeOver: null, estimatedDays: 2 }
  );
}

function deliveryFeeFor(zone: { fee: number; freeOver?: number | null }, subtotal: number) {
  if (zone.freeOver != null && subtotal >= zone.freeOver) return 0;
  return zone.fee;
}

// The storefront reads the flat ProductSummary/ProductDetail DTOs, not the internal domain rows.
function primaryImageUrl(p: Product): string | null {
  const images = p.images || [];
  return (images.find((i) => i.isPrimary) || images[0])?.url ?? null;
}

function toProductSummary(p: Product) {
  return {
    slug: p.slug,
    nameEn: p.nameEn,
    categorySlug: p.categorySlug,
    categoryNameEn: p.categoryNameEn,
    price: p.basePrice,
    salePrice: p.salePrice ?? null,
    currency: p.currency,
    imageUrl: primaryImageUrl(p),
    totalStock: p.totalStock,
    featured: p.featured,
    sizingSystem: p.sizingSystem,
    audience: p.audience,
    gender: p.gender,
    ageGroups: p.ageGroups || [],
    createdAt: p.createdAt,
  };
}

function toProductDetail(p: Product) {
  const guide = db.sizeGuides.find((g: any) => g.sizingSystem === p.sizingSystem);
  return {
    ...toProductSummary(p),
    descriptionEn: p.descriptionEn ?? null,
    images: (p.images || []).map((i) => ({ url: i.url, altEn: i.altEn ?? null })),
    variants: p.variants.map((v) => ({
      ...v,
      colorHex: v.colorHex ?? null,
      price: v.effectivePrice ?? p.basePrice,
      available: (v.stock ?? 0) > 0 && v.active !== false,
    })),
    isSample: Boolean(p.isSample),
    status: p.status,
    sizeGuide: guide ? { titleEn: guide.titleEn, bodyEn: guide.bodyEn ?? null } : null,
    inStock: p.totalStock > 0,
  };
}

const STATUS_FLOW = ['PENDING_CONFIRMATION', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED'];

function allowedTransitions(status: string): string[] {
  if (status === 'DELIVERED' || status === 'CANCELLED') return [];
  if (status === 'OUT_FOR_DELIVERY') return ['DELIVERED', 'CANCELLED'];
  const i = STATUS_FLOW.indexOf(status);
  if (i === -1) return ['CANCELLED'];
  return [STATUS_FLOW[i + 1], 'CANCELLED'];
}

// Track, account and admin all read the flat OrderDetail DTO, not the stored Order row.
function toOrderDetail(order: Order) {
  const zone: any = resolveZone(order.region, order.city, order.subCity);
  const at = (status: string) => order.history?.find((h) => h.toStatus === status)?.at ?? null;

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentStatus: order.paymentStatus,
    paymentMethod: order.paymentMethod,
    currency: order.currency,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    totalAmount: order.totalAmount,
    amountCollected: order.amountCollected,
    customerName: order.customerName,
    customerPhone: order.customerPhone,
    city: order.city,
    region: order.region,
    itemCount: order.itemCount,
    placedVia: order.placedVia,
    cancelRequested: order.cancelRequested,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,

    allowedStatuses: allowedTransitions(order.status),
    discountAmount: 0,
    balanceDue: Math.max(0, order.totalAmount - (order.amountCollected || 0)),
    dialPhone: order.customerPhone,
    secondaryPhone: order.secondaryPhone ?? null,
    telegramUserId: null,
    subCity: order.subCity ?? null,
    neighborhood: order.neighborhood ?? null,
    addressLine: order.addressLine ?? '',
    deliveryInstructions: order.deliveryInstructions ?? null,
    preferredDeliveryTime: order.preferredDeliveryTime ?? null,
    deliveryZoneName: zone?.nameEn ?? null,
    estimatedDays: zone?.estimatedDays ?? null,
    courierName: order.courierName ?? null,
    courierPhone: order.courierPhone ?? null,
    confirmedAt: at('CONFIRMED'),
    processingAt: at('PROCESSING'),
    outForDeliveryAt: at('OUT_FOR_DELIVERY'),
    deliveredAt: at('DELIVERED'),
    cancelledAt: order.status === 'CANCELLED' ? order.updatedAt : null,
    cancelRequestedAt: order.cancelRequested ? order.updatedAt : null,
    cancellationReason: order.cancelReason ?? null,
    cancelledBy: null,
    stockRestored: false,
    failedDeliveryCount: 0,
    paymentCollectedAt: order.amountCollected > 0 ? order.updatedAt : null,
    paymentCollectedBy: null,
    items: (order.items || []).map((it) => {
      const product = db.products.find((p) => p.slug === it.productSlug);
      return {
        productNameEn: it.nameEn,
        sizeLabel: it.sizeLabel,
        colorName: it.colorName,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        lineTotal: it.lineTotal,
        productSlug: it.productSlug ?? null,
        variantId: it.variantId ?? null,
        imageUrl: product ? primaryImageUrl(product) : null,
      };
    }),
    history: (order.history || []).map((h) => ({
      fromStatus: h.fromStatus ?? null,
      toStatus: h.toStatus,
      note: h.note ?? null,
      actorType: h.actorType,
      actor: h.actor ?? null,
      at: h.at,
    })),
    notifications: null,
    auditTrail: null,
  };
}

// -------------------------------------------------------------
// STOREFRONT API
// -------------------------------------------------------------

apiRouter.get('/store', (_req: Request, res: Response) => {
  const featured = db.products.filter((p) => p.featured && p.status === 'PUBLISHED');
  const newArrivals = [...db.products]
    .filter((p) => p.status === 'PUBLISHED')
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 12);

  res.json({
    storeName: db.storeSettings.storeNameEn || 'Debol',
    tagline: db.storeSettings.taglineEn || "Children's clothing, shoes and toys, delivered across Ethiopia",
    currency: db.storeSettings.currency || 'ETB',
    ageGroups: db.ageGroups.filter((g) => g.active),
    contact: {
      phone: db.storeSettings.contactPhone || '0911526922',
      email: db.storeSettings.contactEmail || 'orders@example.com',
    },
    categories: db.categories.filter((c) => c.active).map((c) => ({
      slug: c.slug,
      nameEn: c.nameEn,
      descriptionEn: c.descriptionEn ?? null,
      audience: c.audience,
      imageUrl: null,
      productCount: db.products.filter((p) => p.categorySlug === c.slug && p.status === 'PUBLISHED').length,
    })),
    featured: featured.map(toProductSummary),
    newArrivals: newArrivals.map(toProductSummary),
    banners: db.banners,
    collections: db.collections,
  });
});

apiRouter.get('/store/settings', (_req: Request, res: Response) => {
  res.json({
    storeName: db.storeSettings.storeNameEn || 'Debol',
    tagline: db.storeSettings.taglineEn || "Children's clothing, shoes and toys, delivered across Ethiopia",
    logoUrl: null,
    currency: db.storeSettings.currency || 'ETB',
    contact: {
      phone: db.storeSettings.contactPhone || '0911526922',
      email: db.storeSettings.contactEmail || 'orders@example.com',
    },
  });
});

apiRouter.get('/categories', (_req: Request, res: Response) => {
  const categoriesWithCounts = db.categories.map((c) => {
    const productCount = db.products.filter((p) => p.categorySlug === c.slug && p.status === 'PUBLISHED').length;
    return { ...c, imageUrl: null, productCount };
  });
  res.json(categoriesWithCounts);
});

apiRouter.get('/age-groups', (_req: Request, res: Response) => {
  res.json(db.ageGroups.filter((ag) => ag.active));
});

apiRouter.get('/products', (req: Request, res: Response) => {
  const { category, q, audience, gender, size, ageGroup, minPrice, maxPrice, inStock, featured, sort, page = '0', pageSize = '12' } = req.query;

  let filtered = db.products.filter((p) => p.status === 'PUBLISHED');

  if (category) {
    filtered = filtered.filter((p) => p.categorySlug === category);
  }
  if (audience) {
    filtered = filtered.filter((p) => p.audience === audience);
  }
  if (gender) {
    filtered = filtered.filter((p) => p.gender === gender || p.gender === 'UNISEX');
  }
  if (ageGroup) {
    filtered = filtered.filter((p) => p.ageGroups && p.ageGroups.includes(String(ageGroup)));
  }
  if (size) {
    filtered = filtered.filter((p) => p.variants && p.variants.some((v) => v.sizeLabel === size));
  }
  if (q) {
    const query = String(q).toLowerCase();
    filtered = filtered.filter(
      (p) =>
        p.nameEn.toLowerCase().includes(query) ||
        (p.descriptionEn && p.descriptionEn.toLowerCase().includes(query)) ||
        p.categoryNameEn.toLowerCase().includes(query),
    );
  }
  if (minPrice) {
    filtered = filtered.filter((p) => (p.salePrice ?? p.basePrice ?? p.price ?? 0) >= Number(minPrice));
  }
  if (maxPrice) {
    filtered = filtered.filter((p) => (p.salePrice ?? p.basePrice ?? p.price ?? 0) <= Number(maxPrice));
  }
  if (inStock === 'true') {
    filtered = filtered.filter((p) => p.totalStock > 0);
  }
  if (featured === 'true') {
    filtered = filtered.filter((p) => p.featured);
  }

  // Sorting
  if (sort === 'price-asc') {
    filtered.sort((a, b) => (a.salePrice ?? a.basePrice ?? 0) - (b.salePrice ?? b.basePrice ?? 0));
  } else if (sort === 'price-desc') {
    filtered.sort((a, b) => (b.salePrice ?? b.basePrice ?? 0) - (a.salePrice ?? a.basePrice ?? 0));
  } else {
    // Newest
    filtered.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  const p = Math.max(0, parseInt(String(page), 10) || 0);
  const ps = Math.max(1, parseInt(String(pageSize), 10) || 12);
  const totalElements = filtered.length;
  const totalPages = Math.ceil(totalElements / ps);
  const items = filtered.slice(p * ps, (p + 1) * ps);

  res.json({
    items: items.map(toProductSummary),
    page: p,
    pageSize: ps,
    totalPages,
    totalElements,
  });
});

apiRouter.get('/products/:slug', (req: Request, res: Response) => {
  const { slug } = req.params;
  const product = db.products.find((p) => p.slug === slug);
  if (!product) {
    return res.status(404).json({ error: 'product_not_found', message: 'Product not found' });
  }

  const related = db.products
    .filter((p) => p.id !== product.id && p.categorySlug === product.categorySlug && p.status === 'PUBLISHED')
    .slice(0, 4);

  res.json({
    ...toProductDetail(product),
    related: related.map(toProductSummary),
  });
});

apiRouter.get('/delivery-zones', (_req: Request, res: Response) => {
  res.json(db.deliveryZones.filter((z) => z.active !== false));
});

apiRouter.get('/size-guides', (_req: Request, res: Response) => {
  res.json(db.sizeGuides);
});

// -------------------------------------------------------------
// CART API
// -------------------------------------------------------------

apiRouter.get('/cart', (req: Request, res: Response) => {
  const key = getCartKey(req);
  res.setHeader('x-cart-key', key);
  res.json(getCartView(key));
});

apiRouter.post('/cart/items', (req: Request, res: Response) => {
  const key = getCartKey(req);
  const { variantId, quantity = 1 } = req.body;
  if (!variantId) {
    return res.status(400).json({ error: 'invalid_variant', message: 'Variant ID is required' });
  }

  const items = db.carts.get(key) || [];
  const existing = items.find((i) => i.variantId === Number(variantId));
  if (existing) {
    existing.quantity += Number(quantity);
  } else {
    items.push({ variantId: Number(variantId), quantity: Number(quantity) });
  }
  db.carts.set(key, items);

  res.setHeader('x-cart-key', key);
  res.json(getCartView(key));
});

apiRouter.patch('/cart/items/:variantId', (req: Request, res: Response) => {
  const key = getCartKey(req);
  const variantId = Number(req.params.variantId);
  const { quantity } = req.body;

  let items = db.carts.get(key) || [];
  if (Number(quantity) <= 0) {
    items = items.filter((i) => i.variantId !== variantId);
  } else {
    const item = items.find((i) => i.variantId === variantId);
    if (item) {
      item.quantity = Number(quantity);
    }
  }
  db.carts.set(key, items);

  res.setHeader('x-cart-key', key);
  res.json(getCartView(key));
});

apiRouter.delete('/cart/items/:variantId', (req: Request, res: Response) => {
  const key = getCartKey(req);
  const variantId = Number(req.params.variantId);

  let items = db.carts.get(key) || [];
  items = items.filter((i) => i.variantId !== variantId);
  db.carts.set(key, items);

  res.setHeader('x-cart-key', key);
  res.json(getCartView(key));
});

apiRouter.delete('/cart', (req: Request, res: Response) => {
  const key = getCartKey(req);
  db.carts.delete(key);
  res.setHeader('x-cart-key', key);
  res.json(getCartView(key));
});

apiRouter.post('/me/cart/claim', (req: Request, res: Response) => {
  const key = getCartKey(req);
  res.json({ cartKey: key, attached: true });
});

// -------------------------------------------------------------
// CHECKOUT & ORDERS
// -------------------------------------------------------------

apiRouter.post('/checkout/quote', (req: Request, res: Response) => {
  const key = getCartKey(req);
  const { region, city, subCity } = req.body;
  const cart = getCartView(key);

  const matchedZone = resolveZone(region, city, subCity);
  const fee = deliveryFeeFor(matchedZone, cart.subtotal);

  res.json({
    subtotal: cart.subtotal,
    deliveryFee: fee,
    total: cart.subtotal + fee,
    currency: cart.currency,
    zoneNameEn: 'nameEn' in matchedZone ? matchedZone.nameEn : null,
    estimatedDays: matchedZone.estimatedDays ?? null,
  });
});

apiRouter.post('/checkout', (req: Request, res: Response) => {
  const key = getCartKey(req);
  const cart = getCartView(key);
  const body = req.body;

  const orderId = db.orders.length + 1;
  const orderNumber = `ORD-2026-${String(orderId).padStart(5, '0')}`;
  const publicToken = `tok_${Math.random().toString(36).substring(2, 12)}`;

  // Find delivery zone fee
  const matchedZone = resolveZone(body.region, body.city, body.subCity);
  const deliveryFee = deliveryFeeFor(matchedZone, cart.subtotal);

  const totalAmount = cart.subtotal + deliveryFee;

  // Deduct stock from variants
  cart.items.forEach((item) => {
    for (const p of db.products) {
      const v = p.variants.find((vr) => vr.id === item.variantId);
      if (v) {
        v.stock = Math.max(0, v.stock - item.quantity);
        p.totalStock = p.variants.reduce((acc, vr) => acc + vr.stock, 0);
      }
    }
  });

  const newOrder: Order = {
    id: orderId,
    orderNumber,
    publicToken,
    status: 'PENDING_CONFIRMATION',
    paymentStatus: 'UNPAID',
    paymentMethod: body.paymentMethod || 'CASH_ON_DELIVERY',
    currency: cart.currency,
    subtotal: cart.subtotal,
    deliveryFee,
    totalAmount,
    amountCollected: 0,
    customerName: body.fullName || 'Customer',
    customerPhone: body.phone || '',
    secondaryPhone: body.secondaryPhone,
    city: body.city || 'Addis Ababa',
    region: body.region || 'Addis Ababa',
    subCity: body.subCity,
    neighborhood: body.neighborhood,
    addressLine: body.addressLine,
    deliveryInstructions: body.deliveryInstructions,
    preferredDeliveryTime: body.preferredDeliveryTime,
    deliveryAddress: [body.addressLine, body.neighborhood, body.subCity, body.city, body.region].filter(Boolean).join(', '),
    itemCount: cart.items.length,
    items: cart.items.map((it, idx) => ({
      id: idx + 1,
      variantId: it.variantId,
      productId: it.productId,
      productSlug: it.productSlug,
      nameEn: it.nameEn,
      sizeLabel: it.sizeLabel,
      colorName: it.colorName,
      unitPrice: it.unitPrice,
      quantity: it.quantity,
      lineTotal: it.lineTotal,
    })),
    placedVia: 'WEB',
    cancelRequested: false,
    history: [
      {
        fromStatus: null,
        toStatus: 'PENDING_CONFIRMATION',
        note: 'Order placed',
        actorType: 'CUSTOMER',
        actor: body.phone || null,
        at: new Date().toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.orders.unshift(newOrder);

  // Clear cart
  db.carts.delete(key);

  res.setHeader('x-cart-key', key);
  res.json({
    orderNumber,
    publicToken,
    status: newOrder.status,
    paymentStatus: newOrder.paymentStatus,
    paymentMethod: newOrder.paymentMethod,
    currency: newOrder.currency,
    subtotal: newOrder.subtotal,
    deliveryFee: newOrder.deliveryFee,
    totalAmount: newOrder.totalAmount,
    items: newOrder.items,
    customerName: newOrder.customerName,
    customerPhone: newOrder.customerPhone,
    deliveryAddress: newOrder.deliveryAddress,
    createdAt: newOrder.createdAt,
    customerSessionToken: null,
    replayed: false,
  });
});

apiRouter.get('/orders/track/:orderNumber', (req: Request, res: Response) => {
  const orderNumber = String(req.params.orderNumber || '');

  const order = db.orders.find((o) => o.orderNumber.toUpperCase() === orderNumber.toUpperCase());
  if (!order) {
    return res.status(404).json({ error: 'order_not_found', message: 'Order not found' });
  }

  res.json({
    order: toOrderDetail(order),
    publicToken: order.publicToken,
  });
});

// -------------------------------------------------------------
// CUSTOMER AUTH & ME
// -------------------------------------------------------------

apiRouter.post('/customers/auth/phone', (req: Request, res: Response) => {
  const { phone, fullName } = req.body;
  const token = `cust_${Buffer.from(phone || 'user').toString('hex')}`;
  const profile = {
    id: 1,
    phone: phone || '0911526922',
    fullName: fullName || 'Customer',
    createdAt: new Date().toISOString(),
  };
  db.customerProfiles.set(token, profile);

  res.json({ token, profile });
});

apiRouter.post('/telegram/auth', (_req: Request, res: Response) => {
  const token = `cust_tg_${Math.random().toString(36).substring(2, 10)}`;
  const profile = {
    id: 1,
    phone: '0911526922',
    fullName: 'Telegram Shopper',
    telegramUserId: 12345678,
  };
  db.customerProfiles.set(token, profile);
  res.json({ token, profile });
});

apiRouter.post('/customers/auth/logout', (_req: Request, res: Response) => {
  res.json({ ok: true, revoked: true });
});

apiRouter.get('/me/profile', (_req: Request, res: Response) => {
  res.json({
    id: 1,
    phone: '0911526922',
    fullName: 'Almaz Tesfaye',
    createdAt: '2026-10-12T20:38:11.233Z',
  });
});

apiRouter.patch('/me/profile', (req: Request, res: Response) => {
  const { fullName } = req.body;
  res.json({
    id: 1,
    phone: '0911526922',
    fullName: fullName || 'Almaz Tesfaye',
    createdAt: '2026-10-12T20:38:11.233Z',
  });
});

apiRouter.get('/me/addresses', (_req: Request, res: Response) => {
  res.json([
    {
      id: 1,
      label: 'Home',
      region: 'Addis Ababa',
      city: 'Addis Ababa',
      subCity: 'Bole',
      neighborhood: 'Bole Medhanialem',
      addressLine: 'House 12, near Edna Mall',
      isDefault: true,
    },
  ]);
});

apiRouter.post('/me/addresses', (req: Request, res: Response) => {
  res.json({
    id: Date.now(),
    ...req.body,
    isDefault: true,
  });
});

apiRouter.delete('/me/addresses/:id', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

apiRouter.get('/me/orders', (_req: Request, res: Response) => {
  const myOrders = db.orders.slice(0, 5).map((o) => ({
    summary: {
      id: o.id,
      orderNumber: o.orderNumber,
      status: o.status,
      paymentStatus: o.paymentStatus,
      paymentMethod: o.paymentMethod,
      currency: o.currency,
      subtotal: o.subtotal,
      deliveryFee: o.deliveryFee,
      totalAmount: o.totalAmount,
      amountCollected: o.amountCollected,
      customerName: o.customerName,
      customerPhone: o.customerPhone,
      city: o.city,
      region: o.region,
      itemCount: o.itemCount,
      placedVia: o.placedVia,
      cancelRequested: o.cancelRequested,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
    },
    publicToken: o.publicToken,
  }));
  res.json(myOrders);
});

apiRouter.get('/me/orders/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const order = db.orders.find((o) => o.id === id);
  if (!order) {
    return res.status(404).json({ error: 'not_found', message: 'Order not found' });
  }
  res.json(toOrderDetail(order));
});

apiRouter.post('/me/orders/:id/cancel-request', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const order = db.orders.find((o) => o.id === id);
  if (order) {
    order.cancelRequested = true;
    order.cancelReason = req.body.reason;
  }
  res.json(order);
});

// -------------------------------------------------------------
// ADMIN AUTH & DASHBOARD
// -------------------------------------------------------------

// The panel gates each screen on these tokens (see src/state/AdminAuth.tsx PERMISSION).
const ADMIN_PERMISSIONS = [
  'dashboard',
  'products',
  'orders',
  'inventory',
  'settings',
  'telegram',
  'administrators',
  'audit',
];

apiRouter.post('/admin/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  const admin = db.administrators.find((a) => a.email?.toLowerCase() === String(email ?? '').toLowerCase());

  // A database seeded from the captured API samples has no hashes; until a password is set the
  // panel stays locked instead of accepting anything the way the mock did.
  const configured = Boolean(admin?.passwordHash);
  if (!configured) {
    const message = process.env.ADMIN_BOOTSTRAP_PASSWORD
      ? 'Invalid email or password'
      : 'No administrator password is set. Define ADMIN_BOOTSTRAP_PASSWORD (12+ characters) and restart, or set a password from the administrators screen.';
    if (!admin) {
      // Still hash a throwaway value so a missing account and a wrong password cost the same.
      verifyPassword(String(password ?? ''), hashPassword('timing-equaliser'));
    }
    return res.status(admin ? 403 : 401).json({ error: admin ? 'password_not_set' : 'bad_credentials', message });
  }
  if (!verifyPassword(String(password ?? ''), admin.passwordHash)) {
    return res.status(401).json({ error: 'bad_credentials', message: 'Invalid email or password' });
  }
  if (admin.active === false) {
    return res.status(403).json({ error: 'forbidden', message: 'This administrator account is not active' });
  }

  const token = await createSession(admin.id);
  res.json({
    token,
    email: admin.email,
    fullName: admin.fullName,
    role: admin.role || 'OWNER',
    permissions: ADMIN_PERMISSIONS,
  });
});

apiRouter.post('/admin/auth/dev-login', async (req: Request, res: Response) => {
  if (!devLoginAllowed()) {
    return res.status(404).json({ error: 'not_found', message: 'Enable ADMIN_DEV_LOGIN=true outside production to use the passwordless login' });
  }
  const admin = db.administrators.find((a) => a.email?.toLowerCase() === String(req.body?.email ?? '').toLowerCase())
    ?? db.administrators.find((a) => a.active !== false);
  if (!admin) return res.status(404).json({ error: 'not_found', message: 'No administrator account exists' });
  const token = await createSession(admin.id);
  res.json({
    token,
    email: admin.email,
    fullName: admin.fullName,
    role: admin.role || 'OWNER',
    permissions: ADMIN_PERMISSIONS,
  });
});

apiRouter.get('/admin/auth/me', (req: Request, res: Response) => {
  const admin = req.admin!;
  res.json({
    id: admin.id,
    email: admin.email,
    fullName: admin.fullName,
    role: admin.role || 'OWNER',
    permissions: ADMIN_PERMISSIONS,
  });
});

apiRouter.post('/admin/auth/revoke', async (req: Request, res: Response) => {
  await destroySession(bearerToken(req));
  res.json({ ok: true });
});

/** Signed-in admin sets or resets a password for another administrator. */
apiRouter.post('/admin/administrators/:id/password', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const admin = db.administrators.find((a) => a.id === id);
  const password = String(req.body?.password ?? '');
  if (!admin) return res.status(404).json({ error: 'not_found', message: 'Administrator not found' });
  if (password.length < 12) {
    return res.status(422).json({ error: 'validation_failed', message: 'Password must be at least 12 characters', fields: [{ field: 'password', message: 'Must be at least 12 characters' }] });
  }
  admin.passwordHash = hashPassword(password);
  res.json({ ok: true, id: admin.id, email: admin.email });
});

apiRouter.get('/admin/dashboard', (_req: Request, res: Response) => {
  const orders = db.orders;
  const awaitingConfirmation = orders.filter((o) => o.status === 'PENDING_CONFIRMATION').length;
  const inFulfilment = orders.filter((o) => o.status === 'PROCESSING' || o.status === 'OUT_FOR_DELIVERY').length;
  const deliveredTotal = orders.filter((o) => o.status === 'DELIVERED').length;
  const cancelledTotal = orders.filter((o) => o.status === 'CANCELLED').length;
  const collectedRevenue = orders.reduce((sum, o) => sum + (o.amountCollected || 0), 0);

  const ordersByStatus: Record<string, number> = {};
  const ordersByPaymentStatus: Record<string, number> = {};

  orders.forEach((o) => {
    ordersByStatus[o.status] = (ordersByStatus[o.status] || 0) + 1;
    ordersByPaymentStatus[o.paymentStatus] = (ordersByPaymentStatus[o.paymentStatus] || 0) + 1;
  });

  const lowStock: any[] = [];
  db.products.forEach((p) => {
    p.variants.forEach((v) => {
      if (v.stock <= v.lowStockThreshold) {
        lowStock.push({
          variantId: v.id,
          product: p.nameEn,
          productSlug: p.slug,
          sizeLabel: v.sizeLabel,
          colorName: v.colorName,
          stock: v.stock,
          threshold: v.lowStockThreshold,
          outOfStock: v.stock === 0,
        });
      }
    });
  });

  res.json({
    generatedAt: new Date().toISOString(),
    currency: db.storeSettings.currency || 'ETB',
    ordersToday: orders.length,
    awaitingConfirmation,
    inFulfilment,
    deliveredTotal,
    cancelledTotal,
    collectedRevenue,
    orderedValueToday: orders.reduce((sum, o) => sum + (o.totalAmount || 0), 0),
    unpaidDelivered: orders.filter((o) => o.status === 'DELIVERED' && o.paymentStatus === 'UNPAID').length,
    ordersByStatus,
    ordersByPaymentStatus,
    lowStock: lowStock.slice(0, 10),
    bestSellers: [
      { productId: 15, nameEn: 'Acceptance Rain Coat', slug: 'acceptance-rain-coat', unitsSold: 5 },
      { productId: 7, nameEn: 'Children Sneakers', slug: 'kids-sneakers', unitsSold: 4 },
      { productId: 1, nameEn: 'Baby Bodysuit 3 Pack', slug: 'baby-bodysuit-3pack', unitsSold: 3 },
    ],
    notifications: { pending: 0, sent: 15, deadLetter: 0 },
    telegram: db.telegramStatus,
  });
});

// -------------------------------------------------------------
// ADMIN PRODUCTS
// -------------------------------------------------------------

apiRouter.get('/admin/products', (req: Request, res: Response) => {
  const { q, category, status, page = '0', pageSize = '20' } = req.query;
  let items = [...db.products];

  if (q) {
    const query = String(q).toLowerCase();
    items = items.filter((p) => p.nameEn.toLowerCase().includes(query) || p.slug.toLowerCase().includes(query));
  }
  if (category) {
    items = items.filter((p) => p.categorySlug === category);
  }
  if (status) {
    items = items.filter((p) => p.status === status);
  }

  const p = Math.max(0, parseInt(String(page), 10) || 0);
  const ps = Math.max(1, parseInt(String(pageSize), 10) || 20);
  const totalElements = items.length;
  const totalPages = Math.ceil(totalElements / ps);
  const paged = items.slice(p * ps, (p + 1) * ps);

  res.json({
    items: paged,
    page: p,
    pageSize: ps,
    totalPages,
    totalElements,
  });
});

apiRouter.get('/admin/products/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const product = db.products.find((p) => p.id === id);
  if (!product) {
    return res.status(404).json({ error: 'product_not_found', message: 'Product not found' });
  }
  res.json(product);
});

apiRouter.post('/admin/products', (req: Request, res: Response) => {
  const body = req.body;
  const newId = Math.max(...db.products.map((p) => p.id), 0) + 1;
  const slug =
    body.slug ||
    body.nameEn
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') + `-${Date.now().toString().slice(-4)}`;

  const cat = db.categories.find((c) => c.slug === body.categorySlug) || db.categories[0];

  const variants = (body.variants || []).map((v: any, idx: number) => ({
    id: Date.now() + idx,
    sizeLabel: v.sizeLabel || 'Standard',
    colorName: v.colorName || 'Default',
    colorHex: v.colorHex,
    sku: v.sku || `SKU-${newId}-${idx + 1}`,
    effectivePrice: v.effectivePrice ?? body.salePrice ?? body.basePrice ?? 500,
    stock: v.stock || 0,
    lowStockThreshold: v.lowStockThreshold || 3,
    lowStock: (v.stock || 0) <= 3,
    active: true,
  }));

  const newProduct: Product = {
    id: newId,
    slug,
    nameEn: body.nameEn,
    nameAm: body.nameAm,
    descriptionEn: body.descriptionEn,
    descriptionAm: body.descriptionAm,
    categoryId: cat?.id || 1,
    categorySlug: cat?.slug || 'baby-clothing',
    categoryNameEn: cat?.nameEn || 'Baby clothing',
    audience: body.audience || 'CHILD',
    gender: body.gender || 'UNISEX',
    ageGroups: body.ageGroups || ['TODDLER_1_2Y'],
    sizingSystem: body.sizingSystem || 'AGE',
    basePrice: Number(body.basePrice) || 800,
    price: Number(body.basePrice) || 800,
    salePrice: body.salePrice ? Number(body.salePrice) : null,
    currency: db.storeSettings.currency || 'ETB',
    status: body.status || 'PUBLISHED',
    featured: Boolean(body.featured),
    totalStock: variants.reduce((sum: number, v: any) => sum + v.stock, 0),
    lowStockVariants: variants.filter((v: any) => v.stock <= v.lowStockThreshold).length,
    variants,
    images: body.images || [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    publishedAt: new Date().toISOString(),
  };

  db.products.unshift(newProduct);
  res.json(newProduct);
});

apiRouter.put('/admin/products/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const product = db.products.find((p) => p.id === id);
  if (!product) {
    return res.status(404).json({ error: 'not_found', message: 'Product not found' });
  }

  const body = req.body;
  Object.assign(product, body, { updatedAt: new Date().toISOString() });
  if (product.variants) {
    product.totalStock = product.variants.reduce((acc, v) => acc + (v.stock || 0), 0);
  }

  res.json(product);
});

apiRouter.delete('/admin/products/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const pIndex = db.products.findIndex((p) => p.id === id);
  if (pIndex !== -1) {
    db.products.splice(pIndex, 1);
  }
  res.json({ ok: true });
});

apiRouter.post('/admin/products/:id/status', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const status = String(req.query.status || 'PUBLISHED');
  const product = db.products.find((p) => p.id === id);
  if (product) {
    product.status = status;
  }
  res.json(product);
});

apiRouter.post('/admin/products/:id/featured', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const featured = req.query.featured === 'true';
  const product = db.products.find((p) => p.id === id);
  if (product) {
    product.featured = featured;
  }
  res.json(product);
});

apiRouter.post('/admin/products/:id/images', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const product = db.products.find((p) => p.id === id);
  const newImg = {
    id: Date.now(),
    url: req.body.url,
    altEn: req.body.altEn,
    isPrimary: req.body.isPrimary ?? false,
  };
  if (product) {
    product.images = product.images || [];
    if (newImg.isPrimary) {
      product.images.forEach((img) => (img.isPrimary = false));
    }
    product.images.push(newImg);
  }
  res.json(newImg);
});

/**
 * Real multipart upload from the browser. Bytes go into product_images.content because Render's
 * filesystem is recreated on every deploy, so anything written to disk would disappear.
 */
apiRouter.post('/admin/products/:id/image-upload', (req: Request, res: Response) => {
  const product = db.products.find((p) => p.id === Number(req.params.id));
  if (!product) {
    return res.status(404).json({ error: 'not_found', message: 'Product not found' });
  }
  if (!req.headers['content-type']?.startsWith('multipart/form-data')) {
    return res.status(415).json({ error: 'unsupported_media_type', message: 'Send the image as multipart/form-data with a "file" field' });
  }

  const isPrimary = req.query.isPrimary === 'true';
  const altEn = typeof req.query.altEn === 'string' ? req.query.altEn : null;

  const bb = Busboy({ headers: req.headers, limits: { fileSize: UPLOAD_MAX_BYTES, files: 1 } });
  let handled = false;

  const fail = (status: number, code: string, message: string) => {
    if (handled || res.headersSent) return req.resume();
    handled = true;
    res.status(status).json({ error: code, message });
    return undefined;
  };

  bb.on('file', (_field, file, info) => {
    const mimetype = String(info.mimeType || '');
    if (!UPLOAD_TYPES.has(mimetype)) {
      file.resume();
      fail(415, 'unsupported_image', 'Only JPEG, PNG, WebP and GIF images are accepted');
      return;
    }
    const chunks: Buffer[] = [];
    file.on('data', (c: Buffer) => chunks.push(c));
    file.on('limit', () => fail(413, 'image_too_large', `Images must be ${Math.round(UPLOAD_MAX_BYTES / (1024 * 1024))} MB or smaller`));
    file.on('end', async () => {
      if (handled) return;
      handled = true;
      const content = Buffer.concat(chunks);
      if (!content.length) {
        if (!res.headersSent) res.status(422).json({ error: 'empty_file', message: 'The uploaded file is empty' });
        return;
      }
      const id = BigInt(`${Date.now()}${crypto.randomInt(0, 1000)}`);
      const url = `/api/v1/media/images/${id}`;
      if (dbEnabled()) {
        try {
          // The product may still be in the write queue from the request that just created it, and
          // product_images has a foreign key onto it.
          await flushPersist();
          await q(
            `insert into product_images (id, product_id, url, alt_en, is_primary, content, content_type, size_bytes)
             values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [id, product.id, url, altEn, isPrimary, content, mimetype, content.length],
          );
          if (isPrimary) await q('update product_images set is_primary = false where product_id = $1 and id <> $2', [product.id, id]);
        } catch (err) {
          if (!res.headersSent) res.status(500).json({ error: 'storage_failed', message: `Could not store the image: ${(err as Error).message}` });
          return;
        }
      } else {
        memoryImages.set(String(id), { content, contentType: mimetype });
      }
      product.images = product.images || [];
      if (isPrimary) product.images.forEach((img) => { img.isPrimary = false; });
      const view = {
        id: Number(id),
        url,
        altEn: altEn ?? undefined,
        isPrimary,
        contentType: mimetype,
        sizeBytes: content.length,
      };
      product.images.push(view);
      res.json({ uploaded: true, image: view, url, storageKey: dbEnabled() ? `postgres:product_images:${id}` : 'memory-only' });
    });
  });

  bb.on('error', (err: Error) => fail(400, 'upload_failed', `Could not read the upload: ${err.message}`));
  bb.on('close', () => { if (!handled && !res.headersSent) fail(400, 'no_file', 'No file field was found in the upload'); });
  req.pipe(bb);
});

/** Serve uploaded bytes. Public: these URLs are what the storefront <img> tags point at. */
apiRouter.get('/media/images/:id', async (req: Request, res: Response) => {
  if (!dbEnabled()) {
    const cached = memoryImages.get(String(req.params.id));
    if (!cached) {
      return res.status(404).json({ error: 'not_found', message: 'Uploads are kept in this process until it restarts; set DATABASE_URL to store them permanently' });
    }
    res.setHeader('content-type', cached.contentType);
    res.setHeader('content-length', String(cached.content.length));
    return res.end(cached.content);
  }
  try {
    const r = await q('select content, content_type, size_bytes from product_images where id = $1', [req.params.id]);
    if (!r.rowCount || !r.rows[0].content) {
      return res.status(404).json({ error: 'not_found', message: 'Image not found' });
    }
    res.setHeader('content-type', r.rows[0].content_type || 'application/octet-stream');
    res.setHeader('content-length', String(r.rows[0].content.length));
    res.setHeader('cache-control', 'public, max-age=31536000, immutable');
    return res.end(r.rows[0].content);
  } catch (err) {
    return res.status(500).json({ error: 'storage_failed', message: (err as Error).message });
  }
});

apiRouter.post('/admin/images/:imageId/primary', (req: Request, res: Response) => {
  const imageId = Number(req.params.imageId);
  db.products.forEach((p) => {
    p.images.forEach((img) => {
      img.isPrimary = img.id === imageId;
    });
  });
  res.json({ ok: true });
});

apiRouter.delete('/admin/images/:imageId', (req: Request, res: Response) => {
  const imageId = Number(req.params.imageId);
  db.products.forEach((p) => {
    p.images = p.images.filter((img) => img.id !== imageId);
  });
  res.json({ ok: true });
});

// -------------------------------------------------------------
// ADMIN ORDERS
// -------------------------------------------------------------

apiRouter.get('/admin/orders', (req: Request, res: Response) => {
  const { q, status, paymentStatus, page = '0', pageSize = '20' } = req.query;
  let items = [...db.orders];

  if (q) {
    const query = String(q).toLowerCase();
    items = items.filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(query) ||
        o.customerName.toLowerCase().includes(query) ||
        o.customerPhone.includes(query),
    );
  }
  if (status) {
    items = items.filter((o) => o.status === status);
  }
  if (paymentStatus) {
    items = items.filter((o) => o.paymentStatus === paymentStatus);
  }

  const p = Math.max(0, parseInt(String(page), 10) || 0);
  const ps = Math.max(1, parseInt(String(pageSize), 10) || 20);
  const totalElements = items.length;
  const totalPages = Math.ceil(totalElements / ps);
  const paged = items.slice(p * ps, (p + 1) * ps);

  res.json({
    items: paged,
    page: p,
    pageSize: ps,
    totalPages,
    totalElements,
  });
});

apiRouter.get('/admin/orders/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const order = db.orders.find((o) => o.id === id);
  if (!order) {
    return res.status(404).json({ error: 'not_found', message: 'Order not found' });
  }
  res.json(toOrderDetail(order));
});

apiRouter.post('/admin/orders/:id/status', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const target = req.query.target as any;
  const order = db.orders.find((o) => o.id === id);
  if (order && target) {
    const from = order.status;
    order.status = target;
    order.updatedAt = new Date().toISOString();
    order.history.push({ fromStatus: from, toStatus: target, note: null, actorType: 'ADMIN', at: order.updatedAt });
  }
  res.json({
    orderNumber: order?.orderNumber,
    status: order?.status,
    paymentStatus: order?.paymentStatus,
  });
});

apiRouter.post('/admin/orders/:id/cancel', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { reason, restoreStock } = req.body;
  const order = db.orders.find((o) => o.id === id);
  if (order) {
    const from = order.status;
    order.status = 'CANCELLED';
    order.cancelReason = reason;
    order.updatedAt = new Date().toISOString();
    order.history.push({ fromStatus: from, toStatus: 'CANCELLED', note: reason || null, actorType: 'ADMIN', at: order.updatedAt });
  }
  res.json({
    orderNumber: order?.orderNumber,
    status: 'CANCELLED',
    stockRestored: restoreStock ?? true,
  });
});

apiRouter.post('/admin/orders/:id/cash-collection', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { amount, collectedBy } = req.body;
  const order = db.orders.find((o) => o.id === id);
  if (order) {
    order.paymentStatus = 'PAID';
    order.amountCollected = amount || order.totalAmount;
    order.updatedAt = new Date().toISOString();
  }
  res.json({
    orderNumber: order?.orderNumber,
    paymentStatus: 'PAID',
    amountCollected: order?.amountCollected || 0,
    collectedBy: collectedBy || null,
  });
});

apiRouter.post('/admin/orders/:id/courier', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { courierName, courierPhone } = req.body;
  const order = db.orders.find((o) => o.id === id);
  if (order) {
    order.courierName = courierName;
    order.courierPhone = courierPhone;
    order.updatedAt = new Date().toISOString();
  }
  res.json({ courierName: courierName || null, courierPhone: courierPhone || null });
});

apiRouter.post('/admin/orders/:id/notification-retry', (_req: Request, res: Response) => {
  res.json({ retried: 1 });
});

// -------------------------------------------------------------
// ADMIN INVENTORY
// -------------------------------------------------------------

apiRouter.get('/admin/inventory', (_req: Request, res: Response) => {
  const rows: any[] = [];
  db.products.forEach((p) => {
    p.variants.forEach((v) => {
      rows.push({
        variantId: v.id,
        productId: p.id,
        productSlug: p.slug,
        nameEn: p.nameEn,
        category: p.categoryNameEn,
        sizeLabel: v.sizeLabel,
        colorName: v.colorName,
        sku: v.sku,
        stock: v.stock,
        threshold: v.lowStockThreshold,
        lowStock: v.stock <= v.lowStockThreshold && v.stock > 0,
        outOfStock: v.stock === 0,
        status: p.status,
      });
    });
  });
  res.json(rows);
});

apiRouter.get('/admin/inventory/movements', (_req: Request, res: Response) => {
  res.json({
    items: [
      {
        id: 1,
        variantId: 1,
        productNameEn: 'Baby Bodysuit 3 Pack',
        sizeLabel: '0-3m',
        colorName: 'White',
        delta: 10,
        balanceAfter: 12,
        reason: 'RESTOCK',
        note: 'Initial batch arrival',
        actor: 'Store owner',
        createdAt: '2026-10-12T20:38:19.403Z',
      },
    ],
    page: 0,
    pageSize: 20,
    totalPages: 1,
    totalElements: 1,
  });
});

apiRouter.post('/admin/variants/:variantId/stock', (req: Request, res: Response) => {
  const variantId = Number(req.params.variantId);
  const { mode, stock, delta } = req.body;

  let updatedVariant: any = null;
  let parentProduct: Product | null = null;

  for (const p of db.products) {
    const v = p.variants.find((vr) => vr.id === variantId);
    if (v) {
      if (mode === 'SET' && typeof stock === 'number') {
        v.stock = stock;
      } else if (mode === 'DELTA' && typeof delta === 'number') {
        v.stock = Math.max(0, v.stock + delta);
      }
      p.totalStock = p.variants.reduce((acc, vr) => acc + vr.stock, 0);
      updatedVariant = v;
      parentProduct = p;
      break;
    }
  }

  res.json({
    variantId,
    productId: parentProduct?.id,
    productSlug: parentProduct?.slug,
    nameEn: parentProduct?.nameEn,
    category: parentProduct?.categoryNameEn,
    sizeLabel: updatedVariant?.sizeLabel,
    colorName: updatedVariant?.colorName,
    sku: updatedVariant?.sku,
    stock: updatedVariant?.stock ?? 0,
    threshold: updatedVariant?.lowStockThreshold ?? 3,
    lowStock: (updatedVariant?.stock || 0) <= (updatedVariant?.lowStockThreshold || 3),
    outOfStock: (updatedVariant?.stock || 0) === 0,
    status: parentProduct?.status,
  });
});

apiRouter.patch('/admin/variants/:variantId', (req: Request, res: Response) => {
  const variantId = Number(req.params.variantId);
  const lowStockThreshold = req.query.lowStockThreshold ? Number(req.query.lowStockThreshold) : undefined;

  let updatedVariant: any = null;
  let parentProduct: Product | null = null;

  for (const p of db.products) {
    const v = p.variants.find((vr) => vr.id === variantId);
    if (v) {
      if (lowStockThreshold !== undefined) v.lowStockThreshold = lowStockThreshold;
      updatedVariant = v;
      parentProduct = p;
      break;
    }
  }

  res.json({
    variantId,
    productId: parentProduct?.id,
    productSlug: parentProduct?.slug,
    nameEn: parentProduct?.nameEn,
    category: parentProduct?.categoryNameEn,
    sizeLabel: updatedVariant?.sizeLabel,
    colorName: updatedVariant?.colorName,
    sku: updatedVariant?.sku,
    stock: updatedVariant?.stock ?? 0,
    threshold: updatedVariant?.lowStockThreshold ?? 3,
    lowStock: (updatedVariant?.stock || 0) <= (updatedVariant?.lowStockThreshold || 3),
    outOfStock: (updatedVariant?.stock || 0) === 0,
    status: parentProduct?.status,
  });
});

// -------------------------------------------------------------
// ADMIN SETTINGS, ZONES, CATEGORIES, AGE GROUPS
// -------------------------------------------------------------

apiRouter.get('/admin/settings', (_req: Request, res: Response) => {
  res.json(db.storeSettings);
});

apiRouter.put('/admin/settings', (req: Request, res: Response) => {
  Object.assign(db.storeSettings, req.body, { updatedAt: new Date().toISOString() });
  res.json(db.storeSettings);
});

apiRouter.get('/admin/delivery-zones', (_req: Request, res: Response) => {
  res.json(db.deliveryZones);
});

apiRouter.post('/admin/delivery-zones', (req: Request, res: Response) => {
  const newZone = {
    id: db.deliveryZones.length + 1,
    ...req.body,
    active: true,
  };
  db.deliveryZones.push(newZone);
  res.json(newZone);
});

apiRouter.put('/admin/delivery-zones/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const zone = db.deliveryZones.find((z) => z.id === id);
  if (zone) {
    Object.assign(zone, req.body);
  }
  res.json(zone);
});

apiRouter.patch('/admin/delivery-zones/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const zone = db.deliveryZones.find((z) => z.id === id);
  if (zone) {
    zone.active = req.body.active;
  }
  res.json(zone);
});

apiRouter.get('/admin/categories', (_req: Request, res: Response) => {
  res.json(db.categories);
});

apiRouter.post('/admin/categories', (req: Request, res: Response) => {
  const newCat = {
    id: db.categories.length + 1,
    ...req.body,
    active: true,
  };
  db.categories.push(newCat);
  res.json(newCat);
});

apiRouter.put('/admin/categories/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const cat = db.categories.find((c) => c.id === id);
  if (cat) {
    Object.assign(cat, req.body);
  }
  res.json(cat);
});

apiRouter.get('/admin/age-groups', (_req: Request, res: Response) => {
  res.json(db.ageGroups);
});

apiRouter.post('/admin/age-groups', (req: Request, res: Response) => {
  const newAg = {
    id: db.ageGroups.length + 1,
    ...req.body,
    active: true,
  };
  db.ageGroups.push(newAg);
  res.json(newAg);
});

apiRouter.put('/admin/age-groups/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const ag = db.ageGroups.find((g) => g.id === id);
  if (ag) {
    Object.assign(ag, req.body);
  }
  res.json(ag);
});

// -------------------------------------------------------------
// ADMIN PEOPLE, AUDIT, NOTIFICATIONS, TELEGRAM
// -------------------------------------------------------------

const publicAdmin = (admin: any) => {
  if (!admin) return admin;
  const { passwordHash, ...rest } = admin;
  return { ...rest, hasPassword: Boolean(passwordHash) };
};

apiRouter.get('/admin/administrators', (_req: Request, res: Response) => {
  res.json(db.administrators.map(publicAdmin));
});

apiRouter.post('/admin/administrators', (req: Request, res: Response) => {
  const { password, ...body } = req.body ?? {};
  const newAdmin = {
    id: Math.max(0, ...db.administrators.map((a) => a.id)) + 1,
    ...body,
    active: true,
    passwordHash: typeof password === 'string' && password.length >= 12 ? hashPassword(password) : null,
    createdAt: new Date().toISOString(),
  };
  db.administrators.push(newAdmin);
  res.json(publicAdmin(newAdmin));
});

apiRouter.put('/admin/administrators/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const admin = db.administrators.find((a) => a.id === id);
  if (admin) {
    const { password: _password, ...body } = req.body ?? {};
    Object.assign(admin, body);
  }
  res.json(publicAdmin(admin));
});

apiRouter.post('/admin/administrators/:id/revoke', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const admin = db.administrators.find((a) => a.id === id);
  if (admin) {
    admin.active = false;
  }
  res.json(publicAdmin(admin));
});

apiRouter.get('/admin/audit', (_req: Request, res: Response) => {
  res.json({
    items: db.auditLogs,
    page: 0,
    totalPages: 1,
    totalElements: db.auditLogs.length,
  });
});

apiRouter.get('/admin/notifications', (_req: Request, res: Response) => {
  res.json({
    items: [],
    page: 0,
    pageSize: 20,
    totalPages: 1,
    totalElements: 0,
    counts: { pending: 0, sent: 15, deadLetter: 0 },
    telegram: db.telegramStatus,
  });
});

apiRouter.post('/admin/notifications/:id/retry', (_req: Request, res: Response) => {
  res.json({ retried: 1 });
});

apiRouter.post('/admin/notifications/retry-all', (_req: Request, res: Response) => {
  res.json({ retried: 0 });
});

apiRouter.post('/admin/notifications/dispatch', (_req: Request, res: Response) => {
  res.json({ dispatched: 0 });
});

apiRouter.post('/admin/notifications/test', (_req: Request, res: Response) => {
  res.json({ ok: true, detail: 'Test notification delivered to Telegram' });
});

apiRouter.get('/admin/telegram/status', (_req: Request, res: Response) => {
  res.json(db.telegramStatus);
});

apiRouter.put('/admin/telegram/config', (req: Request, res: Response) => {
  Object.assign(db.telegramStatus, req.body);
  res.json(db.telegramStatus);
});

apiRouter.post('/admin/telegram/pairing-code', (_req: Request, res: Response) => {
  const code = `${Math.floor(100 + Math.random() * 900)}-${Math.floor(100 + Math.random() * 900)}`;
  res.json({
    code,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    instructions: `Send /pair ${code} to @${db.telegramStatus.botUsername || 'kidsstore_demo_bot'}`,
  });
});

apiRouter.post('/admin/telegram/register', (req: Request, res: Response) => {
  const { telegramUserId, chatId } = req.body;
  db.telegramStatus.adminTelegramUserId = telegramUserId;
  db.telegramStatus.adminChatId = chatId;
  db.telegramStatus.setupComplete = true;
  res.json(db.telegramStatus);
});
