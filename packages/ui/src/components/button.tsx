import { Slot } from 'radix-ui';
import { type ButtonHTMLAttributes, forwardRef, type ReactNode } from 'react';
import { cn } from '../lib/cn';
import { useUi } from '../provider';
import { Tooltip } from './tooltip';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md';

const base =
  'relative inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-md font-medium ' +
  'transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed ' +
  'aria-disabled:opacity-55';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:bg-accent-hover shadow-sm',
  secondary: 'border border-line-strong bg-surface text-ink hover:bg-surface-hover',
  ghost: 'text-ink hover:bg-surface-hover',
  danger: 'bg-danger-solid text-white hover:opacity-90 shadow-sm',
  link: 'text-accent underline underline-offset-2 hover:text-accent-hover',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'min-h-control-sm px-2.5 text-[0.8125rem]',
  md: 'min-h-control px-3.5 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a busy state and blocks double submission. The label stays visible (no spinner-only states). */
  loading?: boolean;
  /** Icon rendered before the label (mirrors in RTL automatically because of flex order). */
  icon?: ReactNode;
  /** Render as the child element (e.g. a router <Link>) while keeping button styling. */
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'secondary',
    size = 'md',
    loading = false,
    icon,
    asChild,
    className,
    children,
    disabled,
    type,
    ...rest
  },
  ref,
) {
  const { strings } = useUi();
  const classes = cn(base, variants[variant], variant !== 'link' && sizes[size], className);
  if (asChild) {
    return (
      <Slot.Root ref={ref} className={classes} {...rest}>
        {children}
      </Slot.Root>
    );
  }
  return (
    <button
      ref={ref}
      type={type ?? 'button'}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden
          className="size-3 rounded-full border-2 border-current border-e-transparent animate-spin"
        />
      ) : (
        icon && (
          <span aria-hidden className="inline-flex shrink-0 [&_svg]:size-4">
            {icon}
          </span>
        )
      )}
      <span className="inline-flex min-w-0 items-center gap-2">{children}</span>
      {loading && <span className="pt-sr-only">{strings.common.working}</span>}
    </button>
  );
});

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name; also shown as a tooltip. Required — icon-only controls must be named. */
  label: string;
  icon: ReactNode;
  variant?: Exclude<ButtonVariant, 'link'>;
  size?: ButtonSize;
  /** Keyboard shortcut hint shown in the tooltip, e.g. "⌘K". */
  shortcut?: string;
  tooltip?: boolean;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', shortcut, tooltip = true, className, type, ...rest },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type ?? 'button'}
      aria-label={label}
      aria-keyshortcuts={shortcut ? shortcut.replace('⌘', 'Meta+').replace('Ctrl', 'Control') : undefined}
      className={cn(
        base,
        variants[variant],
        size === 'sm' ? 'size-control-sm' : 'size-control',
        '[&_svg]:size-4 shrink-0',
        className,
      )}
      {...rest}
    >
      <span aria-hidden className="inline-flex">
        {icon}
      </span>
    </button>
  );
  if (!tooltip) return button;
  return (
    <Tooltip content={label} shortcut={shortcut}>
      {button}
    </Tooltip>
  );
});
