'use client';

import { readJobProfile } from '@tims/shared';
import { useI18n } from '../../../../../lib/i18n';
import { ProgressBar } from '../../../../../components';

const SUBHEAD = 'mb-2 text-callout font-semibold text-secondary';

interface DiscRange {
  min: number;
  max: number;
}
interface Kpi {
  name: string;
  target: string;
}
interface Requirement {
  text: string;
  isRequired: boolean;
}

interface JobProfileCardProps {
  jobProfile: {
    discTargets: unknown;
    competencies: unknown;
    pcaExpected: unknown;
    milExpected: unknown;
    kpis: unknown;
    requirements: unknown;
  };
}

export function JobProfileCard({ jobProfile }: JobProfileCardProps) {
  const { t } = useI18n();

  const disc = jobProfile.discTargets as Record<string, DiscRange> | null;
  const pca = jobProfile.pcaExpected as Record<string, DiscRange> | null;
  const mil = jobProfile.milExpected as { minScore?: number } | null;
  // Same reader as the interview scorecard: what is listed here is exactly what evaluators rate.
  const competencies = readJobProfile(jobProfile).competencies;
  const kpis = (Array.isArray(jobProfile.kpis) ? jobProfile.kpis : []) as Kpi[];
  const requirements = (Array.isArray(jobProfile.requirements) ? jobProfile.requirements : []) as Requirement[];

  const discSource = pca ?? disc;
  const discEntries = discSource
    ? [
        { label: t.vacancies.dominance, key: 'dominance' },
        { label: t.vacancies.influence, key: 'influence' },
        { label: t.vacancies.steadiness, key: 'steadiness' },
        { label: t.vacancies.compliance, key: 'compliance' },
      ]
    : [];

  return (
    <section
      aria-labelledby="vacancy-job-profile-title"
      className="rounded-xl border border-border bg-white p-5 shadow-card"
    >
      <h2 id="vacancy-job-profile-title" className="mb-4 text-heading font-semibold text-brand">
        {t.vacancies.jobProfileTitle}
      </h2>

      {/* DISC Targets */}
      {discSource && discEntries.length > 0 && (
        <div className="mb-4">
          <h3 className={SUBHEAD}>{t.vacancies.pcaExpected}</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {discEntries.map((entry) => {
              const range = (discSource as Record<string, DiscRange>)[entry.key];
              if (!range) return null;
              const avg = (range.min + range.max) / 2;
              return (
                <div key={entry.key} className="rounded-lg bg-surface p-3 text-center">
                  <p className="text-caption text-secondary">{entry.label}</p>
                  <p className="text-xl font-semibold tabular-nums text-brand">
                    {range.min}–{range.max}
                  </p>
                  <ProgressBar value={avg} label={entry.label} hideLabel kind="meter" className="mt-1" />
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* MIL Expected */}
      {mil?.minScore && (
        <div className="mb-4">
          <h3 className={SUBHEAD}>{t.vacancies.milExpected}</h3>
          <div className="flex items-center gap-3">
            <ProgressBar
              value={mil.minScore}
              label={t.vacancies.milExpected}
              hideLabel
              kind="meter"
              className="flex-1"
            />
            <span className="shrink-0 text-body font-medium tabular-nums text-brand">
              {t.vacancies.minScore}: {mil.minScore}
            </span>
          </div>
        </div>
      )}

      {/* Competencies */}
      {competencies.length > 0 && (
        <div className="mb-4">
          <h3 className={SUBHEAD}>{t.vacancies.competencies}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {competencies.map((c) => (
              <div key={c.key} className="flex items-center justify-between gap-2 rounded-lg bg-surface px-3 py-2">
                <div className="min-w-0">
                  <span className="break-words text-body text-primary">{c.name}</span>
                  {c.description && <p className="break-words text-caption text-secondary">{c.description}</p>}
                </div>
                {c.targetLevel !== null && (
                  <div
                    className="flex gap-0.5 shrink-0"
                    role="img"
                    aria-label={t.vacancies.competencyLevelBadge
                      .replace('{n}', String(c.targetLevel))
                      .replace('{max}', String(c.scaleMax))}
                  >
                    {Array.from({ length: c.scaleMax }).map((_, j) => (
                      <span
                        key={j}
                        className={`size-2 rounded-full ${j < (c.targetLevel ?? 0) ? 'bg-brand' : 'bg-field-border'}`}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Requirements: two labelled lists, so required vs nice-to-have is never shown by a dot colour alone. */}
      {requirements.length > 0 && (
        <div className="mb-4">
          <h3 className={SUBHEAD}>{t.vacancies.mandatoryReqs}</h3>
          {[
            { key: 'required', label: t.vacancies.requiredReqs, items: requirements.filter((r) => r.isRequired) },
            { key: 'desired', label: t.vacancies.desiredReqs, items: requirements.filter((r) => !r.isRequired) },
          ]
            .filter((group) => group.items.length > 0)
            .map((group) => (
              <div key={group.key} className="mb-2 last:mb-0">
                <h4 className="text-callout font-semibold text-secondary">{group.label}</h4>
                <ul className="mt-1 list-disc space-y-1 pl-5 text-body text-primary">
                  {group.items.map((r, i) => (
                    <li key={i}>{r.text}</li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}

      {/* KPIs */}
      {kpis.length > 0 && (
        <div>
          <h3 className={SUBHEAD}>{t.vacancies.kpis}</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {kpis.map((kpi, i) => (
              <div key={i} className="rounded-lg bg-surface p-2.5 text-center">
                <p className="text-caption text-secondary">{kpi.name}</p>
                <p className="text-subheading font-semibold text-brand">{kpi.target}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
