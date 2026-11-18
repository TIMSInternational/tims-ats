'use client';

import React, { forwardRef } from 'react';

export type IconButtonVariant = 'ghost' | 'secondary' | 'chrome' | 'destructive';

interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label' | 'title'> {
  /** Required: becomes the accessible name and the tooltip (icons.md › Best practices). */
  label: string;
  /** sm = 28px (dense rows), md = 36px (default). Both grow to 44px on touch screens. */
  size?: 'sm' | 'md';
  /** ghost on white panels, chrome on the dark shell, secondary with an outline. */
  variant?: IconButtonVariant;
  /** For toggle buttons: sets aria-pressed. */
  pressed?: boolean;
  /** Hide the native tooltip (e.g. when a visible label sits next to the button). */
  hideTooltip?: boolean;
  /** The icon. Give its <svg> aria-hidden; use size-4 (sm) or size-5 (md). */
  children: React.ReactNode;
}

const SIZES = { sm: 'size-7', md: 'size-9' } as const;

const VARIANTS: Record<IconButtonVariant, string> = {
  ghost: 'text-secondary hover:bg-surface hover:text-primary',
  secondary: 'bg-white text-secondary border border-field-border hover:bg-surface hover:text-primary',
  chrome: 'text-[var(--chrome-text-secondary)] hover:bg-[var(--chrome-hover)] hover:text-[var(--chrome-text-primary)]',
  destructive: 'text-brand-red hover:bg-danger-bg',
};

/** An icon-only button with a required label (foundation-spec.md §5). */
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    size = 'md',
    variant = 'ghost',
    pressed,
    hideTooltip = false,
    className = '',
    type = 'button',
    children,
    ...rest
  },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={hideTooltip ? undefined : label}
      aria-pressed={pressed}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg transition-colors duration-150 ease-out disabled:cursor-not-allowed disabled:opacity-50 pointer-coarse:size-11 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
});
