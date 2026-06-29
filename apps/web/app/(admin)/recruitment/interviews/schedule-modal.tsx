'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';
import { type Step, stepLabels } from './schedule-modal.helpers';
import { Step1Fields, Step2Fields, Step3Fields } from './schedule-modal.fields';
import { useI18n } from '../../../../lib/i18n';

interface ScheduleModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function ScheduleModal({ onClose, onSuccess }: ScheduleModalProps) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>(1);

  // Step 1: Who
  const [candidateSearch, setCandidateSearch] = useState('');
  const [selectedCandidateId, setSelectedCandidateId] = useState('');
  const [selectedCandidateName, setSelectedCandidateName] = useState('');
  const [selectedVacancyId, setSelectedVacancyId] = useState('');
  const [selectedVacancyTitle, setSelectedVacancyTitle] = useState('');

  // Step 2: What & When
  const [interviewType, setInterviewType] = useState('video');
  const [scheduledDate, setScheduledDate] = useState('');
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

  const orgUsers = trpc.user.list.useQuery(
    { limit: 50 },
    { staleTime: 60_000 },
  );

  const createInterview = trpc.interview.schedule.useMutation();

  const isStep1Valid = selectedCandidateId && selectedVacancyId;
  const isStep2Valid = interviewType && scheduledDate && scheduledTime;
  const isStep3Valid = selectedEvaluatorIds.length > 0;
  const isPending = createInterview.isPending;

  const handleSubmit = async () => {
    if (!isStep1Valid || !isStep2Valid || !isStep3Valid) return;
    try {
      const scheduledAt = new Date(`${scheduledDate}T${scheduledTime}`);
      await createInterview.mutateAsync({
        candidateId: selectedCandidateId,
        vacancyId: selectedVacancyId,
        type: interviewType,
        scheduledAt,
        duration,
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
        evaluatorIds: selectedEvaluatorIds,
      });
      toast(t.interviews.scheduledSuccess, { type: 'success' });
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

  // Default date to tomorrow
  if (!scheduledDate) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setScheduledDate(tomorrow.toISOString().split('T')[0]!);
  }

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
        />
      )}

      {/* Step 3: Evaluators + Notes */}
      {step === 3 && (
        <Step3Fields
          orgUsers={orgUsers}
          selectedEvaluatorIds={selectedEvaluatorIds}
          toggleEvaluator={toggleEvaluator}
          notes={notes}
          setNotes={setNotes}
          selectedCandidateName={selectedCandidateName}
          selectedVacancyTitle={selectedVacancyTitle}
          interviewType={interviewType}
          scheduledDate={scheduledDate}
          scheduledTime={scheduledTime}
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
