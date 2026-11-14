'use client';

import { useState } from 'react';
import { useSuccessionSimulateExit } from '../../../../lib/platform-api/succession';
import {
  CandidateAvatar,
  ErrorState,
  Field,
  Select,
  Skeleton,
  StatusBadge,
  type StatusTone,
} from '../../../../components';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { readinessKey } from './succession-types';

interface CriticalRole {
  id: string;
  title: string;
  currentHolder?: { id: string; firstName: string; lastName: string } | null;
}

interface ExitSimulatorProps {
  roles: CriticalRole[];
}

const IMPACT_TONE: Record<string, StatusTone> = { high: 'danger', medium: 'warning', low: 'neutral' };

/** "What if this person leaves": the real pipeline count and the next successors in line. */
export function ExitSimulator({ roles }: ExitSimulatorProps) {
  const { t } = useI18n();
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? '');
  const sim = useSuccessionSimulateExit(selectedId);

  const selectedRole = roles.find((r) => r.id === selectedId);
  const impactLevel = (level: string) =>
    level === 'high'
      ? t.succession.impactHigh
      : level === 'medium'
        ? t.succession.impactMedium
        : t.succession.impactLow;

  return (
    <section aria-labelledby="exit-simulator" className="rounded-xl border border-border bg-white p-4 shadow-card">
      <h2 id="exit-simulator" className="mb-3 text-heading font-semibold text-brand">
        {t.succession.exitSimulator}
      </h2>

      <Field label={t.succession.whatIfLeaves} className="mb-3">
        <Select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.currentHolder ? `${r.currentHolder.firstName} ${r.currentHolder.lastName} - ` : ''}
              {r.title}
            </option>
          ))}
        </Select>
      </Field>

      {sim.isError ? (
        <ErrorState size="compact" error={sim.error} onRetry={() => sim.refetch()} />
      ) : sim.data ? (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-surface p-3">
            <StatusBadge tone={IMPACT_TONE[sim.data.riskLevel] ?? 'neutral'}>
              {formatMessage(t.succession.impactLabel, { level: impactLevel(sim.data.riskLevel) })}
            </StatusBadge>
            <div className="text-right">
              <p className="text-title font-semibold tabular-nums text-primary">{sim.data.pipelineCount}</p>
              <p className="text-callout text-secondary">{t.succession.directReports}</p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-callout font-semibold text-secondary">{t.succession.nextInLine}</h3>
            {sim.data.successors.length === 0 ? (
              <p className="text-callout text-danger">{sim.data.recommendation}</p>
            ) : (
              <ul className="space-y-2">
                {sim.data.successors.slice(0, 2).map((s) => (
                  <li key={s.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
                    <CandidateAvatar firstName={s.user.firstName} lastName={s.user.lastName} size="sm" decorative />
                    <div className="min-w-0 flex-1">
                      <p className="text-body font-medium text-primary">
                        {s.user.firstName} {s.user.lastName}
                      </p>
                      {s.user.jobTitle && <p className="text-callout text-secondary">{s.user.jobTitle}</p>}
                    </div>
                    <StatusBadge tone={s.readiness === 'ready_now' ? 'success' : 'info'}>
                      {t.succession[readinessKey(s.readiness)]}
                    </StatusBadge>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : selectedRole ? (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t.succession.loadingSimulation}</span>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-11 w-full" />
          <Skeleton className="h-11 w-full" />
        </div>
      ) : (
        <p className="rounded-lg bg-surface p-6 text-center text-callout text-secondary">
          {t.succession.selectRoleToSimulate}
        </p>
      )}
    </section>
  );
}
