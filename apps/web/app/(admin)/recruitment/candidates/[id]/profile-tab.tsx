'use client';

import Link from 'next/link';
import { useI18n } from '../../../../../lib/i18n';
import { formatDate } from '../../../../../lib/format-utils';
import { StageBadge, StatusBadge, TEXT_LINK_CLASSES, type StatusMapEntry } from '../../../../../components';
import { CARD, CARD_TITLE } from './card-styles';
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
    {
      label: t.candidates.yearsExperience,
      value: c.yearsExperience != null ? `${c.yearsExperience}` : '\u2014',
    },
  ];

  if (c.linkedinUrl) {
    fields.push({
      label: 'LinkedIn',
      value: c.linkedinUrl,
    });
  }

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>{t.candidates.personalInfo}</h2>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
        {fields.map((f, i) => (
          <div key={i} className="min-w-0">
            <dt className="mb-0.5 text-callout text-secondary">{f.label}</dt>
            <dd className="text-body text-primary">
              {f.label === 'LinkedIn' ? (
                <a
                  href={f.value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${TEXT_LINK_CLASSES} break-all`}
                >
                  {f.value.replace(/^https?:\/\/(www\.)?/, '')}
                </a>
              ) : (
                <span className={f.label === t.candidates.email ? 'break-all' : 'break-words'}>{f.value}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>

      {/* Skills */}
      {Array.isArray(c.skills) && (c.skills as string[]).length > 0 && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="mb-2 text-callout text-secondary">{t.candidates.skills}</h3>
          <div className="flex flex-wrap gap-1.5">
            {(c.skills as string[]).map((skill, i) => (
              <StatusBadge key={i} tone="neutral" icon="none">
                {skill}
              </StatusBadge>
            ))}
          </div>
        </div>
      )}

      {/* Notes */}
      {c.notes && (
        <div className="mt-4 border-t border-border pt-4">
          <h3 className="mb-1 text-callout text-secondary">{t.candidates.notes}</h3>
          <p className="whitespace-pre-wrap text-body text-primary">{c.notes}</p>
        </div>
      )}
    </section>
  );
}

export function ApplicationsCard({ applications }: { applications: CandidateDetail['applications'] }) {
  const { t } = useI18n();
  const c = t.candidates;

  // Active applications show no status chip: the stage already says where they are. Outcomes keep words + icon.
  const statusMap: Record<string, StatusMapEntry> = {
    rejected: { tone: 'danger', label: c.appStatusRejected },
    hired: { tone: 'success', label: c.appStatusHired },
  };

  if (applications.length === 0) return null;

  return (
    <section className={CARD}>
      <h2 className={CARD_TITLE}>{c.applications}</h2>
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
            <div key={app.id} className="rounded-lg bg-surface p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Link
                    href={`/recruitment/vacancies/${app.vacancy.id}`}
                    className="text-body font-medium text-primary hover:underline"
                  >
                    {app.vacancy.title}
                  </Link>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <StageBadge name={app.currentStage.name} order={app.currentStage.order} />
                    <span className="text-caption text-muted">{formatDate(app.appliedAt)}</span>
                  </div>
                </div>
                {app.status !== 'active' && <StatusBadge status={app.status} map={statusMap} />}
              </div>
              {rejection && (
                <div className="mt-2 space-y-0.5 border-t border-border pt-2">
                  {rejection.when && <p className="text-callout font-medium text-danger">{rejection.when}</p>}
                  {rejection.reason && (
                    <p className="text-callout text-secondary">
                      {c.rejectionReason.replace('{reason}', rejection.reason)}
                    </p>
                  )}
                  {rejection.note && (
                    <p className="whitespace-pre-wrap text-callout text-secondary">
                      {c.rejectionNote.replace('{note}', rejection.note)}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
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
