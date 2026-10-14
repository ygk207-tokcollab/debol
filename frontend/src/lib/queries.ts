import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useMemo, useState } from 'react';
import { accountApi, cartApi, checkoutApi, storefront } from './api';
import { cartKey } from './session';
import type { CartView, Quote } from './types';

export const keys = {
  home: ['store', 'home'] as const,
  categories: ['store', 'categories'] as const,
  ageGroups: ['store', 'age-groups'] as const,
  products: (query: Record<string, unknown>) => ['store', 'products', query] as const,
  product: (slug: string) => ['store', 'product', slug] as const,
  zones: ['store', 'zones'] as const,
  cart: ['cart'] as const,
  profile: ['me', 'profile'] as const,
  myOrders: ['me', 'orders'] as const,
  addresses: ['me', 'addresses'] as const,
};

export function useHome() {
  return useQuery({ queryKey: keys.home, queryFn: storefront.home, staleTime: 30_000 });
}

export function useCategories() {
  return useQuery({ queryKey: keys.categories, queryFn: storefront.categories, staleTime: 60_000 });
}

/** Bands come from the database, so a shop can add or rename one without a frontend release. */
export function useAgeGroups() {
  return useQuery({ queryKey: keys.ageGroups, queryFn: storefront.ageGroups, staleTime: 5 * 60_000 });
}

export function useProducts(query: Record<string, string | number | boolean | null | undefined>) {
  return useQuery({
    queryKey: keys.products(query),
    queryFn: () => storefront.products(query),
    staleTime: 15_000,
  });
}

export function useProduct(slug: string) {
  return useQuery({
    queryKey: keys.product(slug),
    queryFn: () => storefront.product(slug),
    enabled: Boolean(slug),
    staleTime: 10_000,
  });
}

export function useDeliveryZones() {
  return useQuery({ queryKey: keys.zones, queryFn: storefront.deliveryZones, staleTime: 300_000 });
}

/**
 * The cart lives server-side and is addressed by the X-Cart-Key header, so the client only ever
 * mirrors whatever the backend returns — including any quantity it had to cap at available stock.
 */
export function useCart() {
  const enabled = Boolean(cartKey());
  const query = useQuery({
    queryKey: keys.cart,
    queryFn: () => cartApi.view().then((r) => r.data),
    staleTime: 5_000,
    enabled,
  });
  const client = useQueryClient();
  const refresh = useCallback(() => client.invalidateQueries({ queryKey: keys.cart }), [client]);

  const add = useMutation({
    mutationFn: ({ variantId, quantity }: { variantId: number; quantity: number }) =>
      cartApi.add(variantId, quantity).then((r) => r.data),
    onSuccess: (data) => client.setQueryData<CartView>(keys.cart, data),
  });
  const setQuantity = useMutation({
    mutationFn: ({ variantId, quantity }: { variantId: number; quantity: number }) =>
      cartApi.setQuantity(variantId, quantity).then((r) => r.data),
    onSuccess: (data) => client.setQueryData<CartView>(keys.cart, data),
  });
  const remove = useMutation({
    mutationFn: (variantId: number) => cartApi.remove(variantId).then((r) => r.data),
    onSuccess: (data) => client.setQueryData<CartView>(keys.cart, data),
  });
  const clear = useMutation({
    mutationFn: () => cartApi.clear().then((r) => r.data),
    onSuccess: () => client.setQueryData<CartView>(keys.cart, undefined),
  });

  const cart = query.data;
  const count = useMemo(() => (cart?.items ?? []).reduce((sum, item) => sum + item.quantity, 0), [cart]);

  return { cart, count, isLoading: enabled && query.isLoading, isError: query.isError, refresh, add, setQuantity, remove, clear };
}

/** Delivery pricing is a server calculation; the quote is refetched whenever the area changes. */
export function useQuote(area: { region: string; city: string; subCity?: string }) {
  const complete = area.region.trim().length > 1 && area.city.trim().length > 1;
  return useQuery({
    queryKey: ['checkout', 'quote', { ...area, cartKey: cartKey() }],
    queryFn: () => checkoutApi.quote(area),
    enabled: complete,
    staleTime: 20_000,
  });
}

export function useProfile(enabled: boolean) {
  return useQuery({ queryKey: keys.profile, queryFn: accountApi.profile, enabled, retry: false, staleTime: 60_000 });
}

export function useMyOrders(enabled: boolean) {
  const query = useQuery({ queryKey: keys.myOrders, queryFn: accountApi.orders, enabled, retry: false });
  // /me/orders wraps each summary with its receipt token; every screen here only wants the summary.
  return { ...query, data: query.data?.map((row) => row.summary) };
}

export function useAddresses(enabled: boolean) {
  return useQuery({ queryKey: keys.addresses, queryFn: accountApi.addresses, enabled, retry: false });
}

export function usePlaceOrder() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (variables: { body: Record<string, unknown>; idempotencyKey: string }) =>
      checkoutApi.place(variables.body, variables.idempotencyKey),
    // Checkout empties the cart on the server, so a cached cart would leave the header badge and the
    // product pages showing the stock that was just reserved.
    onSuccess: () => {
      client.removeQueries({ queryKey: keys.cart });
      client.invalidateQueries({ queryKey: ['store'] });
    },
  });
}

/** Stable per-attempt key so a double tap or a retry after a network error can never place twice. */
export function useIdempotencyKey(prefix: string) {
  const [key, setKey] = useState(() => `${prefix}-${crypto.randomUUID()}`);
  const reset = useCallback(() => setKey(`${prefix}-${crypto.randomUUID()}`), [prefix]);
  return { key, reset };
}

export type QuoteData = Quote;
