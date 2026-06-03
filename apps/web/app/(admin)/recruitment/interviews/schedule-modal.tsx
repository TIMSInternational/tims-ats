'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { Modal, CandidateAvatar } from '../../../../components';

interface ScheduleModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

type Step = 1 | 2 | 3;

const INTERVIEW_TYPES = [
  { value: 'phone', label: 'Telefonica', icon: '📞', desc: 'Llamada rapida de screening' },
  { value: 'video', label: 'Videoconferencia', icon: '📹', desc: 'Entrevista por Daily.co / Meet' },
  { value: 'technical', label: 'Tecnica', icon: '💻', desc: 'Evaluacion de habilidades tecnicas' },
  { value: 'cultural', label: 'Cultural', icon: '🤝', desc: 'Fit cultural y valores' },
  { value: 'panel', label: 'Panel', icon: '👥', desc: 'Multiples evaluadores simultaneos' },
  { value: 'onsite', label: 'Presencial', icon: '🏢', desc: 'Entrevista en oficina' },
];

const DURATIONS = [
  { value: 15, label: '15 min' },
  { value: 30, label: '30 min' },
  { value: 45, label: '45 min' },
  { value: 60, label: '1 hora' },
  { value: 90, label: '1.5 horas' },
  { value: 120, label: '2 horas' },
];

const inputCls = 'w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C]';
const labelCls = 'block text-xs font-medium text-[#585858] mb-1';
const textareaCls = 'w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 focus:border-[#1F114C] resize-none';

