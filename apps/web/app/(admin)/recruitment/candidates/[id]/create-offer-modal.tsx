'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { OFFER_LINK_VALIDITY_DAYS } from '@tims/shared';
import { Modal } from '../../../../../components';
import { useI18n } from '../../../../../lib/i18n';
import { trpc } from '../../../../../lib/trpc';
import { parseVacancySalary, type SalaryPeriod } from '../../../../../lib/offer-salary';
import { describeOfferActionError } from '../../../../../lib/offer-action-error';
import { offerDetailHref } from '../../../../../lib/offer-deep-link';
import { toast } from '../../../../../lib/toast';
import { defaultOfferCurrency } from '../../../../../lib/tenant-locale';
import { useTenantLocale } from '../../../../../lib/tenant-locale-context';
import {
  benefitsFromText,
  benefitsToText,
  buildOfferTerms,
  choiceFor,
  choiceText,
  contractTypeSlugs,
  dateInputValue,
  editableSalary,
  LEGACY_CHOICE,
  offerSalaryState,
  REMOTE_POLICIES,
  termString,
  todayInputValue,
  type Choice,
  type OfferFormApplication,
  type OfferFormSource,
} from './create-offer-form';
import { CreateOfferTermsFields, type OfferTermsValues } from './create-offer-terms-fields';
import { CreateOfferSalaryFields } from './create-offer-salary-fields';

type FormValues = OfferTermsValues & {
  applicationId: string;
  salary: string;
  period: SalaryPeriod;
  currency: string;
  startDate: string;
  contractType: Choice;
};

/**
 * The form state: `currency` null = not chosen yet — the vacancy's own currency, else the tenant's. It is
 * resolved at every render, never frozen when the modal opens: the tenant profile (the admin shell's one
 * organization.getCurrent) can arrive after the modal does, and an offer must not keep the CRC fallback
 * of the first render. The vacancy wizard does the same with its chosen currency.
 */
type FormState = Omit<FormValues, 'currency'> & { currency: string | null };

const INPUT = 'mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]';
const LABEL = 'block text-[12px] font-medium text-[#585858]';

/**
 * The offer form. `mode="create"` (default) creates a draft, optionally starting from `source` (an earlier
 * offer, for "Crear nueva oferta"); `mode="edit"` changes the draft `source` through offer.update (B-04).
 */
