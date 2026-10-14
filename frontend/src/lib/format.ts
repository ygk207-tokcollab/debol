

const amount = new Intl.NumberFormat('en-ET', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Money always renders through this helper: the backend sends BigDecimal, never a float calculation. */
export function money(value: number | string | null | undefined, currency = 'ETB'): string {
  const n = typeof value === 'string' ? Number(value) : value ?? 0;
  return `${currency} ${amount.format(Number.isFinite(n) ? n : 0)}`;
}

export function shortMoney(value: number | string, currency = 'ETB'): string {
  const n = Number(value);
  return `${currency} ${new Intl.NumberFormat('en-ET', { maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0)}`;
}

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' });

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return dateFmt.format(d);
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return `${dateFmt.format(d)} · ${timeFmt.format(d)}`;
}

export function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function titleCase(value: string): string {
  return value.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The stored enum is ANY/MORNING/AFTERNOON/EVENING; every screen shows it through the same locale key. */
const DELIVERY_TIME_KEYS: Record<string, string> = {
  ANY: 'checkout.timeAny',
  MORNING: 'checkout.timeMorning',
  AFTERNOON: 'checkout.timeAfternoon',
  EVENING: 'checkout.timeEvening',
};

export function deliveryTimeKey(value: string): string {
  return DELIVERY_TIME_KEYS[value.toUpperCase()] ?? titleCase(value);
}

/** 0911526922 -> 091 152 6922, the way Ethiopian numbers are read out. */
export function formatPhone(value: string | null | undefined): string {
  if (!value) return '—';
  const digits = value.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) {
    return `${digits.slice(0, 3)} ${digits.slice(3, 6)} ${digits.slice(6)}`;
  }
  return value;
}
