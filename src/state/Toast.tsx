import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, TriangleAlert, X } from 'lucide-react';

type Tone = 'ok' | 'warn';

interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

interface ToastValue {
  push: (text: string, tone?: Tone) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const push = useCallback((text: string, tone: Tone = 'ok') => {
    const id = nextId++;
    setToasts((list) => [...list, { id, tone, text }]);
    window.setTimeout(() => dismiss(id), 5000);
  }, [dismiss]);

  const value = useMemo<ToastValue>(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border border-surface-300 bg-surface-50 px-4 py-3 text-sm shadow-card"
          >
            {toast.tone === 'ok'
              ? <Check className="mt-0.5 size-4 shrink-0 text-primary-500" aria-hidden />
              : <TriangleAlert className="mt-0.5 size-4 shrink-0 text-error-600" aria-hidden />}
            <p className="flex-1 text-ink">{toast.text}</p>
            <button type="button" onClick={() => dismiss(toast.id)} className="text-ink-mute hover:text-ink" aria-label="Dismiss">
              <X className="size-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error('useToast must be used inside ToastProvider');
  return value;
}
