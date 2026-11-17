'use client';

import { cloneElement, useId, type ReactElement, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useI18n } from '../../../../../lib/i18n';
import {
  EVAL_FIELD_CLASSES,
  EVAL_FIELD_ERROR_CLASSES,
  EVAL_FIELD_ERROR_ICON_CLASSES,
  EVAL_FIELD_HELP_CLASSES,
  EVAL_FIELD_LABEL_CLASSES,
  EVAL_FIELD_LABEL_HIDDEN_CLASSES,
  EVAL_FIELD_OPTIONAL_CLASSES,
  EVAL_FIELD_REQUIRED_CLASSES,
} from './eval-control-styles';

export interface EvalFieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
}

/** Only the keys the field sets: cloneElement would overwrite a control's own prop even with undefined. */
function definedProps(control: EvalFieldControlProps): Partial<EvalFieldControlProps> {
  return Object.fromEntries(
    Object.entries(control).filter(([, value]) => value !== undefined),
  ) as Partial<EvalFieldControlProps>;
}

/**
 * The PCA Field: label (0.88rem semibold) above the control, then the error (danger, TriangleAlert, role="alert") and
 * the help line, wired with aria-describedby / aria-invalid / required — the shared Field's contract, in the PCA look.
 * The control is a native <input className={EVAL_INPUT_CLASSES}> or <textarea className={EVAL_TEXTAREA_CLASSES}>
 * (an element is cloned with the ids; a function receives them to spread, e.g. next to react-hook-form's register).
 */
export function EvalField({
  label,
  help,
  error,
  required,
  optional,
  hideLabel,
  id,
  className = '',
  children,
}: {
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  /** Appends " (opcional)". */
  optional?: boolean;
  /** Visually hidden label (still the accessible name), when a heading already names the field. */
  hideLabel?: boolean;
  id?: string;
  className?: string;
  children: ReactElement<EvalFieldControlProps> | ((control: EvalFieldControlProps) => ReactNode);
}) {
  const { t } = useI18n();
  const autoId = useId();
  const controlId = id ?? `eval-field-${autoId}`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const control: EvalFieldControlProps = {
    id: controlId,
    'aria-describedby': [errorId, helpId].filter(Boolean).join(' ') || undefined,
    'aria-invalid': error ? true : undefined,
    required: required || undefined,
  };

  return (
    <div className={`${EVAL_FIELD_CLASSES} ${className}`}>
      <label htmlFor={controlId} className={hideLabel ? EVAL_FIELD_LABEL_HIDDEN_CLASSES : EVAL_FIELD_LABEL_CLASSES}>
        {label}
        {required && (
          <span aria-hidden="true" className={EVAL_FIELD_REQUIRED_CLASSES}>
            *
          </span>
        )}
        {optional && <span className={EVAL_FIELD_OPTIONAL_CLASSES}> ({t.common.optional})</span>}
      </label>
      {typeof children === 'function' ? children(control) : cloneElement(children, definedProps(control))}
      {error && (
        <p id={errorId} role="alert" className={EVAL_FIELD_ERROR_CLASSES}>
          <TriangleAlert aria-hidden="true" className={EVAL_FIELD_ERROR_ICON_CLASSES} />
          <span>{error}</span>
        </p>
      )}
      {help && (
        <p id={helpId} className={EVAL_FIELD_HELP_CLASSES}>
          {help}
        </p>
      )}
    </div>
  );
}
