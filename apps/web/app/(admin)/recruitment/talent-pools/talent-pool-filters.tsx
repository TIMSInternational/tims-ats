'use client';

import { useId } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { Button, CHOICE_INPUT_CLASSES, CHOICE_ROW_CLASSES } from '../../../../components';
import { CANDIDATE_POOL_TYPES, candidatePoolLabel, type CandidatePoolLabels } from '../../../../lib/candidate-labels';
import type { TalentPoolFilterState } from './page';

interface PoolFilterProps {
  filters: TalentPoolFilterState;
  onFilterChange: <K extends keyof TalentPoolFilterState>(key: K, value: TalentPoolFilterState[K]) => void;
  onClear: () => void;
  /** Layout classes for the container (the desktop sidebar passes its width and border). */
  className?: string;
  /** Inside the mobile filter sheet the dialog title already says "Filtros". */
  hideTitle?: boolean;
}

export const POOL_TYPE_OPTIONS = [
  { value: 'active', i18nKey: 'activeCandidates' },
  { value: 'passive', i18nKey: 'passiveCandidates' },
  { value: 'historic_finalist', i18nKey: 'historicFinalists' },
  { value: 'high_potential_rejected', i18nKey: 'highPotentialRejected' },
  { value: 'referral', i18nKey: 'referrals' },
  { value: 'internal', i18nKey: 'internalCandidates' },
  { value: 'ex_employee', i18nKey: 'exEmployees' },
] as const;

type TalentPoolCopy = Record<(typeof POOL_TYPE_OPTIONS)[number]['i18nKey'], string>;

/** A pool slug in words: the shared candidate labels first, then the talent-pool-only types. */
export function talentPoolTypeLabel(slug: string, candidates: CandidatePoolLabels, talentPool: TalentPoolCopy): string {
  if ((CANDIDATE_POOL_TYPES as readonly string[]).includes(slug)) return candidatePoolLabel(slug, candidates);
  const option = POOL_TYPE_OPTIONS.find((o) => o.value === slug);
  return option ? talentPool[option.i18nKey] : candidatePoolLabel(slug, candidates);
}

const SKILL_OPTIONS = ['Node.js', 'React', 'Python', 'AWS', 'TypeScript', 'Java', 'SQL', 'K8s', 'Go', 'Docker'];

function toggleArrayValue(arr: string[], value: string): string[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

const GROUP_LABEL = 'mb-2 text-callout font-semibold text-primary';

/**
 * The talent-pool filters. Only filters the list query applies are offered: one candidate type, a FIT
 * minimum and skills (searching.md › Best practices). Search lives above the results at every width.
 */
export function TalentPoolFilters({ filters, onFilterChange, onClear, className = '', hideTitle }: PoolFilterProps) {
  const { t } = useI18n();
  const tp = t.talentPool;
  const selectedPool = filters.poolTypes.length === 1 ? filters.poolTypes[0] : '';
  // The sidebar and the phone sheet can both be mounted: every id and radio group name is per instance.
  const uid = useId();
  const groupName = `pool-type-${uid}`;
  const fitId = `pool-fit-min-${uid}`;
  const skillsLabelId = `pool-skills-label-${uid}`;

  return (
    <div className={`space-y-5 bg-white ${className}`}>
      <div className={`flex items-center ${hideTitle ? 'justify-end' : 'justify-between'}`}>
        {!hideTitle && <h2 className="text-subheading font-semibold text-brand">{tp.filters}</h2>}
        <Button variant="tertiary" size="sm" onClick={onClear}>
          {t.common.clearFilters}
        </Button>
      </div>

      <fieldset>
        <legend className={GROUP_LABEL}>{tp.poolType}</legend>
        <div className="space-y-0.5">
          <label className={CHOICE_ROW_CLASSES}>
            <input
              type="radio"
              name={groupName}
              checked={selectedPool === ''}
              onChange={() => onFilterChange('poolTypes', [])}
              className={CHOICE_INPUT_CLASSES}
            />
            {tp.allPoolTypes}
          </label>
          {POOL_TYPE_OPTIONS.map((opt) => (
            <label key={opt.value} className={CHOICE_ROW_CLASSES}>
              <input
                type="radio"
                name={groupName}
                checked={selectedPool === opt.value}
                onChange={() => onFilterChange('poolTypes', [opt.value])}
                className={CHOICE_INPUT_CLASSES}
              />
              {tp[opt.i18nKey]}
            </label>
          ))}
        </div>
      </fieldset>

      <div>
        <label htmlFor={fitId} className={`block ${GROUP_LABEL}`}>
          {tp.fitScore}
        </label>
        <div className="flex items-center gap-3">
          <input
            id={fitId}
            type="range"
            min="0"
            max="100"
            step="5"
            value={filters.fitMin}
            onChange={(e) => onFilterChange('fitMin', Number(e.target.value))}
            aria-valuetext={formatMessage(tp.fitMinValue, { n: filters.fitMin })}
            className="h-6 min-w-0 flex-1 accent-brand"
          />
          <span className="w-10 text-right text-body font-medium tabular-nums text-brand" aria-hidden="true">
            {filters.fitMin}+
          </span>
        </div>
      </div>

      <div role="group" aria-labelledby={skillsLabelId}>
        <p id={skillsLabelId} className={GROUP_LABEL}>
          {tp.frequentSkills}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {SKILL_OPTIONS.map((skill) => {
            const active = filters.skills.includes(skill);
            return (
              <button
                key={skill}
                type="button"
                aria-pressed={active}
                onClick={() => onFilterChange('skills', toggleArrayValue(filters.skills, skill))}
                className={`inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 text-callout transition-colors pointer-coarse:min-h-11 ${
                  active
                    ? 'border-brand bg-brand-tint font-medium text-brand'
                    : 'border-border bg-white text-secondary hover:bg-surface'
                }`}
              >
                {active && (
                  <svg
                    className="size-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    viewBox="0 0 24 24"
                    aria-hidden="true"
                  >
                    <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
                {skill}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
