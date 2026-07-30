import * as React from 'react';
import { cn } from '../lib';

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-6 text-center', className)}>
      {icon && <div className="mb-3 text-zinc-600 text-5xl">{icon}</div>}
      <h3 className="text-sm font-semibold text-zinc-300">{title}</h3>
      {description && <p className="mt-1 text-xs text-zinc-500 max-w-sm">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
