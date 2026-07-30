import * as React from 'react';
import { cn } from '../lib';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-[#3a3c41] bg-[#131416] px-3 text-sm text-zinc-100',
        'placeholder:text-zinc-500 transition-colors',
        'focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        'w-full rounded-md border border-[#3a3c41] bg-[#131416] px-3 py-2 text-sm text-zinc-100',
        'placeholder:text-zinc-500 transition-colors resize-y min-h-[80px]',
        'focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'h-9 w-full rounded-md border border-[#3a3c41] bg-[#131416] px-3 text-sm text-zinc-100',
        'focus:outline-none focus:border-violet-500/60 focus:ring-2 focus:ring-violet-500/20',
        'disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn('block text-xs font-medium text-zinc-400 mb-1.5', className)} {...props} />
  ),
);
Label.displayName = 'Label';

export interface FieldProps {
  label?: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function Field({ label, hint, required, children, className }: FieldProps) {
  return (
    <div className={cn('space-y-1', className)}>
      {label && (
        <Label>
          {label} {required && <span className="text-rose-400">*</span>}
        </Label>
      )}
      {children}
      {hint && <p className="text-[11px] text-zinc-500">{hint}</p>}
    </div>
  );
}
