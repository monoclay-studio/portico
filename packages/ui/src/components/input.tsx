import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cn } from '../lib/cn';
import { fieldControlProps, useField } from './field';

export const controlClass =
  'w-full min-h-control rounded-md border border-line-strong bg-surface px-3 text-sm text-ink ' +
  'placeholder:text-ink-subtle hover:border-ink-subtle disabled:cursor-not-allowed disabled:bg-surface-muted ' +
  'disabled:text-ink-muted aria-invalid:border-danger-line aria-invalid:ring-1 aria-invalid:ring-danger-line ' +
  'read-only:bg-surface-muted';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, id, ...rest },
  ref,
) {
  const field = useField();
  return (
    <input
      ref={ref}
      className={cn(controlClass, className)}
      {...fieldControlProps(field, { id })}
      {...rest}
    />
  );
});

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { className, id, ...rest },
  ref,
) {
  const field = useField();
  return (
    <textarea
      ref={ref}
      className={cn(controlClass, 'min-h-20 py-2', className)}
      {...fieldControlProps(field, { id })}
      {...rest}
    />
  );
});
