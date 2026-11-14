'use client';

import React from 'react';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { Button, CandidateAvatar, Field } from '../../../../components';
import type { FieldControlProps } from '../../../../components';
import type { PickedUser } from '../../../../components/user-picker';

interface PersonFieldProps {
  /** Visible field label ("Responsable"). Also names the "Cambiar" button. */
  label: string;
  value: PickedUser | null;
  onChange: (user: PickedUser | null) => void;
  disabled?: boolean;
  required?: boolean;
  optional?: boolean;
  /** The picker shown while empty; receives the input id so the label names its search box. */
  children: (inputId: string) => React.ReactNode;
}

/**
 * A labelled person field: the picker while empty, then the chosen person as a chip with
 * "Cambiar" (tertiary, never the dialog's red "Cancelar") to pick again.
 */
export function PersonField({
  label,
  value,
  onChange,
  disabled,
  required,
  optional,
  children,
}: PersonFieldProps) {
  const { t } = useI18n();
  const renderControl = (control: FieldControlProps) => {
    if (!value) return children(control.id);
    return (
      <div
        id={control.id}
        className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-field-border px-3 py-1.5"
      >
        <span className="flex min-w-0 items-center gap-2">
          <CandidateAvatar firstName={value.firstName} lastName={value.lastName} size="xs" decorative />
          <span className="truncate text-body font-medium text-primary">
            {value.firstName} {value.lastName}
          </span>
        </span>
        <Button
          variant="tertiary"
          size="sm"
          onClick={() => onChange(null)}
          disabled={disabled}
          aria-label={formatMessage(t.performance.changeField, { field: label })}
        >
          {t.common.change}
        </Button>
      </div>
    );
  };
  return (
    <Field label={label} required={required} optional={optional}>
      {renderControl}
    </Field>
  );
}
