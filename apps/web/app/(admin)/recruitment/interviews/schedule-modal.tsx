'use client';

import { useState } from 'react';
import { timeZoneLabel, zonedWallTimeToDate } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';
import { Button } from '../../../../components/button';
import { Stepper } from '../../../../components/stepper';
import { FIELD_LABEL_CLASSES, selectClasses } from '../../../../components/field-styles';
import { type Step, STEP_LABEL_KEYS, defaultInterviewType, locationPayload } from './schedule-modal.helpers';
import { Step1Fields, Step2Fields } from './schedule-modal.fields';
import { Step3Fields } from './schedule-modal.step3';
import { useI18n } from '../../../../lib/i18n';
import { useAssignablePeople } from '../../../../lib/platform-api/assignable-people';

/**
 * Opening the form from a candidate (pipeline card / row, Candidate 360, move toast — A-10): the candidate and
 * the application are known, so the form starts at step 2 and books against that application.
 */
export interface SchedulePrefill {
  candidateId: string;
  candidateName: string;
  /** The candidate's active applications; the first is preselected, the others can be picked in step 2. */
  applications: Array<{ id: string; vacancyId: string; vacancyTitle: string }>;
}

interface ScheduleModalProps {
  onClose: () => void;
  onSuccess: () => void;
  prefill?: SchedulePrefill;
}

/** "YYYY-MM-DD" of tomorrow on the user's own calendar (not UTC: after 18:00 in Costa Rica UTC is
 *  already the next day, so the UTC date skipped a day). */
