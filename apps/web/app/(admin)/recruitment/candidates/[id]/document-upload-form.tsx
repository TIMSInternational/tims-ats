'use client';

import { useState } from 'react';
import { STAFF_DOCUMENT_TYPES, type StaffDocumentType } from '@tims/shared';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { useI18n } from '../../../../../lib/i18n';
import {
  CV_ALLOWED_MIME_TYPES,
  validateCvFile,
  type CvValidationError,
} from '../../../../(portal)/careers/[orgSlug]/[vacancyId]/_lib/cv-validation';

type UploadContentType = (typeof CV_ALLOWED_MIME_TYPES)[number];

/**
 * Staff "Subir documento" (A-21): a CV received by email, a degree, a certificate… The file goes straight to
 * the org's storage through a presigned POST (the same path as the public apply form), then is recorded on
 * the candidate. PDF or DOCX, 5 MB, as S3 enforces.
 */
export function DocumentUploadForm({ candidateId, onDone }: { candidateId: string; onDone: () => void }) {
  const { t } = useI18n();
  const c = t.candidates;
  const utils = trpc.useUtils();
  const getUploadUrl = trpc.candidate.getDocumentUploadUrl.useMutation();
  const record = trpc.candidate.uploadDocument.useMutation();
  const [file, setFile] = useState<File | null>(null);
  const [type, setType] = useState<StaffDocumentType>('cv');
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const typeLabels: Record<StaffDocumentType, string> = {
    cv: c.documentTypeCv,
    cover_letter: c.documentTypeCoverLetter,
    certificate: c.documentTypeCertificate,
    other: c.documentTypeOther,
  };
  const fileErrors: Record<CvValidationError, string> = {
    invalid_type: c.documentFileInvalidType,
    too_large: c.documentFileTooLarge,
  };

  const onFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    if (!selected) return;
    const invalid = validateCvFile(selected);
    setError(invalid ? fileErrors[invalid] : null);
    setFile(invalid ? null : selected);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file) {
      setError(c.documentFileRequired);
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const { url, fields, key } = await getUploadUrl.mutateAsync({
        candidateId,
        contentType: file.type as UploadContentType,
      });
      const body = new FormData();
      Object.entries(fields).forEach(([name, value]) => body.append(name, value));
      body.append('file', file);
      const uploaded = await fetch(url, { method: 'POST', body });
      if (!uploaded.ok) throw new Error('upload_failed');
      await record.mutateAsync({ candidateId, type, fileName: file.name.slice(0, 255), fileKey: key });
      toast(c.documentUploaded, { type: 'success' });
      await Promise.all([
        utils.candidate.getById.invalidate({ id: candidateId }),
        utils.candidate.getTimeline.invalidate({ candidateId }),
      ]);
      onDone();
    } catch (err) {
      const message = err instanceof Error && err.message === 'consent_withdrawn' ? t.consentGuard.withdrawn : c.documentUploadFailed;
      setError(message);
    } finally {
      setUploading(false);
    }
  };

  return (
    <form noValidate onSubmit={submit} className="mb-4 space-y-3 rounded-lg border border-[#EDEDED] p-3">
      <div>
        <label htmlFor="doc-type" className="mb-1 block text-[12px] font-medium text-[#585858]">
          {c.documentTypeLabel}
        </label>
        <select
          id="doc-type"
          value={type}
          onChange={(e) => setType(e.target.value as StaffDocumentType)}
          className="h-9 w-full rounded-lg border border-[#EDEDED] bg-white px-2 text-[13px]"
        >
          {STAFF_DOCUMENT_TYPES.map((value) => (
            <option key={value} value={value}>
              {typeLabels[value]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="doc-file" className="mb-1 block text-[12px] font-medium text-[#585858]">
          {c.documentFileLabel}
        </label>
        <input
          id="doc-file"
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={onFile}
          aria-invalid={!!error}
          aria-describedby={error ? 'doc-error' : undefined}
          className="block w-full text-[12px] text-[#585858]"
        />
      </div>
      {error && (
        <p id="doc-error" role="alert" className="text-[11px] text-red-600">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onDone} disabled={uploading} className="h-8 rounded-lg border border-[#EDEDED] px-3 text-[12px] text-[#585858]">
          {t.common.cancel}
        </button>
        <button type="submit" disabled={uploading} className="h-8 rounded-lg bg-[#1F114C] px-3 text-[12px] font-medium text-white disabled:opacity-50">
          {uploading ? c.documentUploading : c.documentUploadSubmit}
        </button>
      </div>
    </form>
  );
}
