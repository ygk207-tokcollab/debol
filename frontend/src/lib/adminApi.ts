import { api, buildUrl } from './api';
import { ApiError } from './api';
import { adminToken } from './session';
import type {
  AdminAgeGroup, AdminCategory, AdminProduct, Administrator, AuditRow, Dashboard, DeliveryZone, InventoryRow,
  MovementRow, OrderDetail, OrderSummary, OutboxRow, Paged, StoreSettings, TelegramStatus,
} from './types';

/** Multipart upload: the JSON helper cannot be used here, but the error shape is the same. */
async function uploadImage(
  id: number,
  file: File,
  options: { altEn?: string; isPrimary?: boolean },
): Promise<{ uploaded: boolean; url: string; storageKey: string }> {
  const query: Record<string, string | boolean> = { isPrimary: options.isPrimary ?? false };
  if (options.altEn) query.altEn = options.altEn;
  const form = new FormData();
  form.append('file', file);
  const res = await fetch(buildUrl(`/admin/products/${id}/image-upload`, query), {
    method: 'POST',
    headers: adminToken() ? { authorization: `Bearer ${adminToken()}` } : {},
    body: form,
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : {};
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}

export interface AdminLogin {
  token: string;
  email: string;
  fullName: string;
  role: string;
  permissions: string[];
}

export const adminAuth = {
  login: (email: string, password: string) => api<AdminLogin>('/admin/auth/login', { method: 'POST', body: { email, password } }),
  me: () => api<AdminLogin>('/admin/auth/me', { auth: 'admin' }),
  signOut: () => api<{ ok: boolean }>('/admin/auth/revoke', { method: 'POST', auth: 'admin' }),
  devLogin: (email: string) => api<AdminLogin>('/admin/auth/dev-login', { method: 'POST', body: { email } }),
};

export const adminDashboard = {
  get: () => api<Dashboard>('/admin/dashboard', { auth: 'admin' }),
};

export const adminProducts = {
  list: (query: Record<string, string | number | boolean | null | undefined>) =>
    api<Paged<AdminProduct>>('/admin/products', { query, auth: 'admin' }),
  get: (id: number) => api<AdminProduct>(`/admin/products/${id}`, { auth: 'admin' }),
  create: (body: Record<string, unknown>) => api<AdminProduct>('/admin/products', { method: 'POST', body, auth: 'admin' }),
  update: (id: number, body: Record<string, unknown>) =>
    api<AdminProduct>(`/admin/products/${id}`, { method: 'PUT', body, auth: 'admin' }),
  archive: (id: number) => api<{ ok: boolean }>(`/admin/products/${id}`, { method: 'DELETE', auth: 'admin' }),
  setStatus: (id: number, status: string) =>
    api<AdminProduct>(`/admin/products/${id}/status`, { method: 'POST', query: { status }, auth: 'admin' }),
  setFeatured: (id: number, featured: boolean) =>
    api<AdminProduct>(`/admin/products/${id}/featured`, { method: 'POST', query: { featured }, auth: 'admin' }),
  addImage: (id: number, body: { url: string; altEn?: string; isPrimary?: boolean }) =>
    api<{ id: number; url: string }>(`/admin/products/${id}/images`, { method: 'POST', body, auth: 'admin' }),
  uploadImage: (id: number, file: File, options: { altEn?: string; isPrimary?: boolean } = {}) =>
    uploadImage(id, file, options),
  makePrimary: (imageId: number) => api<{ ok: boolean }>(`/admin/images/${imageId}/primary`, { method: 'POST', auth: 'admin' }),
  deleteImage: (imageId: number) => api<{ ok: boolean }>(`/admin/images/${imageId}`, { method: 'DELETE', auth: 'admin' }),
};

export const adminOrders = {
  list: (query: Record<string, string | number | boolean | null | undefined>) =>
    api<Paged<OrderSummary>>('/admin/orders', { query, auth: 'admin' }),
  get: (id: number) => api<OrderDetail>(`/admin/orders/${id}`, { auth: 'admin' }),
  transition: (id: number, target: string, note?: string) =>
    api<{ orderNumber: string; status: string; paymentStatus: string }>(`/admin/orders/${id}/status`,
      { method: 'POST', query: { target }, body: { note: note ?? null }, auth: 'admin' }),
  cancel: (id: number, reason: string, restoreStock?: boolean) =>
    api<{ orderNumber: string; status: string; stockRestored: boolean }>(`/admin/orders/${id}/cancel`,
      { method: 'POST', body: { reason, restoreStock }, auth: 'admin' }),
  collectCash: (id: number, body: { amount?: number; collectedBy?: string; note?: string }) =>
    api<{ orderNumber: string; paymentStatus: string; amountCollected: number; collectedBy: string | null }>(
      `/admin/orders/${id}/cash-collection`, { method: 'POST', body, auth: 'admin' }),
  assignCourier: (id: number, body: { courierName?: string; courierPhone?: string }) =>
    api<{ courierName: string | null; courierPhone: string | null }>(`/admin/orders/${id}/courier`,
      { method: 'POST', body, auth: 'admin' }),
  retryNotifications: (id: number) =>
    api<{ retried: number }>(`/admin/orders/${id}/notification-retry`, { method: 'POST', auth: 'admin' }),
};

export const adminInventory = {
  list: (query: Record<string, string | number | boolean | null | undefined> = {}) =>
    api<InventoryRow[]>('/admin/inventory', { query, auth: 'admin' }),
  movements: (query: Record<string, string | number | undefined> = {}) =>
    api<Paged<MovementRow>>('/admin/inventory/movements', { query, auth: 'admin' }),
  adjust: (variantId: number, body: { mode: 'SET' | 'DELTA'; stock?: number; delta?: number; reason?: string; note?: string }) =>
    api<InventoryRow>(`/admin/variants/${variantId}/stock`, { method: 'POST', body, auth: 'admin' }),
  patch: (variantId: number, query: { lowStockThreshold?: number; active?: boolean }) =>
    api<InventoryRow>(`/admin/variants/${variantId}`, { method: 'PATCH', query, auth: 'admin' }),
};

export const adminSettings = {
  get: () => api<StoreSettings>('/admin/settings', { auth: 'admin' }),
  save: (body: StoreSettings) => api<StoreSettings>('/admin/settings', { method: 'PUT', body, auth: 'admin' }),
  zones: () => api<DeliveryZone[]>('/admin/delivery-zones', { auth: 'admin' }),
  createZone: (body: Record<string, unknown>) => api<DeliveryZone>('/admin/delivery-zones', { method: 'POST', body, auth: 'admin' }),
  updateZone: (id: number, body: Record<string, unknown>) =>
    api<DeliveryZone>(`/admin/delivery-zones/${id}`, { method: 'PUT', body, auth: 'admin' }),
  toggleZone: (id: number, active: boolean) =>
    api<DeliveryZone>(`/admin/delivery-zones/${id}`, { method: 'PATCH', body: { active }, auth: 'admin' }),
  categories: () => api<AdminCategory[]>('/admin/categories', { auth: 'admin' }),
  ageGroups: () => api<AdminAgeGroup[]>('/admin/age-groups', { auth: 'admin' }),
  saveAgeGroup: (body: Record<string, unknown>, id?: number) =>
    api<AdminAgeGroup>(id ? `/admin/age-groups/${id}` : '/admin/age-groups', {
      method: id ? 'PUT' : 'POST', body, auth: 'admin',
    }),
  createCategory: (body: Record<string, unknown>) => api<AdminCategory>('/admin/categories', { method: 'POST', body, auth: 'admin' }),
  updateCategory: (id: number, body: Record<string, unknown>) =>
    api<AdminCategory>(`/admin/categories/${id}`, { method: 'PUT', body, auth: 'admin' }),
};

export const adminPeople = {
  list: () => api<Administrator[]>('/admin/administrators', { auth: 'admin' }),
  create: (body: { email: string; fullName: string; phone?: string; role: string; password: string }) =>
    api<Administrator>('/admin/administrators', { method: 'POST', body, auth: 'admin' }),
  update: (id: number, body: Record<string, unknown>) =>
    api<Administrator>(`/admin/administrators/${id}`, { method: 'PUT', body, auth: 'admin' }),
  revoke: (id: number) => api<Administrator>(`/admin/administrators/${id}/revoke`, { method: 'POST', auth: 'admin' }),
  audit: (query: Record<string, string | number | undefined> = {}) =>
    api<Paged<AuditRow>>('/admin/audit', { query, auth: 'admin' }),
};

export const adminNotifications = {
  list: (query: Record<string, string | number | undefined> = {}) =>
    api<Paged<OutboxRow> & { counts: Record<string, number>; telegram: TelegramStatus }>('/admin/notifications',
      { query, auth: 'admin' }),
  retry: (id: number) => api<{ retried: number }>(`/admin/notifications/${id}/retry`, { method: 'POST', auth: 'admin' }),
  retryAll: () => api<{ retried: number }>('/admin/notifications/retry-all', { method: 'POST', auth: 'admin' }),
  dispatch: () => api<{ dispatched?: number }>('/admin/notifications/dispatch', { method: 'POST', auth: 'admin' }),
  sendTest: () => api<{ ok: boolean; detail?: string }>('/admin/notifications/test', { method: 'POST', auth: 'admin' }),
  telegramStatus: () => api<TelegramStatus>('/admin/telegram/status', { auth: 'admin' }),
  saveTelegram: (body: { botUsername?: string; enabled?: boolean; miniAppUrl?: string; adminNotifyUrl?: string }) =>
    api<TelegramStatus>('/admin/telegram/config', { method: 'PUT', body, auth: 'admin' }),
  pairingCode: () => api<{ code: string; expiresAt: string; instructions: string }>(
    '/admin/telegram/pairing-code', { method: 'POST', auth: 'admin' }),
  registerChat: (body: { telegramUserId: number; chatId: number }) =>
    api<TelegramStatus>('/admin/telegram/register', { method: 'POST', body, auth: 'admin' }),
};
