'use client';

import { useState } from 'react';
import { useSuccessionSuggestedSuccessors } from '../../../../lib/platform-api/succession';
import {
  Button,
  CandidateAvatar,
  EmptyState,
  ErrorState,
  Field,
  Select,
  Skeleton,
  StatusBadge,
} from '../../../../components';
import { useI18n } from '../../../../lib/i18n';
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
  onAddSuggested: (prefill: { roleId: string; candidate: PickedUser; readiness: 'ready_now' | 'ready_1_year' }) => void;
}

/**
 * Sprint 1.4 Task 1 — surfaces `succession.getSuggestedSuccessors` as a
 * one-click "Add as successor" list. This is suggestion-only: clicking the
 * button only PRE-FILLS the existing AddSuccessorModal via `onAddSuggested` —
 * it never calls `addSuccessor` directly. The human still reviews and
 * confirms submit in the modal.
 */
export function SuggestedSuccessors({ roles, t, onAddSuggested }: SuggestedSuccessorsProps) {
  const [roleId, setRoleId] = useState('');

  const { t: tAll } = useI18n();
  const suggestions = useSuccessionSuggestedSuccessors(roleId);

  return (
    <section
      aria-labelledby="suggested-successors"
      className="w-full rounded-xl border border-border bg-white p-4 shadow-card"
    >
      <h2 id="suggested-successors" className="mb-1 text-heading font-semibold text-brand">
        {t.suggestedSuccessors}
      </h2>
      <p className="mb-3 text-callout text-secondary">{t.suggestedSuccessorsDesc}</p>

      <Field label={tAll.succession.suggestedRoleLabel} className="mb-3 max-w-md">
        <Select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          <option value="">{t.suggestedSelectRolePlaceholder}</option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </Select>
      </Field>

      {!roleId ? (
        <p className="py-6 text-center text-callout text-secondary">{t.suggestedNoRole}</p>
      ) : suggestions.isLoading ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{tAll.common.loadingContent}</span>
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : suggestions.isError ? (
        <ErrorState size="compact" error={suggestions.error} onRetry={() => suggestions.refetch()} />
      ) : !suggestions.data || suggestions.data.length === 0 ? (
        <EmptyState size="compact" title={t.suggestedEmpty} description={t.suggestedEmptyDesc} />
      ) : (
        <ul className="space-y-2">
          {suggestions.data.map((s) => {
            const quadrantLabel = s.quadrant === 'star' ? t.quadrantStar : t.quadrantHighPotential;
            const readinessLabel = s.suggestedReadiness === 'ready_now' ? t.readinessReadyNow : t.readinessReady1;
            return (
              <li
                key={s.userId}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-2.5"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <CandidateAvatar firstName={s.user.firstName} lastName={s.user.lastName} size="sm" decorative />
                  <div className="min-w-0">
                    <p className="truncate text-body font-medium text-primary">
                      {s.user.firstName} {s.user.lastName}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <StatusBadge tone="success">{quadrantLabel}</StatusBadge>
                      <span className="text-callout text-secondary">{readinessLabel}</span>
                    </div>
                  </div>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    onAddSuggested({
                      roleId,
                      candidate: { id: s.userId, firstName: s.user.firstName, lastName: s.user.lastName },
                      readiness: s.suggestedReadiness,
                    })
                  }
                >
                  {t.suggestedAddAsSuccessor}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
