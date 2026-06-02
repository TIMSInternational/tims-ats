'use client';

import { useI18n } from '../../../../../lib/i18n';

interface RiskItem {
  id: string;
  title: string;
  description: string;
}

// TODO: wire to API when risk detection is implemented
// For now, renders a placeholder when no risks are available
export function RiskFlags({ risks }: { risks?: RiskItem[] }) {
  const { t } = useI18n();

  if (!risks || risks.length === 0) return null;

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)] border border-amber-200">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-3 flex items-center gap-2">
        <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
        </svg>
        {t.candidates.riskFlags}
      </h3>
      <div className="space-y-2">
        {risks.map((risk) => (
          <div key={risk.id} className="flex items-start gap-2">
            <span className="w-2 h-2 rounded-full bg-amber-500 mt-1.5 shrink-0" />
            <span className="text-[12px] text-[#585858]">
              <strong className="text-[#333]">{risk.title}:</strong> {risk.description}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
