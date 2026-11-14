import type { StaffDocumentType } from '@tims/shared';

interface DocumentTypeCopy {
  documentTypeCv: string;
  documentTypeCoverLetter: string;
  documentTypeCertificate: string;
  documentTypeOther: string;
}

/** One name per stored document type, shared by the upload form's picker and the documents list. */
export function documentTypeLabels(c: DocumentTypeCopy): Record<StaffDocumentType, string> {
  return {
    cv: c.documentTypeCv,
    cover_letter: c.documentTypeCoverLetter,
    certificate: c.documentTypeCertificate,
    other: c.documentTypeOther,
  };
}

/** A stored type in words; anything unknown reads as "Otro documento". */
export function documentTypeLabel(type: string, c: DocumentTypeCopy): string {
  const labels: Record<string, string> = documentTypeLabels(c);
  return labels[type] ?? c.documentTypeOther;
}
