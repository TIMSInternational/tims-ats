'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { CandidateAvatar, StatusBadge } from '../../../../components';
import type { PipelineStageWithApps } from '../../../../lib/trpc-types';

interface PipelineTableViewProps {
  stages: PipelineStageWithApps[];
  onMove: (applicationId: string, toStageId: string) => void;
  onReject: (applicationId: string, reason: string) => void;
}

type SortKey = 'name' | 'stage' | 'fit' | 'days' | 'source';
type SortDir = 'asc' | 'desc';

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

const STAGE_BADGE: Record<number, string> = {
  0: 'bg-[#E8E5F0] text-[#1F114C]',
  1: 'bg-[#D4CFE5] text-[#1F114C]',
  2: 'bg-[#B8AED4] text-[#1F114C]',
  3: 'bg-[#7B6BAA] text-white',
  4: 'bg-[#5C4B99] text-white',
  5: 'bg-[#1F114C] text-white',
};

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  active: { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: 'Activo' },
  rejected: { cls: 'bg-red-50 text-red-600 border border-red-200', label: 'Rechazado' },
  withdrawn: { cls: 'bg-gray-100 text-gray-600', label: 'Retirado' },
  hired: { cls: 'bg-green-50 text-green-600 border border-green-200', label: 'Contratado' },
};

