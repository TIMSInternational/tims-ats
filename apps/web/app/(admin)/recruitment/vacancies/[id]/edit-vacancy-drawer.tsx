'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { Drawer } from '../../../../../components';
import { usePermissions } from '../../../../../lib/permissions';
import { EditVacancyFields } from './edit-vacancy-fields';
import { CompetenciesSection } from '../competencies-section';
import {
  competenciesChanged,
  draftsFromStored,
  toCompetencyInput,
  validateCompetencyDrafts,
  type CompetencyDraft,
  type CompetencySuggestion,
} from '../competencies-model';
import {
  buildVacancyPatch,
  initialEditForm,
  validateEditForm,
  type EditableVacancy,
  type EditVacancyForm,
} from './edit-vacancy-form';

interface EditVacancyDrawerProps {
  vacancyId: string;
  vacancyStatus: string;
  /** The vacancy detail; its job profile seeds "Competencias del puesto". */
  vacancy: EditableVacancy & { jobProfile?: { competencies: unknown } | null };
  onClose: () => void;
}

/**
 * "Editar" on the vacancy detail (journeys-23 / spec-39): title, location, modality, contract, positions,
 * priority, description, salary band and hiring manager, through `vacancy.update`. Only changed fields are
 * sent. The server refuses a vacancy pending approval or closed, and the button is not offered for those.
 * "Competencias del puesto" (the scorecard's job profile) is saved by the same `vacancy.update`, under the
 * same status check, and only when it changed.
 */
export function EditVacancyDrawer({ vacancyId, vacancyStatus, vacancy, onClose }: EditVacancyDrawerProps) {
  const { t } = useI18n();
  const utils = trpc.useUtils();
  const [initial] = useState<EditVacancyForm>(() => initialEditForm(vacancy));
  const [form, setForm] = useState<EditVacancyForm>(initial);
  const [initialCompetencies] = useState<CompetencyDraft[]>(() => draftsFromStored(vacancy.jobProfile?.competencies));
  const [competencies, setCompetencies] = useState<CompetencyDraft[]>(initialCompetencies);
  const [suggestions, setSuggestions] = useState<CompetencySuggestion[]>([]);
  const canSuggest = usePermissions().can('vacancy', 'create');

  const update = trpc.vacancy.update.useMutation({
    onSuccess: () => {
      utils.vacancy.getById.invalidate({ id: vacancyId });
      utils.vacancy.list.invalidate();
      toast(t.vacancies.updated, { type: 'success' });
      onClose();
    },
    onError: (err) => {
      toast(err.message || t.vacancies.editFailed, { type: 'error' });
      // CONFLICT: the vacancy moved on (submitted for approval or closed elsewhere) - refetch the page.
      if (err.data?.code === 'CONFLICT') utils.vacancy.getById.invalidate({ id: vacancyId });
    },
  });

  const error = validateEditForm(initial, form);
  const patch = error === null ? buildVacancyPatch(initial, form) : null;
  const competencyError = validateCompetencyDrafts(competencies);
  const competenciesDirty = competenciesChanged(initialCompetencies, competencies);
  const hasChanges = patch !== null || competenciesDirty;
  const errorText =
    error === 'titleRequired'
      ? t.vacancies.editTitleRequired
      : error === 'salaryInvalid'
        ? t.vacancies.editSalaryInvalid
        : error === 'salaryRange'
          ? t.vacancies.editSalaryRange
          : null;

  const save = () => {
    if (error !== null || competencyError !== null || !hasChanges) return;
    update.mutate({
      id: vacancyId,
      ...(patch ?? {}),
      ...(competenciesDirty ? { competencies: toCompetencyInput(competencies) } : {}),
    });
  };

  return (
    <Drawer title={t.vacancies.editVacancyTitle} onClose={onClose}>
      {(vacancyStatus === 'published' || vacancyStatus === 'frozen') && (
        <p className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-[#92400e]">
          {vacancyStatus === 'published' ? t.vacancies.editPublishedNotice : t.vacancies.editFrozenNotice}
        </p>
      )}

      <EditVacancyFields
        form={form}
        onChange={(next) => setForm((prev) => ({ ...prev, ...next }))}
        disabled={update.isPending}
      />

      <div className="mt-5">
        <CompetenciesSection
          value={competencies}
          onChange={setCompetencies}
          suggestions={suggestions}
          onSuggestionsChange={setSuggestions}
          title={form.title}
          descriptionText={form.description}
          canSuggest={canSuggest}
          disabled={update.isPending}
        />
      </div>

      {errorText && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-[#991b1b]"
        >
          {errorText}
        </p>
      )}
      {update.error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12px] text-[#991b1b]"
        >
          {t.vacancies.editFailed}: {update.error.message}
        </p>
      )}

      <div className="flex items-center justify-end gap-3 mt-6 pt-4 border-t border-[#EDEDED]">
        {!hasChanges && error === null && (
          <p className="mr-auto text-[11px] text-[#8B8B8B]">{t.vacancies.editNoChanges}</p>
        )}
        <button
          type="button"
          onClick={onClose}
          className="h-9 px-4 rounded-lg border border-[#EDEDED] text-sm text-[#585858] hover:bg-[#F6F6F6] transition"
        >
          {t.common.cancel}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={update.isPending || error !== null || competencyError !== null || !hasChanges}
          className="h-9 px-5 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
        >
          {update.isPending ? t.common.saving : t.vacancies.editSave}
        </button>
      </div>
    </Drawer>
  );
}
