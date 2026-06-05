'use client';

import type { AppRouter } from '@tims/api';
import type { inferRouterOutputs } from '@trpc/server';
import type { UseTRPCQueryResult } from '@trpc/react-query/shared';
import type { TRPCClientErrorLike } from '@trpc/client';
import { CandidateAvatar } from '../../../../components';
import { INTERVIEW_TYPES, DURATIONS, inputCls, labelCls, textareaCls } from './schedule-modal.helpers';

type RouterOutput = inferRouterOutputs<AppRouter>;
type ClientError = TRPCClientErrorLike<AppRouter>;

type CandidateSearchResult = UseTRPCQueryResult<RouterOutput['candidate']['search'], ClientError>;
type VacancyListResult = UseTRPCQueryResult<RouterOutput['vacancy']['list'], ClientError>;
type OrgUsersResult = UseTRPCQueryResult<RouterOutput['user']['list'], ClientError>;

interface Step1FieldsProps {
  candidates: CandidateSearchResult;
  candidateSearch: string;
  setCandidateSearch: (value: string) => void;
  selectedCandidateId: string;
  setSelectedCandidateId: (value: string) => void;
  selectedCandidateName: string;
  setSelectedCandidateName: (value: string) => void;
  vacancies: VacancyListResult;
  selectedVacancyId: string;
  setSelectedVacancyId: (value: string) => void;
  setSelectedVacancyTitle: (value: string) => void;
}

export function Step1Fields({
  candidates,
  candidateSearch,
  setCandidateSearch,
  selectedCandidateId,
  setSelectedCandidateId,
  selectedCandidateName,
  setSelectedCandidateName,
  vacancies,
  selectedVacancyId,
  setSelectedVacancyId,
  setSelectedVacancyTitle,
}: Step1FieldsProps) {
  return (
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
  );
}

interface Step2FieldsProps {
  interviewType: string;
  setInterviewType: (value: string) => void;
  scheduledDate: string;
  setScheduledDate: (value: string) => void;
  scheduledTime: string;
  setScheduledTime: (value: string) => void;
  duration: number;
  setDuration: (value: number) => void;
  location: string;
  setLocation: (value: string) => void;
}

export function Step2Fields({
  interviewType,
  setInterviewType,
  scheduledDate,
  setScheduledDate,
  scheduledTime,
  setScheduledTime,
  duration,
  setDuration,
  location,
  setLocation,
}: Step2FieldsProps) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-[13px] font-medium text-[#1F114C] mb-3">Tipo de entrevista</p>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
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

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
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
  );
}

interface Step3FieldsProps {
  orgUsers: OrgUsersResult;
  selectedEvaluatorIds: string[];
  toggleEvaluator: (id: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  selectedCandidateName: string;
  selectedVacancyTitle: string;
  interviewType: string;
  scheduledDate: string;
  scheduledTime: string;
  duration: number;
}

export function Step3Fields({
  orgUsers,
  selectedEvaluatorIds,
  toggleEvaluator,
  notes,
  setNotes,
  selectedCandidateName,
  selectedVacancyTitle,
  interviewType,
  scheduledDate,
  scheduledTime,
  duration,
}: Step3FieldsProps) {
  return (
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
  );
}
