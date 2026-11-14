'use client';

import { useI18n } from '../../../../../lib/i18n/index';
import { formatDate } from '../../../../../lib/format-utils';
import { OfferValidationItem, type OfferValidation } from './offer-validation-item';
import { OfferLegalCheckItem, type OfferLegalCheck } from './offer-legal-check-item';
import { validationStatus, validationTypeLabel } from './offer-validation-labels';

interface OfferValidationsProps {
  offerId: string;
  validations: OfferValidation[];
  legalChecks: OfferLegalCheck[];
  readOnly?: boolean;
}

export function OfferValidations({ offerId, validations, legalChecks, readOnly = false }: OfferValidationsProps) {
  const { t } = useI18n();

  const completedValidations = validations.filter((v) => v.status === 'passed' || v.status === 'waived').length;
  const totalValidations = validations.length;
  const completedLegal = legalChecks.filter((c) => c.completed).length;
  const totalLegal = legalChecks.length;

  const fill = (template: string, done: number, total: number) =>
    template.replace('{done}', String(done)).replace('{total}', String(total));
  const card = 'rounded-xl border border-border bg-white p-4 shadow-card md:p-5';
  const audited = validations
    .filter((v) => v.completedAt)
    .sort((a, b) => String(b.completedAt ?? '').localeCompare(String(a.completedAt ?? '')));

  return (
    <div className="space-y-4">
      {/* Validation checklist */}
      <section className={card} aria-labelledby="offer-validations-title">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 id="offer-validations-title" className="text-heading font-semibold text-brand">{t.offers.validationChecklist}</h2>
          <span className="text-callout text-secondary tabular-nums">
            {fill(t.offers.validationsProgress, completedValidations, totalValidations)}
          </span>
        </div>
        {validations.length > 0 ? (
          <ul className="space-y-2">
            {validations.map((v) => (
              <OfferValidationItem key={v.id} validation={v} />
            ))}
          </ul>
        ) : (
          <p className="py-4 text-center text-callout text-secondary">{t.offers.noValidationsConfigured}</p>
        )}
      </section>

      {/* Legal checklist */}
      {legalChecks.length > 0 && (
        <section className={card} aria-labelledby="offer-legal-title">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 id="offer-legal-title" className="text-heading font-semibold text-brand">{t.offers.legalChecklist}</h2>
            <span className="rounded bg-surface px-2 py-0.5 text-caption text-secondary">{t.offers.autoLoadedByCountry}</span>
          </div>
          <ul className="space-y-0.5">
            {legalChecks.map((check) => (
              <OfferLegalCheckItem key={check.id} check={check} offerId={offerId} readOnly={readOnly} />
            ))}
          </ul>
          <p className="mt-3 border-t border-border pt-3 text-callout text-secondary">
            {fill(t.offers.legalProgress, completedLegal, totalLegal)} — {t.offers.managedInOnboarding}
          </p>
        </section>
      )}

      {/* Audit trail */}
      <section className={card} aria-labelledby="offer-audit-title">
        <h2 id="offer-audit-title" className="mb-3 text-heading font-semibold text-brand">{t.offers.auditTrail}</h2>
        {audited.length > 0 ? (
          <ul className="space-y-1.5">
            {audited.map((v) => (
              <li key={v.id} className="flex flex-col gap-0.5 text-callout sm:flex-row sm:items-center sm:gap-3">
                <span className="shrink-0 text-muted tabular-nums sm:w-28">{formatDate(v.completedAt)}</span>
                <span className="text-primary">
                  {v.completedByUser ? `${v.completedByUser.firstName} ${v.completedByUser.lastName}` : t.offers.auditSystemActor}
                  {' — '}
                  {validationTypeLabel(v.type, t.offers)}: {validationStatus(v.status, t.offers).label}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="py-2 text-center text-callout text-secondary">{t.offers.noAuditEvents}</p>
        )}
      </section>
    </div>
  );
}
