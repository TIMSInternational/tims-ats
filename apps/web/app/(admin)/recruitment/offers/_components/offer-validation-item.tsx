'use client';

import { useI18n } from '../../../../../lib/i18n/index';
import { formatDate } from '../../../../../lib/format-utils';
import { StatusBadge } from '../../../../../components/status-badge';
import { validationStatus, validationTypeLabel } from './offer-validation-labels';

export interface OfferValidation {
  id: string;
  type: string;
  status: string;
  isBlocking: boolean;
  completedAt: Date | string | null;
  notes: string | null;
  completedByUser: { id: string; firstName: string; lastName: string } | null;
}

/** One pre-hire validation: its name, whether it blocks hiring, and its status as a word. */
export function OfferValidationItem({ validation }: { validation: OfferValidation }) {
  const { t } = useI18n();
  const status = validationStatus(validation.status, t.offers);
  const by = validation.completedByUser ? `${validation.completedByUser.firstName} ${validation.completedByUser.lastName}` : null;
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body font-medium text-primary">{validationTypeLabel(validation.type, t.offers)}</p>
        <span
          className={`rounded px-1.5 py-0.5 text-caption font-medium ${
            validation.isBlocking ? 'bg-danger-bg text-danger' : 'border border-border bg-surface text-secondary'
          }`}
        >
          {validation.isBlocking ? t.offers.blocking : t.offers.nonBlocking}
        </span>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
        {validation.completedAt && <span className="text-caption text-muted tabular-nums">{formatDate(validation.completedAt)}</span>}
        {by && <span className="text-caption text-secondary">{by}</span>}
      </div>
      {validation.notes && <p className="mt-1 text-callout text-secondary">{validation.notes}</p>}
    </li>
  );
}