function localTomorrow(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ScheduleModal({ onClose, onSuccess, prefill }: ScheduleModalProps) {
  const { t, locale } = useI18n();
  const prefilledApp = prefill?.applications[0];
  const [step, setStep] = useState<Step>(prefilledApp ? 2 : 1);

  // Step 1: Who
  const [candidateSearch, setCandidateSearch] = useState('');
  const [selectedCandidateId, setSelectedCandidateId] = useState(prefilledApp ? (prefill?.candidateId ?? '') : '');
  const [selectedCandidateName, setSelectedCandidateName] = useState(prefilledApp ? (prefill?.candidateName ?? '') : '');
  const [selectedVacancyId, setSelectedVacancyId] = useState(prefilledApp?.vacancyId ?? '');
  const [selectedVacancyTitle, setSelectedVacancyTitle] = useState(prefilledApp?.vacancyTitle ?? '');
  const [selectedApplicationId, setSelectedApplicationId] = useState(prefilledApp?.id ?? '');
  const pickApplication = (applicationId: string) => {
    const app = prefill?.applications.find((a) => a.id === applicationId);
    if (!app) return;
    setSelectedApplicationId(app.id);
    setSelectedVacancyId(app.vacancyId);
    setSelectedVacancyTitle(app.vacancyTitle);
  };

  // Step 2: What & When
  const [interviewType, setInterviewType] = useState(() => defaultInterviewType());
  const [scheduledDate, setScheduledDate] = useState(localTomorrow);
  const [scheduledTime, setScheduledTime] = useState('10:00');
  const [duration, setDuration] = useState(60);
  const [location, setLocation] = useState('');

  // Step 3: Who evaluates + notes
  const [selectedEvaluatorIds, setSelectedEvaluatorIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');

  // Queries
  const candidates = trpc.candidate.search.useQuery(
    { query: candidateSearch || 'a', limit: 10 },
    { enabled: candidateSearch.length > 0, staleTime: 10_000 },
  );

  const vacancies = trpc.vacancy.list.useQuery(
    { limit: 20, status: 'published' },
    { staleTime: 60_000 },
  );

  // The zone the typed time means — the chain the invitation emails print: the organization's, then the
  // selected vacancy's company, then UTC said explicitly. Read from interview.list (filtered to the
  // vacancy, one row) rather than a procedure of its own. The browser's zone plays no part (A-17).
  const zoneQuery = trpc.interview.list.useQuery(
    { vacancyId: selectedVacancyId, pageSize: 1 },
    { enabled: selectedVacancyId !== '', staleTime: 5 * 60_000 },
  );
  const schedulingTimeZone = zoneQuery.data?.schedulingTimeZone ?? null;
  const isTimeZoneError = zoneQuery.isError;
  const timeZone = schedulingTimeZone?.timeZone ?? null;
  const labelLocale = locale === 'EN' ? 'en' : 'es';
  const scheduledAt = timeZone ? zonedWallTimeToDate(scheduledDate, scheduledTime, timeZone) : null;
  const zoneLabel = timeZone
    ? timeZoneLabel(timeZone, labelLocale, scheduledAt ?? new Date())
    : isTimeZoneError
      ? t.common.error
      : t.common.loading;
  const whenLabel =
    scheduledAt && timeZone
      ? `${new Intl.DateTimeFormat(labelLocale === 'en' ? 'en-US' : 'es-CR', {
          dateStyle: 'full',
          timeStyle: 'short',
          timeZone,
        }).format(scheduledAt)}, ${zoneLabel}`
      : '';

  // Evaluators come from the tenant people directory (interview:create), not user.list (user:read),
  // which recruiters do not hold.
  const evaluators = useAssignablePeople({ purpose: 'interview_evaluator', limit: 50 });

  const createInterview = trpc.interview.schedule.useMutation();

  const isStep1Valid = selectedCandidateId && selectedVacancyId;
  const isStep2Valid = interviewType && scheduledDate && scheduledTime && scheduledAt !== null;
  const isStep3Valid = selectedEvaluatorIds.length > 0;
  const isPending = createInterview.isPending;

  const handleSubmit = async () => {
    if (!isStep1Valid || !isStep2Valid || !isStep3Valid || !scheduledAt) return;
    try {
      const created = await createInterview.mutateAsync({
        candidateId: selectedCandidateId,
        vacancyId: selectedVacancyId,
        ...(prefill && selectedApplicationId ? { applicationId: selectedApplicationId } : {}),
        type: interviewType,
        scheduledAt,
        duration,
        ...locationPayload(location),
        notes: notes.trim() || undefined,
        evaluatorIds: selectedEvaluatorIds,
      });
      toast(t.interviews.scheduledSuccess, { type: 'success' });
      if (created.candidateNotNotifiedReason === 'consent_withdrawn') {
        toast(t.consentGuard.interviewNotNotified, { type: 'warning', duration: 8000 });
      }
      onSuccess();
    } catch (err) {
      toast(err instanceof Error ? err.message : t.interviews.scheduleError, { type: 'error' });
    }
  };

  const toggleEvaluator = (id: string) => {
    setSelectedEvaluatorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const firstStep: Step = prefill ? 2 : 1;
  const footer = (
    <>
      {step > firstStep && (
        <Button variant="tertiary" className="sm:mr-auto" onClick={() => setStep((step - 1) as Step)}
          icon={<svg className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>}>
          {t.common.back}
        </Button>
      )}
      <Button variant="secondary" onClick={onClose}>
        {t.common.cancel}
      </Button>
      {step < 3 ? (
        <Button
          onClick={() => setStep((step + 1) as Step)}
          disabled={(step === 1 && !isStep1Valid) || (step === 2 && !isStep2Valid)}
        >
          {t.common.next}
        </Button>
      ) : (
        <Button onClick={handleSubmit} disabled={!isStep3Valid} loading={isPending} loadingLabel={t.portal.scheduling}>
          {t.interviews.modalTitle}
        </Button>
      )}
    </>
  );

  return (
    <Modal title={t.interviews.modalTitle} onClose={onClose} size="lg" footer={footer}>
      <Stepper steps={STEP_LABEL_KEYS.map((key) => t.interviews[key])} current={step - 1} className="mb-6" />

      {/* Step 1: Candidate + Vacancy */}
      {step === 1 && (
        <Step1Fields
          candidates={candidates}
          candidateSearch={candidateSearch}
          setCandidateSearch={setCandidateSearch}
          selectedCandidateId={selectedCandidateId}
          setSelectedCandidateId={setSelectedCandidateId}
          selectedCandidateName={selectedCandidateName}
          setSelectedCandidateName={setSelectedCandidateName}
          vacancies={vacancies}
          selectedVacancyId={selectedVacancyId}
          setSelectedVacancyId={setSelectedVacancyId}
          setSelectedVacancyTitle={setSelectedVacancyTitle}
        />
      )}

      {/* Prefilled from a candidate: who and for which application, instead of step 1 */}
      {prefill && step === 2 && (
        <div className="mb-4 rounded-lg bg-surface px-3 py-2">
          {prefill.applications.length > 1 ? (
            <label className={`${FIELD_LABEL_CLASSES} mb-0`}>
              {t.candidates.scheduleForApplication} · {prefill.candidateName}
              <select
                value={selectedApplicationId}
                onChange={(e) => pickApplication(e.target.value)}
                className={selectClasses('md', 'mt-1.5 font-normal')}
              >
                {prefill.applications.map((app) => (
                  <option key={app.id} value={app.id}>
                    {app.vacancyTitle}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="text-callout text-primary">
              {t.candidates.scheduleSummary.replace('{candidate}', prefill.candidateName).replace('{vacancy}', selectedVacancyTitle)}
            </p>
          )}
        </div>
      )}

      {/* Step 2: Type & Schedule */}
      {step === 2 && (
        <Step2Fields
          interviewType={interviewType}
          setInterviewType={setInterviewType}
          scheduledDate={scheduledDate}
          setScheduledDate={setScheduledDate}
          scheduledTime={scheduledTime}
          setScheduledTime={setScheduledTime}
          duration={duration}
          setDuration={setDuration}
          location={location}
          setLocation={setLocation}
          timeZoneLabel={zoneLabel}
          isUtcFallback={schedulingTimeZone?.source === 'utc'}
        />
      )}

      {/* Step 3: Evaluators + Notes */}
      {step === 3 && (
        <Step3Fields
          evaluators={evaluators}
          selectedEvaluatorIds={selectedEvaluatorIds}
          toggleEvaluator={toggleEvaluator}
          notes={notes}
          setNotes={setNotes}
          selectedCandidateName={selectedCandidateName}
          selectedVacancyTitle={selectedVacancyTitle}
          interviewType={interviewType}
          whenLabel={whenLabel}
          duration={duration}
        />
      )}

    </Modal>
  );
}