export function CreateOfferModal({
  candidateId,
  applications,
  onClose,
  source,
  mode = 'create',
  onSaved,
}: {
  candidateId: string;
  applications: OfferFormApplication[];
  onClose: () => void;
  source?: OfferFormSource;
  mode?: 'create' | 'edit';
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  const tenant = useTenantLocale();
  const router = useRouter();
  const contractLabels = t.portal.contractTypes as Record<string, string>;
  const remoteLabels = t.portal.remotePolicies as Record<string, string>;
  const slugs = contractTypeSlugs();
  const today = todayInputValue();

  const [state, setState] = useState<FormState>(() => {
    const first = applications[0];
    const range = parseVacancySalary(first?.vacancy.salary);
    const salary = source ? editableSalary(source.salary, range?.period ?? 'monthly') : null;
    return {
      applicationId: first?.id ?? '',
      salary: salary?.amount ?? '',
      period: salary?.period ?? range?.period ?? 'monthly',
      currency: source?.currency ?? null,
      startDate: dateInputValue(source?.startDate),
      contractType: choiceFor(source ? source.contractType : first?.vacancy.contractType, slugs, contractLabels),
      schedule: termString(source?.terms, 'schedule'),
      modality: choiceFor(
        source ? termString(source.terms, 'modality') : first?.vacancy.remotePolicy,
        REMOTE_POLICIES,
        remoteLabels,
      ),
      bonus: termString(source?.terms, 'bonus'),
      benefits: benefitsToText(source?.benefits),
    };
  });
  const patch = (next: Partial<FormState>) => setState((current) => ({ ...current, ...next }));
  const [error, setError] = useState<string | null>(null);
  const create = trpc.offer.create.useMutation();
  const update = trpc.offer.update.useMutation();
  const isSaving = create.isPending || update.isPending;

  const application = applications.find((item) => item.id === state.applicationId);
  const values: FormValues = {
    ...state,
    currency:
      state.currency ?? defaultOfferCurrency(parseVacancySalary(application?.vacancy.salary)?.currency, tenant.currency),
  };
  const { annualSalary } = offerSalaryState(values, application?.vacancy.salary);
  const contractType = choiceText(values.contractType, contractLabels);
  const isStartDateValid = values.startDate !== '' && values.startDate >= today;

  // B-33: the reason the submit button is disabled is spelled out.
  const missing = [
    !application ? t.offers.colVacancy : null,
    annualSalary === null ? t.offers.salaryAmount : null,
    !values.startDate ? t.offers.startDate : null,
    !contractType ? t.offers.contractType : null,
  ].filter((label): label is string => label !== null);
  const startDateInPast = values.startDate !== '' && !isStartDateValid;
  const isValid = missing.length === 0 && !startDateInPast;

  const selectApplication = (id: string) => {
    const vacancy = applications.find((item) => item.id === id)?.vacancy;
    const range = parseVacancySalary(vacancy?.salary);
    // A typed amount belongs to the previous vacancy's period/currency — clear it rather than silently
    // reinterpret it (no conversions are invented). A vacancy without salary data falls back to the form
    // defaults (monthly / tenant currency). Contract type and modality follow the newly chosen vacancy.
    patch({
      applicationId: id,
      salary: id !== values.applicationId ? '' : values.salary,
      period: range?.period ?? 'monthly',
      currency: null,
      contractType: choiceFor(vacancy?.contractType, slugs, contractLabels),
      modality: choiceFor(vacancy?.remotePolicy, REMOTE_POLICIES, remoteLabels),
    });
  };

  const handleSubmit = async () => {
    if (!application || !isValid || annualSalary === null) return;
    setError(null);
    const terms = buildOfferTerms(source?.terms, {
      schedule: values.schedule,
      modality: choiceText(values.modality, remoteLabels),
      bonus: values.bonus,
    });
    const benefits = benefitsFromText(values.benefits);
    const common = {
      // Offer.salary is an ANNUAL base salary — convert explicitly from the entered period.
      salary: annualSalary,
      currency: values.currency,
      startDate: new Date(`${values.startDate}T12:00:00`),
      contractType,
      terms,
    };
    try {
      if (mode === 'edit' && source) {
        // An emptied benefits box clears the stored list.
        await update.mutateAsync({ id: source.id, ...common, benefits: benefits ?? {} });
        toast(t.offers.draftUpdated, { type: 'success' });
        onSaved?.();
        onClose();
        return;
      }
      const created = await create.mutateAsync({
        candidateId,
        vacancyId: application.vacancy.id,
        applicationId: application.id,
        ...common,
        ...(benefits ? { benefits } : {}),
      });
      // B-16: confirm, and open the new draft (where the approver is picked) instead of the bare list.
      toast(t.offers.draftCreated, { type: 'success' });
      onClose();
      router.push(created?.id ? offerDetailHref(created.id) : '/recruitment/offers');
    } catch (cause) {
      const message = describeOfferActionError(cause, {
        forbidden: t.offers.errorForbiddenAction,
        generic: t.offers.errorOfferAction,
      });
      setError(message);
      toast(message, { type: 'error' });
    }
  };

  return (
    <Modal title={mode === 'edit' ? t.offers.editDraftTitle : t.offers.createOffer} onClose={onClose}>
      <div className="space-y-4">
        <label className={LABEL}>
          {t.offers.colVacancy} *
          <select
            value={values.applicationId}
            disabled={mode === 'edit' || applications.length < 2}
            onChange={(event) => selectApplication(event.target.value)}
            className={`${INPUT} bg-white text-[#333] disabled:bg-[#FAFAFA]`}
          >
            {applications.map((item) => (
              <option key={item.id} value={item.id}>
                {item.vacancy.title}
              </option>
            ))}
          </select>
        </label>
        <CreateOfferSalaryFields values={values} vacancySalary={application?.vacancy.salary} onChange={patch} />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className={LABEL}>
            {t.offers.startDate} *
            <input
              type="date"
              min={today}
              value={values.startDate}
              onChange={(event) => patch({ startDate: event.target.value })}
              className={INPUT}
            />
          </label>
          <label className={LABEL}>
            {t.offers.contractType} *
            <select
              value={values.contractType.value}
              onChange={(event) =>
                patch({ contractType: { value: event.target.value, legacy: values.contractType.legacy } })
              }
              className={`${INPUT} bg-white`}
            >
              <option value="">{t.offers.contractTypePlaceholder}</option>
              {slugs.map((slug) => (
                <option key={slug} value={slug}>
                  {contractLabels[slug] ?? slug}
                </option>
              ))}
              {values.contractType.legacy && <option value={LEGACY_CHOICE}>{values.contractType.legacy}</option>}
            </select>
          </label>
        </div>
        <CreateOfferTermsFields values={values} onChange={patch} />
        <p className="text-[11px] text-[#8B8B8B]">
          {t.offers.linkValidityHint.replace('{days}', String(OFFER_LINK_VALIDITY_DAYS))}
        </p>
        <p data-testid="offer-form-hint" className="text-[11px] text-[#585858]">
          {startDateInPast
            ? t.offers.startDatePast
            : isValid
              ? t.offers.requiredFieldsHint
              : t.offers.missingFieldsHint.replace('{fields}', missing.join(', '))}
        </p>
        {error && (
          <p role="alert" className="text-[12px] text-[#DD0C15]">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg border border-[#EDEDED] px-4 py-2 text-[12px]"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValid || isSaving}
            className="rounded-lg bg-[#DD0C15] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {mode === 'edit' ? t.offers.saveDraft : t.offers.createOffer}
          </button>
        </div>
      </div>
    </Modal>
  );
}
