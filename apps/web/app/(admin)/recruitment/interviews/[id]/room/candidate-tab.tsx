'use client';

import type { ReactNode } from 'react';
import { useI18n } from '../../../../../../lib/i18n';
import type { InterviewDetail } from '../../../../../../lib/trpc-types';
import { interviewTypeLabel } from './interview-type-label';

interface CandidateTabProps {
  interview: InterviewDetail;
  candidateInitials: string;
}

const linkClass =
  'text-[12px] font-medium text-[#1F114C] underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1F114C] rounded';

/** Candidate facts that the interview query already returns — nothing invented. */
export function CandidateTab({ interview, candidateInitials }: CandidateTabProps) {
  const { t, locale } = useI18n();
  const { candidate, vacancy } = interview;
  const scheduled = new Intl.DateTimeFormat(locale === 'EN' ? 'en' : 'es', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(interview.scheduledAt));

  const rows: Array<{ label: string; value: ReactNode }> = [
    {
      label: t.interviewRoom.candidateEmail,
      value: (
        <a className={linkClass} href={`mailto:${candidate.email}`}>
          {candidate.email}
        </a>
      ),
    },
    {
      label: t.interviewRoom.candidatePhone,
      value: candidate.phone ? (
        <a className={linkClass} href={`tel:${candidate.phone}`}>
          {candidate.phone}
        </a>
      ) : (
        <span className="text-[#8B8B8B]">{t.interviewRoom.notProvided}</span>
      ),
    },
    { label: t.interviewRoom.candidateVacancy, value: vacancy.title },
    {
      label: t.interviewRoom.candidateInterview,
      value: t.interviewRoom.candidateInterviewValue
        .replace('{type}', interviewTypeLabel(t, interview.type))
        .replace('{date}', scheduled)
        .replace('{minutes}', String(interview.duration)),
    },
  ];

  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <div
          className="w-12 h-12 rounded-full bg-[#1F114C] flex items-center justify-center text-white text-[14px] font-bold"
          aria-hidden="true"
        >
          {candidateInitials}
        </div>
        <p className="text-[14px] font-medium text-[#333]">
          {candidate.firstName} {candidate.lastName}
        </p>
      </div>
      <dl className="space-y-2 mb-4">
        {rows.map((row) => (
          <div key={row.label}>
            <dt className="text-[10px] uppercase tracking-wide text-[#8B8B8B]">{row.label}</dt>
            <dd className="text-[12px] text-[#333] break-words">{row.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-col gap-2">
        {/* New tab + full document load: keeps the call alive and never carries the room's relaxed CSP. */}
        <a
          className={linkClass}
          href={`/recruitment/candidates/${candidate.id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.interviewRoom.candidateViewProfile}
        </a>
        <a
          className={linkClass}
          href={`/recruitment/vacancies/${vacancy.id}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.interviewRoom.candidateViewVacancy}
        </a>
      </div>
    </div>
  );
}
