/** Hand-written mirror of the backend DTOs (see docs/api-samples for captured live responses). */


export interface ProductSummary {
  slug: string;
  nameEn: string;
  categorySlug: string;
  categoryNameEn: string;
  price: number;
  salePrice: number | null;
  currency: string;
  imageUrl: string | null;
  totalStock: number;
  featured: boolean;
  sizingSystem: 'AGE' | 'NUMERIC' | 'SHOE' | 'LETTER' | 'ONE_SIZE';
  audience: 'CHILD' | 'ADULT' | 'FAMILY';
  gender: 'BOY' | 'GIRL' | 'UNISEX' | 'WOMAN' | 'MAN';
  ageGroups: string[];
  createdAt: string;
}

export interface ProductImage {
  url: string;
  altEn: string | null;
}

export interface Variant {
  id: number;
  sizeLabel: string;
  colorName: string;
  colorHex: string | null;
  sku: string | null;
  price: number;
  stock: number;
  available: boolean;
}

export interface SizeGuide {
  titleEn: string;
  bodyEn: string | null;
}

export interface ProductDetail extends Omit<ProductSummary, 'createdAt'> {
  descriptionEn: string | null;
  images: ProductImage[];
  variants: Variant[];
  isSample: boolean;
  status: string;
  sizeGuide: SizeGuide | null;
  related: ProductSummary[];
}

export interface Category {
  slug: string;
  nameEn: string;
  descriptionEn: string | null;
  audience: 'CHILD' | 'ADULT' | 'FAMILY';
  imageUrl: string | null;
  productCount: number;
}

/** One row of the backend age_group table - the dropdown and the admin editor both read this. */
export interface AgeGroup {
  code: string;
  label: string;
  minAge?: number | null;
  maxAge?: number | null;
  ageUnit: 'MONTH' | 'YEAR';
}

export interface Banner {
  id: number;
  titleEn: string;
  subtitleEn: string | null;
  linkType: string;
  linkValue: string | null;
  placement: string;
}

export interface StoreCollection {
  slug: string;
  nameEn: string;
  descriptionEn: string | null;
  products: ProductSummary[];
}

export interface HomePayload {
  storeName: string;
  tagline: string;
  currency: string;
  contact: { phone: string; email: string };
  categories: Category[];
  featured: ProductSummary[];
  newArrivals: ProductSummary[];
  banners: Banner[];
  collections: StoreCollection[];
}

