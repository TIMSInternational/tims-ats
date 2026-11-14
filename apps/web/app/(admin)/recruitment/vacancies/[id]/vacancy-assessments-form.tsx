'use client';

import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useI18n } from '../../../../../lib/i18n';
import { toast } from '../../../../../lib/toast';
import {
  useSaveVacancyAssessments,
  VacancyAssessmentsConflict,
  type FitRequirementInstrument,
  type VacancyAssessments,
} from '../../../../../lib/platform-api/vacancy-assessments';
import type { StaffCatalogInstrument } from '../../../../../lib/platform-api/assessment-providers-staff';
import {
  assessmentFormSchema,
  newRow,
  toInput,
  toRow,
  type AssessmentForm,
} from '../../../../../lib/assessments/vacancy-assessment-form';
import { VacancyAssessmentRow } from './vacancy-assessment-row';
import { BUTTON_GROUP_CLASSES, Button, selectClasses } from '../../../../../components';

export type CatalogState = 'ok' | 'unavailable' | 'not_connected';

// The editor itself: one row per configured test (react-hook-form + the zod rules FIT v2 applies), an "add" picker
// limited to the catalog instruments not yet listed, and a save that sends the whole array with the version it was
// edited from. A concurrent change comes back as the current array (the card remounts the form on it) with a notice.
export function VacancyAssessmentsForm({
  vacancyId,
  stored,
  catalog,
  catalogState,
  canEdit,
}: {
  vacancyId: string;
  stored: VacancyAssessments;
  catalog: StaffCatalogInstrument[];
  catalogState: CatalogState;
  canEdit: boolean;
}) {
  const { t } = useI18n();
  const va = t.vacancyAssessments;
  const save = useSaveVacancyAssessments(vacancyId);
  const [adding, setAdding] = useState<FitRequirementInstrument | ''>('');
  const form = useForm<AssessmentForm>({
    resolver: zodResolver(assessmentFormSchema),
    defaultValues: { rows: stored.assessments.map(toRow) },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'rows' });
  const listed = new Set(fields.map((field) => field.instrument));
  const addable = catalog.filter((entry) => !listed.has(entry.instrument));
  const ignored = stored.issues.filter((issue) => issue.dropped).length;

  const onSubmit = form.handleSubmit((values) =>
    save.mutate(
      { assessments: values.rows.map(toInput), version: stored.version },
      {
        onSuccess: () => toast(va.saved, { type: 'success' }),
        onError: (error) =>
          toast(error instanceof VacancyAssessmentsConflict ? va.conflict : va.saveError, { type: 'error' }),
      },
    ),
  );

  const catalogNote =
    catalogState === 'not_connected' ? va.notConnected : catalogState === 'unavailable' ? va.catalogUnavailable : null;

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-3">
      {catalogNote && <p className="text-callout text-secondary">{catalogNote}</p>}
      {ignored > 0 && (
        <p role="status" className="text-callout text-warning">
          {va.ignored.replace('{count}', String(ignored))}
        </p>
      )}
      {fields.length === 0 && <p className="text-body text-secondary">{va.empty}</p>}
      <ul className="space-y-3">
        {fields.map((field, index) => (
          <VacancyAssessmentRow
            key={field.id}
            index={index}
            form={form}
            catalogEntry={catalog.find((entry) => entry.instrument === field.instrument) ?? null}
            catalogKnown={catalogState === 'ok'}
            disabled={!canEdit || save.isPending}
            onRemove={() => remove(index)}
          />
        ))}
      </ul>

      {canEdit && addable.length > 0 && (
        <div className="flex items-end gap-2">
          <label className="block flex-1 text-callout font-medium text-primary">
            {va.addLabel}
            <select
              value={adding}
              onChange={(event) => setAdding(event.target.value as FitRequirementInstrument | '')}
              className={`mt-1 font-normal ${selectClasses()}`}
            >
              <option value="">{va.addPlaceholder}</option>
              {addable.map((entry) => (
                <option key={entry.instrument} value={entry.instrument}>
                  {t.candidates.fitInstrumentNames[entry.instrument]}
                </option>
              ))}
            </select>
          </label>
          <Button
            variant="secondary"
            disabled={adding === ''}
            onClick={() => {
              if (adding === '') return;
              append(newRow(adding));
              setAdding('');
            }}
          >
            {va.addButton}
          </Button>
        </div>
      )}

      <p className="text-callout text-secondary">{va.noteNoAutoReject}</p>

      {canEdit && (
        // Sticky: with several tests the form is long, and Save stays in reach while editing any of them.
        <div
          className={`sticky bottom-0 -mx-4 border-t border-border bg-white px-4 py-3 md:-mx-5 md:px-5 ${BUTTON_GROUP_CLASSES}`}
        >
          <Button variant="secondary" disabled={save.isPending || !form.formState.isDirty} onClick={() => form.reset()}>
            {va.discard}
          </Button>
          <Button
            type="submit"
            // Stored entries FIT ignores are removed by a save, so one is offered even without an edit.
            disabled={!form.formState.isDirty && ignored === 0}
            loading={save.isPending}
            loadingLabel={va.saving}
          >
            {va.save}
          </Button>
        </div>
      )}
    </form>
  );
}
