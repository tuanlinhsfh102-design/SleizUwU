import type { ReactNode } from 'react';
import { cn } from '@sleiz/ui';

export function PageHeader({
  title,
  description,
  actions,
  icon,
  className,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        'flex items-center justify-between gap-4 px-5 py-3.5 border-b border-[#2b2d31] bg-[#131416]/50 backdrop-blur-sm',
        className,
      )}
    >
      <div className="flex items-center gap-3 min-w-0">
        {icon && <div className="text-violet-400 shrink-0">{icon}</div>}
        <div className="min-w-0">
          <h1 className="text-base font-semibold text-zinc-100 truncate">{title}</h1>
          {description && <p className="text-xs text-zinc-500 mt-0.5 truncate">{description}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

export function PageContent({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex-1 overflow-auto p-5', className)}>{children}</div>;
}

export function PageContainer({ children }: { children: ReactNode }) {
  return <div className="flex flex-col h-full">{children}</div>;
}
