'use client';

import React, { forwardRef } from 'react';
import Link from 'next/link';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './button-styles';
import { Spinner } from './spinner';

interface ButtonOwnProps {
  /** primary = the one most likely action per view; destructive only confirms a destructive dialog. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (decorative; give it aria-hidden). Replaced by a spinner while loading. */
  icon?: React.ReactNode;
  /** Shows a spinner, sets aria-busy and disables the button. */
  loading?: boolean;
  /** The gerund shown while loading ("Guardando…"). Defaults to the normal label. */
  loadingLabel?: React.ReactNode;
  fullWidth?: boolean;
  className?: string;
  children?: React.ReactNode;
}

export type ButtonProps = ButtonOwnProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, keyof ButtonOwnProps> & {
    href?: undefined;
  };

export type LinkButtonProps = ButtonOwnProps &
  Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, keyof ButtonOwnProps | 'href'> & {
    /** Renders a Next.js <Link> styled as a button (navigation, not an action). */
    href: string;
  };

function Content({
  icon,
  loading,
  loadingLabel,
  children,
}: Pick<ButtonOwnProps, 'icon' | 'loading' | 'loadingLabel' | 'children'>) {
  return (
    <>
      {loading ? <Spinner /> : icon}
      {loading && loadingLabel !== undefined ? loadingLabel : children}
    </>
  );
}

/**
 * The shared button (foundation-spec.md §5). Five variants, three sizes, a loading state, and `href` for a
 * link that looks like a button. Defaults to type="button" so it never submits a form by accident.
 */
export const Button = forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps | LinkButtonProps>(
  function Button(props, ref) {
    const { variant, size, icon, loading = false, loadingLabel, fullWidth, className, children, ...rest } = props;
    const classes = buttonClasses({ variant, size, fullWidth, className });
    const content = (
      <Content icon={icon} loading={loading} loadingLabel={loadingLabel}>
        {children}
      </Content>
    );

    if (typeof rest.href === 'string') {
      const { href, ...anchorRest } = rest as LinkButtonProps;
      return (
        <Link ref={ref as React.Ref<HTMLAnchorElement>} href={href} className={classes} {...anchorRest}>
          {content}
        </Link>
      );
    }

    const { type = 'button', disabled, ...buttonRest } = rest as ButtonProps;
    return (
      <button
        ref={ref as React.Ref<HTMLButtonElement>}
        type={type}
        className={classes}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...buttonRest}
      >
        {content}
      </button>
    );
  },
);
