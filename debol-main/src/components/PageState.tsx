import { useTranslation } from 'react-i18next';
import type { ReactNode } from 'react';
import { AlertCircle, Inbox } from 'lucide-react';

export function GridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-hidden>
      {Array.from({ length: count }).map((_, index) => (
        <div key={index} className="space-y-2">
          <div className="skeleton aspect-product w-full" />
          <div className="skeleton h-3.5 w-3/4" />
          <div className="skeleton h-3.5 w-1/3" />
        </div>
      ))}
    </div>
  );
}

export function LoadingRows({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="skeleton h-14 w-full" />
      ))}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
      <Inbox className="size-7 text-secondary-400" aria-hidden />
      <h3 className="font-display text-lg text-ink">{title}</h3>
      {body && <p className="max-w-sm text-sm text-ink-soft">{body}</p>}
      {action}
    </div>
  );
}

/** The backend never returns stack traces; we show the code it did send so a report is actionable. */
export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  const message = error instanceof Error ? error.message : t('common.error');
  const code = (error as { code?: string } | null)?.code;
  const reference = (error as { requestId?: string } | null)?.requestId;
  return (
    <div className="card flex flex-col items-start gap-3 border-error-300/60 bg-error-100/40 px-5 py-4">
      <div className="flex items-center gap-2 text-error-600">
        <AlertCircle className="size-4 shrink-0" aria-hidden />
        <p className="text-sm font-medium">{message}</p>
      </div>
      {(code || reference) && (
        <p className="text-xs text-ink-mute">
          {[code, reference].filter(Boolean).join(' · ')}
        </p>
      )}
      {onRetry && (
        <button type="button" className="btn-secondary" onClick={onRetry}>
          {t('common.retry')}
        </button>
      )}
    </div>
  );
}
