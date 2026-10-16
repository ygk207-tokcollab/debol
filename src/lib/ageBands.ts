import { useMemo } from 'react';
import { titleCase } from './format';
import { useAgeGroups } from './queries';
import type { AgeGroup } from './types';

/**
 * A band is identified by a stable code (TODDLER_1_2Y) and labelled by a database row an
 * administrator can rename. Until the band table has loaded, the age word inside the code is a
 * readable fallback, so a tile never shows a raw enum to a customer.
 */
export function ageBandText(codes: string[], labelFor: (code: string) => string | undefined): string {
  return codes.map((code) => labelFor(code) ?? titleCase(code.split('_')[0].replace(/-/g, ' '))).join(', ');
}

export function useAgeBandLabels(): (code: string) => string | undefined {
  const { data } = useAgeGroups();
  return useMemo(() => {
    const byCode = new Map((data ?? []).map((band) => [band.code, band.label]));
    return (code: string) => byCode.get(code);
  }, [data]);
}

/**
 * A grid tile has a few characters next to the price, so it shows the numbers only. The bounds come
 * from the same database row as the long label, so a renamed band changes in both places.
 */
function shortRange(band: AgeGroup): string {
  const unit = band.ageUnit === 'MONTH' ? 'm' : 'y';
  // Jackson drops null keys, so an unbounded side arrives as undefined rather than null.
  const min = band.minAge ?? null;
  const max = band.maxAge ?? null;
  if (min === null && max === null) return 'Any age';
  if (max === null) return `${min}${unit}+`;
  if (min === null) return `Up to ${max}${unit}`;
  return `${min}-${max}${unit}`;
}

export function useAgeBandShort(): (code: string) => string {
  const { data } = useAgeGroups();
  return useMemo(() => {
    const byCode = new Map((data ?? []).map((band) => [band.code, band]));
    return (code: string) => {
      const band = byCode.get(code);
      return band ? shortRange(band) : titleCase(code.split('_')[0].replace(/-/g, ' '));
    };
  }, [data]);
}

/** Two ranges read at a glance; a toy that fits nine of them shows the rest as a count. */
export function compactAgeBands(codes: string[], shortFor: (code: string) => string, max = 2): string {
  if (codes.length === 0) return '';
  const head = codes.slice(0, max).map(shortFor).join(' · ');
  return codes.length > max ? `${head} +${codes.length - max}` : head;
}
