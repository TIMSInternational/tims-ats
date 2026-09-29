'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../../../../lib/i18n';

/** Breadcrumb bar shared by the business-units screens; `actions` renders on the right. */
export function UnitsTopBar({ actions }: { actions?: ReactNode }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-[#8B8B8B]">{t.units.breadcrumbParent}</span>
        <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="m9 18 6-6-6-6" />
        </svg>
        <span className="text-sm font-medium text-[#1F114C]">{t.units.title}</span>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