export function ScheduleModal({ onClose, onSuccess }: ScheduleModalProps) {
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
      toast('Entrevista agendada exitosamente', { type: 'success' });
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

  const stepLabels = ['Candidato y vacante', 'Tipo y horario', 'Evaluadores y notas'];

  // Default date to tomorrow
  if (!scheduledDate) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    setScheduledDate(tomorrow.toISOString().split('T')[0]!);
  }

  return (
    <Modal title="Agendar Entrevista" onClose={onClose} maxWidth="max-w-2xl">
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
        <div className="space-y-5">
          {/* Candidate search */}
          <div>
            <label className={labelCls}>Candidato *</label>
            {selectedCandidateId ? (
              <div className="flex items-center gap-3 bg-[#F0EEF5] rounded-lg px-3 py-2.5">
                <div className="w-8 h-8 rounded-full bg-[#1F114C] flex items-center justify-center text-white text-[10px] font-bold">
                  {selectedCandidateName.split(' ').map((p) => p[0]).join('').slice(0, 2)}
                </div>
                <span className="text-[13px] text-[#1F114C] font-medium flex-1">{selectedCandidateName}</span>
                <button onClick={() => { setSelectedCandidateId(''); setSelectedCandidateName(''); setCandidateSearch(''); }}
                  className="text-[11px] text-[#8B8B8B] hover:text-[#DD0C15]">Cambiar</button>
              </div>
            ) : (
              <div>
                <input type="text" value={candidateSearch} onChange={(e) => setCandidateSearch(e.target.value)}
                  placeholder="Buscar por nombre o email..." className={inputCls} autoFocus />
                {candidateSearch.length > 0 && (
                  <div className="mt-1 border border-[#EDEDED] rounded-lg max-h-[180px] overflow-y-auto bg-white shadow-sm">
                    {candidates.isLoading && <p className="px-3 py-2 text-[11px] text-[#8B8B8B]">Buscando...</p>}
                    {candidates.data?.length === 0 && <p className="px-3 py-2 text-[11px] text-[#8B8B8B]">Sin resultados</p>}
                    {(candidates.data ?? []).map((c) => (
                      <button key={c.id} onClick={() => { setSelectedCandidateId(c.id); setSelectedCandidateName(`${c.firstName} ${c.lastName}`); setCandidateSearch(''); }}
                        className="w-full text-left px-3 py-2 flex items-center gap-2 hover:bg-[#F6F6F6] transition">
                        <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={null} size="sm" />
                        <div>
                          <p className="text-[12px] text-[#333] font-medium">{c.firstName} {c.lastName}</p>
                          <p className="text-[10px] text-[#8B8B8B]">{c.email}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Vacancy selector */}
          <div>
            <label className={labelCls}>Vacante *</label>
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {(vacancies.data?.items ?? []).map((v) => (
                <button key={v.id} type="button"
                  onClick={() => { setSelectedVacancyId(v.id); setSelectedVacancyTitle(v.title); }}
                  className={`w-full text-left px-3 py-2.5 rounded-lg border text-[12px] transition ${
                    selectedVacancyId === v.id ? 'border-[#1F114C] bg-[#F0EEF5] text-[#1F114C] font-medium' : 'border-[#EDEDED] text-[#585858] hover:bg-[#F6F6F6]'
                  }`}>
                  <span>{v.title}</span>
                  {v.location && <span className="text-[10px] text-[#8B8B8B] ml-2">· {v.location}</span>}
                </button>
              ))}
              {vacancies.isLoading && <p className="text-[11px] text-[#8B8B8B] py-2">Cargando vacantes...</p>}
            </div>
          </div>
        </div>
      )}

      {/* Step 2: Type & Schedule */}
      {step === 2 && (
        <div className="space-y-5">
          <div>
            <p className="text-[13px] font-medium text-[#1F114C] mb-3">Tipo de entrevista</p>
            <div className="grid grid-cols-3 gap-2">
              {INTERVIEW_TYPES.map((it) => (
                <button key={it.value} type="button" onClick={() => setInterviewType(it.value)}
                  className={`text-left px-3 py-3 rounded-lg border transition ${
                    interviewType === it.value ? 'border-[#1F114C] bg-[#F0EEF5]' : 'border-[#EDEDED] hover:bg-[#F6F6F6]'
                  }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[16px]">{it.icon}</span>
                    <span className={`text-[12px] font-medium ${interviewType === it.value ? 'text-[#1F114C]' : 'text-[#333]'}`}>{it.label}</span>
                  </div>
                  <p className="text-[10px] text-[#8B8B8B]">{it.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={labelCls}>Fecha *</label>
              <input type="date" value={scheduledDate} onChange={(e) => setScheduledDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Hora *</label>
              <input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Duracion</label>
              <select value={duration} onChange={(e) => setDuration(parseInt(e.target.value))} className={`${inputCls} bg-white`}>
                {DURATIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <label className={labelCls}>Ubicacion / Link</label>
            <input type="text" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={500} className={inputCls}
              placeholder={interviewType === 'video' ? 'Se generara automaticamente con Daily.co' : interviewType === 'onsite' ? 'Oficina Bogota, Sala 3A' : 'Numero o enlace de reunion'} />
            {interviewType === 'video' && !location && (
              <p className="text-[10px] text-teal-600 mt-1">La sala de video se creara automaticamente al unirse</p>
            )}
          </div>
        </div>
      )}

      {/* Step 3: Evaluators + Notes */}
      {step === 3 && (
        <div className="space-y-5">
          <div>
            <p className="text-[13px] font-medium text-[#1F114C] mb-1">Evaluadores *</p>
            <p className="text-[10px] text-[#8B8B8B] mb-3">Selecciona al menos un evaluador</p>
            <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
              {(orgUsers.data?.users ?? []).map((u) => {
                const isSelected = selectedEvaluatorIds.includes(u.id);
                return (
                  <label key={u.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition ${
                      isSelected ? 'border-[#1F114C] bg-[#F0EEF5]' : 'border-[#EDEDED] hover:bg-[#F6F6F6]'
                    }`}>
                    <input type="checkbox" checked={isSelected} onChange={() => toggleEvaluator(u.id)}
                      className="w-4 h-4 rounded text-[#1F114C] focus:ring-[#1F114C]/20" />
                    <div className="flex items-center gap-2 flex-1">
                      <div className="w-7 h-7 rounded-full bg-[#1F114C] flex items-center justify-center text-white text-[9px] font-bold">
                        {u.firstName[0]}{u.lastName[0]}
                      </div>
                      <div>
                        <p className={`text-[12px] ${isSelected ? 'text-[#1F114C] font-medium' : 'text-[#333]'}`}>{u.firstName} {u.lastName}</p>
                        <p className="text-[10px] text-[#8B8B8B]">{u.jobTitle ?? u.email}</p>
                      </div>
                    </div>
                  </label>
                );
              })}
              {orgUsers.isLoading && <p className="text-[11px] text-[#8B8B8B] py-2">Cargando usuarios...</p>}
            </div>
          </div>

          <div>
            <label className={labelCls}>Notas para los evaluadores</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} rows={3} className={textareaCls}
              placeholder="Instrucciones especiales, competencias a evaluar, contexto del candidato..." />
          </div>

          {/* Summary */}
          <div className="border-t border-[#EDEDED] pt-4">
            <p className="text-[13px] font-medium text-[#1F114C] mb-2">Resumen</p>
            <div className="bg-[#F6F6F6] rounded-lg p-3 space-y-1.5">
              <div className="flex justify-between">
                <span className="text-[12px] text-[#585858]">Candidato:</span>
                <span className="text-[12px] text-[#333] font-medium">{selectedCandidateName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[12px] text-[#585858]">Vacante:</span>
                <span className="text-[12px] text-[#333]">{selectedVacancyTitle}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[12px] text-[#585858]">Tipo:</span>
                <span className="text-[12px] text-[#333]">{INTERVIEW_TYPES.find((t) => t.value === interviewType)?.label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[12px] text-[#585858]">Fecha:</span>
                <span className="text-[12px] text-[#333]">{scheduledDate} a las {scheduledTime} ({DURATIONS.find((d) => d.value === duration)?.label})</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[12px] text-[#585858]">Evaluadores:</span>
                <span className="text-[12px] text-[#333]">{selectedEvaluatorIds.length} seleccionado(s)</span>
              </div>
            </div>
          </div>
        </div>
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
              {isPending ? 'Agendando...' : 'Agendar Entrevista'}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
