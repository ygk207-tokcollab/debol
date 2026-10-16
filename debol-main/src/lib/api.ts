import {
  adminToken, cartKey, customerToken, rememberAdminToken, rememberCartKey, rememberCustomerToken,
} from './session';
import type {
  AgeGroup, CartView, CatalogPage, Category, CustomerProfile, DeliveryZone, HomePayload, OrderDetail,
  OrderPlaced, OrderSummary, ProductDetail, Quote, SavedAddress, SizeGuideRow,
} from './types';

const RAW_BASE = import.meta.env.VITE_API_BASE_URL?.trim() || '/api/v1';
export const API_BASE = RAW_BASE.replace(/\/+$/, '');
export const API_ORIGIN = API_BASE.startsWith('http') ? new URL(API_BASE).origin : '';

export interface ApiFieldError {
  field: string;
  message: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly fields: ApiFieldError[];
  readonly requestId?: string;

  constructor(status: number, payload: { error?: string; message?: string; fields?: ApiFieldError[]; requestId?: string }) {
    super(payload.message || 'Something went wrong');
    this.name = 'ApiError';
    this.status = status;
    this.code = payload.error || 'unknown';
    this.fields = payload.fields || [];
    this.requestId = payload.requestId;
  }
}

type Auth = 'none' | 'customer' | 'admin';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  auth?: Auth;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  withCartKey?: boolean;
}

export interface ApiResponse<T> {
  data: T;
  headers: Headers;
}

export function buildUrl(path: string, query?: RequestOptions['query']) {
  const url = new URL(API_BASE + path, window.location.origin);
  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  });
  return url.origin === window.location.origin ? url.pathname + url.search : url.toString();
}

/**
 * Uploads are served by the backend under a root-relative /api/v1/media path. When the
 * API lives on another origin (Cloudflare Pages + Render) that path would 404, so it has
 * to be rewritten onto the API host.
 */
export function assetUrl(url?: string | null): string | undefined {
  if (!url) return undefined;
  if (!API_ORIGIN || !url.startsWith('/')) return url;
  return `${API_ORIGIN}${url}`;
}

async function call<T>(path: string, opts: RequestOptions = {}): Promise<ApiResponse<T>> {
  const { method = 'GET', body, query, auth = 'none', headers = {}, signal, withCartKey } = opts;
  const sent: Record<string, string> = { accept: 'application/json', ...headers };
  if (body !== undefined) sent['content-type'] = 'application/json';
  const token = auth === 'admin' ? adminToken() : auth === 'customer' ? customerToken() : null;
  if (token) sent.authorization = `Bearer ${token}`;
  const key = cartKey();
  if (withCartKey && key) sent['x-cart-key'] = key;

  const res = await fetch(buildUrl(path, query), {
    method,
    headers: sent,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });

  const text = await res.text();
  let data: T | undefined;
  try {
    data = text ? (JSON.parse(text) as T) : undefined;
  } catch {
    data = undefined;
  }

  if (!res.ok) {
    // A rejected token means the stored session is dead; drop it so the UI stops retrying.
    if (res.status === 401 && auth === 'admin') rememberAdminToken(null);
    if (res.status === 401 && auth === 'customer') rememberCustomerToken(null);
    throw new ApiError(res.status, (data ?? {}) as Record<string, never>);
  }

  const returnedKey = res.headers.get('x-cart-key');
  if (returnedKey) rememberCartKey(returnedKey);
  return { data: data as T, headers: res.headers };
}

export function api<T>(path: string, opts?: RequestOptions): Promise<T> {
  return call<T>(path, opts).then((r) => r.data);
}

export function apiWithHeaders<T>(path: string, opts?: RequestOptions): Promise<ApiResponse<T>> {
  return call<T>(path, opts);
}

