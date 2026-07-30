import * as React from 'react';
import { cn } from '../lib';

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('animate-pulse rounded bg-[#2b2d31]', className)} {...props} />;
}

export function SkeletonRow({ cols = 4 }: { cols?: number }) {
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton key={i} className="h-8" />
      ))}
    </div>
  );
}
