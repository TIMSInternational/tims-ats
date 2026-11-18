import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { LegalDocumentView } from '../../../components/legal/legal-document-view';
import { loadLegalDocument } from '../../../lib/legal/content';
import { isLegalDocumentSlug, isLegalPagesEnabled } from '../../../lib/legal/documents';

interface LegalPageProps {
  params: Promise<{ doc: string }>;
}

export async function generateMetadata({ params }: LegalPageProps): Promise<Metadata> {
  const { doc } = await params;
  if (!isLegalPagesEnabled() || !isLegalDocumentSlug(doc)) return {};
  const content = await loadLegalDocument(doc);
  return {
    title: content.es.title,
    // Draft text must never be indexed, even if the flag is turned on in a preview.
    robots: content.es.isDraft || content.en.isDraft ? { index: false, follow: false } : undefined,
  };
}

// /legal/terms, /legal/privacy, /legal/subprocessors, /legal/ai-processing. Text lives in
// apps/web/content/legal/{es,en}/<slug>.md so counsel can replace it without a code change.
export default async function LegalDocumentPage({ params }: LegalPageProps) {
  if (!isLegalPagesEnabled()) notFound();
  const { doc } = await params;
  if (!isLegalDocumentSlug(doc)) notFound();
  const content = await loadLegalDocument(doc);
  return <LegalDocumentView slug={doc} content={content} />;
}
