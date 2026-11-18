'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import {
  BUTTON_GROUP_CLASSES,
  Button,
  EmptyState,
  ErrorState,
  Field,
  PageHeader,
  Skeleton,
  TextInput,
} from '../../../../components';
import { formatMessage } from '../../../../lib/i18n/format';
import { isPilotScope } from '../../../../lib/launch-scope';

const ALL_DIMENSIONS = ['assessment', 'interview', 'experience', 'education', 'languages'] as const;
type Dimension = (typeof ALL_DIMENSIONS)[number];
// Assessments are not part of the pilot: the form does not ask for their weight (it saves 0). The table
// still shows it whenever a listed profile gives it weight (scoring bootstraps "Default" at 20 % each), so
// the columns on screen always add up to what scoring uses.
const PILOT = isPilotScope();
const DIMENSIONS: readonly Dimension[] = PILOT ? ALL_DIMENSIONS.filter((d) => d !== 'assessment') : ALL_DIMENSIONS;
const EVEN_WEIGHT = 1 / DIMENSIONS.length;

/** 0.25 -> "25 %": profiles read as shares of the score, not as raw decimals. */
function formatWeight(weight: number | undefined): string {
  return `${toPercent(weight ?? 0)} %`;
}

/** The form edits whole percents (5 % steps); the saved payload stays the 0–1 share it always was. */
function toPercent(weight: number): number {
  return Math.round(weight * 100);
}

export default function FitWeightsPage() {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState('');
  const [weights, setWeights] = useState<Record<Dimension, number>>(() => ({
    assessment: PILOT ? 0 : EVEN_WEIGHT,
    interview: EVEN_WEIGHT,
    experience: EVEN_WEIGHT,
    education: EVEN_WEIGHT,
    languages: EVEN_WEIGHT,
  }));

  const profiles = trpc.fitEngine.listRoleFamilyWeightProfiles.useQuery();

  const upsert = trpc.fitEngine.upsertRoleFamilyWeightProfile.useMutation({
    onSuccess: () => {
      toast(t.fitWeights.saved, { type: 'success' });
      utils.fitEngine.listRoleFamilyWeightProfiles.invalidate();
      setShowForm(false);
      setName('');
    },
    onError: (err) => toast(err.message, { type: 'error' }),
  });

  const weightLabels: Record<Dimension, string> = {
    assessment: t.fitWeights.weightAssessment,
    interview: t.fitWeights.weightInterview,
    experience: t.fitWeights.weightExperience,
    education: t.fitWeights.weightEducation,
    languages: t.fitWeights.weightLanguages,
  };

  const sum = DIMENSIONS.reduce((s, d) => s + weights[d], 0);
  const sumValid = Math.abs(sum - 1) < 0.001;
  const hasStoredAssessmentWeight = (profiles.data ?? []).some((p) => (p.weights.assessment ?? 0) > 0);
  const tableDimensions: readonly Dimension[] = PILOT && hasStoredAssessmentWeight ? ALL_DIMENSIONS : DIMENSIONS;
  const closeForm = () => {
    setShowForm(false);
    setName('');
  };

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader
        title={t.fitWeights.pageTitle}
        actions={
          !showForm && (
            <Button variant="primary" onClick={() => setShowForm(true)}>
              {t.fitWeights.createButton}
            </Button>
          )
        }
      />

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        <p className="max-w-3xl text-body text-secondary">{t.fitWeights.explainer}</p>
        {PILOT && hasStoredAssessmentWeight && (
          <p className="max-w-3xl text-body text-secondary">{t.fitWeights.pilotStoredAssessmentNote}</p>
        )}
        {showForm && (
          <section
            aria-labelledby="fit-profile-form-title"
            className="max-w-3xl space-y-4 rounded-xl bg-white p-4 shadow-card md:p-5"
          >
            <h2 id="fit-profile-form-title" className="text-heading font-semibold text-primary">
              {t.fitWeights.formTitle}
            </h2>
            <Field label={t.fitWeights.profileName} id="fit-profile-name" required>
              <TextInput
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.fitWeights.profileNamePlaceholder}
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {DIMENSIONS.map((dim) => (
                <Field key={dim} label={weightLabels[dim]} id={`fit-weight-${dim}`}>
                  {(control) => (
                    <div className="relative">
                      <TextInput
                        {...control}
                        aria-describedby="fit-weight-sum"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={100}
                        step={5}
                        value={toPercent(weights[dim])}
                        onChange={(e) => setWeights((w) => ({ ...w, [dim]: Number(e.target.value) / 100 }))}
                        className="pr-8 tabular-nums"
                      />
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-body text-secondary"
                      >
                        %
                      </span>
                    </div>
                  )}
                </Field>
              ))}
            </div>
            <p
              id="fit-weight-sum"
              role="status"
              className={`flex items-center gap-1 text-callout ${sumValid ? 'text-secondary' : 'font-medium text-danger'}`}
            >
              {!sumValid && (
                <svg
                  className="size-3.5 shrink-0"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v4m0 4h.01" strokeLinecap="round" />
                </svg>
              )}
              {formatMessage(t.fitWeights.sumOf, { sum: toPercent(sum) })}
            </p>
            <div className={BUTTON_GROUP_CLASSES}>
              <Button variant="secondary" onClick={closeForm}>
                {t.common.cancel}
              </Button>
              <Button
                onClick={() => upsert.mutate({ name, weights })}
                disabled={!name || !sumValid}
                loading={upsert.isPending}
              >
                {t.fitWeights.saveButton}
              </Button>
            </div>
          </section>
        )}

        {profiles.isLoading ? (
          <Skeleton className="h-32 w-full rounded-xl" />
        ) : profiles.isError ? (
          <ErrorState onRetry={() => profiles.refetch()} error={profiles.error} />
        ) : (profiles.data ?? []).length === 0 ? (
          <EmptyState title={t.fitWeights.emptyTitle} description={t.fitWeights.emptyBody} />
        ) : (
          <div className="rounded-xl bg-white p-4 shadow-card md:overflow-x-auto md:p-5">
            {/* Below md each profile is a stacked block: the column name comes from data-label (no duplicate text). */}
            <table className="w-full text-callout max-md:block md:min-w-[560px]">
              <thead className="max-md:sr-only">
                <tr className="border-b border-border text-secondary">
                  <th scope="col" className="pb-2 text-left font-medium">
                    {t.fitWeights.profileName}
                  </th>
                  {tableDimensions.map((dim) => (
                    <th key={dim} scope="col" className="pb-2 text-right font-medium">
                      {weightLabels[dim]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="text-primary max-md:block max-md:divide-y max-md:divide-border">
                {(profiles.data ?? []).map((p) => (
                  <tr key={p.id} className="border-b border-border max-md:block max-md:border-0 max-md:py-3">
                    <th scope="row" className="py-2.5 text-left font-medium max-md:block max-md:py-1 max-md:text-body">
                      {p.name}
                    </th>
                    {tableDimensions.map((dim) => (
                      <td
                        key={dim}
                        data-label={weightLabels[dim]}
                        className="py-2.5 text-right tabular-nums max-md:flex max-md:justify-between max-md:py-1 max-md:before:text-secondary max-md:before:content-[attr(data-label)]"
                      >
                        {formatWeight(p.weights[dim])}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
