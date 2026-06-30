'use client';

import React from 'react';
import { EmptyState } from '../../../../components/empty-state';

interface RecommendedHiresProps {
  t: {
    recommendedHires: string;
    aiPanelEmptyTitle: string;
    aiPanelEmptyBody: string;
  };
}

export function RecommendedHires({ t }: RecommendedHiresProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-[#1F114C]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M18 7.5v3m0 0v3m0-3h3m-3 0h-3m-2.25-4.125a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zM3 19.235v-.11a6.375 6.375 0 0112.75 0v.109A12.318 12.318 0 019.374 21c-2.331 0-4.512-.645-6.374-1.766z" />
        </svg>
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.recommendedHires}</h3>
      </div>
      <EmptyState
        icon={
          <svg className="w-8 h-8 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09Z" />
          </svg>
        }
        message={t.aiPanelEmptyTitle}
        description={t.aiPanelEmptyBody}
      />
    </div>
  );
}
