import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { ApiError } from '../../lib/api';
import { adminSettings } from '../../lib/adminApi';
import { SectionCard, SelectField, TextField, ToggleField } from '../form';
import { PERMISSION, useAdminAuth } from '../../state/AdminAuth';
import { useToast } from '../../state/Toast';
import type { AdminAgeGroup } from '../../lib/types';

interface Draft {
  id: number | null;
  code: string;
  label: string;
  minAge: string;
  maxAge: string;
  ageUnit: 'MONTH' | 'YEAR';
  sortOrder: string;
  active: boolean;
}

const BLANK: Draft = {
  id: null, code: '', label: '', minAge: '', maxAge: '', ageUnit: 'YEAR', sortOrder: '200', active: true,
};

function draftOf(row: AdminAgeGroup): Draft {
  return {
    id: row.id,
    code: row.code,
    label: row.label,
    minAge: row.minAge == null ? '' : String(row.minAge),
    maxAge: row.maxAge == null ? '' : String(row.maxAge),
    ageUnit: row.ageUnit,
    sortOrder: String(row.sortOrder),
    active: row.active,
  };
}

// Jackson omits null keys, so an unbounded side arrives as undefined.
function rangeOf(band: AdminAgeGroup): string {
  const unit = band.ageUnit === 'MONTH' ? 'm' : 'y';
  const min = band.minAge ?? null;
  const max = band.maxAge ?? null;
  if (min === null && max === null) return 'Any age';
  if (max === null) return `${min}${unit} and up`;
  if (min === null) return `Up to ${max}${unit}`;
  return `${min}-${max}${unit}`;
}

/**
 * The storefront age dropdown and the product editor both read these rows, so a shop can add or
 * rename a band without a code change. Codes stay stable so saved products never lose a link.
 */
