'use client';

import { useState } from 'react';
import { useSuccessionSimulateExit } from '../../../../lib/platform-api/succession';
import { ErrorState } from '../../../../components';

interface CriticalRole {
  id: string;
  title: string;
  currentHolder?: { id: string; firstName: string; lastName: string } | null;
}

interface ExitSimulatorProps {
  roles: CriticalRole[];
  t: {
    exitSimulator: string;
    whatIfLeaves: string;
    impact: string;
    directReports: string;
    peopleAffected: string;
    replacementTime: string;
    nextInLine: string;
    readiness: string;
  };
}

function getInitials(first: string, last: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

export function ExitSimulator({ roles, t }: ExitSimulatorProps) {
  const [selectedId, setSelectedId] = useState(roles[0]?.id ?? '');
  const sim = useSuccessionSimulateExit(selectedId);

  const selectedRole = roles.find((r) => r.id === selectedId);

  return (
    <div className="w-full md:w-[42%] bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.exitSimulator}</h3>
        <svg className="w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
        </svg>
      </div>

      <div className="mb-3">
        <label className="text-[10px] text-[#585858] font-medium block mb-1">{t.whatIfLeaves}</label>
        <select
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
          className="w-full text-[11px] text-[#1F114C] font-medium bg-[#F6F6F6] border border-[#EDEDED] rounded-lg px-3 h-9 outline-none"
        >
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.currentHolder ? `${r.currentHolder.firstName} ${r.currentHolder.lastName} - ` : ''}{r.title}
            </option>
          ))}
        </select>
      </div>

      {sim.isError ? (
        <div className="bg-[#F6F6F6] rounded-lg p-6 text-center">
          <ErrorState onRetry={() => sim.refetch()} />
        </div>
      ) : sim.data ? (
        <>
          <div className="bg-[#F6F6F6] rounded-lg p-3 mb-3">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-4 h-4 text-[#DD0C15]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
              </svg>
              <span className="text-[11px] font-semibold text-[#DD0C15]">
                {t.impact}: {sim.data.riskLevel === 'high' ? 'Alto' : sim.data.riskLevel === 'medium' ? 'Medio' : 'Bajo'}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <div className="text-center bg-white rounded-lg p-2">
                <p className="text-[16px] font-bold text-[#DD0C15]">{sim.data.pipelineCount}</p>
                <p className="text-[9px] text-[#8B8B8B]">{t.directReports}</p>
              </div>
              <div className="text-center bg-white rounded-lg p-2">
                <p className="text-[16px] font-bold text-[#1F114C]">{sim.data.pipelineCount * 20}</p>
                <p className="text-[9px] text-[#8B8B8B]">{t.peopleAffected}</p>
              </div>
              <div className="text-center bg-white rounded-lg p-2">
                <p className="text-[16px] font-bold text-amber-600">4-6m</p>
                <p className="text-[9px] text-[#8B8B8B]">{t.replacementTime}</p>
              </div>
            </div>
          </div>

          <div>
            <p className="text-[10px] text-[#585858] font-medium mb-2">{t.nextInLine}:</p>
            {sim.data.successors.slice(0, 2).map((s) => {
              const isReady = s.readiness === 'ready_now';
              const bg = isReady ? 'bg-green-50' : 'bg-amber-50';
              const border = isReady ? 'border-green-200' : 'border-amber-200';
              const avatarBg = isReady ? 'bg-green-600' : 'bg-amber-600';
              const badgeBg = isReady ? 'bg-green-600' : 'bg-amber-600';

              return (
                <div key={s.id} className={`flex items-center gap-2 p-2 ${bg} rounded-lg border ${border} mb-2`}>
                  <div className={`w-7 h-7 rounded-full ${avatarBg} flex items-center justify-center text-white text-[9px] font-bold shrink-0`}>
                    {getInitials(s.user.firstName, s.user.lastName)}
                  </div>
                  <div className="flex-1">
                    <p className="text-[11px] font-medium text-[#333]">{s.user.firstName} {s.user.lastName}</p>
                    <p className="text-[9px] text-[#8B8B8B]">{s.user.jobTitle ?? ''} &middot; {isReady ? 'Ready Now' : '1-2 Anos'}</p>
                  </div>
                  <span className={`text-[9px] ${badgeBg} text-white px-2 py-0.5 rounded-full font-medium`}>
                    {t.readiness} {isReady ? '91%' : '64%'}
                  </span>
                </div>
              );
            })}
            {sim.data.successors.length === 0 && (
              <p className="text-[10px] text-[#DD0C15]">{sim.data.recommendation}</p>
            )}
          </div>
        </>
      ) : (
        <div className="bg-[#F6F6F6] rounded-lg p-6 text-center">
          <p className="text-[11px] text-[#8B8B8B]">
            {selectedRole ? 'Cargando simulacion...' : 'Selecciona un rol para simular'}
          </p>
        </div>
      )}
    </div>
  );
}
