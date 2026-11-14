'use client';

import { useId } from 'react';

import { useI18n } from '../../../../../../lib/i18n';
import { Button } from '../../../../../../components/button';
import { FIELD_ERROR_CLASSES, FIELD_HELP_CLASSES, FIELD_LABEL_CLASSES } from '../../../../../../components/field-styles';
import type { CvValidationError } from '../_lib/cv-validation';

interface CvUploadFieldProps {
  file: File | null;
  error: CvValidationError | 'upload_failed' | null;
  uploading: boolean;
  onFileChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}

const ERROR_KEYS = {
  invalid_type: 'cvInvalidType',
  too_large: 'cvTooLarge',
  upload_failed: 'cvUploadFailed',
} as const;

export function CvUploadField({ file, error, uploading, onFileChange, onRemove }: CvUploadFieldProps) {
  const { t } = useI18n();
  const p = t.portal;
  const inputId = useId();
  const labelId = `${inputId}-label`;
  const helpId = `${inputId}-help`;
  const errorId = `${inputId}-error`;
  const describedBy = error ? `${helpId} ${errorId}` : helpId;

  return (
    <div>
      {file ? (
        <span id={labelId} className={FIELD_LABEL_CLASSES}>
          {p.cvLabel}
        </span>
      ) : (
        <label id={labelId} htmlFor={inputId} className={FIELD_LABEL_CLASSES}>
          {p.cvLabel}
        </label>
      )}
      {file ? (
        <div
          role="group"
          aria-labelledby={labelId}
          className="flex items-center justify-between gap-2 rounded-lg border border-field-border px-3 py-1 text-body text-primary">
          <span className="truncate">{file.name}</span>
          <Button variant="tertiary" size="sm" onClick={onRemove} disabled={uploading} className="-mr-2 shrink-0">
            {p.cvRemove}
          </Button>
        </div>
      ) : (
        <input
          id={inputId}
          type="file"
          accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
          onChange={onFileChange}
          disabled={uploading}
          aria-describedby={describedBy}
          aria-invalid={error ? true : undefined}
          className="block w-full text-body text-secondary file:mr-3 file:min-h-9 file:cursor-pointer file:rounded-lg file:border file:border-field-border file:bg-white file:px-3 file:py-2 file:text-callout file:font-medium file:text-brand hover:file:bg-surface disabled:opacity-50"
        />
      )}
      <p id={helpId} className={FIELD_HELP_CLASSES}>
        {p.cvHelperText}
      </p>
      {error && (
        <p id={errorId} role="alert" className={FIELD_ERROR_CLASSES}>
          {p[ERROR_KEYS[error]]}
        </p>
      )}
    </div>
  );
}
