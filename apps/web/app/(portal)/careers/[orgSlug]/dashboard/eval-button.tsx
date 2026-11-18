'use client';

import { forwardRef, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type ReactNode, type Ref } from 'react';
import Link from 'next/link';
import {
  evalButtonClasses,
  type EvalButtonSize,
  type EvalButtonVariant,
  type EvalButtonWidth,
} from './eval-control-styles';
import { EVAL_SPINNER_CLASSES } from './eval-styles';

interface EvalButtonOwnProps {
  /** primary = the one most likely action; secondary; ghost (a text action); danger = only the CONFIRM of a destructive
   * dialog; secondary-danger = a destructive action on the page itself ("Withdraw my application"). */
  variant?: EvalButtonVariant;
  /** bar (default) = 52px phone / 48px md, a section's main action; compact = 44px, inside a panel. */
  size?: EvalButtonSize;
  /** fit (default), full, or bar = full width on phones and its content from md. */
  width?: EvalButtonWidth;
  /** A leading lucide icon (decorative: pass it aria-hidden). Replaced by the spinner while loading. */
  icon?: ReactNode;
  /** A trailing lucide icon (the PCA's "Comenzar →"). */
  trailingIcon?: ReactNode;
  /** Busy: the PCA spinner, aria-busy, and the native disabled attribute (as the shared Button does). */
  loading?: boolean;
  /** The label while loading ("Guardando…"); defaults to the normal label. */
  loadingLabel?: ReactNode;
  className?: string;
  children?: ReactNode;
}

export type EvalButtonProps = EvalButtonOwnProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof EvalButtonOwnProps> & { href?: undefined };

export type EvalLinkButtonProps = EvalButtonOwnProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof EvalButtonOwnProps | 'href'> & {
    /** Navigation that looks like a button: a Next.js <Link>. */
    href: string;
  };

/**
 * The PCA button (RButton) for the candidate dashboard. Same contract as the shared Button: type="button" by default,
 * `loading` disables it and sets aria-busy, `href` renders a link. Disabled keeps the native attribute (behaviour
 * unchanged) with the PCA soft-disabled look.
 */
export const EvalButton = forwardRef<HTMLButtonElement | HTMLAnchorElement, EvalButtonProps | EvalLinkButtonProps>(
  function EvalButton(props, ref) {
    const {
      variant,
      size,
      width,
      icon,
      trailingIcon,
      loading = false,
      loadingLabel,
      className,
      children,
      ...rest
    } = props;
    const classes = evalButtonClasses({ variant, size, width, className });
    const content = (
      <>
        {loading ? <span aria-hidden="true" className={EVAL_SPINNER_CLASSES} /> : icon}
        {loading && loadingLabel !== undefined ? loadingLabel : children}
        {!loading && trailingIcon}
      </>
    );

    if (typeof rest.href === 'string') {
      const { href, ...anchorRest } = rest as EvalLinkButtonProps;
      return (
        <Link ref={ref as Ref<HTMLAnchorElement>} href={href} className={classes} {...anchorRest}>
          {content}
        </Link>
      );
    }

    const { type = 'button', disabled, ...buttonRest } = rest as EvalButtonProps;
    return (
      <button
        ref={ref as Ref<HTMLButtonElement>}
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
