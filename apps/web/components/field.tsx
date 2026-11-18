'use client';

import React, { useId } from 'react';
import { useI18n } from '../lib/i18n';
import { FIELD_ERROR_CLASSES, FIELD_HELP_CLASSES, FIELD_LABEL_CLASSES } from './field-styles';

export interface FieldControlProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
  required?: boolean;
}

interface FieldProps {
  /** The visible label, always above the control (never a placeholder standing in for it). */
  label: React.ReactNode;
  /** One line of help, linked with aria-describedby. */
  help?: React.ReactNode;
  /** The error: says what happened and how to fix it. Sets aria-invalid on the control. */
  error?: React.ReactNode;
  /** Marks the control required and shows an aria-hidden asterisk. */
  required?: boolean;
  /** Appends " (opcional)" to the label, for forms where most fields are required. */
  optional?: boolean;
  /** Visually hide the label (it stays the accessible name). Use only when a heading already names the field. */
  hideLabel?: boolean;
  /** Override the generated control id. */
  id?: string;
  className?: string;
  /**
   * The control. A single element (TextInput, Select, TextArea, a native input…) is cloned with id,
   * aria-describedby, aria-invalid and required. A function receives the same props to spread itself.
   */
  children: React.ReactElement<FieldControlProps> | ((control: FieldControlProps) => React.ReactNode);
}

/**
 * Only the keys Field actually sets. cloneElement overwrites a child prop even with `undefined`, so passing
 * `{ required: undefined }` would strip a `required` the caller put on the control itself.
 */
function definedProps(control: FieldControlProps): Partial<FieldControlProps> {
  return Object.fromEntries(
    Object.entries(control).filter(([, value]) => value !== undefined),
  ) as Partial<FieldControlProps>;
}

/** Label + control + help + error with the ids wired up (foundation-spec.md §6). */
export function Field({ label, help, error, required, optional, hideLabel, id, className = '', children }: FieldProps) {
  const { t } = useI18n();
  const autoId = useId();
  const controlId = id ?? `field-${autoId}`;
  const helpId = help ? `${controlId}-help` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [helpId, errorId].filter(Boolean).join(' ') || undefined;

  const control: FieldControlProps = {
    id: controlId,
    'aria-describedby': describedBy,
    'aria-invalid': error ? true : undefined,
    required: required || undefined,
  };

  return (
    <div className={className}>
      <label htmlFor={controlId} className={hideLabel ? 'sr-only' : FIELD_LABEL_CLASSES}>
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-danger">
            *
          </span>
        )}
        {optional && <span className="font-normal text-secondary"> ({t.common.optional})</span>}
      </label>
      {typeof children === 'function' ? children(control) : React.cloneElement(children, definedProps(control))}
      {help && (
        <p id={helpId} className={FIELD_HELP_CLASSES}>
          {help}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className={FIELD_ERROR_CLASSES}>
          <svg
            className="mt-px size-3.5 shrink-0"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle cx="12" cy="12" r="9" />
            <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
          </svg>
          <span>{error}</span>
        </p>
      )}
    </div>
  );
}
