'use client';

import { useI18n } from '../../../../../../lib/i18n';
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

  return (
    <div>
      <label className="block text-xs font-medium text-[#585858] mb-1">{p.cvLabel}</label>
      {file ? (
        <div className="flex items-center justify-between rounded-lg border border-[#EDEDED] px-3 py-2 text-sm text-[#333]">
          <span className="truncate">{file.name}</span>
          <button
            type="button"
            onClick={onRemove}
            disabled={uploading}
            className="ml-2 shrink-0 text-[11px] text-[#DD0C15] hover:underline disabled:opacity-50"
          >
            {p.cvRemove}
          </button>
        </div>
      ) : (
        <input
          type="file"
          accept="application/pdf,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.docx"
          onChange={onFileChange}
          disabled={uploading}
          className="block w-full text-sm text-[#585858] file:mr-3 file:rounded-lg file:border-0 file:bg-[#F6F6F6] file:px-3 file:py-2 file:text-[12px] file:font-medium file:text-[#1F114C] disabled:opacity-50"
        />
      )}
      <p className="mt-1 text-[10px] text-[#8B8B8B]">{p.cvHelperText}</p>
      {error && <p className="mt-1 text-[11px] text-[#DD0C15]">{p[ERROR_KEYS[error]]}</p>}
    </div>
  );
}