interface FlatApp {
  id: string;
  candidateId: string;
  firstName: string;
  lastName: string;
  avatar: string | null;
  currentTitle: string | null;
  source: string;
  status: string;
  appliedAt: Date | string;
  stageName: string;
  stageOrder: number;
  stageId: string;
  slaHours: number | null;
  fitScore: number;
  days: number;
  isOverdue: boolean;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <svg className={`w-3 h-3 inline ml-0.5 ${active ? 'text-[#1F114C]' : 'text-[#ccc]'}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      {dir === 'asc' ? <path d="M8 15l4-4 4 4" /> : <path d="M8 9l4 4 4-4" />}
    </svg>
  );
}

export function PipelineTableView({ stages, onMove }: PipelineTableViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>('stage');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  const flatApps: FlatApp[] = useMemo(() => {
    const result: FlatApp[] = [];
    for (const stage of stages) {
      for (const app of stage.applications) {
        const c = app.candidate as { id: string; firstName: string; lastName: string; avatar: string | null; currentTitle?: string | null; email: string };
        const days = daysAgo(app.appliedAt);
        const fit = deriveFitScore(app.id);
        result.push({
          id: app.id,
          candidateId: c.id,
          firstName: c.firstName,
          lastName: c.lastName,
          avatar: c.avatar,
          currentTitle: c.currentTitle ?? null,
          source: app.source,
          status: app.status,
          appliedAt: app.appliedAt,
          stageName: stage.name,
          stageOrder: stage.order,
          stageId: stage.id,
          slaHours: stage.slaHours,
          fitScore: fit,
          days,
          isOverdue: stage.slaHours != null && days * 24 > stage.slaHours,
        });
      }
    }
    return result;
  }, [stages]);

  const sorted = useMemo(() => {
    const arr = [...flatApps];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'name': cmp = `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`); break;
        case 'stage': cmp = a.stageOrder - b.stageOrder; break;
        case 'fit': cmp = a.fitScore - b.fitScore; break;
        case 'days': cmp = a.days - b.days; break;
        case 'source': cmp = a.source.localeCompare(b.source); break;
      }
      return sortDir === 'desc' ? -cmp : cmp;
    });
    return arr;
  }, [flatApps, sortKey, sortDir]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) { setSortDir(sortDir === 'asc' ? 'desc' : 'asc'); }
    else { setSortKey(key); setSortDir('asc'); }
  };

  const stageList = stages.map((s) => ({ id: s.id, name: s.name, order: s.order }));

  return (
    <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden h-full flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-[#EDEDED]">
        <h3 className="text-[13px] font-semibold text-[#1F114C]">{sorted.length} candidatos en proceso</h3>
      </div>

      <div className="overflow-auto flex-1">
        <table className="w-full min-w-[640px] text-[11px]">
          <thead className="sticky top-0 z-10">
            <tr className="bg-[#FAFAFA] border-b border-[#EDEDED]">
              <th className="text-left py-2.5 px-4 text-[#585858] font-medium cursor-pointer select-none" onClick={() => toggleSort('name')}>
                Candidato <SortIcon active={sortKey === 'name'} dir={sortDir} />
              </th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium cursor-pointer select-none" onClick={() => toggleSort('stage')}>
                Etapa <SortIcon active={sortKey === 'stage'} dir={sortDir} />
              </th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium cursor-pointer select-none" onClick={() => toggleSort('fit')}>
                FIT <SortIcon active={sortKey === 'fit'} dir={sortDir} />
              </th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium cursor-pointer select-none" onClick={() => toggleSort('source')}>
                Fuente <SortIcon active={sortKey === 'source'} dir={sortDir} />
              </th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium cursor-pointer select-none" onClick={() => toggleSort('days')}>
                Dias <SortIcon active={sortKey === 'days'} dir={sortDir} />
              </th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">Estado</th>
              <th className="text-center py-2.5 px-3 text-[#585858] font-medium">SLA</th>
              <th className="text-right py-2.5 px-4 text-[#585858] font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((app, idx) => {
              const nextStage = stageList.find((s) => s.order === app.stageOrder + 1);
              return (
                <tr key={app.id} className={`border-b border-[#F0F0F0] hover:bg-[#FAFAFA] transition ${idx % 2 === 1 ? 'bg-[#FAFAFA]/50' : ''} ${app.isOverdue ? 'border-l-[3px] border-l-[#DD0C15]' : ''}`}>
                  <td className="py-2.5 px-4">
                    <div className="flex items-center gap-2">
                      <CandidateAvatar firstName={app.firstName} lastName={app.lastName} avatar={app.avatar} size="sm" />
                      <div className="min-w-0">
                        <Link href={`/recruitment/candidates/${app.candidateId}`} className="text-[12px] font-medium text-[#333] truncate block hover:underline">
                          {app.firstName} {app.lastName}
                        </Link>
                        {app.currentTitle && <p className="text-[10px] text-[#8B8B8B] truncate">{app.currentTitle}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${STAGE_BADGE[Math.min(app.stageOrder, 5)]}`}>
                      {app.stageName}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${fitColor(app.fitScore)}`}>{app.fitScore}</span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <span className="text-[10px] text-[#585858]">{SOURCE_LABELS[app.source] ?? app.source}</span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <span className={`text-[11px] ${app.isOverdue ? 'text-[#DD0C15] font-medium' : 'text-[#8B8B8B]'}`}>{app.days}d</span>
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    <StatusBadge status={app.status} map={STATUS_MAP} />
                  </td>
                  <td className="py-2.5 px-3 text-center">
                    {app.isOverdue ? (
                      <span className="text-[9px] bg-red-50 text-[#DD0C15] px-1.5 py-0.5 rounded font-medium">Vencido</span>
                    ) : app.slaHours ? (
                      <span className="text-[9px] text-green-600 bg-green-50 px-1.5 py-0.5 rounded">OK</span>
                    ) : (
                      <span className="text-[9px] text-[#ccc]">—</span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 text-right">
                    <div className="flex items-center gap-2 justify-end">
                      {nextStage && (
                        <button onClick={() => onMove(app.id, nextStage.id)} className="text-[10px] text-[#1F114C] bg-[#F0EEF5] hover:bg-[#E8E5F0] px-2 py-1 rounded font-medium transition">
                          → {nextStage.name}
                        </button>
                      )}
                      <Link href={`/recruitment/candidates/${app.candidateId}`} className="text-[10px] text-[#585858] hover:text-[#1F114C]">
                        Ver
                      </Link>
                    </div>
                  </td>
                </tr>
              );
            })}
            {sorted.length === 0 && (
              <tr><td colSpan={8} className="py-12 text-center text-[13px] text-[#8B8B8B]">No hay candidatos en este pipeline</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