export const storefront = {
  home: () => api<HomePayload>('/store'),
  storeInfo: () =>
    api<Pick<HomePayload, 'storeName' | 'tagline' | 'currency' | 'contact'>>('/store/settings'),
  categories: () => api<Category[]>('/categories'),
  ageGroups: () => api<AgeGroup[]>('/age-groups'),
  products: (query: Record<string, string | number | boolean | null | undefined>) =>
    api<CatalogPage>('/products', { query }),
  product: (slug: string) => api<ProductDetail>(`/products/${slug}`),
  deliveryZones: () => api<DeliveryZone[]>('/delivery-zones'),
  sizeGuides: () => api<SizeGuideRow[]>('/size-guides'),
};

export const cartApi = {
  view: () => apiWithHeaders<CartView>('/cart', { withCartKey: true }),
  add: (variantId: number, quantity: number) =>
    apiWithHeaders<CartView>('/cart/items', { method: 'POST', body: { variantId, quantity }, withCartKey: true }),
  setQuantity: (variantId: number, quantity: number) =>
    apiWithHeaders<CartView>(`/cart/items/${variantId}`, {
      method: 'PATCH',
      // The shared CartItemRequest DTO is @Valid-ed on the body, so variantId must be echoed back
      // even though the path variable is what the server acts on.
      body: { variantId, quantity },
      withCartKey: true,
    }),
  remove: (variantId: number) =>
    apiWithHeaders<CartView>(`/cart/items/${variantId}`, { method: 'DELETE', withCartKey: true }),
  clear: () => apiWithHeaders<CartView>('/cart', { method: 'DELETE', withCartKey: true }),
  claim: () => api<CartView>('/me/cart/claim', { method: 'POST', auth: 'customer', withCartKey: true }),
};

export const checkoutApi = {
  quote: (body: { region: string; city: string; subCity?: string }) =>
    api<Quote>('/checkout/quote', { method: 'POST', body, withCartKey: true }),
  place: (body: Record<string, unknown>, idempotencyKey: string) =>
    api<OrderPlaced>('/checkout', { method: 'POST', body, headers: { idempotency: idempotencyKey }, withCartKey: true }),
};

export const ordersApi = {
  track: (orderNumber: string, token: string) =>
    api<{ order: OrderDetail; publicToken: string }>(`/orders/track/${orderNumber}`, { query: { token } }),
};

export const accountApi = {
  loginByPhone: (body: { phone: string; orderNumber?: string; publicToken?: string; fullName?: string }) =>
    api<{ token: string; profile: CustomerProfile }>('/customers/auth/phone', { method: 'POST', body }),
  telegramLogin: (initData: string) =>
    api<{ token: string; profile: CustomerProfile }>('/telegram/auth', { method: 'POST', body: { initData } }),
  logout: () => api<{ ok: boolean }>('/customers/auth/logout', { method: 'POST', auth: 'customer' }),
  profile: () => api<CustomerProfile>('/me/profile', { auth: 'customer' }),
  saveProfile: (body: Record<string, unknown>) => api<CustomerProfile>('/me/profile', { method: 'PATCH', body, auth: 'customer' }),
  addresses: () => api<SavedAddress[]>('/me/addresses', { auth: 'customer' }),
  addAddress: (body: Record<string, unknown>) => api<SavedAddress>('/me/addresses', { method: 'POST', body, auth: 'customer' }),
  deleteAddress: (id: number) => api<{ ok: boolean }>(`/me/addresses/${id}`, { method: 'DELETE', auth: 'customer' }),
  // The server pairs each summary with its receipt token so the account can offer a shareable track link.
  orders: () => api<{ summary: OrderSummary; publicToken: string }[]>('/me/orders', { auth: 'customer' }),
  order: (id: number) => api<OrderDetail>(`/me/orders/${id}`, { auth: 'customer' }),
  requestCancellation: (id: number, reason: string) =>
    api<OrderDetail>(`/me/orders/${id}/cancel-request`, { method: 'POST', body: { reason }, auth: 'customer' }),
};
