import { z } from 'zod';

/** Same rule as the backend: 10 digits starting 09 or 07, or a +251/251/00251 form. */
const PHONE = /^(?:00251|\+251|251|0)?[79]\d{8}$/;

export function normalizeEthiopianPhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  const match = /^(?:00251|\+251|251|0)?([79])(\d{8})$/.exec(digits);
  return match ? `0${match[1]}${match[2]}` : null;
}

export const phone = z
  .string()
  .trim()
  .refine((value) => PHONE.test(value), 'Use a 10-digit Ethiopian mobile number, for example 0912345678.');

export const optionalPhone = z
  .string()
  .trim()
  .optional()
  .refine((value) => !value || value === '' || PHONE.test(value), 'That secondary number does not look right.');

export const money = z.coerce
  .number({ message: 'Enter a number.' })
  .finite()
  .nonnegative('Money cannot be negative.');

export const checkoutSchema = z.object({
  fullName: z.string().trim().min(3, 'Please give the full name of the receiver.'),
  phone,
  secondaryPhone: optionalPhone,
  region: z.string().trim().min(2, 'Region is needed to price delivery.'),
  city: z.string().trim().min(2, 'City or town is needed to price delivery.'),
  subCity: z.string().trim().optional(),
  neighborhood: z.string().trim().optional(),
  addressLine: z.string().trim().min(4, 'A landmark or house number helps the courier find you.'),
  deliveryInstructions: z.string().trim().max(400).optional(),
  preferredDeliveryTime: z.string().trim().optional(),
});

export type CheckoutForm = z.infer<typeof checkoutSchema>;

export const addressSchema = checkoutSchema.pick({
  region: true,
  city: true,
  subCity: true,
  neighborhood: true,
  addressLine: true,
  deliveryInstructions: true,
}).extend({ label: z.string().trim().max(40).optional() });

export const variantSchema = z.object({
  id: z.number().optional(),
  sizeLabel: z.string().trim().min(1, 'Size is needed.'),
  colorName: z.string().trim().min(1, 'Colour name is needed.'),
  colorHex: z.string().trim().optional().nullable(),
  sku: z.string().trim().optional().nullable(),
  stock: z.coerce.number({ message: 'Stock must be a number.' }).int('Stock is a whole number.').min(0, 'Stock cannot be negative.'),
  priceOverride: z.coerce.number().nullable().optional(),
  lowStockThreshold: z.coerce.number().int().min(0).optional(),
});

export const productSchema = z.object({
  nameEn: z.string().trim().min(2, 'English name is required.'),
  descriptionEn: z.string().trim().max(2000).optional().nullable(),
  categorySlug: z.string().trim().min(1, 'Choose a category.'),
  audience: z.enum(['CHILD', 'ADULT', 'FAMILY']),
  gender: z.enum(['BOY', 'GIRL', 'UNISEX', 'WOMAN', 'MAN']),
  ageGroups: z.array(z.string().min(1)).min(1, 'Choose at least one age range.'),
  sizingSystem: z.enum(['AGE', 'NUMERIC', 'SHOE', 'LETTER', 'ONE_SIZE']),
  basePrice: money.gt(0, 'Base price must be more than zero.'),
  salePrice: z.coerce.number().nullable().optional(),
  status: z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']),
  featured: z.boolean(),
  variants: z.array(variantSchema).min(1, 'Add at least one size.'),
});

export type ProductForm = z.infer<typeof productSchema>;

export const settingsSchema = z.object({
  storeNameEn: z.string().trim().min(2, 'Store name in English is required.'),
  taglineEn: z.string().trim().max(140).optional(),
  contactPhone: z.string().trim().min(3),
  contactEmail: z.union([z.string().trim().email('Enter a valid email address.'), z.literal('')]),
  currency: z.string().trim().length(3, 'Currency is a three-letter code.'),
  lowStockThreshold: z.coerce.number().int().min(0).max(999),
  freeDeliveryOver: z.coerce.number().nullable().optional(),
  allowCustomerCancelUntil: z.enum(['PENDING_CONFIRMATION', 'CONFIRMED', 'PROCESSING']),
  restoreStockOnCancellation: z.boolean(),
  requireAdminConfirmation: z.boolean(),
  telegramEnabled: z.boolean(),
});

export const zoneSchema = z.object({
  nameEn: z.string().trim().min(2, 'Zone name in English is required.'),
  region: z.string().trim().min(2),
  city: z.string().trim().min(2),
  subCity: z.string().trim().optional().nullable(),
  fee: money,
  freeOver: z.coerce.number().nullable().optional(),
  estimatedDays: z.coerce.number().int().min(0).max(30).nullable().optional(),
  active: z.boolean(),
});

export const categorySchema = z.object({
  nameEn: z.string().trim().min(2, 'Name in English is required.'),
  descriptionEn: z.string().trim().optional().nullable(),
  audience: z.enum(['CHILD', 'ADULT', 'FAMILY']),
  sortOrder: z.coerce.number().int().min(0),
  active: z.boolean(),
});

export const administratorSchema = z.object({
  email: z.string().trim().email('Enter a valid email address.'),
  fullName: z.string().trim().min(2, 'Name is required.'),
  phone: optionalPhone,
  role: z.enum(['OWNER', 'MANAGER', 'DELIVERY_STAFF']),
  password: z.string().min(12, 'Use at least 12 characters.'),
});

export const INVENTORY_REASONS = ['ADMIN_ADJUST', 'STOCK_SET', 'INITIAL_STOCK', 'CANCEL_RESTORED'] as const;

export const stockAdjustSchema = z.object({
  mode: z.enum(['DELTA', 'SET']),
  amount: z.coerce.number().int('Whole units only.').min(0, 'Enter an amount.'),
  reason: z.enum(INVENTORY_REASONS),
  note: z.string().trim().max(240).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Email is required.'),
  password: z.string().min(1, 'Password is required.'),
});

/** Turns a ZodError into the shape react-hook-form expects. */
export function fieldErrors(error: z.ZodError): Record<string, { message: string }> {
  const out: Record<string, { message: string }> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    if (!out[key]) out[key] = { message: issue.message };
  }
  return out;
}
