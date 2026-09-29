'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Modal } from '../../../../../components';
import { useI18n } from '../../../../../lib/i18n';
import { trpc } from '../../../../../lib/trpc';
import type { CandidateDetail } from '../../../../../lib/trpc-types';

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
  const [salary, setSalary] = useState('');
  const [currency, setCurrency] = useState('COP');
  const [startDate, setStartDate] = useState('');
  const [contractType, setContractType] = useState('');
  const [error, setError] = useState<string | null>(null);
  const create = trpc.offer.create.useMutation();
  const application = applications.find((item) => item.id === applicationId);
  const salaryValue = Number(salary);
  const isValid = !!application && Number.isFinite(salaryValue) && salaryValue > 0 && !!startDate && !!contractType.trim();

  const handleCreate = async () => {
    if (!application || !isValid) return;
    setError(null);
    try {
      await create.mutateAsync({
        candidateId,
        vacancyId: application.vacancy.id,
        applicationId,
        salary: salaryValue,
        currency,
        startDate: new Date(`${startDate}T12:00:00`),
        contractType: contractType.trim(),
      });
      onClose();
      router.push('/recruitment/offers');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t.common.error);
    }
  };

  return (
    <Modal title={t.offers.createOffer} onClose={onClose}>
      <div className="space-y-4">
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.offers.colVacancy}
          <select value={applicationId} onChange={(event) => setApplicationId(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] bg-white p-2 text-[13px] text-[#333]">
            {applications.map((item) => <option key={item.id} value={item.id}>{item.vacancy.title}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-[12px] font-medium text-[#585858]">
            {t.offers.annualBaseSalary}
            <input type="number" min="1" step="0.01" value={salary} onChange={(event) => setSalary(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]" />
          </label>
          <label className="block text-[12px] font-medium text-[#585858]">
            {t.offers.currency}
            <select value={currency} onChange={(event) => setCurrency(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] bg-white p-2 text-[13px]">
              <option value="COP">COP</option>
              <option value="USD">USD</option>
              <option value="MXN">MXN</option>
            </select>
          </label>
        </div>
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.offers.startDate}
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]" />
        </label>
        <label className="block text-[12px] font-medium text-[#585858]">
          {t.offers.contractType}
          <input type="text" maxLength={100} value={contractType} onChange={(event) => setContractType(event.target.value)} className="mt-1 w-full rounded-lg border border-[#EDEDED] p-2 text-[13px]" />
        </label>
        {error && <p role="alert" className="text-[12px] text-[#DD0C15]">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={create.isPending} className="rounded-lg border border-[#EDEDED] px-4 py-2 text-[12px]">{t.common.cancel}</button>
          <button type="button" onClick={handleCreate} disabled={!isValid || create.isPending} className="rounded-lg bg-[#DD0C15] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50">{t.offers.createOffer}</button>
        </div>
      </div>
    </Modal>
  );
}
