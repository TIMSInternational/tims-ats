'use client';

import { useState } from 'react';
import { timeZoneLabel, zonedWallTimeToDate } from '@tims/shared';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';
import { type Step, stepLabels, defaultInterviewType, locationPayload } from './schedule-modal.helpers';
import { Step1Fields, Step2Fields, Step3Fields } from './schedule-modal.fields';
import { useI18n } from '../../../../lib/i18n';
import { useAssignablePeople } from '../../../../lib/platform-api/assignable-people';

export type SchedulingTimeZone = { timeZone: string; source: 'organization' | 'utc' };

interface ScheduleModalProps {
  onClose: () => void;
  onSuccess: () => void;
  /** From interview.list: the organization's zone, else UTC. Null while loading (submit stays disabled). */
  schedulingTimeZone: SchedulingTimeZone | null;
  isTimeZoneError?: boolean;
}

/** "YYYY-MM-DD" of tomorrow on the user's own calendar (not UTC: after 18:00 in Costa Rica UTC is
 *  already the next day, so the UTC date skipped a day). */
function localTomorrow(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function ScheduleModal({ onClose, onSuccess, schedulingTimeZone, isTimeZoneError = false }: ScheduleModalProps) {
  const { t, locale } = useI18n();
  const [step, setStep] = useState<Step>(1);

  // Step 1: Who
  const [candidateSearch, setCandidateSearch] = useState('');
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [selectedCandidateName, setSelectedCandidateName] = useState('');
  const [selectedVacancyId, setSelectedVacancyId] = useState('');
  const [selectedVacancyTitle, setSelectedVacancyTitle] = useState('');

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

  // The zone the typed time means — the organization's, as the invitation emails print it (UTC, said
  // explicitly, when the organization has none). The browser's own zone plays no part (A-17).
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
      toast(err instanceof Error ? err.message : 'Error al agendar', { type: 'error' });
    }
  };

  const toggleEvaluator = (id: string) => {
    setSelectedEvaluatorIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  return (
    <Modal title={t.interviews.modalTitle} onClose={onClose} maxWidth="max-w-2xl">
      {/* Step indicator */}
      <div className="flex items-center gap-2 mb-6">
        {stepLabels.map((label, i) => (
          <div key={i} className="flex items-center gap-2 flex-1">
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${
              step > i + 1 ? 'bg-green-500 text-white' : step === i + 1 ? 'bg-[#1F114C] text-white' : 'bg-[#EDEDED] text-[#8B8B8B]'
            }`}>
              {step > i + 1 ? '✓' : i + 1}
            </div>
            <span className={`text-[11px] ${step === i + 1 ? 'text-[#1F114C] font-medium' : 'text-[#8B8B8B]'}`}>{label}</span>
            {i < 2 && <div className={`flex-1 h-[1px] ${step > i + 1 ? 'bg-green-500' : 'bg-[#EDEDED]'}`} />}
          </div>
        ))}
      </div>

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

      {/* Navigation */}
      <div className="flex items-center justify-between mt-6 pt-4 border-t border-[#EDEDED]">
        <div>
          {step > 1 && (
            <button onClick={() => setStep((step - 1) as Step)} className="text-[12px] text-[#585858] hover:text-[#1F114C] transition flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
              Anterior
            </button>
          )}
        </div>
        <div className="flex gap-3">
          <button onClick={onClose} className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition">
            Cancelar
          </button>
          {step < 3 ? (
            <button
              onClick={() => setStep((step + 1) as Step)}
              disabled={(step === 1 && !isStep1Valid) || (step === 2 && !isStep2Valid)}
              className="h-9 px-5 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1a5c] transition disabled:opacity-50 flex items-center gap-1">
              Siguiente
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
            </button>
          ) : (
            <button onClick={handleSubmit} disabled={!isStep3Valid || isPending}
              className="h-9 px-5 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50 flex items-center gap-2">
              {isPending ? t.portal.scheduling : t.interviews.modalTitle}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
