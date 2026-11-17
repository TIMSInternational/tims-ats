'use client';

import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import {
  EVAL_CHECK_BOX_CLASSES,
  EVAL_CHECK_BOX_WRAP_CLASSES,
  EVAL_CHECK_ICON_CLASSES,
  EVAL_CHECK_INPUT_CLASSES,
  EVAL_CHECK_LABEL_CLASSES,
  EVAL_CHECK_ROW_CLASSES,
} from './eval-control-styles';

/**
 * The consent step's checkbox in the PCA look: the PCA checkbox (24px box, radius 7, 2px field border; checked = accent
 * fill + white Check) inside a radio-card-shaped row (50px, radius 12; checked = 2px accent border + accent tint). The
 * whole row is the <label>, so the label text is the checkbox's accessible name; the native input stays (role
 * checkbox, Space toggles), invisible over a 44px hit area, and the row draws its keyboard ring. Unchecked by default:
 * the caller owns `checked`.
 */
export function EvalCheckboxRow({
  checked,
  onChange,
  children,
  describedBy,
  disabled,
  invalid,
  id,
  lang,
  className = '',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The label ("I have read this text and I accept it."). */
  children: ReactNode;
  /** Extra description ids (the step's title, "Tick the box to continue"). */
  describedBy?: string;
  disabled?: boolean;
  invalid?: boolean;
  id?: string;
  lang?: string;
  className?: string;
}) {
  return (
    <label className={`${EVAL_CHECK_ROW_CLASSES} ${className}`} lang={lang}>
      <span className={EVAL_CHECK_BOX_WRAP_CLASSES}>
        <input
          id={id}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-describedby={describedBy || undefined}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.checked)}
          className={EVAL_CHECK_INPUT_CLASSES}
        />
        <span aria-hidden="true" className={EVAL_CHECK_BOX_CLASSES}>
          {checked && <Check className={EVAL_CHECK_ICON_CLASSES} strokeWidth={3} />}
        </span>
      </span>
      <span className={EVAL_CHECK_LABEL_CLASSES}>{children}</span>
    </label>
  );
}
