import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Standard shadcn `cn()` helper — combines clsx + tailwind-merge so
 * conditional class lists get de-duped with later classes winning.
 * Every shadcn-generated component imports this from `@/lib/utils`,
 * so the path has to stay stable.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
