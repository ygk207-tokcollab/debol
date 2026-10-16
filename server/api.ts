import { Router, Request, Response } from 'express';
import { db, Product, Order } from './data';

export const apiRouter = Router();

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
      renderedItems.push({
        variantId: matchedVariant.id,
        productId: matchedProduct.id,
        productSlug: matchedProduct.slug,
        nameEn: matchedProduct.nameEn,
        sizeLabel: matchedVariant.sizeLabel,
        colorName: matchedVariant.colorName,
        unitPrice,
        quantity: item.quantity,
        lineTotal,
        stockAvailable: matchedVariant.stock,
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
    categories: db.categories.filter((c) => c.active),
    featured,
    newArrivals,
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
    return { ...c, productCount };
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
    items,
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
    ...product,
    inStock: product.totalStock > 0,
    price: product.basePrice,
    related,
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

  const matchedZone =
    db.deliveryZones.find((z) => z.region === region && z.city === city && (!subCity || z.subCity === subCity)) ||
    db.deliveryZones.find((z) => z.region === region) ||
    db.deliveryZones[0] ||
    { fee: 150, freeOver: 3000, estimatedDays: 2 };

  let fee = matchedZone.fee;
  if (matchedZone.freeOver && cart.subtotal >= matchedZone.freeOver) {
    fee = 0;
  }

  res.json({
    subtotal: cart.subtotal,
    deliveryFee: fee,
    total: cart.subtotal + fee,
    currency: cart.currency,
    estimatedDays: matchedZone.estimatedDays,
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
  const matchedZone =
    db.deliveryZones.find((z) => z.region === body.region && z.city === body.city) ||
    db.deliveryZones[0] ||
    { fee: 150, freeOver: 3000 };
  let deliveryFee = matchedZone.fee;
  if (matchedZone.freeOver && cart.subtotal >= matchedZone.freeOver) {
    deliveryFee = 0;
  }

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
  });
});

apiRouter.get('/orders/track/:orderNumber', (req: Request, res: Response) => {
  const orderNumber = String(req.params.orderNumber || '');

  const order = db.orders.find((o) => o.orderNumber.toUpperCase() === orderNumber.toUpperCase());
  if (!order) {
    return res.status(404).json({ error: 'order_not_found', message: 'Order not found' });
  }

  res.json({
    order,
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
  res.json(order);
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

const ADMIN_PERMISSIONS = [
  'CATALOG_READ',
  'CATALOG_WRITE',
  'ORDERS_READ',
  'ORDERS_WRITE',
  'INVENTORY_READ',
  'INVENTORY_WRITE',
  'NOTIFICATIONS_READ',
  'NOTIFICATIONS_WRITE',
  'ADMIN_READ',
  'ADMIN_WRITE',
  'SETTINGS_READ',
  'SETTINGS_WRITE',
  'AUDIT_READ',
];

apiRouter.post('/admin/auth/login', (req: Request, res: Response) => {
  const { email, password } = req.body;
  const admin = db.administrators.find((a) => a.email.toLowerCase() === String(email).toLowerCase());

  // Password validation: allow LocalDemo2026pass or test logins
  if (!admin || (password && password !== 'LocalDemo2026pass' && password !== 'admin' && !password.includes('pass') && !password.includes('demo') && password.length < 3)) {
    return res.status(401).json({ error: 'bad_credentials', message: 'Invalid email or password' });
  }

  res.json({
    token: 'admin-mock-token-2026',
    email: admin.email,
    fullName: admin.fullName,
    role: admin.role || 'OWNER',
    permissions: ADMIN_PERMISSIONS,
  });
});

apiRouter.post('/admin/auth/dev-login', (_req: Request, res: Response) => {
  res.json({
    token: 'admin-mock-token-2026',
    email: 'owner@kidsstore.test',
    fullName: 'Store owner',
    role: 'OWNER',
    permissions: ADMIN_PERMISSIONS,
  });
});

apiRouter.get('/admin/auth/me', (_req: Request, res: Response) => {
  res.json({
    id: 1,
    email: 'owner@kidsstore.test',
    fullName: 'Store owner',
    role: 'OWNER',
    permissions: ADMIN_PERMISSIONS,
  });
});

apiRouter.post('/admin/auth/revoke', (_req: Request, res: Response) => {
  res.json({ ok: true });
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

apiRouter.post('/admin/products/:id/image-upload', (_req: Request, res: Response) => {
  res.json({
    uploaded: true,
    url: '/brand-poster.png',
    storageKey: 'local-asset',
  });
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
  res.json(order);
});

apiRouter.post('/admin/orders/:id/status', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const target = req.query.target as any;
  const order = db.orders.find((o) => o.id === id);
  if (order && target) {
    order.status = target;
    order.updatedAt = new Date().toISOString();
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
    order.status = 'CANCELLED';
    order.cancelReason = reason;
    order.updatedAt = new Date().toISOString();
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

apiRouter.get('/admin/administrators', (_req: Request, res: Response) => {
  res.json(db.administrators);
});

apiRouter.post('/admin/administrators', (req: Request, res: Response) => {
  const newAdmin = {
    id: db.administrators.length + 1,
    ...req.body,
    active: true,
    createdAt: new Date().toISOString(),
  };
  db.administrators.push(newAdmin);
  res.json(newAdmin);
});

apiRouter.put('/admin/administrators/:id', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const admin = db.administrators.find((a) => a.id === id);
  if (admin) {
    Object.assign(admin, req.body);
  }
  res.json(admin);
});

apiRouter.post('/admin/administrators/:id/revoke', (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const admin = db.administrators.find((a) => a.id === id);
  if (admin) {
    admin.active = false;
  }
  res.json(admin);
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
