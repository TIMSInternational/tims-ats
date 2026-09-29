'use client';

import { useI18n } from '../../../../../../../../lib/i18n';

export function ProctoringPreflightIntro({ isResume }: { isResume: boolean }) {
  const copy = useI18n().t.proctoring.candidate;
  return (
    <div>
      <h1 id="proctoring-title" className="text-lg font-semibold text-[#1F114C]">
        {isResume ? copy.resumeTitle : copy.title}
      </h1>
      <p className="mt-2 text-[13px] text-[#585858] leading-relaxed">{copy.intro}</p>
      {isResume && (
        <p className="mt-2 text-[13px] text-[#B45309]" role="status">{copy.timerContinues}</p>
      )}
    </div>
  );
}
