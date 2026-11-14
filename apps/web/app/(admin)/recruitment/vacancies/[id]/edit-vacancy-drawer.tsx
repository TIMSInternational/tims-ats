'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { Button, Drawer } from '../../../../../components';
import { usePermissions } from '../../../../../lib/permissions';
import { salaryBandStatus } from '../../../../../lib/money-amount';
import { EditVacancyFields } from './edit-vacancy-fields';
import { CompetenciesSection } from '../competencies-section';
import { requestDialogClose } from '../request-dialog-close';
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
  withDefaultCurrency,
  validateEditForm,
  type EditableVacancy,
  type EditVacancyForm,
} from './edit-vacancy-form';
import { useTenantLocale } from '../../../../../lib/tenant-locale-context';

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
  const tenant = useTenantLocale();
  // A vacancy saved without a currency keeps '' in state; the tenant's currency is applied at render, never
  // frozen at mount — the admin shell's one organization.getCurrent can resolve after the drawer opened.
  const [storedInitial] = useState<EditVacancyForm>(() => initialEditForm(vacancy, ''));
  const [storedForm, setForm] = useState<EditVacancyForm>(storedInitial);
  const initial = withDefaultCurrency(storedInitial, tenant.currency);
  const form = withDefaultCurrency(storedForm, tenant.currency);
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

  // The band the person confirmed as correct although its minimum is below a tenth of its maximum.
  const [confirmedRangeKey, setConfirmedRangeKey] = useState<string | null>(null);
  const salaryStatus = salaryBandStatus(form.salaryMin, form.salaryMax, form.currency);
  const error = validateEditForm(initial, form, confirmedRangeKey);
  const patch = error === null ? buildVacancyPatch(initial, form) : null;
  const competencyError = validateCompetencyDrafts(competencies);
  const competenciesDirty = competenciesChanged(initialCompetencies, competencies);
  const hasChanges = patch !== null || competenciesDirty;
  // The salary band explains its own errors next to the amounts (SalaryBandFields / MoneyInput); this summary
  // only adds what is not shown there.
  const errorText = error === 'titleRequired' ? t.vacancies.editTitleRequired : null;

  const save = () => {
    if (error !== null || competencyError !== null || !hasChanges) return;
    update.mutate({
      id: vacancyId,
      ...(patch ?? {}),
      ...(competenciesDirty ? { competencies: toCompetencyInput(competencies) } : {}),
    });
  };

  return (
    <Drawer
      title={t.vacancies.editVacancyTitle}
      onClose={onClose}
      size="lg"
      dirty={hasChanges && !update.isPending}
      footer={
        <>
          {!hasChanges && error === null && (
            <p className="text-callout text-secondary sm:mr-auto sm:self-center">{t.vacancies.editNoChanges}</p>
          )}
          <Button
            variant="secondary"
            onClick={(e) => requestDialogClose(e, t.common.close, onClose)}
            disabled={update.isPending}
          >
            {t.common.cancel}
          </Button>
          <Button
            onClick={save}
            disabled={error !== null || competencyError !== null || !hasChanges}
            loading={update.isPending}
            loadingLabel={t.common.saving}
          >
            {t.vacancies.editSave}
          </Button>
        </>
      }
    >
      {(vacancyStatus === 'published' || vacancyStatus === 'frozen') && (
        <p className="mb-4 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-callout text-warning">
          {vacancyStatus === 'published' ? t.vacancies.editPublishedNotice : t.vacancies.editFrozenNotice}
        </p>
      )}

      <EditVacancyFields
        form={form}
        onChange={(next) => setForm((prev) => ({ ...prev, ...next }))}
        disabled={update.isPending}
        salaryStatus={salaryStatus}
        wideConfirmed={confirmedRangeKey === salaryStatus.rangeKey}
        onConfirmWide={(confirmed) => setConfirmedRangeKey(confirmed ? salaryStatus.rangeKey : null)}
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
          className="mt-4 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-callout text-danger"
        >
          {errorText}
        </p>
      )}
      {update.error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-callout text-danger"
        >
          {t.vacancies.editFailed}: {update.error.message}
        </p>
      )}
    </Drawer>
  );
}
