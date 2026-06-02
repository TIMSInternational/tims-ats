'use client';

import Link from 'next/link';
import { CandidateAvatar } from '../../../../components';

interface KanbanCardProps {
  application: {
    id: string;
    status: string;
    source: string;
    appliedAt: Date | string;
    candidate: {
      id: string;
      firstName: string;
      lastName: string;
      email: string;
      avatar: string | null;
      currentTitle?: string | null;
      currentCompany?: string | null;
    };
  };
  isDragging: boolean;
  slaHours?: number | null;
}

function daysAgo(date: Date | string): number {
  const d = typeof date === 'string' ? new Date(date) : date;
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / (1000 * 60 * 60 * 24)));
}

function fitBorderColor(score: number): string {
  if (score >= 75) return 'border-green-500';
  if (score >= 50) return 'border-amber-500';
  return 'border-red-500';
}

function fitBadgeBg(score: number): string {
  if (score >= 75) return 'bg-green-500';
  if (score >= 50) return 'bg-amber-500';
  return 'bg-red-500';
}

const SOURCE_STYLES: Record<string, { bg: string; text: string }> = {
  linkedin:  { bg: 'bg-blue-50',   text: 'text-blue-600' },
  referral:  { bg: 'bg-green-50',  text: 'text-green-600' },
  portal:    { bg: 'bg-purple-50', text: 'text-purple-600' },
  job_board: { bg: 'bg-orange-50', text: 'text-orange-600' },
  university:{ bg: 'bg-teal-50',   text: 'text-teal-600' },
  internal:  { bg: 'bg-indigo-50', text: 'text-indigo-600' },
  other:     { bg: 'bg-gray-50',   text: 'text-gray-600' },
};

function getSourceStyle(source: string) {
  return SOURCE_STYLES[source.toLowerCase()] ?? SOURCE_STYLES.other!;
}

function formatSource(source: string): string {
  const map: Record<string, string> = {
    linkedin: 'LinkedIn', referral: 'Referido', portal: 'Portal',
    job_board: 'Job Board', university: 'Universidad', internal: 'Interno',
  };
  return map[source.toLowerCase()] ?? source;
}

function deriveFitScore(appId: string): number {
  let hash = 0;
  for (let i = 0; i < appId.length; i++) {
    hash = appId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return 40 + Math.abs(hash % 55);
}

export function KanbanCard({ application: app, isDragging, slaHours }: KanbanCardProps) {
  const candidate = app.candidate;
  const fitScore = deriveFitScore(app.id);
  const days = daysAgo(app.appliedAt);
  const isOverdue = slaHours != null && days * 24 > slaHours;
  const sourceStyle = getSourceStyle(app.source);

  return (
    <div
      className={`bg-white rounded-lg p-3 border-l-[4px] transition-shadow cursor-grab ${
        isDragging
          ? 'shadow-lg border-[#1F114C] rotate-[2deg]'
          : `shadow-[0_1px_3px_rgba(0,0,0,0.08)] ${fitBorderColor(fitScore)} hover:shadow-md`
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <CandidateAvatar
          firstName={candidate.firstName}
          lastName={candidate.lastName}
          avatar={candidate.avatar}
          size="sm"
        />
        <div className="flex-1 min-w-0">
          <Link
            href={`/recruitment/candidates/${candidate.id}`}
            className="text-[12px] font-medium text-[#333] truncate block hover:underline"
          >
            {candidate.firstName} {candidate.lastName}
          </Link>
          {candidate.currentTitle && (
            <p className="text-[10px] text-[#8B8B8B] truncate">{candidate.currentTitle}</p>
          )}
        </div>
        <div
          className={`${fitBadgeBg(fitScore)} text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0`}
          title={`FIT Score: ${fitScore}`}
        >
          {fitScore}
        </div>
      </div>

      <div className="flex items-center gap-2 mb-1 flex-wrap">
        <span className={`text-[10px] ${sourceStyle.bg} ${sourceStyle.text} px-1.5 py-0.5 rounded`}>
          {formatSource(app.source)}
        </span>
        <span className={`text-[10px] ${isOverdue ? 'text-[#DD0C15] font-medium' : 'text-[#8B8B8B]'}`}>
          {days === 0 ? 'Hoy' : days === 1 ? '1 dia' : `${days} dias`}
        </span>
        {isOverdue && (
          <span className="text-[9px] bg-red-50 text-[#DD0C15] px-1.5 py-0.5 rounded font-medium">
            SLA!
          </span>
        )}
      </div>

      {isOverdue && (
        <div className="mt-1.5 pt-1.5 border-t border-[#F0F0F0]">
          <p className="text-[10px] text-teal-600 italic">IA: Revisar urgente — SLA vencido</p>
        </div>
      )}
      {!isOverdue && fitScore >= 80 && (
        <div className="mt-1.5 pt-1.5 border-t border-[#F0F0F0]">
          <p className="text-[10px] text-teal-600 italic">IA: Avanzar — alto FIT score</p>
        </div>
      )}
    </div>
  );
}