export interface CatalogPage {
  items: ProductSummary[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalElements: number;
}

export interface CartItem {
  variantId: number;
  productSlug: string;
  nameEn: string;
  sizeLabel: string;
  colorName: string;
  colorHex: string | null;
  unitPrice: number;
  listPrice: number;
  quantity: number;
  lineTotal: number;
  stock: number;
  imageUrl: string | null;
}

export interface CartView {
  cartKey: string;
  items: CartItem[];
  subtotal: number;
  currency: string;
}

export interface Quote {
  subtotal: number;
  deliveryFee: number;
  total: number;
  currency: string;
  zoneNameEn: string | null;
  estimatedDays: number | null;
}

export interface OrderPlaced {
  orderNumber: string;
  publicToken: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  currency: string;
  items: CartItem[];
  customerSessionToken: string | null;
  replayed: boolean;
}

export interface CustomerProfile {
  fullName: string;
  phone: string;
  secondaryPhone: string | null;
  telegramLinked: boolean;
  currency: string;
}

export interface SavedAddress {
  id: number;
  label: string | null;
  region: string;
  city: string;
  subCity: string | null;
  neighborhood: string | null;
  addressLine: string;
  instructions: string | null;
  isDefault: boolean;
}

export interface OrderSummary {
  id: number;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string;
  currency: string;
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  amountCollected: number;
  customerName: string;
  customerPhone: string;
  city: string;
  region: string;
  itemCount: number;
  placedVia: string;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OrderLine {
  productNameEn: string;
  sizeLabel: string;
  colorName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  productSlug: string | null;
  variantId: number | null;
  imageUrl: string | null;
}

export interface StatusEvent {
  fromStatus: string | null;
  toStatus: string;
  note: string | null;
  actorType: string;
  actor: string | null;
  at: string;
}

export interface OrderNotification {
  id: number;
  eventType: string;
  status: string;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
  nextAttemptAt: string;
  createdAt: string;
  message: string;
}

export interface OrderDetail extends Omit<OrderSummary, 'updatedAt'> {
  allowedStatuses: string[];
  discountAmount: number;
  balanceDue: number;
  dialPhone: string;
  secondaryPhone: string | null;
  telegramUserId: number | null;
  subCity: string | null;
  neighborhood: string | null;
  addressLine: string;
  deliveryInstructions: string | null;
  preferredDeliveryTime: string | null;
  deliveryZoneName: string | null;
  estimatedDays: number | null;
  courierName: string | null;
  courierPhone: string | null;
  confirmedAt: string | null;
  processingAt: string | null;
  outForDeliveryAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  cancelRequestedAt: string | null;
  cancellationReason: string | null;
  cancelledBy: string | null;
  stockRestored: boolean;
  failedDeliveryCount: number;
  paymentCollectedAt: string | null;
  paymentCollectedBy: string | null;
  updatedAt: string;
  items: OrderLine[];
  history: StatusEvent[];
  notifications: OrderNotification[] | null;
  auditTrail: Record<string, unknown>[] | null;
}

export interface DeliveryZone {
  id: number;
  nameEn: string;
  region: string;
  city: string;
  subCity: string | null;
  fee: number;
  freeOver: number | null;
  estimatedDays: number | null;
  active: boolean;
}

export interface SizeGuideRow {
  sizingSystem: string;
  titleEn: string;
  bodyEn: string | null;
}

/* ------------------------------------------------------------------ admin */

export interface AdminProductVariant {
  id: number;
  sizeLabel: string;
  colorName: string;
  colorHex: string | null;
  sku: string | null;
  effectivePrice: number;
  stock: number;
  lowStockThreshold: number;
  lowStock: boolean;
  active: boolean;
}

export interface AdminProduct {
  id: number;
  slug: string;
  nameEn: string;
  descriptionEn: string | null;
  categoryId: number;
  categorySlug: string;
  categoryNameEn: string;
  audience: string;
  gender: string;
  ageGroups: string[];
  sizingSystem: string;
  basePrice: number;
  salePrice: number | null;
  status: string;
  featured: boolean;
  isSample: boolean;
  totalStock: number;
  lowStockVariants: number;
  variants: AdminProductVariant[];
  images: { id: number; url: string; isPrimary: boolean; altEn: string | null }[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface InventoryRow {
  variantId: number;
  productId: number;
  productSlug: string;
  nameEn: string;
  category: string;
  sizeLabel: string;
  colorName: string;
  sku: string | null;
  stock: number;
  threshold: number;
  lowStock: boolean;
  outOfStock: boolean;
  status: string;
}

export interface MovementRow {
  id: number;
  variantId: number;
  changeQty: number;
  balanceAfter: number;
  reason: string;
  referenceType: string | null;
  referenceId: number | null;
  actorType: string;
  actorEmail: string | null;
  note: string | null;
  createdAt: string;
}

export interface StoreSettings {
  storeNameEn: string;
  taglineEn: string;
  contactPhone: string;
  contactEmail: string;
  currency: string;
  lowStockThreshold: number;
  allowCustomerCancelUntil: string;
  restoreStockOnCancellation: boolean;
  requireAdminConfirmation: boolean;
  freeDeliveryOver: number | null;
  botUsername: string | null;
  telegramEnabled: boolean;
  updatedAt?: string;
}

export interface AdminAgeGroup extends AgeGroup {
  id: number;
  sortOrder: number;
  active: boolean;
}

export interface AdminCategory {
  id: number;
  slug: string;
  nameEn: string;
  descriptionEn: string | null;
  audience: string;
  sortOrder: number;
  active: boolean;
  isSample: boolean;
}

export interface Administrator {
  id: number;
  email: string;
  fullName: string;
  phone: string | null;
  role: 'OWNER' | 'MANAGER' | 'DELIVERY_STAFF';
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface AuditRow {
  id: number;
  actorType: string;
  actor: string;
  action: string;
  entityType: string;
  summary: string;
  at: string;
}

export interface OutboxRow {
  id: number;
  eventType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  lastAttemptAt: string | null;
  sentAt: string | null;
  lastError?: string | null;
  chatId: number | null;
  orderNumber: string | null;
  adminLink?: string | null;
  inlineActions: boolean;
  message: string;
  createdAt: string;
}

export interface TelegramStatus {
  botTokenConfigured: boolean;
  enabled: boolean;
  setupComplete: boolean;
  adminChatId: number | null;
  adminTelegramUserId: number | null;
  adminContactPhone: string | null;
  botUsername: string | null;
  pollingEnabled: boolean;
  ready: boolean;
  warning?: string | null;
  pendingPairingCodes: { code?: string; expiresAt?: string }[];
}

export interface Dashboard {
  generatedAt: string;
  currency: string;
  ordersToday: number;
  awaitingConfirmation: number;
  inFulfilment: number;
  deliveredTotal: number;
  cancelledTotal: number;
  collectedRevenue: number;
  orderedValueToday: number;
  unpaidDelivered: number;
  ordersByStatus: Record<string, number>;
  ordersByPaymentStatus: Record<string, number>;
  lowStock: {
    variantId: number;
    product: string;
    productSlug: string;
    sizeLabel: string;
    colorName: string;
    stock: number;
    threshold: number;
    outOfStock: boolean;
  }[];
  bestSellers: { productId: number; nameEn: string; slug: string; unitsSold: number }[];
  notifications: { pending: number; sent: number; deadLetter: number };
  telegram: TelegramStatus;
}

export interface Paged<T> {
  items: T[];
  page: number;
  pageSize?: number;
  totalPages: number;
  totalElements: number;
}

export interface AdminSession {
  token: string;
  email: string;
  fullName: string;
  role: 'OWNER' | 'MANAGER' | 'DELIVERY_STAFF';
  permissions: string[];
}
