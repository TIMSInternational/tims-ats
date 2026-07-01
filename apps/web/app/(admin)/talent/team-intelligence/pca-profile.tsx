'use client';

import React from 'react';
import { EmptyState } from '../../../../components/empty-state';

interface PcaProfileProps {
  t: {
    pcaProfile: string;
    groupAverage: string;
    pcaProfileEmptyTitle: string;
    pcaProfileEmptyBody: string;
  };
}

export function PcaProfile({ t }: PcaProfileProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.pcaProfile}</h3>
        <span className="text-[11px] text-[#8B8B8B]">{t.groupAverage}</span>
      </div>
      <EmptyState
        icon={
          <svg className="w-8 h-8 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
          </svg>
        }
        message={t.pcaProfileEmptyTitle}
        description={t.pcaProfileEmptyBody}
      />
    </div>
  );
}
