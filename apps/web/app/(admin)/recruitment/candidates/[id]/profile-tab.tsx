'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { formatDate } from '../../../../../lib/format-utils';
import { StageBadge, StatusBadge } from '../../../../../components';
import type { CandidateDetail } from '../../../../../lib/trpc-types';

function PersonalInfoCard({ candidate: c }: { candidate: CandidateDetail }) {
  const { t } = useI18n();

  const fields = [
    { label: t.candidates.fullName, value: `${c.firstName} ${c.lastName}` },
    { label: t.candidates.email, value: c.email },
    { label: t.candidates.phone, value: c.phone ?? '\u2014' },
    { label: t.candidates.location, value: c.location ?? '\u2014' },
    { label: t.candidates.currentTitle, value: c.currentTitle ?? '\u2014' },
    { label: t.candidates.currentCompany, value: c.currentCompany ?? '\u2014' },
    { label: t.candidates.yearsExperience, value: c.yearsExperience != null ? `${c.yearsExperience}` : '\u2014' },
  ];

  if (c.linkedinUrl) {
    fields.push({
      label: 'LinkedIn',
      value: c.linkedinUrl,
    });
  }

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.candidates.personalInfo}</h3>
      <div className="grid grid-cols-2 gap-x-8 gap-y-3">
        {fields.map((f, i) => (
          <div key={i}>
            <p className="text-[11px] text-[#8B8B8B] mb-0.5">{f.label}</p>
            {f.label === 'LinkedIn' ? (
              <a href={f.value} target="_blank" rel="noopener noreferrer" className="text-[13px] text-blue-600 underline cursor-pointer">
                {f.value.replace(/^https?:\/\/(www\.)?/, '')}
              </a>
            ) : (
              <p className="text-[13px] text-[#333]">{f.value}</p>
            )}
          </div>
        ))}
      </div>

      {/* Skills */}
      {Array.isArray(c.skills) && (c.skills as string[]).length > 0 && (
        <div className="mt-4 pt-4 border-t border-[#F6F6F6]">
          <p className="text-[11px] text-[#8B8B8B] mb-2">{t.candidates.skills}</p>
          <div className="flex flex-wrap gap-1.5">
            {(c.skills as string[]).map((skill, i) => (
              <span key={i} className="text-[11px] bg-blue-50 text-blue-600 px-2.5 py-1 rounded-full">{skill}</span>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {c.notes && (
        <div className="mt-4 pt-4 border-t border-[#F6F6F6]">
          <p className="text-[11px] text-[#8B8B8B] mb-1">{t.candidates.notes}</p>
          <p className="text-[12px] text-[#585858] whitespace-pre-wrap">{c.notes}</p>
        </div>
      )}
    </div>
  );
}

function ApplicationsCard({ applications }: { applications: CandidateDetail['applications'] }) {
  const { t } = useI18n();

  const statusMap: Record<string, { cls: string; label: string }> = {
    active: { cls: 'bg-green-50 text-green-600 border border-green-200', label: t.candidates.active },
    rejected: { cls: 'bg-red-50 text-red-600', label: 'Rechazada' },
    hired: { cls: 'bg-[#1F114C] text-white', label: 'Contratada' },
  };

  if (applications.length === 0) return null;

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{t.candidates.applications}</h3>
      <div className="space-y-3">
        {applications.map((app) => (
          <Link
            key={app.id}
            href={`/recruitment/vacancies/${app.vacancy.id}`}
            className="flex items-center justify-between p-3 rounded-lg bg-[#F6F6F6] hover:bg-[#EDEDED] transition"
          >
            <div>
              <p className="text-[13px] font-medium text-[#333]">{app.vacancy.title}</p>
              <div className="flex items-center gap-2 mt-1">
                <StageBadge name={app.currentStage.name} order={app.currentStage.order} />
                <span className="text-[10px] text-[#8B8B8B]">{formatDate(app.appliedAt)}</span>
              </div>
            </div>
            <StatusBadge status={app.status} map={statusMap} />
          </Link>
        ))}
      </div>
    </div>
  );
}

export function ProfileTab({ candidate }: { candidate: CandidateDetail }) {
  return (
    <>
      <PersonalInfoCard candidate={candidate} />
      <ApplicationsCard applications={candidate.applications} />
    </>
  );
}
