'use client';

import Link from 'next/link';
import { CandidateAvatar, StatusBadge } from '../../../../components';
import type { PipelineStageWithApps } from '../../../../lib/trpc-types';

interface PipelineListViewProps {
  stages: PipelineStageWithApps[];
  onMove: (applicationId: string, toStageId: string) => void;
  onReject: (applicationId: string, reason: string) => void;
}

const STAGE_COLORS: Record<number, string> = {
  0: 'bg-[#E8E5F0] text-[#1F114C]',
  1: 'bg-[#D4CFE5] text-[#1F114C]',
  2: 'bg-[#B8AED4] text-white',
  3: 'bg-[#7B6BAA] text-white',
  4: 'bg-[#5C4B99] text-white',
  5: 'bg-[#1F114C] text-white',
};

function getStageColor(idx: number) {
  return STAGE_COLORS[Math.min(idx, 5)] ?? STAGE_COLORS[5];
}

function daysAgo(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400000));
}

function deriveFitScore(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return 40 + Math.abs(hash % 55);
}

function fitColor(score: number) {
  if (score >= 75) return 'text-green-600 bg-green-50';
  if (score >= 50) return 'text-amber-600 bg-amber-50';
  return 'text-red-600 bg-red-50';
}

const SOURCE_LABELS: Record<string, string> = {
  linkedin: 'LinkedIn', referral: 'Referido', portal: 'Portal',
  job_board: 'Job Board', university: 'Universidad', internal: 'Interno',
};

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  active: { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: 'Activo' },
  rejected: { cls: 'bg-red-50 text-red-600 border border-red-200', label: 'Rechazado' },
  withdrawn: { cls: 'bg-gray-100 text-gray-600', label: 'Retirado' },
  hired: { cls: 'bg-green-50 text-green-600 border border-green-200', label: 'Contratado' },
};

export function PipelineListView({ stages, onMove }: PipelineListViewProps) {
  return (
    <div className="space-y-4 overflow-y-auto h-full pb-4">
      {stages.map((stage, stageIdx) => {
        if (stage.applications.length === 0) return null;
        return (
          <div key={stage.id} className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
            {/* Stage header */}
            <div className={`flex items-center justify-between px-4 py-2.5 ${getStageColor(stageIdx)}`}>
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold">{stage.name}</span>
                <span className="bg-white/20 text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                  {stage.applications.length}
                </span>
              </div>
              {stage.slaHours && (
                <span className="text-[10px] opacity-70">{stage.slaHours}h SLA</span>
              )}
            </div>

            {/* Candidates in this stage */}
            <div className="divide-y divide-[#F0F0F0]">
              {stage.applications.map((app) => {
                const c = app.candidate as { id: string; firstName: string; lastName: string; avatar: string | null; currentTitle?: string | null; email: string };
                const days = daysAgo(app.appliedAt);
                const fit = deriveFitScore(app.id);
                const isOverdue = stage.slaHours != null && days * 24 > stage.slaHours;
                const nextStage = stages[stageIdx + 1];

                return (
                  <div key={app.id} className={`flex items-center gap-4 px-4 py-3 hover:bg-[#FAFAFA] transition ${isOverdue ? 'border-l-[3px] border-l-[#DD0C15]' : ''}`}>
                    {/* Avatar + Name */}
                    <div className="flex items-center gap-2.5 w-[220px] shrink-0">
                      <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={c.avatar} size="sm" />
                      <div className="min-w-0">
                        <Link href={`/recruitment/candidates/${c.id}`} className="text-[12px] font-medium text-[#333] truncate block hover:underline">
                          {c.firstName} {c.lastName}
                        </Link>
                        {c.currentTitle && <p className="text-[10px] text-[#8B8B8B] truncate">{c.currentTitle}</p>}
                      </div>
                    </div>

                    {/* FIT Score */}
                    <div className="w-[60px] shrink-0">
                      <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${fitColor(fit)}`}>{fit}</span>
                    </div>

                    {/* Source */}
                    <div className="w-[80px] shrink-0">
                      <span className="text-[10px] text-[#585858]">{SOURCE_LABELS[app.source] ?? app.source}</span>
                    </div>

                    {/* Days */}
                    <div className="w-[70px] shrink-0">
                      <span className={`text-[11px] ${isOverdue ? 'text-[#DD0C15] font-medium' : 'text-[#8B8B8B]'}`}>
                        {days}d {isOverdue && '⚠'}
                      </span>
                    </div>

                    {/* Status */}
                    <div className="w-[80px] shrink-0">
                      <StatusBadge status={app.status} map={STATUS_MAP} />
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 ml-auto">
                      {nextStage && (
                        <button
                          onClick={() => onMove(app.id, nextStage.id)}
                          className="text-[10px] text-[#1F114C] bg-[#F0EEF5] hover:bg-[#E8E5F0] px-2.5 py-1 rounded-lg font-medium transition"
                        >
                          Avanzar →
                        </button>
                      )}
                      <Link href={`/recruitment/candidates/${c.id}`} className="text-[10px] text-[#585858] hover:text-[#1F114C] transition">
                        Ver perfil
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
