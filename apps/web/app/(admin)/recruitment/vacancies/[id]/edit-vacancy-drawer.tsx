'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { trpc } from '../../../../../lib/trpc';
import { toast } from '../../../../../lib/toast';
import { Drawer } from '../../../../../components';
import { EditVacancyFields } from './edit-vacancy-fields';
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
  vacancy: EditableVacancy;
  onClose: () => void;
}

/**
 * "Editar" on the vacancy detail (journeys-23 / spec-39): title, location, modality, contract, positions,
 * priority, description, salary band and hiring manager, through `vacancy.update`. Only changed fields are
 * sent. The server refuses a vacancy pending approval or closed, and the button is not offered for those.
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
  const errorText =
    error === 'titleRequired'
      ? t.vacancies.editTitleRequired
      : error === 'salaryInvalid'
        ? t.vacancies.editSalaryInvalid
        : error === 'salaryRange'
          ? t.vacancies.editSalaryRange
          : null;

  const save = () => {
    if (error !== null || patch === null) return;
    update.mutate({ id: vacancyId, ...patch });
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
        {patch === null && error === null && (
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
          disabled={update.isPending || error !== null || patch === null}
          className="h-9 px-5 rounded-lg bg-[#DD0C15] text-white text-sm font-medium hover:bg-[#c00b13] transition disabled:opacity-50"
        >
          {update.isPending ? t.common.saving : t.vacancies.editSave}
        </button>
      </div>
    </Drawer>
  );
}
