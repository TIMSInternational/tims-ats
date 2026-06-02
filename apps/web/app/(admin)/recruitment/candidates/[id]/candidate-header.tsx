'use client';

import { useI18n } from '../../../../../lib/i18n';
import { formatDate } from '../../../../../lib/format-utils';
import { CandidateAvatar } from '../../../../../components';
import type { CandidateDetail } from '../../../../../lib/trpc-types';

function FitScoreCircle({ score }: { score: number }) {
  const { t } = useI18n();
  const borderColor = score >= 70 ? 'border-green-500' : score >= 40 ? 'border-amber-500' : 'border-red-500';
  const labelColor = score >= 70 ? 'text-green-600' : score >= 40 ? 'text-amber-600' : 'text-red-600';
  const label = score >= 70 ? t.candidates.highFit : score >= 40 ? t.candidates.mediumFit : t.candidates.lowFit;

  return (
    <div className="flex flex-col items-center shrink-0">
      <div className={`w-20 h-20 rounded-full border-4 ${borderColor} flex items-center justify-center`}>
        <div className="text-center">
          <span className="text-2xl font-bold text-[#1F114C]">{score}</span>
          <p className="text-[9px] text-[#8B8B8B] -mt-1">{t.candidates.fitScoreLabel}</p>
        </div>
      </div>
      <span className={`text-[10px] ${labelColor} font-medium mt-1`}>{label}</span>
    </div>
  );
}

export function CandidateHeader({ candidate: c }: { candidate: CandidateDetail }) {
  const { t } = useI18n();
  const fitScore = c.fitScores?.[0]?.overallScore;
  const activeApp = c.applications?.[0];
  const currentStage = activeApp?.currentStage?.name;

  const poolLabels: Record<string, string> = {
    applicant: t.candidates.poolApplicant,
    referral: t.candidates.poolReferral,
    sourced: t.candidates.poolSourced,
    silver_medalist: t.candidates.poolSilverMedalist,
    passive: t.candidates.poolPassive,
  };

  return (
    <div className="bg-white rounded-xl p-6 shadow-[0_2px_12px_rgba(0,0,0,0.06)] mb-6">
      <div className="flex items-start gap-6">
        {/* Avatar */}
        <CandidateAvatar firstName={c.firstName} lastName={c.lastName} avatar={c.avatar} size="xl" />

        {/* Info */}
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-xl font-bold text-[#1F114C]">{c.firstName} {c.lastName}</h1>
            {currentStage && (
              <span className="bg-[#7B6BAA] text-white text-[11px] font-medium px-3 py-1 rounded-full">
                {currentStage}
              </span>
            )}
            {c.isActive && (
              <span className="bg-green-50 text-green-600 text-[11px] font-medium px-3 py-1 rounded-full border border-green-200">
                {t.candidates.active}
              </span>
            )}
          </div>

          {activeApp && (
            <p className="text-[13px] text-[#585858] mb-2">
              {t.candidates.applyingTo}{' '}
              <span className="text-[#1F114C] font-medium">{activeApp.vacancy.title}</span>
            </p>
          )}

          <div className="flex items-center gap-4 text-[12px] text-[#8B8B8B] flex-wrap">
            <span className="flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
              {c.email}
            </span>
            {c.phone && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" /></svg>
                {c.phone}
              </span>
            )}
            {c.location && (
              <span className="flex items-center gap-1">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z" /><path d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z" /></svg>
                {c.location}
              </span>
            )}
            {c.linkedinUrl && (
              <a href={c.linkedinUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-1.06l4.5-4.5a4.5 4.5 0 00-6.364-6.364l-1.757 1.757" /></svg>
                LinkedIn
              </a>
            )}
            <span className="text-[11px] bg-blue-50 text-blue-600 px-2 py-0.5 rounded">
              {t.candidates.sourceLabel} {c.source}
            </span>
            {activeApp && (
              <span className="text-[11px] text-[#8B8B8B]">
                {t.candidates.applied} {formatDate(activeApp.appliedAt)}
              </span>
            )}
          </div>
        </div>

        {/* FIT Score */}
        {fitScore != null && <FitScoreCircle score={fitScore} />}

        {/* Action Buttons */}
        <div className="flex flex-col gap-2 shrink-0">
          <button className="flex items-center gap-2 bg-[#DD0C15] text-white px-4 h-9 rounded-lg text-[12px] font-medium hover:bg-[#c00b13] transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5-3L16.5 18m0 0L12 13.5m4.5 4.5V4.5" /></svg>
            {t.candidates.moveStage}
          </button>
          <button className="flex items-center gap-2 border border-[#1F114C] text-[#1F114C] px-4 h-9 rounded-lg text-[12px] font-medium hover:bg-[#1F114C]/5 transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" /></svg>
            {t.candidates.message}
          </button>
          <button className="flex items-center gap-2 border border-[#EDEDED] text-[#585858] px-4 h-9 rounded-lg text-[12px] font-medium hover:bg-[#F6F6F6] transition">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" /></svg>
            {t.candidates.more}
          </button>
        </div>
      </div>

      {/* AI Recommendation Banner */}
      {fitScore != null && fitScore >= 70 && (
        <div className="mt-4 bg-teal-50 border border-teal-200 rounded-lg p-3 flex items-start gap-2">
          <svg className="w-4 h-4 text-teal-600 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
            <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          <div>
            <span className="text-[12px] text-teal-700 font-semibold">{t.candidates.aiRecommendation}</span>
            <span className="text-[12px] text-teal-700"> {t.candidates.highFit} (FIT {fitScore})</span>
          </div>
        </div>
      )}
    </div>
  );
}
