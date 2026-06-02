'use client';

import { useI18n } from '../../../../../lib/i18n';
import type { CandidateDetail } from '../../../../../lib/trpc-types';

export function ProfileInfo({ candidate: c }: { candidate: CandidateDetail }) {
  const { t } = useI18n();

  const fields = [
    { label: t.candidates.firstName, value: c.firstName },
    { label: t.candidates.lastName, value: c.lastName },
    { label: t.candidates.email, value: c.email },
    { label: t.candidates.phone, value: c.phone ?? '—' },
    { label: t.candidates.location, value: c.location ?? '—' },
    { label: t.candidates.currentTitle, value: c.currentTitle ?? '—' },
    { label: t.candidates.currentCompany, value: c.currentCompany ?? '—' },
    { label: t.candidates.yearsExperience, value: c.yearsExperience != null ? `${c.yearsExperience} years` : '—' },
  ];

  const skills = Array.isArray(c.skills) ? (c.skills as string[]) : [];

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.candidates.profileHeader}</h3>
      <div className="grid grid-cols-2 gap-x-8 gap-y-3">
        {fields.map((f, i) => (
          <div key={i}>
            <p className="text-[11px] text-[#8B8B8B] mb-0.5">{f.label}</p>
            <p className="text-[13px] text-[#333]">{f.value}</p>
          </div>
        ))}
      </div>
      {skills.length > 0 && (
        <div className="mt-4 pt-4 border-t border-[#F6F6F6]">
          <p className="text-[11px] text-[#8B8B8B] mb-2">{t.candidates.skills}</p>
          <div className="flex flex-wrap gap-1.5">
            {skills.map((skill, i) => (
              <span key={i} className="text-[11px] bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full">{skill}</span>
            ))}
          </div>
        </div>
      )}
      {c.notes && (
        <div className="mt-4 pt-4 border-t border-[#F6F6F6]">
          <p className="text-[11px] text-[#8B8B8B] mb-1">{t.candidates.notes}</p>
          <p className="text-[12px] text-[#585858] whitespace-pre-wrap">{c.notes}</p>
        </div>
      )}
    </div>
  );
}
