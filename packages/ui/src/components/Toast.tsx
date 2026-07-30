import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib';

type ToastVariant = 'default' | 'success' | 'error' | 'warning' | 'info';

interface Toast {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
}

interface ToastContextValue {
  toast: (t: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => void;
  dismiss: (id: string) => void;
}

const ToastContext = React.createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (t: Omit<Toast, 'id' | 'duration'> & { duration?: number }) => {
      const id = Math.random().toString(36).slice(2);
      const duration = t.duration ?? 4000;
      setToasts((cur) => [...cur, { ...t, id, duration }]);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss }}>
      {children}
      {createPortal(
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80 pointer-events-none">
          {toasts.map((t) => (
            <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

const variantStyles: Record<ToastVariant, string> = {
  default: 'border-[#3a3c41] bg-[#1e1f22]',
  success: 'border-emerald-500/30 bg-emerald-950/40',
  error: 'border-rose-500/30 bg-rose-950/40',
  warning: 'border-amber-500/30 bg-amber-950/40',
  info: 'border-blue-500/30 bg-blue-950/40',
};

const variantIcon: Record<ToastVariant, string> = {
  default: '●',
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ⓘ',
};

const variantIconColor: Record<ToastVariant, string> = {
  default: 'text-zinc-400',
  success: 'text-emerald-400',
  error: 'text-rose-400',
  warning: 'text-amber-400',
  info: 'text-blue-400',
};

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  return (
    <div
      className={cn(
        'pointer-events-auto flex items-start gap-3 rounded-md border px-3.5 py-2.5 shadow-lg animate-in slide-in-from-right-4 fade-in duration-200',
        variantStyles[toast.variant],
      )}
    >
      <span className={cn('mt-0.5 text-sm', variantIconColor[toast.variant])}>{variantIcon[toast.variant]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-zinc-100">{toast.title}</p>
        {toast.description && <p className="mt-0.5 text-xs text-zinc-400 break-words">{toast.description}</p>}
      </div>
      <button
        onClick={onDismiss}
        className="text-zinc-500 hover:text-zinc-300 transition-colors text-sm leading-none"
        aria-label="Đóng"
      >
        ✕
      </button>
    </div>
  );
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within <ToastProvider>');
  return ctx;
}
