# Frontend build notes (shared context for page authors)

Read this before writing any page. Everything listed here already exists — do not recreate it and
do **not** edit the shared files (`src/lib/*`, `src/components/*`, `src/locales/*`, `src/state/*`,
`tailwind.config.js`, `src/index.css`). If something you need is missing, define it inside your own
page file.

## Toolchain

React 19 + TypeScript + Vite 7 + Tailwind **v3** + react-router-dom v7 + TanStack Query v5 +
react-hook-form v7 + zod v4 + lucide-react. Typecheck with `npm run typecheck` (from
`kids-store/frontend`). `tsconfig.json` has `strict`, `noUnusedLocals` and `noUnusedParameters` on —
an unused import or variable is a build error. No CSS modules; use the Tailwind classes below.

## Design rules (from the brief)

- Warm ivory background, deep forest green primary, sage support, restrained terracotta accent.
- Palette classes: `bg-ivory-50|100|200|300`, `text-ink`, `text-ink-soft`, `text-ink-mute`,
  `forest-50…800` (`forest-500` is the primary button), `sage-100…500`, `clay-100|300|500|600`.
- Headings use `font-display` (already applied to h1/h2/h3); body text uses `font-sans`.
- Mobile first: layouts must be comfortable at 360px wide and scale to `sm:`, `lg:`.
- **No** glassmorphism, no big drop shadows, no rounded-everything, no giant hero headings, no
  animation beyond `transition-colors`, no emoji anywhere.
- Reusable classes already defined in `src/index.css`: `field-label`, `field`, `field-error`,
  `btn`, `btn-primary`, `btn-secondary`, `btn-quiet`, `btn-danger`, `card`, `eyebrow`, `skeleton`.
- Money is only ever rendered with the `Price` component or `money()` — never arithmetic on floats.
- Do not invent reviews, ratings, discounts or sales numbers. Show only what the API returns.

## Bilingual content

Products/categories/zones carry `…En` and `…Am` fields from the API. Use
`pick(lang, product.nameEn, product.nameAm)` (`src/lib/format.ts`) for those. UI chrome uses
`useTranslation()` and the keys in `src/locales/en.ts`. **If a label you need has no key, use
`pick(lang, 'English label', 'አማርኛ ምልክት')` inline** rather than editing the locale files. Get the
active language with `const lang = useLang()` (`src/lib/i18n.ts`).

## Imports you will use

```ts
// data hooks — src/lib/queries.ts
import { useHome, useCategories, useProducts, useProduct, useDeliveryZones,
         useCart, useQuote, useProfile, useMyOrders, useAddresses,
         usePlaceOrder, useIdempotencyKey } from '../lib/queries';

// REST clients
import { storefront, cartApi, checkoutApi, ordersApi, accountApi, ApiError } from '../lib/api';
import { adminAuth, adminDashboard, adminProducts, adminOrders, adminInventory,
         adminSettings, adminPeople, adminNotifications } from '../lib/adminApi';

// state
import { useCustomerAuth } from '../state/CustomerAuth';   // { profile, isSignedIn, busy, error, signInByPhone, signOut }
import { useAdminAuth, PERMISSION } from '../state/AdminAuth'; // { session, isSignedIn, signIn, signOut, can(p) }
import { useToast } from '../state/Toast';                 // push(text, 'ok'|'warn')
import { useTelegramLink } from ... // not needed; telegram helpers live in ../lib/telegram

// helpers
import { money, shortMoney, pick, formatDate, formatDateTime, relativeTime, titleCase, formatPhone } from '../lib/format';
import { useLang, setLanguage, currentLanguage } from '../lib/i18n';
import { checkoutSchema, addressSchema, productSchema, settingsSchema, zoneSchema,
         categorySchema, administratorSchema, stockAdjustSchema, loginSchema,
         normalizeEthiopianPhone, INVENTORY_REASONS } from '../lib/validation';

// components
import { ProductCard } from '../components/ProductCard';
import { ProductImage } from '../components/ProductImage';   // url, nameEn, nameAm, lang, ratio, className
import { Price } from '../components/Price';                 // value, sale?, currency?, size?
import { StatusPill } from '../components/StatusPill';       // value: 'DELIVERED' | 'PAID' | …
import { LanguageToggle } from '../components/LanguageToggle';
import { GridSkeleton, LoadingRows, EmptyState, ErrorState } from '../components/PageState';
import { TextField, TextAreaField, SelectField, ToggleField, SectionCard, KeyValue } from '../components/form';
```

TanStack Query usage pattern for admin screens (mutations must invalidate what they changed):

```ts
const client = useQueryClient();
const rows = useQuery({ queryKey: ['admin', 'orders', filters], queryFn: () => adminOrders.list(filters) });
const move = useMutation({
  mutationFn: (v: { id: number; target: string; note?: string }) => adminOrders.transition(v.id, v.target, v.note),
  onSuccess: () => { client.invalidateQueries({ queryKey: ['admin', 'orders'] }); toast.push('Status updated'); },
});
// mutation error text: (e) => e instanceof ApiError ? e.message : 'unknown'
```

