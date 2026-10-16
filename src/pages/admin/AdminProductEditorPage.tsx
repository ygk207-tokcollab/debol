import { useEffect, useMemo, useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import type { FieldPath } from 'react-hook-form';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Upload, X } from 'lucide-react';
import { ApiError, assetUrl } from '../../lib/api';
import { adminProducts, adminSettings } from '../../lib/adminApi';
import { fieldErrors, productSchema } from '../../lib/validation';
import { ErrorState, LoadingRows } from '../../components/PageState';
import { Price } from '../../components/Price';
import { SectionCard, SelectField, TextAreaField, TextField, ToggleField } from '../../components/form';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';
import { useToast } from '../../state/Toast';
import type { AdminProductVariant } from '../../lib/types';

type Audience = 'CHILD' | 'ADULT' | 'FAMILY';
type Gender = 'BOY' | 'GIRL' | 'UNISEX' | 'WOMAN' | 'MAN';
type Sizing = 'AGE' | 'NUMERIC' | 'SHOE' | 'LETTER' | 'ONE_SIZE';
type Status = 'DRAFT' | 'PUBLISHED' | 'ARCHIVED';

/**
 * Money stays a decimal string in the form — the browser never adds or divides it. `effective` and
 * `variantId` are display-only echoes of what the server already stores.
 */
interface VariantRow {
  variantId?: number;
  effective: string;
  sizeLabel: string;
  colorName: string;
  colorHex: string;
  sku: string;
  stock: string;
  priceOverride: string;
  lowStockThreshold: string;
  active: boolean;
}

interface FormValues {
  nameEn: string;
  descriptionEn: string;
  categorySlug: string;
  audience: Audience;
  gender: Gender;
  ageGroups: string[];
  sizingSystem: Sizing;
  basePrice: string;
  salePrice: string;
  status: Status;
  featured: boolean;
  variants: VariantRow[];
}

const NEW_ROW: VariantRow = {
  effective: '', sizeLabel: '', colorName: '', colorHex: '', sku: '',
  stock: '0', priceOverride: '', lowStockThreshold: '', active: true,
};

const BLANK: FormValues = {
  nameEn: '', descriptionEn: '', categorySlug: '',
  audience: 'CHILD', gender: 'UNISEX', ageGroups: [], sizingSystem: 'AGE',
  basePrice: '', salePrice: '', status: 'DRAFT', featured: false, variants: [NEW_ROW],
};

const SIZE_HINT: Record<Sizing, string> = {
  AGE: '2-3y · 0-3m',
  NUMERIC: '28 · 30',
  SHOE: '26 · 29',
  LETTER: 'S · M · L',
  ONE_SIZE: 'One size',
};

function blankToNull(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}

function toInput(value: number | string | null | undefined): string {
  return value === null || value === undefined ? '' : String(value);
}

