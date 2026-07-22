'use client';

import { useState } from 'react';
import { useSuccessionSuggestedSuccessors } from '../../../../lib/platform-api/succession';
import { Skeleton, ErrorState } from '../../../../components';
import { EmptyState } from '../../../../components/empty-state';
import type { PickedUser } from '../../../../components/user-picker';

interface SuggestedSuccessorsProps {
  roles: { id: string; title: string }[];
  t: {
    suggestedSuccessors: string;
    suggestedSuccessorsDesc: string;
    suggestedSelectRolePlaceholder: string;
    suggestedNoRole: string;
    suggestedEmpty: string;
    suggestedEmptyDesc: string;
    suggestedAddAsSuccessor: string;
    quadrantStar: string;
    quadrantHighPotential: string;
    readinessReadyNow: string;
    readinessReady1: string;
    loadError: string;
  };
  onAddSuggested: (prefill: {
    roleId: string;
    candidate: PickedUser;
    readiness: 'ready_now' | 'ready_1_year';
  }) => void;
}

function getInitials(first: string, last: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

const QUADRANT_STYLES: Record<string, { bg: string; text: string }> = {
  star: { bg: 'bg-green-50', text: 'text-green-700' },
  high_potential: { bg: 'bg-amber-50', text: 'text-amber-700' },
};

/**
 * Sprint 1.4 Task 1 — surfaces `succession.getSuggestedSuccessors` as a
 * one-click "Add as successor" list. This is suggestion-only: clicking the
 * button only PRE-FILLS the existing AddSuccessorModal via `onAddSuggested` —
 * it never calls `addSuccessor` directly. The human still reviews and
 * confirms submit in the modal.
 */
export function SuggestedSuccessors({ roles, t, onAddSuggested }: SuggestedSuccessorsProps) {
  const [roleId, setRoleId] = useState('');

  const suggestions = useSuccessionSuggestedSuccessors(roleId);

  return (
    <div className="w-full bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
      <div className="flex items-center justify-between mb-1">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.suggestedSuccessors}</h3>
      </div>
      <p className="text-[10px] text-[#8B8B8B] mb-3">{t.suggestedSuccessorsDesc}</p>

      <select
        value={roleId}
        onChange={(e) => setRoleId(e.target.value)}
        className="w-full border border-[#EDEDED] rounded-lg px-3 py-2 text-[12px] text-[#333] bg-white focus:outline-none focus:border-[#1F114C]/40 mb-3"
      >
        <option value="">{t.suggestedSelectRolePlaceholder}</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.title}
          </option>
        ))}
      </select>

      {!roleId ? (
        <p className="text-[11px] text-[#8B8B8B] text-center py-6">{t.suggestedNoRole}</p>
      ) : suggestions.isLoading ? (
        <>
          <Skeleton className="h-10 w-full mb-2" />
          <Skeleton className="h-10 w-full mb-2" />
        </>
      ) : suggestions.isError ? (
        <ErrorState />
      ) : !suggestions.data || suggestions.data.length === 0 ? (
        <EmptyState
          icon={
            <svg className="w-8 h-8 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M9.53 16.122a3 3 0 0 0-5.78 1.128 2.25 2.25 0 0 1-2.4 2.245 4.5 4.5 0 0 0 8.4-2.245c0-.399-.078-.78-.22-1.128Zm0 0a15.998 15.998 0 0 0 3.388-1.62m-5.043-.025a15.994 15.994 0 0 1 1.622-3.395m3.42 3.42a15.995 15.995 0 0 0 4.764-4.648l3.876-5.814a1.151 1.151 0 0 0-1.597-1.597L14.146 6.32a15.996 15.996 0 0 0-4.649 4.763m3.42 3.42a6.776 6.776 0 0 0-3.42-3.42" />
            </svg>
          }
          message={t.suggestedEmpty}
          description={t.suggestedEmptyDesc}
        />
      ) : (
        <div className="space-y-2">
          {suggestions.data.map((s) => {
            const style = QUADRANT_STYLES[s.quadrant] ?? QUADRANT_STYLES.star;
            const quadrantLabel = s.quadrant === 'star' ? t.quadrantStar : t.quadrantHighPotential;
            const readinessLabel =
              s.suggestedReadiness === 'ready_now' ? t.readinessReadyNow : t.readinessReady1;
            return (
              <div
                key={s.userId}
                className="flex items-center justify-between border border-[#EDEDED] rounded-lg p-2.5"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-8 h-8 rounded-full bg-[#1F114C] flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                    {getInitials(s.user.firstName, s.user.lastName)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-[#333] truncate">
                      {s.user.firstName} {s.user.lastName}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] ${style.bg} ${style.text} px-1.5 py-0.5 rounded-full font-medium`}>
                        {quadrantLabel}
                      </span>
                      <span className="text-[9px] text-[#8B8B8B]">{readinessLabel}</span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onAddSuggested({
                      roleId,
                      candidate: { id: s.userId, firstName: s.user.firstName, lastName: s.user.lastName },
                      readiness: s.suggestedReadiness,
                    })
                  }
                  className="shrink-0 text-[10px] text-white bg-[#1F114C] px-2.5 py-1.5 rounded-lg font-medium hover:bg-[#2a1866] transition"
                >
                  {t.suggestedAddAsSuccessor}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
