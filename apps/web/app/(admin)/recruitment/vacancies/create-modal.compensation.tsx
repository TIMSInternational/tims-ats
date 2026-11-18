'use client';

import { CHOICE_INPUT_CLASSES, CHOICE_ROW_CLASSES, Field, TextInput } from '../../../../components';
import { positionCountLabel } from './create-modal.helpers';
import { useI18n } from '../../../../lib/i18n';
import {
  enumLabel,
  formatPortalSalary,
  parsePortalSalary,
} from '../../../(portal)/careers/[orgSlug]/_lib/vacancy-display';
import type { SalaryBandStatus } from '../../../../lib/money-amount';
import { SalaryBandFields, type SalaryBandPatch } from './salary-band-fields';

interface Step3Props {
  salaryMin: string;
  salaryMax: string;
  currency: string;
  salaryPeriod: 'monthly' | 'yearly';
  onSalaryChange: (patch: SalaryBandPatch) => void;
  salaryStatus: SalaryBandStatus;
  wideConfirmed: boolean;
  onConfirmWide: (confirmed: boolean) => void;
  slaTargetDays: string;
  setSlaTargetDays: (v: string) => void;
  autoPublish: boolean;
  setAutoPublish: (v: boolean) => void;
  requireApproval: boolean;
  setRequireApproval: (v: boolean) => void;
  title: string;
  location: string;
  remotePolicy: 'onsite' | 'remote' | 'hybrid';
  contractType: string;
  positions: number;
}

export function Step3Compensation({
  salaryMin,
  salaryMax,
  currency,
  salaryPeriod,
  onSalaryChange,
  salaryStatus,
  wideConfirmed,
  onConfirmWide,
  slaTargetDays,
  setSlaTargetDays,
  autoPublish,
  setAutoPublish,
  requireApproval,
  setRequireApproval,
  title,
  location,
  remotePolicy,
  contractType,
  positions,
}: Step3Props) {
  const { t, locale } = useI18n();
  // Same formatter as the vacancy detail and the careers portal: currency code + period, locale grouping.
  // The amounts are what the band parsed (lib/money-amount.ts), never Number() of the typed text.
  const salary = parsePortalSalary({ min: salaryStatus.min, max: salaryStatus.max, currency, period: salaryPeriod });
  const salaryText = salary ? formatPortalSalary(salary, locale, t.portal) : null;
  const remoteLabel = enumLabel(remotePolicy, t.portal.remotePolicies);
  const contractLabel = enumLabel(contractType, t.portal.contractTypes);
  return (
    <div className="space-y-5">
      <section aria-labelledby="create-vacancy-salary-title">
        <h3 id="create-vacancy-salary-title" className="mb-3 text-subheading font-semibold text-brand">
          {t.vacancies.salaryRange}
        </h3>
        <SalaryBandFields
          idPrefix="create-vacancy"
          salaryMin={salaryMin}
          salaryMax={salaryMax}
          currency={currency}
          salaryPeriod={salaryPeriod}
          onChange={onSalaryChange}
          status={salaryStatus}
          wideConfirmed={wideConfirmed}
          onConfirmWide={onConfirmWide}
          gridClassName="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4"
        />
        {salaryText && <p className="mt-2 text-callout text-secondary">{salaryText}</p>}
      </section>

      <section aria-labelledby="create-vacancy-process-title" className="border-t border-border pt-4">
        <h3 id="create-vacancy-process-title" className="mb-3 text-subheading font-semibold text-brand">
          {t.vacancies.processConfig}
        </h3>
        <Field label={t.vacancies.slaObjectiveLabel} className="mb-4 sm:max-w-48">
          <TextInput
            type="number"
            inputMode="numeric"
            value={slaTargetDays}
            onChange={(e) => setSlaTargetDays(e.target.value)}
            min={1}
            max={365}
          />
        </Field>
        <div className="space-y-3">
          <label className={`${CHOICE_ROW_CLASSES} cursor-pointer items-start`}>
            <input
              type="checkbox"
              checked={requireApproval}
              onChange={(e) => setRequireApproval(e.target.checked)}
              aria-describedby="create-vacancy-approval-desc"
              className={`${CHOICE_INPUT_CLASSES} mt-0.5`}
            />
            <span>
              <span className="block">{t.vacancies.requireApprovalLabel}</span>
              <span id="create-vacancy-approval-desc" className="block text-callout text-secondary">
                {t.vacancies.requireApprovalDesc}
              </span>
            </span>
          </label>
          <label
            className={`${CHOICE_ROW_CLASSES} items-start ${requireApproval ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}
          >
            <input
              type="checkbox"
              checked={autoPublish && !requireApproval}
              disabled={requireApproval}
              onChange={(e) => setAutoPublish(e.target.checked)}
              aria-describedby="create-vacancy-autopublish-desc"
              className={`${CHOICE_INPUT_CLASSES} mt-0.5`}
            />
            <span>
              <span className="block">{t.vacancies.autoPublishLabel}</span>
              <span id="create-vacancy-autopublish-desc" className="block text-callout text-secondary">
                {t.vacancies.autoPublishDesc}
              </span>
            </span>
          </label>
          {requireApproval && (
            <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-callout text-warning">
              {t.vacancies.autoPublishNeedsNoApproval}
            </p>
          )}
        </div>
      </section>

      <section aria-labelledby="create-vacancy-summary-title" className="border-t border-border pt-4">
        <h3 id="create-vacancy-summary-title" className="mb-2 text-subheading font-semibold text-brand">
          {t.vacancies.summaryTitle}
        </h3>
        <dl className="space-y-1.5 rounded-lg bg-surface p-3 text-callout">
          <div className="flex justify-between gap-3">
            <dt className="text-secondary">{t.vacancies.summaryRoleLabel}</dt>
            <dd className="text-right font-medium text-primary">{title}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-secondary">{t.vacancies.summaryLocationLabel}</dt>
            <dd className="text-right text-primary">
              {location || '—'} ({remoteLabel})
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-secondary">{t.vacancies.summaryContractLabel}</dt>
            <dd className="text-right text-primary">
              {contractLabel ?? '—'} · {positionCountLabel(positions, t.vacancies)}
            </dd>
          </div>
          {salaryText && (
            <div className="flex justify-between gap-3">
              <dt className="text-secondary">{t.vacancies.summarySalaryLabel}</dt>
              <dd className="text-right text-primary">{salaryText}</dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}
