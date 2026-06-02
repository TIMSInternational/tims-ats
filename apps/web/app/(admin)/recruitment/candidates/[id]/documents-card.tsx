'use client';

import { useI18n } from '../../../../../lib/i18n';
import { formatRelativeTime } from '../../../../../lib/format-utils';

interface Document {
  id: string;
  type: string;
  fileName: string;
  fileUrl: string;
  fileSize: number | null;
  parsedData: unknown;
  uploadedAt: Date | string;
}

const TYPE_ICONS: Record<string, string> = {
  cv: 'bg-blue-100 text-blue-600',
  cover_letter: 'bg-violet-100 text-violet-600',
  certificate: 'bg-emerald-100 text-emerald-600',
  other: 'bg-gray-100 text-gray-600',
};

export function DocumentsCard({ documents }: { documents: Document[] }) {
  const { t } = useI18n();

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.candidates.documents}</h3>
        <button className="text-[12px] text-[#DD0C15] font-medium">{t.candidates.uploadDocument}</button>
      </div>
      {documents.length === 0 ? (
        <p className="text-xs text-[#8B8B8B] py-3 text-center">{t.candidates.noDocuments}</p>
      ) : (
        <div className="space-y-2">
          {documents.map((doc) => {
            const iconCls = TYPE_ICONS[doc.type] ?? TYPE_ICONS.other;
            const hasParsed = doc.parsedData != null;
            return (
              <div key={doc.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-[#F6F6F6]">
                <div className={`w-8 h-8 rounded-lg ${iconCls} flex items-center justify-center shrink-0`}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[12px] font-medium text-[#333] truncate">{doc.fileName}</p>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[#8B8B8B]">{formatRelativeTime(doc.uploadedAt)}</span>
                    {hasParsed && (
                      <span className="text-[9px] bg-teal-50 text-teal-600 px-1.5 py-0.5 rounded">AI</span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
