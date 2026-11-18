'use client';

import { useId } from 'react';
import { Button, CandidateAvatar, Select, StatusBadge, type StatusTone } from '../../../../components';
import { useI18n, formatMessage } from '../../../../lib/i18n';
import { SuccessorCard } from './successor-card';
import type { AdjustmentTarget, CompGapAlert, CriticalRole, SalaryBandOption } from './succession-types';

interface SuccessionRoleCardProps {
  role: CriticalRole;
  bands: SalaryBandOption[];
  compGapAlerts: CompGapAlert[];
  bandPending: boolean;
  onBandChange: (roleId: string, level: string | null) => void;
  onAssign: (roleId: string) => void;
  onRequestAdjustment: (target: AdjustmentTarget) => void;
}

function riskLevel(risk?: number | null): 'high' | 'medium' | 'low' {
  if (!risk || risk < 0.5) return 'low';
  if (risk < 0.8) return 'medium';
  return 'high';
}

const RISK_TONE: Record<'high' | 'medium' | 'low', StatusTone> = { high: 'danger', medium: 'warning', low: 'success' };

/** One critical role: holder, flight-risk chip, target band and its successors. */
export function SuccessionRoleCard({
  role,
  bands,
  compGapAlerts,
  bandPending,
  onBandChange,
  onAssign,
  onRequestAdjustment,
}: SuccessionRoleCardProps) {
  const { t } = useI18n();
  const bandId = useId();
  const noSuccessor = role.successors.length === 0;
  const level = riskLevel(role.flightRisk);
  const riskLabel =
    level === 'high' ? t.succession.riskHigh : level === 'medium' ? t.succession.riskMedium : t.succession.riskLow;

  return (
    <li className={`rounded-lg border p-3 ${noSuccessor ? 'border-danger/40' : 'border-border'}`}>
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {role.currentHolder ? (
            <CandidateAvatar
              firstName={role.currentHolder.firstName}
              lastName={role.currentHolder.lastName}
              avatar={role.currentHolder.avatar}
              size="sm"
              decorative
            />
          ) : (
            <span
              className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-field-border text-muted"
              aria-hidden="true"
            >
              <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0" />
              </svg>
            </span>
          )}
          <div className="min-w-0">
            <h3 className="text-body font-semibold text-brand">{role.title}</h3>
            <p className="text-callout text-secondary">
              {role.currentHolder
                ? `${role.currentHolder.firstName} ${role.currentHolder.lastName}`
                : t.succession.vacant}
            </p>
          </div>
        </div>
        {noSuccessor ? (
          <StatusBadge tone="danger">{t.succession.noSuccessor}</StatusBadge>
        ) : (
          <StatusBadge tone={RISK_TONE[level]}>{riskLabel}</StatusBadge>
        )}
      </div>

      {/* Sprint 1.4 Task 4 — minimal inline target-band control: a single select wired to the
          single-field updateCriticalRoleBand mutation. */}
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:ml-10">
        <label htmlFor={bandId} className="text-callout text-secondary">
          {t.succession.targetBandLabel}
        </label>
        <div className="w-full sm:w-56">
          <Select
            id={bandId}
            value={role.targetBandLevel ?? ''}
            onChange={(e) => onBandChange(role.id, e.target.value || null)}
            disabled={bandPending}
          >
            <option value="">{t.succession.targetBandNone}</option>
            {bands.map((b) => (
              <option key={b.level} value={b.level}>
                {b.title ? `${b.level} — ${b.title}` : b.level}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div className="border-l-2 border-dashed border-border pl-3 sm:ml-4">
        {noSuccessor ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-danger-bg p-3">
            <p className="text-callout font-medium text-danger">{t.succession.noSuccessorsIdentified}</p>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => onAssign(role.id)}
              aria-label={formatMessage(t.succession.assignSuccessorFor, { role: role.title })}
            >
              {t.succession.assignSuccessor}
            </Button>
          </div>
        ) : (
          <ul
            aria-label={formatMessage(t.succession.successorsLabel, { role: role.title })}
            className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3"
          >
            {role.successors.map((s) => (
              <SuccessorCard
                key={s.id}
                successor={s}
                gap={compGapAlerts.find((a) => a.successorId === s.id)}
                onRequestAdjustment={onRequestAdjustment}
              />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}
