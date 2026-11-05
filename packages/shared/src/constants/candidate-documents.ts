// What staff may file a candidate document as (candidate_documents.type) when they upload one on the
// Candidate 360 (A-21). Labels live in the web app's i18n (candidates.documentType*).
export const STAFF_DOCUMENT_TYPES = ['cv', 'cover_letter', 'certificate', 'other'] as const;
export type StaffDocumentType = (typeof STAFF_DOCUMENT_TYPES)[number];
