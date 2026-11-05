'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { formatDate } from '../../../../../lib/format-utils';
import { StageBadge, StatusBadge } from '../../../../../components';
import type { CandidateDetail } from '../../../../../lib/trpc-types';
import { rejectionReasonLabel } from '../../../../../lib/reject-reasons';

export function PersonalInfoCard({ candidate: c }: { candidate: CandidateDetail }) {
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

export function ApplicationsCard({ applications }: { applications: CandidateDetail['applications'] }) {
  const { t } = useI18n();
  const c = t.candidates;

  const statusMap: Record<string, { cls: string; label: string }> = {
    active: { cls: 'bg-green-50 text-green-600 border border-green-200', label: c.active },
    rejected: { cls: 'bg-red-50 text-red-600', label: c.appStatusRejected },
    hired: { cls: 'bg-[#1F114C] text-white', label: c.appStatusHired },
  };

  if (applications.length === 0) return null;

  return (
    <div className="bg-white rounded-xl p-5 shadow-[0_1px_4px_rgba(0,0,0,0.06)]">
      <h3 className="text-[14px] font-semibold text-[#1F114C] mb-4">{c.applications}</h3>
      <div className="space-y-3">
        {applications.map((app) => {
          // A rejection stays readable here (A-05): when, by whom, why, and the internal note.
          const rejection =
            app.status === 'rejected'
              ? {
                  when: app.rejectedAt
                    ? app.rejectedBy
                      ? c.rejectedOnBy.replace('{date}', formatDate(app.rejectedAt)).replace('{name}', app.rejectedBy)
                      : c.rejectedOnDate.replace('{date}', formatDate(app.rejectedAt))
                    : null,
                  reason: rejectionReasonLabel(app.rejectedReason, t.rejectCandidateModal.reasons),
                  note: app.feedback?.trim() || null,
                }
              : null;
          return (
            <div key={app.id} className="p-3 rounded-lg bg-[#F6F6F6]">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/recruitment/vacancies/${app.vacancy.id}`} className="text-[13px] font-medium text-[#333] hover:underline">
                    {app.vacancy.title}
                  </Link>
                  <div className="flex items-center gap-2 mt-1">
                    <StageBadge name={app.currentStage.name} order={app.currentStage.order} />
                    <span className="text-[10px] text-[#8B8B8B]">{formatDate(app.appliedAt)}</span>
                  </div>
                </div>
                <StatusBadge status={app.status} map={statusMap} />
              </div>
              {rejection && (
                <div className="mt-2 border-t border-[#EDEDED] pt-2 space-y-0.5">
                  {rejection.when && <p className="text-[11px] font-medium text-red-600">{rejection.when}</p>}
                  {rejection.reason && <p className="text-[11px] text-[#585858]">{c.rejectionReason.replace('{reason}', rejection.reason)}</p>}
                  {rejection.note && (
                    <p className="text-[11px] text-[#8B8B8B] whitespace-pre-wrap">{c.rejectionNote.replace('{note}', rejection.note)}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
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
