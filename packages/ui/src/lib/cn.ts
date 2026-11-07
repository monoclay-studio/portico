import { type ClassValue, clsx } from 'clsx';

/** Join class names conditionally. Tokens-only Tailwind classes; no merging magic needed. */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
