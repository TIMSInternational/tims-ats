'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Modal } from '../../../../../components';
import { AssessmentConsentNotice } from '../../../../../components/assessment-consent-notice';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import { trpc } from '../../../../../lib/trpc';
import { useVacancyAssessments } from '../../../../../lib/platform-api/vacancy-assessments';
import {
  ACCOMMODATION_AIDS,
  AGE_BANDS,
  PROVIDER_INSTRUMENTS,
  TIME_MULTIPLIERS,
  assignErrorCode,
  useAssignProviderAssessments,
  useProviderCatalog,
  type AccommodationAid,
  type ProviderInstrument,
} from '../../../../../lib/platform-api/assessment-providers-staff';
import { AssignProviderTermsStep, type AssignTermsForm } from './assign-provider-terms-step';

const termsSchema = z.object({
  ageBand: z.string().refine((band) => (AGE_BANDS as readonly string[]).includes(band)),
  timeMultiplier: z.string().refine((value) => TIME_MULTIPLIERS.map(String).includes(value)),
  aids: z
    .array(z.string())
    .max(ACCOMMODATION_AIDS.length)
    .refine((aids) => aids.every((aid) => (ACCOMMODATION_AIDS as readonly string[]).includes(aid))),
});

const isProviderInstrument = (instrument: string): instrument is ProviderInstrument =>
  (PROVIDER_INSTRUMENTS as readonly string[]).includes(instrument);

// Assigning a vacancy's tests to one candidate (AS-14): every provider test the vacancy lists and this organization
// may assign, never a hand-picked subset (design §6.3: every candidate gets the same tests and versions; the server
// pins the version). Step 1 sets the conditions; step 2 shows the notice the candidate will read before the provider's
// own consent texts, which HR must acknowledge before anything is sent.
export function AssignProviderAssessmentsModal({
  candidateId,
  vacancy,
  onClose,
}: {
  candidateId: string;
  vacancy: { id: string; title: string };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const ap = t.assignProviderAssessments;
  const requirements = useVacancyAssessments(vacancy.id);
  const catalog = useProviderCatalog(vacancy.id);
  const organization = trpc.organization.getCurrent.useQuery(undefined, { retry: false, staleTime: 5 * 60_000 });
  const assign = useAssignProviderAssessments();
  const [step, setStep] = useState<'terms' | 'consent'>('terms');
  const [acknowledged, setAcknowledged] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const form = useForm<AssignTermsForm>({
    resolver: zodResolver(termsSchema),
    defaultValues: { ageBand: '', timeMultiplier: '1', aids: [] },
  });

  const listed = (requirements.data?.assessments ?? []).map((a) => a.instrument).filter(isProviderInstrument);
  const offered = new Set(catalog.data?.connected ? catalog.data.instruments.map((i) => i.instrument) : []);
  const instruments = listed.filter((instrument) => offered.has(instrument));
  const names = instruments.map((instrument) => t.candidates.fitInstrumentNames[instrument]);

  const submit = form.handleSubmit((values) => {
    setFailure(null);
    assign.mutate(
      {
        candidateId,
        vacancyId: vacancy.id,
        instruments,
        ageBand: values.ageBand as (typeof AGE_BANDS)[number],
        timeMultiplier: Number(values.timeMultiplier),
        aids: values.aids as AccommodationAid[],
      },
      {
        onSuccess: (response) => {
          toast(response.complete ? ap.assigned : ap.partial, { type: response.complete ? 'success' : 'info' });
          onClose();
        },
        onError: (error) => {
          const code = assignErrorCode(error);
          setFailure(code in ap.errors ? ap.errors[code as keyof typeof ap.errors] : ap.errors.unknown);
          toast(ap.errors.unknown, { type: 'error' });
        },
      },
    );
  });

  const body = () => {
    if (requirements.isLoading || catalog.isLoading)
      return <p className="text-[12px] text-[#8B8B8B]">{t.common.loading}</p>;
    if (requirements.isError || catalog.isError) {
      return (
        <p role="alert" className="text-[12px] text-[#B42318]">
          {ap.loadError}
        </p>
      );
    }
    if (instruments.length === 0) return <p className="text-[12px] text-[#585858]">{ap.noInstruments}</p>;
    if (step === 'terms') {
      return (
        <AssignProviderTermsStep form={form} instrumentNames={names} notOffered={listed.length - instruments.length} />
      );
    }
    return (
      <div className="space-y-3">
        <AssessmentConsentNotice
          orgName={organization.data?.name ?? ''}
          vacancyTitle={vacancy.title}
          instruments={names}
        />
        <label className="flex items-start gap-2 text-[12px] text-[#1F114C]">
          <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} />
          <span>{ap.consentAck}</span>
        </label>
      </div>
    );
  };

  const ready = instruments.length > 0 && !requirements.isError && !catalog.isError;
  return (
    <Modal title={`${ap.title}: ${vacancy.title}`} onClose={onClose} maxWidth="max-w-xl">
      <p className="mb-3 text-[11px] font-medium text-[#8B8B8B]" aria-live="polite">
        {step === 'terms' ? ap.stepTerms : ap.stepConsent}
      </p>
      {body()}
      {failure && (
        <p role="alert" className="mt-3 text-[12px] text-[#B42318]">
          {failure}
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={step === 'consent' ? () => setStep('terms') : onClose}
          disabled={assign.isPending}
          className="rounded-lg border border-[#EDEDED] px-4 py-2 text-[12px]"
        >
          {step === 'consent' ? ap.back : t.common.cancel}
        </button>
        {ready && step === 'terms' && (
          <button
            type="button"
            onClick={async () => {
              if (await form.trigger()) setStep('consent');
            }}
            className="rounded-lg bg-[#1F114C] px-4 py-2 text-[12px] font-medium text-white"
          >
            {ap.next}
          </button>
        )}
        {ready && step === 'consent' && (
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!acknowledged || assign.isPending || !organization.data}
            className="rounded-lg bg-[#1F114C] px-4 py-2 text-[12px] font-medium text-white disabled:opacity-50"
          >
            {assign.isPending ? ap.submitting : ap.submit}
          </button>
        )}
      </div>
    </Modal>
  );
}