export default function AdminProductEditorPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const toast = useToast();
  const { can } = useAdminAuth();
  const canWrite = can(PERMISSION.products);
  const { id: rawId } = useParams<{ id?: string }>();
  const productId = rawId && rawId !== 'new' ? Number(rawId) : null;

  const [banner, setBanner] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [altEn, setAltEn] = useState('');
  const [asPrimary, setAsPrimary] = useState(false);
  const [urlDraft, setUrlDraft] = useState({ url: '', altEn: '' });
  const [confirmImage, setConfirmImage] = useState<number | null>(null);

  const { register, handleSubmit, reset, setError, setValue, watch, control, formState: { errors } } =
    useForm<FormValues>({ defaultValues: BLANK });

  const { fields, append, update, remove } = useFieldArray({ control, name: 'variants' });
  const values = watch();

  const loaded = useQuery({
    queryKey: ['admin', 'product', productId],
    queryFn: () => adminProducts.get(productId as number),
    enabled: productId !== null,
  });

  const categories = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: adminSettings.categories,
    staleTime: 120_000,
  });

  // Inactive bands stay listed so an older product keeps the codes it was filed under.
  const bands = useQuery({
    queryKey: ['admin', 'age-groups'],
    queryFn: adminSettings.ageGroups,
    staleTime: 120_000,
  });

  useEffect(() => {
    const product = loaded.data;
    if (!product) return;
    reset({
      nameEn: product.nameEn,
      descriptionEn: product.descriptionEn ?? '',
      categorySlug: product.categorySlug,
      audience: product.audience as Audience,
      gender: product.gender as Gender,
      ageGroups: product.ageGroups,
      sizingSystem: product.sizingSystem as Sizing,
      basePrice: toInput(product.basePrice),
      salePrice: toInput(product.salePrice),
      status: product.status as Status,
      featured: product.featured,
      variants: product.variants.length > 0
        ? product.variants.map((variant) => ({
            variantId: variant.id,
            effective: toInput(variant.effectivePrice),
            sizeLabel: variant.sizeLabel,
            colorName: variant.colorName,
            colorHex: variant.colorHex ?? '',
            sku: variant.sku ?? '',
            stock: toInput(variant.stock),
            // The admin DTO ships priceOverride even though the client mirror omits it.
            priceOverride: toInput((variant as unknown as AdminProductOverride).priceOverride),
            lowStockThreshold: toInput(variant.lowStockThreshold),
            active: variant.active,
          }))
        : [NEW_ROW],
    });
  }, [loaded.data, reset]);

  const options = useMemo(() => ({
    audience: (['CHILD', 'ADULT', 'FAMILY'] as Audience[]).map((value) => ({
      value,
      label: value === 'CHILD' ? 'Children'
        : value === 'ADULT' ? 'Grown-ups' : t('nav.family'),
    })),
    gender: (['BOY', 'GIRL', 'UNISEX', 'WOMAN', 'MAN'] as Gender[]).map((value) => ({
      value,
      label: value === 'BOY' ? 'Boy'
        : value === 'GIRL' ? 'Girl'
        : value === 'UNISEX' ? 'Either'
        : value === 'WOMAN' ? 'Woman' : 'Man',
    })),
    sizing: (['AGE', 'NUMERIC', 'SHOE', 'LETTER', 'ONE_SIZE'] as Sizing[]).map((value) => ({
      value,
      label: value === 'AGE' ? 'Age (2-3y)'
        : value === 'NUMERIC' ? 'Numeric'
        : value === 'SHOE' ? 'Shoe size'
        : value === 'LETTER' ? 'Letter (S/M/L)'
        : 'One size',
    })),
    status: (['PUBLISHED', 'DRAFT', 'ARCHIVED'] as Status[]).map((value) => ({
      value,
      label: t(`status.${value}`, value),
    })),
    category: (categories.data ?? []).map((row) => ({
      value: row.slug,
      label: row.nameEn,
    })),
  }), [t, categories.data]);

  /** Existing rows keep their server id, so the backend updates them instead of inserting copies. */
  const buildBody = (form: FormValues) => ({
    nameEn: form.nameEn.trim(),
    descriptionEn: blankToNull(form.descriptionEn),
    categorySlug: form.categorySlug,
    audience: form.audience,
    gender: form.gender,
    ageGroups: form.ageGroups,
    sizingSystem: form.sizingSystem,
    basePrice: form.basePrice.trim(),
    salePrice: blankToNull(form.salePrice),
    status: form.status,
    featured: form.featured,
    variants: form.variants.map((row) => ({
      ...(row.variantId === undefined ? {} : { id: row.variantId }),
      sizeLabel: row.sizeLabel.trim(),
      colorName: row.colorName.trim(),
      colorHex: blankToNull(row.colorHex),
      sku: blankToNull(row.sku),
      stock: row.stock.trim() === '' ? 0 : Number(row.stock),
      priceOverride: blankToNull(row.priceOverride),
      lowStockThreshold: row.lowStockThreshold.trim() === '' ? undefined : Number(row.lowStockThreshold),
      active: row.active,
    })),
  });

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      (productId === null ? adminProducts.create(body) : adminProducts.update(productId, body)),
    onSuccess: (product) => {
      client.invalidateQueries({ queryKey: ['admin', 'products'] });
      client.invalidateQueries({ queryKey: ['admin', 'inventory'] });
      client.invalidateQueries({ queryKey: ['admin', 'product', product.id] });
      client.invalidateQueries({ queryKey: ['store'] });
      toast.push(
        productId === null
          ? `${product.nameEn} created with status ${product.status}.`
          : `${product.nameEn} saved.`,
        'ok',
      );
      navigate('/admin/products');
    },
    onError: (error) => {
      if (error instanceof ApiError) {
        setBanner(error.message);
        error.fields.forEach((field) => setError(field.field as FieldPath<FormValues>, { message: field.message }));
      } else {
        setBanner('request failed');
      }
    },
  });

  const submit = handleSubmit((form) => {
    setBanner(null);
    const body = buildBody(form);
    const checked = productSchema.safeParse(body);
    if (!checked.success) {
      const found = fieldErrors(checked.error);
      Object.entries(found).forEach(([key, value]) => setError(key as FieldPath<FormValues>, { message: value.message }));
      const issues = Object.values(found).map((entry) => entry.message);
      setBanner(issues.length > 0
        ? issues.join(' · ')
        : 'The form is not complete yet.');
      return;
    }
    save.mutate(body as unknown as Record<string, unknown>);
  });

  const refreshImages = () => {
    client.invalidateQueries({ queryKey: ['admin', 'product', productId] });
    client.invalidateQueries({ queryKey: ['admin', 'products'] });
    client.invalidateQueries({ queryKey: ['store'] });
  };

  const uploadImage = useMutation({
    mutationFn: (file: File) => {
      if (productId === null) {
        return Promise.reject(new Error('Save the product before uploading images.'));
      }
      return adminProducts.uploadImage(productId, file, {
        altEn: blankToNull(altEn) ?? undefined,
        isPrimary: asPrimary,
      });
    },
    onSuccess: () => {
      setImageError(null);
      setAltEn('');
      setAsPrimary(false);
      refreshImages();
      toast.push('Image stored on the server.', 'ok');
    },
    onError: (error) => setImageError(error instanceof ApiError ? error.message : 'request failed'),
  });

  const attachUrl = useMutation({
    mutationFn: () => {
      if (productId === null) throw new Error('Save the product first.');
      return adminProducts.addImage(productId, {
        url: urlDraft.url.trim(),
        altEn: blankToNull(urlDraft.altEn) ?? undefined,
        isPrimary: asPrimary,
      });
    },
    onSuccess: () => {
      setImageError(null);
      setUrlDraft({ url: '', altEn: '' });
      setAsPrimary(false);
      refreshImages();
      toast.push('Image link attached.', 'ok');
    },
    onError: (error) => setImageError(error instanceof ApiError ? error.message : 'request failed'),
  });

  const makePrimary = useMutation({
    mutationFn: (imageId: number) => adminProducts.makePrimary(imageId),
    onSuccess: () => {
      setImageError(null);
      refreshImages();
      toast.push('Primary photo changed.', 'ok');
    },
    onError: (error) => setImageError(error instanceof ApiError ? error.message : 'request failed'),
  });

  const dropImage = useMutation({
    mutationFn: (imageId: number) => adminProducts.deleteImage(imageId),
    onSuccess: () => {
      setConfirmImage(null);
      setImageError(null);
      refreshImages();
      toast.push('Image removed.', 'ok');
    },
    onError: (error) => setImageError(error instanceof ApiError ? error.message : 'request failed'),
  });

  if (productId !== null && loaded.isLoading) {
    return <div className="card px-4 py-6"><LoadingRows rows={6} /></div>;
  }

  if (productId !== null && loaded.isError) {
    return (
      <div className="space-y-4">
        <h1 className="font-display text-2xl text-ink">{t('admin.editProduct')}</h1>
        <ErrorState error={loaded.error} onRetry={() => loaded.refetch()} />
      </div>
    );
  }

  const images = loaded.data?.images ?? [];

  return (
    <form className="space-y-4" onSubmit={submit} noValidate>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="eyebrow">{t('admin.panel')}</p>
          <h1 className="font-display text-2xl leading-tight text-ink">
            {productId === null ? t('admin.newProduct') : t('admin.editProduct')}
          </h1>
          {loaded.data && (
            <p className="mt-1 truncate text-xs text-ink-mute">
              {loaded.data.slug} · {'total stock'} {loaded.data.totalStock}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Link to="/admin/products" className="btn-quiet">{t('nav.back')}</Link>
          <button type="submit" className="btn-primary" disabled={!canWrite || save.isPending}>
            {save.isPending ? t('admin.saving') : t('admin.save')}
          </button>
        </div>
      </div>

      {!canWrite && (
        <p className="card px-4 py-3 text-sm text-error-600">
          {'Your role cannot change the catalogue, so saving is disabled.'}
        </p>
      )}

      {banner && (
        <div className="card border-error-300/60 bg-error-100/50 px-4 py-3 text-sm text-error-600">{banner}</div>
      )}

      <SectionCard
        title={'Name and description'}
        description={'English only.'}
      >
        <div className="grid gap-3">
          <TextField
            label={'Name'}
            required
            error={errors.nameEn?.message}
            {...register('nameEn')}
          />
          <TextAreaField
            label={'Description'}
            error={errors.descriptionEn?.message}
            {...register('descriptionEn')}
          />
        </div>
      </SectionCard>

      <SectionCard title={'Classification and price'}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SelectField
            label={t('catalog.category')}
            required
            options={options.category}
            placeholder={'Choose a category'}
            error={errors.categorySlug?.message}
            {...register('categorySlug')}
          />
          <SelectField label={t('catalog.audience')} required options={options.audience} {...register('audience')} />
          <SelectField label={t('catalog.gender')} required options={options.gender} {...register('gender')} />
          <div className="sm:col-span-2 lg:col-span-3">
            <span className="field-label">{'Age ranges'}</span>
            <div className="mt-1 flex flex-wrap gap-2">
              {(bands.data ?? []).map((band) => {
                const chosen = values.ageGroups.includes(band.code);
                return (
                  <button
                    key={band.code}
                    type="button"
                    aria-pressed={chosen}
                    title={band.active ? undefined : 'Retired band - leave it ticked only if this product still belongs here'}
                    className={`chip ${chosen ? 'chip-selected' : ''} ${band.active ? '' : 'opacity-[0.38]'}`}
                    onClick={() => setValue('ageGroups',
                      chosen
                        ? values.ageGroups.filter((code) => code !== band.code)
                        : [...values.ageGroups, band.code],
                      { shouldValidate: true })}
                  >
                    {band.label}
                  </button>
                );
              })}
            </div>
            <p className={`mt-1 text-xs ${errors.ageGroups ? 'text-error-600' : 'text-ink-mute'}`}>
              {errors.ageGroups?.message ?? 'Tick every range this product fits. Shoppers filter the catalogue by these.'}
            </p>
          </div>
          <SelectField
            label={'Sizing system'}
            required
            options={options.sizing}
            hint={`${'Size examples'} · ${SIZE_HINT[values.sizingSystem]}`}
            {...register('sizingSystem')}
          />
          <SelectField
            label={'Storefront status'}
            required
            options={options.status}
            hint={values.status === 'PUBLISHED'
              ? 'Shoppers can buy it.'
              : values.status === 'ARCHIVED'
                ? 'Hidden from the storefront.'
                : 'Kept as a draft, not shown.'}
            {...register('status')}
          />
          <TextField
            label={'Regular price (ETB)'}
            required
            inputMode="decimal"
            hint={'Use a dot, for example 890.00'}
            error={errors.basePrice?.message}
            {...register('basePrice')}
          />
          <TextField
            label={'Sale price (ETB)'}
            inputMode="decimal"
            hint={'Leave empty for no discount. Must stay below the regular price.'}
            error={errors.salePrice?.message}
            {...register('salePrice')}
          />
          <div className="flex items-end pb-1">
            <ToggleField
              label={t('admin.featuredOn')}
              checked={values.featured}
              onChange={(next) => setValue('featured', next)}
              hint={'Featured items also show on the home page.'}
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title={t('admin.variants')}
        description={'One row per size and colour. Rows that already exist keep their server id, so saving updates them instead of creating duplicates.'}
        actions={canWrite && (
          <button
            type="button"
            className="btn-secondary px-3 py-1.5 text-xs"
            onClick={() => append({ ...NEW_ROW })}
          >
            <Plus className="size-3.5" aria-hidden />
            {t('admin.addVariant')}
          </button>
        )}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[54rem] text-left text-xs">
            <thead className="bg-surface-100 uppercase tracking-wide text-ink-mute">
              <tr>
                <th className="px-2 py-2 font-medium">{'Size'}</th>
                <th className="px-2 py-2 font-medium">{'Colour'}</th>
                <th className="px-2 py-2 font-medium">{'Hex'}</th>
                <th className="px-2 py-2 font-medium">SKU</th>
                <th className="px-2 py-2 font-medium">{t('admin.stock')}</th>
                <th className="px-2 py-2 font-medium">{'Price override'}</th>
                <th className="px-2 py-2 font-medium">{t('admin.lowStockThreshold')}</th>
                <th className="px-2 py-2 font-medium">{'Show'}</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-200">
              {fields.map((field, index) => {
                const rowErrors = errors.variants?.[index];
                const row = values.variants[index];
                return (
                  <tr key={field.id} className="align-top">
                    <td className="px-2 py-1.5">
                      <input
                        className={`field px-2 py-1.5 text-xs ${rowErrors?.sizeLabel ? 'field-error' : ''}`}
                        placeholder={SIZE_HINT[values.sizingSystem]}
                        aria-label={`Size ${index + 1}`}
                        {...register(`variants.${index}.sizeLabel` as const)}
                      />
                      <RowIssue message={rowErrors?.sizeLabel?.message} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className={`field px-2 py-1.5 text-xs ${rowErrors?.colorName ? 'field-error' : ''}`}
                        placeholder={'Sage'}
                        aria-label={`Colour ${index + 1}`}
                        {...register(`variants.${index}.colorName` as const)}
                      />
                      <RowIssue message={rowErrors?.colorName?.message} />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className="field px-2 py-1.5 text-xs"
                        placeholder="#B7C9A8"
                        aria-label={`Colour code ${index + 1}`}
                        {...register(`variants.${index}.colorHex` as const)}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className="field px-2 py-1.5 text-xs"
                        placeholder="SS-KSN-28-W"
                        aria-label={`SKU ${index + 1}`}
                        {...register(`variants.${index}.sku` as const)}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className={`field px-2 py-1.5 text-xs tabular-nums ${rowErrors?.stock ? 'field-error' : ''}`}
                        inputMode="numeric"
                        aria-label={`Stock ${index + 1}`}
                        {...register(`variants.${index}.stock` as const)}
                      />
                      <RowIssue message={rowErrors?.stock?.message} />
                      {row?.variantId !== undefined && (
                        <span className="mt-1 block text-[0.65rem] text-ink-mute">
                          {`row ${row.variantId}`}
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className="field px-2 py-1.5 text-xs tabular-nums"
                        inputMode="decimal"
                        aria-label={`Price override ${index + 1}`}
                        {...register(`variants.${index}.priceOverride` as const)}
                      />
                      {row?.effective && <Price value={row.effective} size="sm" />}
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        className="field px-2 py-1.5 text-xs tabular-nums"
                        inputMode="numeric"
                        aria-label={`Low stock alert ${index + 1}`}
                        {...register(`variants.${index}.lowStockThreshold` as const)}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        className="mt-1 size-4 accent-primary-500"
                        aria-label={`Show variant ${index + 1}`}
                        checked={row?.active ?? true}
                        onChange={(event) => update(index, {
                          ...(values.variants[index] ?? NEW_ROW),
                          active: event.target.checked,
                        })}
                      />
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      {fields.length > 1 && (
                        <button
                          type="button"
                          className="btn-quiet px-2 py-1 text-xs"
                          onClick={() => remove(index)}
                          aria-label={`Remove variant ${index + 1}`}
                        >
                          <X className="size-3.5" aria-hidden />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[0.7rem] text-ink-mute">
          {'Removing an unsaved row is free; removing a saved row only detaches it from this form — the server keeps it until the product is deleted.'}
        </p>
      </SectionCard>

      <SectionCard
        title={t('admin.images')}
        description={productId === null
          ? 'Images attach to a saved product id. Save this draft, then open it again to upload photos.'
          : 'JPEG, PNG and WebP only — the server checks the file itself.'}
      >
        {productId === null ? (
          <p className="text-sm text-ink-mute">{'No product id yet.'}</p>
        ) : (
          <div className="space-y-4">
            {imageError && (
              <p className="rounded-md border border-error-300/60 bg-error-100/60 px-3 py-2 text-sm text-error-600">
                {imageError}
              </p>
            )}

            {images.length > 0 && (
              <ul className="grid gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {images.map((image) => (
                  <li key={image.id} className="card overflow-hidden">
                    <img src={assetUrl(image.url)} alt={image.altEn ?? ''} className="aspect-product w-full object-cover" loading="lazy" />
                    <div className="space-y-1.5 px-3 py-2">
                      <p className="truncate text-[0.7rem] text-ink-mute">
                        {image.isPrimary ? t('admin.primary') : (image.altEn ?? 'no alt text')}
                      </p>
                      {confirmImage === image.id ? (
                        <div className="flex flex-wrap gap-1.5">
                          <button
                            type="button"
                            className="btn-danger px-2 py-1 text-xs"
                            disabled={dropImage.isPending}
                            onClick={() => dropImage.mutate(image.id)}
                          >
                            {'Yes, remove'}
                          </button>
                          <button type="button" className="btn-quiet px-2 py-1 text-xs" onClick={() => setConfirmImage(null)}>
                            {t('admin.cancel')}
                          </button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {!image.isPrimary && (
                            <button
                              type="button"
                              className="btn-secondary px-2 py-1 text-xs"
                              disabled={makePrimary.isPending}
                              onClick={() => makePrimary.mutate(image.id)}
                            >
                              {t('admin.makePrimary')}
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-danger px-2 py-1 text-xs"
                            onClick={() => setConfirmImage(image.id)}
                          >
                            <Trash2 className="size-3.5" aria-hidden />
                            {t('admin.delete')}
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2 rounded-md border border-surface-300/70 px-3 py-3">
                <p className="text-sm font-medium text-ink">{t('admin.uploadImage')}</p>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  aria-label={t('admin.uploadImage')}
                  className="field w-full px-2 py-1.5 text-xs"
                  disabled={uploadImage.isPending}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) uploadImage.mutate(file);
                    event.target.value = '';
                  }}
                />
                {uploadImage.isPending && (
                  <p className="flex items-center gap-1.5 text-xs text-ink-mute">
                    <Upload className="size-3.5" aria-hidden />
                    {'Sending the file…'}
                  </p>
                )}
              </div>

              <div className="space-y-2 rounded-md border border-surface-300/70 px-3 py-3">
                <p className="text-sm font-medium text-ink">{t('admin.imageLink')}</p>
                <input
                  className="field px-2 py-1.5 text-xs"
                  placeholder="https://…"
                  aria-label={t('admin.imageLink')}
                  value={urlDraft.url}
                  onChange={(event) => setUrlDraft((prev) => ({ ...prev, url: event.target.value }))}
                />
                <button
                  type="button"
                  className="btn-secondary px-3 py-1.5 text-xs"
                  disabled={urlDraft.url.trim() === '' || attachUrl.isPending}
                  onClick={() => attachUrl.mutate()}
                >
                  {'Attach this link'}
                </button>
              </div>
            </div>

            <div className="grid gap-3">
              <TextField
                label={'Alt text'}
                value={altEn}
                onChange={(event) => setAltEn(event.target.value)}
              />
            </div>
            <ToggleField
              label={'Make the next image primary'}
              checked={asPrimary}
              onChange={setAsPrimary}
              hint={'The very first image becomes primary on its own.'}
            />
          </div>
        )}
      </SectionCard>

      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" className="btn-primary" disabled={!canWrite || save.isPending}>
          {save.isPending ? t('admin.saving') : t('admin.save')}
        </button>
        <Link to="/admin/products" className="btn-quiet">{t('admin.cancel')}</Link>
        {loaded.data && (
          <Link to={`/admin/inventory?product=${loaded.data.id}`} className="btn-secondary">
            {t('admin.adjustStock')}
          </Link>
        )}
      </div>
    </form>
  );
}

/** The admin variant DTO carries priceOverride; the shared mirror does not declare it. */
type AdminProductOverride = AdminProductVariant & { priceOverride?: number | null };

function RowIssue({ message }: { message?: string }) {
  if (!message) return null;
  return <span className="mt-1 block text-[0.65rem] text-error-600">{message}</span>;
}
