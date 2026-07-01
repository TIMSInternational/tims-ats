'use client';

import React from 'react';
import { EmptyState } from '../../../../components/empty-state';

interface TeamComparisonProps {
  t: {
    teamComparisonEmptyTitle: string;
    teamComparisonEmptyBody: string;
  };
}

export function TeamComparison({ t }: TeamComparisonProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <EmptyState
        icon={
          <svg className="w-8 h-8 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
          </svg>
        }
        message={t.teamComparisonEmptyTitle}
        description={t.teamComparisonEmptyBody}
      />
    </div>
  );
}
