import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export { formatCost, formatTokens, formatDuration, timeAgo, formatTimestamp, clamp, cx } from '@sleiz/shared';