## API facts you must respect

- `useCart()` returns `{ cart, count, add, setQuantity, remove, clear, isLoading }`. The backend caps
  quantities at available stock and returns the corrected cart — always render `result.items`, never
  your own optimistic number. `cart.items[].stock` is the ceiling for the stepper.
- `useQuote({region, city, subCity})` returns the server-calculated `{subtotal, deliveryFee, total,
  zoneNameEn, zoneNameAm, estimatedDays}`. The checkout total comes from here; the client never adds
  anything up itself.
- `checkoutApi.place(body, idempotencyKey)` — send the **exact** `expectedTotal` from the quote, plus
  `paymentMethod: 'CASH_ON_DELIVERY'`, `language: lang`, and reuse the same idempotency key for every
  retry of the same attempt (see `useIdempotencyKey`). Response: `{orderNumber, publicToken, …}`.
  Track state after success by navigating with `state: { publicToken, order: response }`.
- Guest order tracking: `ordersApi.track(orderNumber, token)` needs the receipt token; without it the
  API answers 403. Store nothing sensitive in localStorage.
- Account sign-in is `accountApi.loginByPhone({ phone, orderNumber?, publicToken? })`; a Telegram
  session is exchanged automatically by `TelegramAutoSignIn`, so never hand a Telegram user id to the API.
- Admin order lifecycle: `PENDING_CONFIRMATION → CONFIRMED → PROCESSING → OUT_FOR_DELIVERY →
  DELIVERED`, plus `CANCELLED` / `PAYMENT_FAILED`. `order.allowedStatuses` is the server's answer to
  which moves are legal — build the buttons from that array, not a hard-coded list. A backward move
  returns 409.
- Payment: `adminOrders.collectCash(id, { amount?, collectedBy?, note? })` is the only way an order
  becomes `PAID`. Never imply a payment happened; show `balanceDue` until cash is recorded.
- Telegram: `adminNotifications.telegramStatus()` never returns a bot token. If
  `status.ready === false`, the panel must say so plainly instead of pretending alerts were sent.
- Stock: `adminInventory.adjust(variantId, { mode: 'DELTA' | 'SET', delta?, stock?, reason?, note? })`
  — `DELTA` uses `delta`, `SET` uses `stock`.
- Admin product save: `adminProducts.create(body)` / `adminProducts.update(id, body)` where body
  follows `productSchema` (`{nameEn, nameAm, descriptionEn, descriptionAm, categorySlug, audience,
  gender, ageGroup, sizingSystem, basePrice, salePrice, status, featured, variants[]}`). Variants are
  `{id?, sizeLabel, colorName, colorHex?, sku?, stock, priceOverride?, lowStockThreshold?}`; keep the
  `id` on existing rows so the server updates instead of duplicating.
- Image upload: `adminProducts.uploadImage(id, file, { altEn, altAm, isPrimary })`, link attach:
  `adminProducts.addImage(id, {url, altEn, altAm, isPrimary})`, `makePrimary(imageId)`,
  `deleteImage(imageId)`.
- Settings save must send the whole loaded object plus edits
  (`adminSettings.save({ ...loaded, ...values })` with `updatedAt` deleted), otherwise untouched
  fields fall back to server defaults.
- `adminPeople.list()` / `create` / `update` / `revoke` are OWNER-only on the server; a 403 answers
  with `{error, message}` — surface `message`.
- Dashboard numbers all come from PostgreSQL (`adminDashboard.get()`); render them as-is. `lowStock`
  and `bestSellers` are arrays; `ordersByStatus` is a `{STATUS: count}` map.

## Types

All response types live in `src/lib/types.ts` (`HomePayload`, `ProductDetail`, `CartView`, `Quote`,
`OrderPlaced`, `OrderDetail`, `AdminProduct`, `InventoryRow`, `Dashboard`, `OutboxRow`,
`TelegramStatus`, `Paged<T>`, …). Import with `import type { … } from '../lib/types';`.

## File ownership (do not touch another author's files)

- `pages/storefront/HomePage.tsx`, `CatalogPage.tsx`, `ProductPage.tsx`, `CartPage.tsx`, `NotFoundPage.tsx`
- `pages/storefront/CheckoutPage.tsx`, `OrderPlacedPage.tsx`, `TrackOrderPage.tsx`, `AccountPage.tsx`
- `pages/admin/AdminLoginPage.tsx`, `DashboardPage.tsx`, `AdminOrdersPage.tsx`, `AdminOrderDetailPage.tsx`
- `pages/admin/AdminProductsPage.tsx`, `AdminProductEditorPage.tsx`, `AdminInventoryPage.tsx`
- `pages/admin/AdminSettingsPage.tsx`, `AdminZonesPage.tsx`, `AdminCategoriesPage.tsx`,
  `AdminPeoplePage.tsx`, `AdminAuditPage.tsx`, `AdminNotificationsPage.tsx`

Every page is a `export default function XPage()`. They are already routed in `src/App.tsx`.
