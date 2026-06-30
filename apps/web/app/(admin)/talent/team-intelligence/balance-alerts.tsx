'use client';

import React from 'react';
import { EmptyState } from '../../../../components/empty-state';

interface BalanceAlertsProps {
  t: {
    balanceAlerts: string;
    aiPanelEmptyTitle: string;
    aiPanelEmptyBody: string;
  };
}

export function BalanceAlerts({ t }: BalanceAlertsProps) {
  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <div className="flex items-center gap-2 mb-3">
        <svg className="w-4 h-4 text-amber-500" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
        </svg>
        <h3 className="text-[14px] font-semibold text-[#1F114C]">{t.balanceAlerts}</h3>
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
