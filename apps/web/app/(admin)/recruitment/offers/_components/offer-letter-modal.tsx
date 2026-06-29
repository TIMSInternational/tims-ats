'use client';

import { OfferLetter } from './offer-letter';
import { useI18n } from '../../../../../lib/i18n';

interface OfferLetterModalProps {
  offer: {
    candidate: { firstName: string; lastName: string };
    vacancy: { title: string; department?: string | null };
    salary: number;
    currency: string;
    startDate: Date | string | null;
    contractType: string | null;
    benefits: Record<string, string> | null;
    terms: Record<string, string> | null;
    createdAt: Date | string;
  };
  onClose: () => void;
}

export function OfferLetterModal({ offer, onClose }: OfferLetterModalProps) {
  const { t } = useI18n();
  const handlePrint = () => window.print();

  const handleDownloadPdf = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[#F6F6F6]">
      {/* Toolbar - hidden when printing */}
      <div className="print:hidden flex items-center justify-between px-6 py-3 bg-white border-b border-[#EDEDED] shadow-sm">
        <h2 className="text-[15px] font-semibold text-[#1F114C]">{t.offers.offerPreview}</h2>
        <div className="flex items-center gap-3">
          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-[#585858] bg-[#F6F6F6] rounded-lg hover:bg-[#EDEDED] transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0110.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0l.229 2.523a1.125 1.125 0 01-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0021 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 00-1.913-.247M6.34 18H5.25A2.25 2.25 0 013 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 011.913-.247m10.5 0a48.536 48.536 0 00-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18.25 7.034l.036.003" />
            </svg>
            Imprimir
          </button>
          <button
            onClick={handleDownloadPdf}
            className="flex items-center gap-1.5 px-4 py-2 text-[13px] font-medium text-white bg-[#1F114C] rounded-lg hover:bg-[#2D1B6E] transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Descargar PDF
          </button>
          <button
            onClick={onClose}
            className="ml-2 p-2 text-[#8B8B8B] hover:text-[#585858] rounded-lg hover:bg-[#EDEDED] transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Letter container */}
      <div className="flex-1 overflow-auto py-8 print:py-0 print:overflow-visible">
        <div className="mx-auto shadow-lg print:shadow-none bg-white" style={{ width: '210mm', minHeight: '297mm' }}>
          <OfferLetter offer={offer} />
        </div>
      </div>
    </div>
  );
}
