'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { candidateSourceLabel } from '../../../../lib/candidate-labels';

interface AddCandidateSummaryProps {
  firstName: string;
  lastName: string;
  email: string;
  currentTitle: string;
  currentCompany: string;
  source: string;
  skills: string;
  vacancyTitle: string;
}

const ROW = 'flex flex-col gap-0.5 sm:flex-row sm:justify-between sm:gap-4';
const TERM = 'text-callout text-secondary';
const VALUE = 'text-body text-primary sm:text-right';

/** The last step's review of what will be created, as a description list. */
export function AddCandidateSummary(props: AddCandidateSummaryProps) {
  const { t } = useI18n();
  const p = t.pipeline;
  const skillList = props.skills
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const skillsText = `${skillList.slice(0, 4).join(', ')}${skillList.length > 4 ? '…' : ''}`;
  const role = props.currentCompany
    ? formatMessage(p.summaryRoleAt, { title: props.currentTitle, company: props.currentCompany })
    : props.currentTitle;

  return (
    <section aria-labelledby="add-candidate-summary" className="border-t border-border pt-4">
      <h3 id="add-candidate-summary" className="mb-2 text-body font-semibold text-brand">
        {p.summaryTitle}
      </h3>
      <dl className="space-y-1.5 rounded-lg bg-surface p-3">
        <div className={ROW}>
          <dt className={TERM}>{p.summaryCandidate}</dt>
          <dd className={`${VALUE} font-medium`}>
            {props.firstName} {props.lastName}
          </dd>
        </div>
        <div className={ROW}>
          <dt className={TERM}>{p.summaryEmail}</dt>
          <dd className={`${VALUE} break-all`}>{props.email}</dd>
        </div>
        {props.currentTitle && (
          <div className={ROW}>
            <dt className={TERM}>{p.summaryRole}</dt>
            <dd className={VALUE}>{role}</dd>
          </div>
        )}
        <div className={ROW}>
          <dt className={TERM}>{p.summarySource}</dt>
          <dd className={VALUE}>{candidateSourceLabel(props.source, t.candidates)}</dd>
        </div>
        <div className={ROW}>
          <dt className={TERM}>{p.summaryVacancy}</dt>
          <dd className={VALUE}>{props.vacancyTitle}</dd>
        </div>
        {skillList.length > 0 && (
          <div className={ROW}>
            <dt className={TERM}>{p.summarySkills}</dt>
            <dd className={VALUE}>{skillsText}</dd>
          </div>
        )}
      </dl>
    </section>
  );
}
