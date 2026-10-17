import fs from 'fs';
import path from 'path';

function loadJson<T>(filename: string, fallback: T): T {
  try {
    const fullPath = path.resolve(process.cwd(), 'docs/api-samples', filename);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      return JSON.parse(content) as T;
    }
  } catch (err) {
    console.warn(`[Mock DB] Failed to load ${filename}, using fallback:`, err);
  }
  return fallback;
}

export interface Variant {
  id: number;
  sizeLabel: string;
  colorName: string;
  colorHex?: string;
  sku: string;
  effectivePrice?: number;
  stock: number;
  lowStockThreshold: number;
  lowStock?: boolean;
  active: boolean;
}

export interface ProductImage {
  id: number;
  url: string;
  altEn?: string;
  isPrimary: boolean;
  contentType?: string | null;
  sizeBytes?: number | null;
}

export interface Product {
  id: number;
  slug: string;
  nameEn: string;
  nameAm?: string;
  descriptionEn?: string;
  descriptionAm?: string;
  categoryId?: number;
  categorySlug: string;
  categoryNameEn: string;
  audience: string;
  gender: string;
  ageGroups: string[];
  sizingSystem: string;
  basePrice: number;
  price?: number;
  salePrice?: number | null;
  currency: string;
  status: string;
  featured: boolean;
  isSample?: boolean;
  totalStock: number;
  lowStockVariants?: number;
  variants: Variant[];
  images: ProductImage[];
  createdAt: string;
  updatedAt: string;
  publishedAt?: string;
}

export interface Category {
  id: number;
  slug: string;
  nameEn: string;
  nameAm?: string;
  descriptionEn?: string;
  audience: string;
  productCount?: number;
  sortOrder: number;
  active: boolean;
  isSample?: boolean;
}

export interface AgeGroup {
  id: number;
  code: string;
  label: string;
  minAge?: number;
  maxAge?: number;
  ageUnit: string;
  sortOrder: number;
  active: boolean;
}

export interface DeliveryZone {
  id: number;
  nameEn: string;
  region: string;
  city: string;
  subCity?: string;
  fee: number;
  freeOver?: number | null;
  estimatedDays: number;
  active?: boolean;
}