export function AgeBandsCard() {
  const client = useQueryClient();
  const toast = useToast();
  const { can } = useAdminAuth();
  const canWrite = can(PERMISSION.products);

  const [draft, setDraft] = useState<Draft | null>(null);
  const [banner, setBanner] = useState<string | null>(null);

  const list = useQuery({ queryKey: ['admin', 'age-groups'], queryFn: adminSettings.ageGroups });
  const rows = useMemo(() => [...(list.data ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [list.data]);

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['admin', 'age-groups'] });
    client.invalidateQueries({ queryKey: ['store'] });
  };

  const save = useMutation({
    mutationFn: (variables: { body: Record<string, unknown>; id: number | null }) =>
      adminSettings.saveAgeGroup(variables.body, variables.id ?? undefined),
    onSuccess: (saved) => {
      refresh();
      setDraft(null);
      setBanner(null);
      toast.push(`Age range “${saved.label}” is on the server.`, 'ok');
    },
    onError: (error: unknown) => {
      if (error instanceof ApiError) {
        const fields = error.fields.map((field) => `${field.field}: ${field.message}`).join(' · ');
        setBanner(fields ? `${error.message} — ${fields}` : error.message);
        return;
      }
      setBanner('request failed');
    },
  });

  function submit() {
    if (!draft) return;
    const label = draft.label.trim();
    if (label.length < 2) {
      setBanner('A label is needed, for example “Toddler (1-2 years)”.');
      return;
    }
    const minAge = draft.minAge.trim() === '' ? null : Number(draft.minAge);
    const maxAge = draft.maxAge.trim() === '' ? null : Number(draft.maxAge);
    if ((minAge !== null && !Number.isInteger(minAge)) || (maxAge !== null && !Number.isInteger(maxAge))) {
      setBanner('Ages are whole numbers; leave a box empty for no bound.');
      return;
    }
    if (minAge !== null && maxAge !== null && maxAge < minAge) {
      setBanner('The upper age cannot be below the lower age.');
      return;
    }
    save.mutate({
      id: draft.id,
      body: {
        code: draft.code.trim(),
        label,
        minAge,
        maxAge,
        ageUnit: draft.ageUnit,
        sortOrder: /^\d+$/.test(draft.sortOrder.trim()) ? Number(draft.sortOrder.trim()) : 0,
        active: draft.active,
      },
    });
  }

  return (
    <SectionCard
      title={'Age ranges'}
      description={
        'These rows fill the age dropdown shoppers filter by and the tick boxes on the product editor. '
        + 'Retiring a range hides it from the storefront but never erases it from a product.'
      }
      actions={canWrite && !draft && (
        <button
          type="button"
          className="btn-tonal"
          onClick={() => { setDraft({ ...BLANK }); setBanner(null); }}
        >
          <Plus className="size-4" aria-hidden />
          {'Add a range'}
        </button>
      )}
    >
      {list.isError && (
        <p className="text-sm text-error-600">
          {'The age ranges could not be loaded. '}
          <button type="button" className="btn-quiet" onClick={() => list.refetch()}>{'Try again'}</button>
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200 text-left text-xs uppercase tracking-[0.1em] text-secondary-500">
                <th className="py-2 pr-3 font-medium">{'Order'}</th>
                <th className="py-2 pr-3 font-medium">{'Code'}</th>
                <th className="py-2 pr-3 font-medium">{'Label'}</th>
                <th className="py-2 pr-3 font-medium">{'Range'}</th>
                <th className="py-2 pr-3 font-medium">{'Shown'}</th>
                {canWrite && <th className="py-2 font-medium"><span className="sr-only">{'Actions'}</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.code} className="border-b border-surface-100 last:border-0">
                  <td className="py-2 pr-3 tabular-nums text-ink-soft">{row.sortOrder}</td>
                  <td className="py-2 pr-3 font-mono text-xs text-ink">{row.code}</td>
                  <td className="py-2 pr-3 text-ink">{row.label}</td>
                  <td className="py-2 pr-3 text-ink-soft">{rangeOf(row)}</td>
                  <td className="py-2 pr-3">
                    <span className={`chip h-6 px-2 text-xs ${row.active ? 'chip-selected' : ''}`}>
                      {row.active ? 'Active' : 'Retired'}
                    </span>
                  </td>
                  {canWrite && (
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        className="btn-quiet"
                        onClick={() => { setDraft(draftOf(row)); setBanner(null); }}
                      >
                        {'Edit'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {draft && (
        <div className="mt-4 border border-surface-200 bg-surface-100/60 rounded-xl px-4 py-4">
          <h3 className="font-display text-base text-ink">
            {draft.id === null ? 'New age range' : `Editing ${draft.code}`}
          </h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField
              label={'Code'}
              required={draft.id === null}
              value={draft.code}
              disabled={draft.id !== null}
              onChange={(event) => setDraft({ ...draft, code: event.target.value })}
              placeholder="TODDLER_1_2Y"
              hint={'Stable identifier. Products remember it, so renaming the label is safe but re-coding is not.'}
            />
            <TextField
              label={'Label'}
              required
              value={draft.label}
              onChange={(event) => setDraft({ ...draft, label: event.target.value })}
              placeholder="Toddler (1-2 years)"
              hint={'What the dropdown and the product card show.'}
            />
            <SelectField
              label={'Age unit'}
              required
              value={draft.ageUnit}
              onChange={(event) => setDraft({ ...draft, ageUnit: event.target.value as Draft['ageUnit'] })}
              options={[
                { value: 'MONTH', label: 'Months (0-24m)' },
                { value: 'YEAR', label: 'Years (1-2y)' },
              ]}
            />
            <TextField
              label={'From age'}
              inputMode="numeric"
              value={draft.minAge}
              onChange={(event) => setDraft({ ...draft, minAge: event.target.value })}
              placeholder="1"
            />
            <TextField
              label={'To age'}
              inputMode="numeric"
              value={draft.maxAge}
              onChange={(event) => setDraft({ ...draft, maxAge: event.target.value })}
              placeholder="2"
              hint={'Leave empty for an open-ended range such as adult.'}
            />
            <TextField
              label={'Order in the dropdown'}
              inputMode="numeric"
              value={draft.sortOrder}
              onChange={(event) => setDraft({ ...draft, sortOrder: event.target.value })}
            />
          </div>

          <div className="mt-3">
            <ToggleField
              label={'Show in the storefront'}
              checked={draft.active}
              onChange={(next) => setDraft({ ...draft, active: next })}
              hint={'Retiring keeps existing product links and hides the option from shoppers.'}
            />
          </div>

          {banner && <p className="mt-3 text-sm text-error-600">{banner}</p>}

          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn-primary" onClick={submit} disabled={save.isPending}>
              {save.isPending ? 'Saving' : 'Save range'}
            </button>
            <button type="button" className="btn-secondary" onClick={() => { setDraft(null); setBanner(null); }}>
              {'Cancel'}
            </button>
          </div>
        </div>
      )}

      {!draft && banner && <p className="mt-3 text-sm text-error-600">{banner}</p>}
    </SectionCard>
  );
}
