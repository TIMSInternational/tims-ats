'use client';

import { useState } from 'react';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { useI18n } from '../../../../../lib/i18n';
import { formatRelativeTimeLocale } from '../../../../../lib/format-utils';
import { Button, EmptyState, StatusBadge } from '../../../../../components';
import { CARD, CARD_TITLE } from './card-styles';
import { documentTypeLabel } from './document-type-labels';
import { useCan } from '../../../../../lib/permissions';
import { documentOpenErrorKey, openSignedUrlInNewTab, reserveNewTab } from './document-open';
import { DocumentUploadForm } from './document-upload-form';

interface Document {
  id: string;
  type: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  parsedData: unknown;
  uploadedAt: Date | string;
}

export function DocumentsCard({ documents, candidateId }: { documents: Document[]; candidateId: string }) {
  const { t, locale } = useI18n();
  const can = useCan();
  const canUpload = can('candidate', 'update');
  const [uploading, setUploading] = useState(false);
  const getDocumentUrl = trpc.candidate.getDocumentUrl.useMutation();

  const openDocument = async (documentId: string) => {
    // Reserve the tab inside the click handler — a window opened after an await is popup-blocked.
    const tab = reserveNewTab();
    try {
      const { url } = await getDocumentUrl.mutateAsync({ candidateId, documentId });
      openSignedUrlInNewTab(url, tab);
    } catch (err) {
      tab?.close();
      toast(t.candidates[documentOpenErrorKey(err)], { type: 'error' });
    }
  };

  // The type is written out ("Hoja de vida (CV) · hace 2 días"), never carried by a tile colour alone.
  return (
    <section className={CARD}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className={`${CARD_TITLE} mb-0`}>{t.candidates.documents}</h2>
        {canUpload && !uploading && documents.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setUploading(true)}>
            {t.candidates.uploadDocument}
          </Button>
        )}
      </div>
      {uploading && <DocumentUploadForm candidateId={candidateId} onDone={() => setUploading(false)} />}
      {documents.length === 0 ? (
        !uploading && (
          <EmptyState
            size="compact"
            title={t.candidates.noDocuments}
            action={
              canUpload
                ? { label: t.candidates.uploadDocument, onClick: () => setUploading(true), variant: 'secondary' }
                : undefined
            }
          />
        )
      ) : (
        <ul className="space-y-2">
          {documents.map((doc) => {
            const hasParsed = doc.parsedData != null;
            const isOpening = getDocumentUrl.isPending && getDocumentUrl.variables?.documentId === doc.id;
            return (
              <li key={doc.id} className="flex items-center gap-3 rounded-lg bg-surface p-2.5">
                <div
                  className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-tint text-brand"
                  aria-hidden="true"
                >
                  <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                    <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-body font-medium text-primary">{doc.fileName}</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-caption text-secondary">
                      {documentTypeLabel(doc.type, t.candidates)} · {formatRelativeTimeLocale(doc.uploadedAt, locale)}
                    </span>
                    {hasParsed && (
                      <StatusBadge tone="brand" icon="none">
                        {t.candidates.aiTagPrefix}
                      </StatusBadge>
                    )}
                  </div>
                </div>
                <Button
                  variant="tertiary"
                  size="sm"
                  onClick={() => void openDocument(doc.id)}
                  loading={isOpening}
                  aria-label={t.candidates.openDocumentAria.replace('{name}', doc.fileName)}
                >
                  {t.candidates.openDocument}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
