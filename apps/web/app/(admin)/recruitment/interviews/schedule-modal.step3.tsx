'use client';

import { AssignablePeopleError } from '../../../../components';
import type { AssignablePeopleState } from '../../../../lib/platform-api/assignable-people';
import { CHOICE_INPUT_CLASSES, FIELD_HELP_CLASSES, FIELD_LABEL_CLASSES, textareaClasses } from '../../../../components/field-styles';
import { useI18n } from '../../../../lib/i18n';
import { pluralize } from '../../../../lib/i18n/format';
import { interviewTypeLabel } from './[id]/room/interview-type-label';
import { DURATIONS } from './schedule-modal.helpers';

interface Step3FieldsProps {
  evaluators: AssignablePeopleState;
  selectedEvaluatorIds: string[];
  toggleEvaluator: (id: string) => void;
  notes: string;
  setNotes: (value: string) => void;
  selectedCandidateName: string;
  selectedVacancyTitle: string;
  interviewType: string;
  /** The booked date and time, formatted in the scheduling zone with its label. */
  whenLabel: string;
  duration: number;
}

export function Step3Fields({
  evaluators,
  selectedEvaluatorIds,
  toggleEvaluator,
  notes,
  setNotes,
  selectedCandidateName,
  selectedVacancyTitle,
  interviewType,
  whenLabel,
  duration,
}: Step3FieldsProps) {
  const { t, locale } = useI18n();
  const durationKey = DURATIONS.find((d) => d.value === duration)?.labelKey;
  const summary: Array<[string, string]> = [
    [t.interviews.scheduleSummaryCandidate, selectedCandidateName],
    [t.interviews.scheduleSummaryVacancy, selectedVacancyTitle],
    [t.interviews.scheduleSummaryType, interviewTypeLabel(t, interviewType)],
    [t.interviews.scheduleSummaryWhen, durationKey ? `${whenLabel} (${t.interviews[durationKey]})` : whenLabel],
    [
      t.interviews.scheduleSummaryEvaluators,
      pluralize(
        selectedEvaluatorIds.length,
        { one: t.interviews.scheduleEvaluatorsSelectedOne, other: t.interviews.scheduleEvaluatorsSelectedOther },
        locale,
      ),
    ],
  ];
  return (
    <div className="space-y-5">
      <fieldset>
        <legend className={FIELD_LABEL_CLASSES}>{t.interviews.scheduleFieldEvaluators}</legend>
        <p className={`${FIELD_HELP_CLASSES} mt-0 mb-3`}>{t.interviews.scheduleFieldSelectEvaluator}</p>
        <div className="max-h-[200px] space-y-1.5 overflow-y-auto">
          {evaluators.failure ? (
            <AssignablePeopleError failure={evaluators.failure} onRetry={evaluators.refetch} />
          ) : (
            evaluators.people.map((u) => {
              const isSelected = selectedEvaluatorIds.includes(u.id);
              return (
                <label key={u.id}
                  className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors pointer-coarse:min-h-11 ${
                    isSelected ? 'border-brand bg-brand-tint' : 'border-border hover:bg-surface'
                  }`}>
                  <input type="checkbox" checked={isSelected} onChange={() => toggleEvaluator(u.id)} className={CHOICE_INPUT_CLASSES} />
                  <div className="flex flex-1 items-center gap-2">
                    <div className="flex size-7 items-center justify-center rounded-full bg-brand text-caption font-semibold text-white" aria-hidden="true">
                      {u.firstName[0]}{u.lastName[0]}
                    </div>
                    <div>
                      <p className={`text-callout ${isSelected ? 'font-medium text-brand' : 'text-primary'}`}>{u.firstName} {u.lastName}</p>
                      <p className="text-caption text-muted">{u.email}</p>
                    </div>
                  </div>
                </label>
              );
            })
          )}
          {evaluators.isLoading && <p className="py-2 text-callout text-muted">{t.interviews.scheduleFieldLoadingUsers}</p>}
          {!evaluators.isLoading && !evaluators.failure && evaluators.people.length === 0 && (
            <p className="py-2 text-callout text-secondary">{t.assignablePeople.noEvaluators}</p>
          )}
        </div>
      </fieldset>

      <div>
        <label htmlFor="schedule-notes" className={FIELD_LABEL_CLASSES}>{t.interviews.scheduleFieldEvaluatorNotes}</label>
        <textarea id="schedule-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={5000} rows={3} className={textareaClasses('resize-none')}
          placeholder={t.interviews.scheduleFieldEvaluatorNotesPlaceholder} />
      </div>

      {/* Summary */}
      <section aria-labelledby="schedule-summary-title" className="border-t border-border pt-4">
        <h3 id="schedule-summary-title" className="mb-2 text-subheading font-semibold text-primary">{t.interviews.scheduleSummaryHeading}</h3>
        <dl className="space-y-1.5 rounded-lg bg-surface p-3">
          {summary.map(([term, value]) => (
            <div key={term} className="flex justify-between gap-3">
              <dt className="text-callout text-secondary">{term}</dt>
              <dd className="text-right text-callout font-medium text-primary">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
