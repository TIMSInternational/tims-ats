'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Button, ErrorState, Modal, Skeleton, Stepper } from '../../../../../components';
import { useI18n } from '../../../../../lib/i18n';
import { formatMessage } from '../../../../../lib/i18n/format';
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
import { AssignProviderNoticeStep } from './assign-provider-notice-step';
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
// pins the version). Step 1 sets the conditions; step 2 is the notice the candidate will read before the provider's
// own consent texts, as a step of the consent guide (title, "Leer el texto completo", an unchecked acknowledgment), which
// HR must tick before anything is sent. A "Paso n de 2" Stepper says where HR is.
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
  const [readingNotice, setReadingNotice] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const termsRef = useRef<HTMLDivElement>(null);
  const stepRef = useRef<HTMLDivElement>(null);
  const moved = useRef(false);
  const hintId = useId();
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
          // The dialog stays open, so the specific message shows inline (role="alert"); no second, vaguer toast.
          setFailure(code in ap.errors ? ap.errors[code as keyof typeof ap.errors] : ap.errors.unknown);
        },
      },
    );
  });

  const body = () => {
    if (requirements.isLoading || catalog.isLoading)
      return (
        <div aria-busy="true" className="space-y-2">
          <span className="sr-only">{t.common.loadingContent}</span>
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-9 w-full" />
        </div>
      );
    if (requirements.isError || catalog.isError) {
      return (
        <ErrorState
          size="compact"
          title={ap.loadError}
          onRetry={() => {
            if (requirements.isError) void requirements.refetch();
            if (catalog.isError) void catalog.refetch();
          }}
        />
      );
    }
    if (instruments.length === 0) return <p className="text-body text-secondary">{ap.noInstruments}</p>;
    if (step === 'terms') {
      return (
        <div ref={termsRef}>
          <AssignProviderTermsStep
            form={form}
            instrumentNames={names}
            notOffered={listed.length - instruments.length}
          />
        </div>
      );
    }
    return (
      <AssignProviderNoticeStep
        orgName={organization.data?.name ?? ''}
        vacancyTitle={vacancy.title}
        instrumentNames={names}
        acknowledged={acknowledged}
        onAcknowledge={setAcknowledged}
        reading={readingNotice}
        onRead={() => setReadingNotice(true)}
        hintId={hintId}
      />
    );
  };

  const ready = instruments.length > 0 && !requirements.isError && !catalog.isError;
  const steps = [ap.stepTermsLabel, ap.stepConsentLabel];
  const stepIndex = step === 'terms' ? 0 : 1;
  const submitLabel =
    instruments.length === 1 ? ap.submitOne : formatMessage(ap.submitCount, { count: instruments.length });
  // A new step replaces the button that was pressed: the keyboard (and a screen reader) starts on the new step.
  useEffect(() => {
    if (moved.current) stepRef.current?.focus();
  }, [step]);
  const goTo = (next: 'terms' | 'consent') => {
    moved.current = true;
    setReadingNotice(false);
    setStep(next);
  };
  const goToConsent = async () => {
    if (await form.trigger()) {
      goTo('consent');
      return;
    }
    // A missing age band: focus its first radio so the error under it is the next thing read.
    termsRef.current?.querySelector<HTMLInputElement>('input[name="ageBand"]')?.focus();
  };
  return (
    <Modal
      title={`${ap.title}: ${vacancy.title}`}
      onClose={onClose}
      size="lg"
      footer={
        readingNotice ? (
          <Button variant="secondary" onClick={() => setReadingNotice(false)}>
            {ap.closeFull}
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={step === 'consent' ? () => goTo('terms') : onClose}
              disabled={assign.isPending}
            >
              {step === 'consent' ? ap.back : t.common.cancel}
            </Button>
            {ready && step === 'terms' && <Button onClick={() => void goToConsent()}>{ap.next}</Button>}
            {ready && step === 'consent' && (
              <Button
                onClick={() => void submit()}
                disabled={!acknowledged || !organization.data}
                loading={assign.isPending}
                loadingLabel={ap.submitting}
                aria-describedby={acknowledged ? undefined : hintId}
              >
                {submitLabel}
              </Button>
            )}
          </>
        )
      }
    >
      <Stepper steps={steps} current={stepIndex} className="mb-4" />
      <p className="sr-only" aria-live="polite">
        {formatMessage(t.common.stepOf, { current: stepIndex + 1, total: steps.length })} · {steps[stepIndex]}
      </p>
      <div ref={stepRef} tabIndex={-1} className="rounded-lg">
        {body()}
      </div>
      {failure && (
        <p role="alert" className="mt-3 text-callout text-danger">
          {failure}
        </p>
      )}
    </Modal>
  );
}
