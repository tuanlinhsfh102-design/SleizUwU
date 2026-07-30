import * as React from 'react';
import { cn } from '../lib';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'success' | 'warning' | 'error' | 'info' | 'violet' | 'amber' | 'cyan';
  size?: 'sm' | 'md';
}

export function Badge({ className, variant = 'default', size = 'sm', ...props }: BadgeProps) {
  const variants: Record<string, string> = {
    default: 'bg-[#2b2d31] text-zinc-300 border-[#3a3c41]',
    success: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
    warning: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    error: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    info: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
    violet: 'bg-violet-500/10 text-violet-400 border-violet-500/30',
    amber: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    cyan: 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30',
  };
  const sizes: Record<string, string> = {
    sm: 'px-1.5 py-0.5 text-[10px]',
    md: 'px-2.5 py-1 text-xs',
  };
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded border font-medium whitespace-nowrap',
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

export function StatusDot({ color = 'emerald', pulse = false }: { color?: string; pulse?: boolean }) {
  const colors: Record<string, string> = {
    emerald: 'bg-emerald-400',
    amber: 'bg-amber-400',
    rose: 'bg-rose-400',
    violet: 'bg-violet-400',
    blue: 'bg-blue-400',
    slate: 'bg-slate-400',
    cyan: 'bg-cyan-400',
  };
  return (
    <span className="relative inline-flex h-2 w-2">
      {pulse && <span className={cn('absolute inset-0 rounded-full opacity-75 animate-ping', colors[color])} />}
      <span className={cn('relative inline-flex h-2 w-2 rounded-full', colors[color])} />
    </span>
  );
}
