import * as React from 'react';
import { cn } from '../lib';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'ghost' | 'outline' | 'destructive' | 'success';
  size?: 'sm' | 'md' | 'lg' | 'icon';
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', loading, disabled, children, ...props }, ref) => {
    const variants: Record<string, string> = {
      default: 'bg-[#1e1f22] text-zinc-200 hover:bg-[#2b2d31] border border-[#3a3c41]',
      primary:
        'bg-gradient-to-b from-violet-600 to-violet-700 text-white hover:from-violet-500 hover:to-violet-600 shadow-sm shadow-violet-900/40',
      secondary: 'bg-[#2b2d31] text-zinc-100 hover:bg-[#36373d] border border-[#3a3c41]',
      ghost: 'text-zinc-300 hover:bg-[#2b2d31] hover:text-zinc-100',
      outline: 'border border-[#3a3c41] text-zinc-200 hover:bg-[#2b2d31] hover:text-zinc-100',
      destructive:
        'bg-gradient-to-b from-rose-600 to-rose-700 text-white hover:from-rose-500 hover:to-rose-600',
      success: 'bg-gradient-to-b from-emerald-600 to-emerald-700 text-white hover:from-emerald-500 hover:to-emerald-600',
    };
    const sizes: Record<string, string> = {
      sm: 'h-7 px-2.5 text-xs gap-1.5 rounded',
      md: 'h-9 px-3.5 text-sm gap-2 rounded-md',
      lg: 'h-11 px-5 text-base gap-2 rounded-md',
      icon: 'h-9 w-9 rounded-md',
    };
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap font-medium transition-all',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60',
          'disabled:pointer-events-none disabled:opacity-50 select-none',
          variants[variant],
          sizes[size],
          className,
        )}
        disabled={disabled || loading}
        {...props}
      >
        {loading && (
          <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
            <path
              d="M4 12a8 8 0 0 1 8-8"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              className="opacity-90"
            />
          </svg>
        )}
        {children}
      </button>
    );
  },
);
Button.displayName = 'Button';
