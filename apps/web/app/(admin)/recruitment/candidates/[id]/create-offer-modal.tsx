'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '../../../../../components';
import { useI18n } from '../../../../../lib/i18n';
import { trpc } from '../../../../../lib/trpc';
import type { CandidateDetail } from '../../../../../lib/trpc-types';
import {
  annualToPeriod,
  formatMoneyCode,
  parseVacancySalary,
  toAnnualSalary,
  vacancyMidpointIn,
  type SalaryPeriod,
} from '../../../../../lib/offer-salary';
import { describeOfferActionError } from '../../../../../lib/offer-action-error';
import { toast } from '../../../../../lib/toast';

type Application = CandidateDetail['applications'][number];

export function CreateOfferModal({
  candidateId,
  applications,
  onClose,
}: {
  candidateId: string;
  applications: Application[];
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [applicationId, setApplicationId] = useState(applications[0]?.id ?? '');
  const initialRange = parseVacancySalary(applications[0]?.vacancy.salary);
  const [salary, setSalary] = useState('');
  const [period, setPeriod] = useState<SalaryPeriod>(initialRange?.period ?? 'monthly');
  const [currency, setCurrency] = useState(initialRange?.currency ?? 'COP');
  const [startDate, setStartDate] = useState('');
  const [contractType, setContractType] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = trpc.offer.create.useMutation();
  const application = applications.find((item) => item.id === applicationId);
  const vacancyRange = parseVacancySalary(application?.vacancy.salary);
  // The midpoint is a reference in the VACANCY's own currency. It is only offered as the numeric
  // placeholder when the offer currency matches; it is never converted between currencies.
  const referenceCurrency = vacancyRange?.currency ?? null;
  const referenceAmount = referenceCurrency ? vacancyMidpointIn(vacancyRange, period) : null;
  const placeholderAmount = referenceCurrency === currency ? referenceAmount : null;
  const salaryValue = Number(salary);
  const isSalaryValid = salary.trim() !== '' && Number.isFinite(salaryValue) && salaryValue > 0;
  const annualSalary = isSalaryValid ? toAnnualSalary(salaryValue, period) : null;
  const isValid = !!application && annualSalary !== null && !!startDate && !!contractType.trim();

  const selectApplication = (id: string) => {
    // A typed amount belongs to the previous vacancy's period/currency — clear it rather than
    // silently reinterpret it (no conversions are invented).
    if (id !== applicationId) setSalary('');
    setApplicationId(id);
    const range = parseVacancySalary(applications.find((item) => item.id === id)?.vacancy.salary);
    if (range) {
      setPeriod(range.period);
      if (range.currency) setCurrency(range.currency);
    }
  };

  const handleCreate = async () => {
    if (!application || !isValid || annualSalary === null) return;
    setError(null);
    try {
      await create.mutateAsync({
        candidateId,
        vacancyId: application.vacancy.id,
        applicationId,
        // Offer.salary is an ANNUAL base salary — convert explicitly from the entered period.
        salary: annualSalary,
        currency,
        startDate: new Date(`${startDate}T12:00:00`),
        contractType: contractType.trim(),
      });
      onClose();
      router.push('/recruitment/offers');
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
    <Modal title={t.offers.createOffer} onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.offers.colVacancy}
          <select
            value={applicationId}
            onChange={(event) => selectApplication(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[#EDEDED] bg-white p-2 text-[13px] text-[#333]"
          >
            {applications.map((item) => (
              <option key={item.id} value={item.id}>
                {item.vacancy.title}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-3 gap-3">
          <label className="block text-[12px] font-medium text-[#585858]">
            {t.offers.salaryAmount}
            <input
              type="number"
              min="1"
              step="0.01"
              value={salary}
              placeholder={placeholderAmount !== null ? String(placeholderAmount) : undefined}
              onChange={(event) => setSalary(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]"
            />
          </label>
          <label className="block text-[12px] font-medium text-[#585858]">
            {t.offers.salaryPeriod}
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value === 'yearly' ? 'yearly' : 'monthly')}
              className="mt-1 w-full rounded-lg border border-[#EDEDED] bg-white p-2 text-[13px]"
            >
              <option value="monthly">{t.offers.periodMonthly}</option>
              <option value="yearly">{t.offers.periodYearly}</option>
            </select>
          </label>
          <label className="block text-[12px] font-medium text-[#585858]">
            {t.offers.currency}
            <select
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
              className="mt-1 w-full rounded-lg border border-[#EDEDED] bg-white p-2 text-[13px]"
            >
              {Array.from(new Set(['COP', 'USD', 'MXN', currency])).map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>
        {referenceAmount !== null && referenceCurrency !== null && (
          <p data-testid="offer-salary-reference" className="text-[11px] text-[#8B8B8B]">
            {t.offers.salaryPlaceholderHint.replace('{amount}', formatMoneyCode(referenceAmount, referenceCurrency))}
          </p>
        )}
        {annualSalary !== null && (
          <p data-testid="offer-salary-equivalents" className="text-[12px] font-medium text-[#1F114C]">
            {t.offers.salaryEquivalents
              .replace('{annual}', formatMoneyCode(annualSalary, currency))
              .replace('{monthly}', formatMoneyCode(annualToPeriod(annualSalary, 'monthly'), currency))}
          </p>
        )}
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.offers.startDate}
          <input
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]"
          />
        </label>
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.offers.contractType}
          <input
            type="text"
            maxLength={100}
            value={contractType}
            onChange={(event) => setContractType(event.target.value)}
            className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]"
          />
        </label>
        {error && (
          <p role="alert" className="text-[12px] text-[#DD0C15]">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={create.isPending}
            className="rounded-lg border border-[#EDEDED] px-4 py-2 text-[12px]"
          >
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!isValid || create.isPending}
            className="rounded-lg bg-[#DD0C15] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {t.offers.createOffer}
          </button>
        </div>
      </div>
    </Modal>
  );
}
