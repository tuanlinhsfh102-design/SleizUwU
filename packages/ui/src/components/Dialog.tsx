import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../lib';
import { Button } from './Button';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  footer?: React.ReactNode;
}

export function Dialog({ open, onOpenChange, title, description, children, className, footer }: DialogProps) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOpenChange(false);
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onOpenChange]);

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={() => onOpenChange(false)}
      />
      <div
        className={cn(
          'relative w-full max-w-lg rounded-lg border border-[#3a3c41] bg-[#1e1f22] shadow-2xl animate-in fade-in zoom-in-95 duration-200',
          className,
        )}
      >
        {(title || description) && (
          <div className="px-5 py-4 border-b border-[#2b2d31]">
            {title && <h2 className="text-base font-semibold text-zinc-100">{title}</h2>}
            {description && <p className="mt-1 text-sm text-zinc-400">{description}</p>}
          </div>
        )}
        <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">{children}</div>
        {footer && <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[#2b2d31]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  open,
  onOpenChange,
  title = 'Xác nhận',
  description,
  confirmText = 'Xác nhận',
  cancelText = 'Hủy',
  onConfirm,
  variant = 'destructive',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void | Promise<void>;
  variant?: 'destructive' | 'primary';
}) {
  const [loading, setLoading] = React.useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {cancelText}
          </Button>
          <Button
            variant={variant}
            loading={loading}
            onClick={async () => {
              setLoading(true);
              try {
                await onConfirm();
                onOpenChange(false);
              } finally {
                setLoading(false);
              }
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    />
  );
}
