'use client';

import Link from 'next/link';
import { CandidateAvatar, FitScoreBadge } from '../../../../components';
import type { PipelineApplicationCard } from '../../../../lib/trpc-types';

interface KanbanCardProps {
  application: PipelineApplicationCard;
  isDragging: boolean;
}

export function KanbanCard({ application: app, isDragging }: KanbanCardProps) {
  const candidate = app.candidate;

  return (
    <div
      className={`bg-white rounded-lg p-3 border-l-[3px] transition-shadow ${
        isDragging ? 'shadow-lg border-[#1F114C]' : 'shadow-[0_1px_3px_rgba(0,0,0,0.08)] border-transparent hover:shadow-md'
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <CandidateAvatar firstName={candidate.firstName} lastName={candidate.lastName} avatar={candidate.avatar} size="sm" />
        <div className="flex-1 min-w-0">
          <Link href={`/recruitment/candidates/${candidate.id}`} className="text-[12px] font-medium text-[#333] truncate block hover:underline">
            {candidate.firstName} {candidate.lastName}
          </Link>
          {candidate.currentTitle && (
            <p className="text-[10px] text-[#8B8B8B] truncate">{candidate.currentTitle}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-[10px] bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">{app.source}</span>
      </div>
    </div>
  );
}
