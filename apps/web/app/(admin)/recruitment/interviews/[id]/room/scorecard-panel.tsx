'use client';

import { useState } from 'react';

const COMPETENCIES = [
  { id: 'leadership', label: 'Liderazgo Tecnico', aiQuestion: 'Describe una situacion donde tuviste que tomar una decision tecnica impopular. Como la comunicaste al equipo?' },
  { id: 'analytical', label: 'Pensamiento Analitico', aiQuestion: 'Cuentame sobre un problema complejo que descompusiste en partes manejables. Cual fue tu enfoque?' },
  { id: 'communication', label: 'Comunicacion', aiQuestion: 'Cuentame sobre una vez que tuviste que explicar un concepto tecnico complejo a un stakeholder no tecnico. Que enfoque usaste?' },
  { id: 'problem_solving', label: 'Resolucion de Problemas', aiQuestion: 'Describe el bug mas complejo que hayas resuelto. Cual fue tu proceso de debugging?' },
];

const TABS = ['Scorecard', 'AI Coach', 'Notas', 'Candidato'] as const;
type Tab = (typeof TABS)[number];

interface ScorecardPanelProps {
  candidateName: string;
  candidateInitials: string;
  vacancyTitle: string;
  fitScore?: number;
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex gap-1">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className={`w-4 h-4 cursor-pointer transition-colors ${
            star <= value ? 'text-amber-400' : 'text-[#EDEDED] hover:text-amber-300'
          }`}
          fill="currentColor"
          viewBox="0 0 24 24"
          onClick={() => onChange(star)}
        >
          <path d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" />
        </svg>
      ))}
    </div>
  );
}

export function ScorecardPanel({ candidateName, candidateInitials, vacancyTitle, fitScore }: ScorecardPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('Scorecard');
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});

  const ratedCount = Object.values(ratings).filter((r) => r > 0).length;
  const progress = Math.round((ratedCount / COMPETENCIES.length) * 100);

  const setRating = (id: string, value: number) => setRatings((prev) => ({ ...prev, [id]: value }));
  const setNote = (id: string, value: string) => setNotes((prev) => ({ ...prev, [id]: value }));

  return (
    <div className="flex-1 md:flex-[40] flex flex-col bg-white border-t md:border-t-0 md:border-l border-[#EDEDED] min-h-0">
      {/* Tabs */}
      <div className="flex border-b border-[#EDEDED] shrink-0">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-3 text-[12px] font-medium text-center transition-colors ${
              activeTab === tab
                ? 'text-[#1F114C] border-b-2 border-[#DD0C15]'
                : 'text-[#8B8B8B] hover:text-[#585858]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4 scrollbar-thin">
        {activeTab === 'Scorecard' && (
          <ScorecardTabContent
            candidateName={candidateName}
            candidateInitials={candidateInitials}
            vacancyTitle={vacancyTitle}
            fitScore={fitScore}
            ratings={ratings}
            notes={notes}
            onRate={setRating}
            onNote={setNote}
          />
        )}
        {activeTab === 'AI Coach' && <AiCoachTab />}
        {activeTab === 'Notas' && <NotasTab />}
        {activeTab === 'Candidato' && <CandidatoTab candidateName={candidateName} candidateInitials={candidateInitials} />}
      </div>

      {/* Submit footer */}
      {activeTab === 'Scorecard' && (
        <div className="p-4 border-t border-[#EDEDED] shrink-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[11px] text-[#8B8B8B]">{ratedCount} de {COMPETENCIES.length} competencias evaluadas</span>
            <div className="w-32 bg-[#EDEDED] rounded-full h-1.5">
              <div className="h-1.5 bg-[#DD0C15] rounded-full transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
          <button className="w-full bg-[#DD0C15] text-white py-2.5 rounded-lg text-[13px] font-medium shadow-[0_2px_8px_rgba(221,12,21,0.25)] hover:bg-[#c00b13] transition-colors">
            Enviar Scorecard
          </button>
        </div>
      )}
    </div>
  );
}

/* ---- Scorecard Tab ---- */
function ScorecardTabContent({
  candidateName, candidateInitials, vacancyTitle, fitScore,
  ratings, notes, onRate, onNote,
}: {
  candidateName: string; candidateInitials: string; vacancyTitle: string; fitScore?: number;
  ratings: Record<string, number>; notes: Record<string, string>;
  onRate: (id: string, v: number) => void; onNote: (id: string, v: string) => void;
}) {
  return (
    <>
      {/* Candidate quick info */}
      <div className="bg-[#F6F6F6] rounded-lg p-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-[#1F114C] flex items-center justify-center text-white text-[12px] font-bold">{candidateInitials}</div>
          <div className="flex-1">
            <p className="text-[13px] font-medium text-[#333]">{candidateName}</p>
            <p className="text-[11px] text-[#8B8B8B]">{vacancyTitle}{fitScore != null ? ` — FIT: ${fitScore}` : ''}</p>
          </div>
        </div>
      </div>

      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">Evaluacion por Competencia</h3>

      {/* Competency cards */}
      {COMPETENCIES.map((comp) => {
        const rated = (ratings[comp.id] ?? 0) > 0;
        return (
          <div key={comp.id} className={`mb-4 rounded-lg p-3 border ${rated ? 'bg-[#F9FAFB] border-[#F0F0F0]' : 'bg-white border-[#EDEDED]'}`}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-[12px] font-medium text-[#333]">{comp.label}</span>
              <StarRating value={ratings[comp.id] ?? 0} onChange={(v) => onRate(comp.id, v)} />
            </div>
            <textarea
              placeholder="Evidencia observada..."
              value={notes[comp.id] ?? ''}
              onChange={(e) => onNote(comp.id, e.target.value)}
              className="w-full bg-[#F6F6F6] rounded border border-[#EDEDED] p-2 text-[11px] h-12 outline-none resize-none placeholder:text-[#8B8B8B]"
              maxLength={2000}
            />
            <div className="flex items-start gap-1.5 bg-teal-50 rounded p-2 mt-2 border border-teal-200">
              <svg className="w-3.5 h-3.5 text-teal-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25" />
              </svg>
              <p className="text-[10px] text-teal-700"><strong>IA sugiere preguntar:</strong> &quot;{comp.aiQuestion}&quot;</p>
            </div>
          </div>
        );
      })}

      {/* Bias detection alert */}
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4">
        <div className="flex items-start gap-2">
          <svg className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
          </svg>
          <div>
            <p className="text-[11px] text-amber-700 font-medium">Deteccion de Sesgo</p>
            <p className="text-[10px] text-amber-600">Asegurar evaluacion objetiva basada en evidencia. Utilice ejemplos concretos y comportamientos observables.</p>
          </div>
        </div>
      </div>

      {/* Evaluator comparison */}
      <div className="bg-[#F6F6F6] rounded-lg p-3 mb-4">
        <p className="text-[11px] font-medium text-[#1F114C] mb-2">Comparacion entre Evaluadores</p>
        <div className="space-y-1.5">
          {[
            { name: 'Evaluador 1', type: 'Tecnica', score: 4.2, pending: false },
            { name: 'Tu', type: 'Actual', score: 0, pending: false },
            { name: 'Evaluador 3', type: 'Cultural', score: 0, pending: true },
          ].map((ev) => (
            <div key={ev.name} className="flex items-center gap-2">
              <span className="text-[10px] text-[#585858] w-20">{ev.name}</span>
              <span className="text-[10px] text-[#8B8B8B]">({ev.type})</span>
              <div className="flex gap-0.5 ml-auto">
                {[1, 2, 3, 4, 5].map((i) => (
                  <span key={i} className={`w-2 h-2 rounded-full ${!ev.pending && i <= Math.round(ev.score) ? 'bg-amber-400' : 'bg-[#EDEDED]'}`} />
                ))}
              </div>
              <span className={`text-[10px] w-8 text-right font-medium ${ev.pending ? 'text-[#8B8B8B]' : 'text-[#1F114C]'}`}>
                {ev.pending ? 'Pend.' : ev.score > 0 ? ev.score.toFixed(1) : '—'}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* ---- AI Coach Tab ---- */
function AiCoachTab() {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <svg className="w-10 h-10 text-[#8B8B8B] mb-3" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
      <p className="text-[13px] text-[#585858] font-medium mb-1">AI Coach</p>
      <p className="text-[11px] text-[#8B8B8B]">El coach de IA proporcionara sugerencias en tiempo real durante la entrevista.</p>
    </div>
  );
}

/* ---- Notas Tab ---- */
function NotasTab() {
  const [generalNotes, setGeneralNotes] = useState('');
  return (
    <div>
      <h3 className="text-[13px] font-semibold text-[#1F114C] mb-3">Notas Generales</h3>
      <textarea
        value={generalNotes}
        onChange={(e) => setGeneralNotes(e.target.value)}
        placeholder="Escribe tus notas aqui..."
        className="w-full bg-[#F6F6F6] rounded-lg border border-[#EDEDED] p-3 text-[12px] h-64 outline-none resize-none placeholder:text-[#8B8B8B]"
        maxLength={10000}
      />
      <p className="text-[10px] text-[#8B8B8B] mt-1">{generalNotes.length} / 10,000 caracteres</p>
    </div>
  );
}

/* ---- Candidato Tab ---- */
function CandidatoTab({ candidateName, candidateInitials }: { candidateName: string; candidateInitials: string }) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div className="w-12 h-12 rounded-full bg-[#1F114C] flex items-center justify-center text-white text-[14px] font-bold">{candidateInitials}</div>
        <div>
          <p className="text-[14px] font-medium text-[#333]">{candidateName}</p>
          <p className="text-[11px] text-[#8B8B8B]">Informacion del candidato</p>
        </div>
      </div>
      <p className="text-[11px] text-[#8B8B8B]">La informacion completa del candidato se cargara desde su perfil.</p>
    </div>
  );
}