export interface OrderItem {
  id: number;
  variantId: number;
  productId: number;
  productSlug: string;
  nameEn: string;
  sizeLabel: string;
  colorName: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface OrderHistoryEvent {
  fromStatus: string | null;
  toStatus: string;
  note?: string | null;
  actorType: string;
  actor?: string | null;
  at: string;
}

export interface Order {
  id: number;
  orderNumber: string;
  publicToken: string;
  status: 'PENDING_CONFIRMATION' | 'CONFIRMED' | 'PROCESSING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'CANCELLED';
  paymentStatus: 'UNPAID' | 'PAID' | 'REFUNDED';
  paymentMethod: string;
  currency: string;
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  amountCollected: number;
  customerName: string;
  customerPhone: string;
  secondaryPhone?: string;
  city: string;
  region: string;
  subCity?: string;
  neighborhood?: string;
  addressLine?: string;
  deliveryInstructions?: string;
  preferredDeliveryTime?: string;
  deliveryAddress?: string;
  itemCount: number;
  items: OrderItem[];
  placedVia: string;
  cancelRequested: boolean;
  cancelReason?: string;
  history: OrderHistoryEvent[];
  courierName?: string | null;
  courierPhone?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CartItem {
  variantId: number;
  quantity: number;
}

// Initial Data Loading
const initialStore = loadJson<any>('store.json', {});
const initialCategories = loadJson<Category[]>('admin_categories.json', []);
const initialAgeGroups = loadJson<AgeGroup[]>('admin_age-groups.json', []);
const initialDeliveryZones = loadJson<DeliveryZone[]>('admin_delivery-zones.json', []);
const initialSizeGuides = loadJson<any[]>('size-guides.json', []);
const initialSettings = loadJson<any>('admin_settings.json', {
  storeNameEn: 'Debol',
  taglineEn: "Children's clothing, shoes and toys, delivered across Ethiopia",
  contactPhone: '0911526922',
  contactEmail: 'orders@example.com',
  currency: 'ETB',
  lowStockThreshold: 3,
  allowCustomerCancelUntil: 'PROCESSING',
  restoreStockOnCancellation: true,
  requireAdminConfirmation: true,
  freeDeliveryOver: 2500,
  botUsername: 'kidsstore_demo_bot',
  telegramEnabled: true,
});
const initialAdmins = loadJson<any[]>('admin_administrators.json', [
  { id: 1, email: 'owner@kidsstore.test', fullName: 'Store owner', phone: '0911526922', role: 'OWNER', active: true, createdAt: new Date().toISOString() },
  { id: 2, email: 'demo@kidsstore.test', fullName: 'Demo operator', phone: '0911526922', role: 'OWNER', active: true, createdAt: new Date().toISOString() },
]);
const initialOrdersJson = loadJson<{ items: any[] }>('admin_orders.json', { items: [] });
const initialInventory = loadJson<any[]>('admin_inventory.json', []);
const initialAuditJson = loadJson<{ items: any[] }>('admin_audit.json', { items: [] });

// Build comprehensive product list
const productMap = new Map<number, Product>();

// Seed products from inventory items if available
initialInventory.forEach((inv) => {
  const pId = inv.productId;
  if (!productMap.has(pId)) {
    const featuredItem = (initialStore.featured || []).find((f: any) => f.slug === inv.productSlug);
    const newArrivalItem = (initialStore.newArrivals || []).find((f: any) => f.slug === inv.productSlug);
    const itemMeta = featuredItem || newArrivalItem || {};
    const cat = initialCategories.find((c) => c.nameEn === inv.category || c.slug === itemMeta.categorySlug);

    productMap.set(pId, {
      id: pId,
      slug: inv.productSlug,
      nameEn: inv.nameEn,
      nameAm: itemMeta.nameAm || '',
      descriptionEn: itemMeta.descriptionEn || `High-quality ${inv.nameEn} designed for comfort and durability.`,
      descriptionAm: '',
      categoryId: cat?.id || 1,
      categorySlug: cat?.slug || itemMeta.categorySlug || 'baby-clothing',
      categoryNameEn: cat?.nameEn || inv.category || 'Baby clothing',
      audience: itemMeta.audience || cat?.audience || 'CHILD',
      gender: itemMeta.gender || 'UNISEX',
      ageGroups: itemMeta.ageGroups || ['TODDLER_1_2Y', 'LITTLE_KID_3_4Y'],
      sizingSystem: itemMeta.sizingSystem || 'AGE',
      basePrice: itemMeta.price || 850,
      price: itemMeta.price || 850,
      salePrice: itemMeta.salePrice || null,
      currency: 'ETB',
      status: inv.status || 'PUBLISHED',
      featured: Boolean(itemMeta.featured),
      isSample: true,
      totalStock: 0,
      lowStockVariants: 0,
      variants: [],
      images: itemMeta.images || [],
      createdAt: itemMeta.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      publishedAt: itemMeta.createdAt || new Date().toISOString(),
    });
  }

  const p = productMap.get(pId)!;
  p.variants.push({
    id: inv.variantId,
    sizeLabel: inv.sizeLabel,
    colorName: inv.colorName,
    sku: inv.sku || `SKU-${inv.variantId}`,
    effectivePrice: p.salePrice || p.basePrice,
    stock: inv.stock,
    lowStockThreshold: inv.threshold || 3,
    lowStock: inv.lowStock || false,
    active: true,
  });
});

// Calculate total stock and low stock counts
for (const p of productMap.values()) {
  p.totalStock = p.variants.reduce((acc, v) => acc + (v.stock || 0), 0);
  p.lowStockVariants = p.variants.filter((v) => v.stock <= v.lowStockThreshold).length;
}

// Convert orders to full Order objects
const STATUS_CHAIN = ['PENDING_CONFIRMATION', 'CONFIRMED', 'PROCESSING', 'OUT_FOR_DELIVERY', 'DELIVERED'];

// Seeded orders only carry their current status, so replay the chain up to it: the first event lands
// at createdAt and the last at updatedAt, which is what the admin timeline renders.
function seedHistory(status: string, createdAt: string, updatedAt: string): OrderHistoryEvent[] {
  if (status === 'CANCELLED') {
    return [{ fromStatus: null, toStatus: 'PENDING_CONFIRMATION', note: 'Order placed', actorType: 'SYSTEM', at: createdAt }];
  }
  const reached = STATUS_CHAIN.slice(0, Math.max(1, STATUS_CHAIN.indexOf(status) + 1));
  if (reached.length === 0) return [{ fromStatus: null, toStatus: status, note: 'Order placed', actorType: 'SYSTEM', at: createdAt }];
  return reached.map((toStatus, i) => ({
    fromStatus: i === 0 ? null : reached[i - 1],
    toStatus,
    note: i === 0 ? 'Order placed' : null,
    actorType: 'SYSTEM',
    at: i === 0 ? createdAt : i === reached.length - 1 ? updatedAt : createdAt,
  }));
}

let ordersList: Order[] = (initialOrdersJson.items || []).map((o: any, idx: number) => ({
  id: o.id || idx + 1,
  orderNumber: o.orderNumber || `ORD-2026-0000${idx + 1}`,
  publicToken: `tok_${Math.random().toString(36).substring(2, 10)}`,
  status: o.status || 'PENDING_CONFIRMATION',
  paymentStatus: o.paymentStatus || 'UNPAID',
  paymentMethod: o.paymentMethod || 'CASH_ON_DELIVERY',
  currency: o.currency || 'ETB',
  subtotal: o.subtotal || 1000,
  deliveryFee: o.deliveryFee || 150,
  totalAmount: o.totalAmount || 1150,
  amountCollected: o.amountCollected || 0,
  customerName: o.customerName || 'Almaz Tesfaye',
  customerPhone: o.customerPhone || '0911526922',
  city: o.city || 'Addis Ababa',
  region: o.region || 'Addis Ababa',
  subCity: o.subCity || 'Bole',
  neighborhood: 'Bole Medhanialem',
  addressLine: 'House 12, near Edna Mall',
  itemCount: o.itemCount || 1,
  items: [
    {
      id: 1,
      variantId: 1,
      productId: 1,
      productSlug: 'baby-bodysuit-3pack',
      nameEn: 'Baby Bodysuit 3 Pack',
      sizeLabel: '0-3m',
      colorName: 'White',
      unitPrice: 750,
      quantity: 1,
      lineTotal: 750,
    },
  ],
  placedVia: o.placedVia || 'WEB',
  cancelRequested: Boolean(o.cancelRequested),
  history: seedHistory(o.status || 'PENDING_CONFIRMATION', o.createdAt || new Date().toISOString(), o.updatedAt || new Date().toISOString()),
  createdAt: o.createdAt || new Date().toISOString(),
  updatedAt: o.updatedAt || new Date().toISOString(),
}));

export const db = {
  storeSettings: { ...initialSettings },
  categories: [...initialCategories],
  ageGroups: [...initialAgeGroups],
  deliveryZones: [...initialDeliveryZones],
  sizeGuides: [...initialSizeGuides],
  administrators: [...initialAdmins],
  products: Array.from(productMap.values()),
  orders: ordersList,
  carts: new Map<string, CartItem[]>(),
  customerProfiles: new Map<string, any>(),
  savedAddresses: new Map<string, any[]>(),
  auditLogs: [...(initialAuditJson.items || [])],
  banners: initialStore.banners || [
    {
      id: 1,
      titleEn: 'School season essentials',
      subtitleEn: 'Uniforms, pinafores and school shoes with 1-2 day delivery in Addis Ababa.',
      linkType: 'COLLECTION',
      linkValue: 'back-to-school',
      placement: 'HERO',
    },
    {
      id: 2,
      titleEn: 'Little feet, first steps',
      subtitleEn: 'Soft sole baby shoes from ETB 640.',
      linkType: 'CATEGORY',
      linkValue: 'baby-shoes',
      placement: 'HOME',
    },
  ],
  collections: initialStore.collections || [],
  telegramStatus: {
    botTokenConfigured: true,
    enabled: true,
    setupComplete: true,
    adminChatId: 777001,
    adminTelegramUserId: 777001,
    adminContactPhone: '0911526922',
    botUsername: 'kidsstore_demo_bot',
    pollingEnabled: false,
    ready: true,
    pendingPairingCodes: [] as any[],
  },
};
