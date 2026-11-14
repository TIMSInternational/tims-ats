'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { Button, UserPicker } from '../../../../../components';
import { VacancyChoiceGroups } from '../vacancy-choice-groups';
import type { SalaryBandStatus } from '../../../../../lib/money-amount';
import { CONTRACT_TYPES, hintCls, inputCls, labelCls, textareaCls } from '../create-modal.helpers';
import { SalaryBandFields } from '../salary-band-fields';
import type { EditVacancyForm } from './edit-vacancy-form';

interface EditVacancyFieldsProps {
  form: EditVacancyForm;
  onChange: (patch: Partial<EditVacancyForm>) => void;
  disabled: boolean;
  salaryStatus: SalaryBandStatus;
  wideConfirmed: boolean;
  onConfirmWide: (confirmed: boolean) => void;
}

/** The editable fields of the vacancy "Editar" drawer, laid out for the drawer's single column. */
export function EditVacancyFields({
  form,
  onChange,
  disabled,
  salaryStatus,
  wideConfirmed,
  onConfirmWide,
}: EditVacancyFieldsProps) {
  const { t } = useI18n();
  const [pickingManager, setPickingManager] = useState(false);
  // A legacy contract type outside today's list stays selectable, so an unrelated edit never drops it.
  const contractTypes: string[] = [...CONTRACT_TYPES];
  if (form.contractType && !contractTypes.includes(form.contractType)) contractTypes.push(form.contractType);
  const contractLabels: Record<string, string> = t.portal.contractTypes;

  return (
    <fieldset disabled={disabled} className="space-y-4">
      <div>
        <label htmlFor="edit-vacancy-title" className={labelCls}>
          {t.vacancies.titleField}
        </label>
        <input
          id="edit-vacancy-title"
          type="text"
          value={form.title}
          maxLength={200}
          className={inputCls}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </div>

      <div>
        <label htmlFor="edit-vacancy-location" className={labelCls}>
          {t.vacancies.location}
        </label>
        <input
          id="edit-vacancy-location"
          type="text"
          value={form.location}
          maxLength={200}
          className={inputCls}
          placeholder={t.vacancies.locationPlaceholder}
          onChange={(e) => onChange({ location: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="edit-vacancy-contract" className={labelCls}>
            {t.vacancies.contractTypeLabel}
          </label>
          <select
            id="edit-vacancy-contract"
            value={form.contractType}
            className={`${inputCls} pr-8`}
            onChange={(e) => onChange({ contractType: e.target.value })}
          >
            {form.contractType === '' && <option value="">—</option>}
            {contractTypes.map((value) => (
              <option key={value} value={value}>
                {contractLabels[value] ?? value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="edit-vacancy-positions" className={labelCls}>
            {t.vacancies.positions}
          </label>
          <input
            id="edit-vacancy-positions"
            type="number"
            inputMode="numeric"
            min={1}
            max={100}
            value={form.positions}
            className={inputCls}
            onChange={(e) => onChange({ positions: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)) })}
          />
        </div>
      </div>

      {/* The same segmented groups as the create wizard (one way to set modality and priority). */}
      <VacancyChoiceGroups
        remotePolicy={form.remotePolicy}
        onRemotePolicyChange={(remotePolicy) => onChange({ remotePolicy })}
        priority={form.priority}
        onPriorityChange={(priority) => onChange({ priority })}
      />

      <div>
        <label htmlFor="edit-vacancy-description" className={labelCls}>
          {t.vacancies.description}
        </label>
        <textarea
          id="edit-vacancy-description"
          value={form.description}
          maxLength={5000}
          rows={10}
          aria-describedby="edit-vacancy-description-hint"
          className={textareaCls}
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <p id="edit-vacancy-description-hint" className={hintCls}>
          {t.vacancies.editDescriptionHint}
        </p>
      </div>

      <div className="border-t border-border pt-4">
        <h3 className="mb-3 text-subheading font-semibold text-brand">{t.vacancies.salaryRange}</h3>
        <SalaryBandFields
          idPrefix="edit-vacancy"
          salaryMin={form.salaryMin}
          salaryMax={form.salaryMax}
          currency={form.currency}
          salaryPeriod={form.salaryPeriod}
          onChange={onChange}
          status={salaryStatus}
          wideConfirmed={wideConfirmed}
          onConfirmWide={onConfirmWide}
          gridClassName="grid grid-cols-1 gap-3 sm:grid-cols-2"
        />
      </div>

      <div className="border-t border-border pt-4">
        <p id="edit-vacancy-hiring-manager-label" className={labelCls}>
          {t.vacancies.hiringManager}
        </p>
        {form.hiringManager ? (
          <div className="flex min-h-9 items-center justify-between gap-2 rounded-lg border border-field-border px-3">
            <span className="truncate text-body text-primary">
              {form.hiringManager.firstName} {form.hiringManager.lastName}
            </span>
            <Button variant="tertiary" size="sm" onClick={() => onChange({ hiringManager: null })}>
              {t.vacancies.clearHiringManager}
            </Button>
          </div>
        ) : pickingManager ? (
          <UserPicker
            // Same directory as the create wizard (every active member may be the vacancy's hiring manager).
            purpose="vacancy_assignee"
            autoFocus={false}
            ariaLabelledBy="edit-vacancy-hiring-manager-label"
            onSelect={(_id, user) => {
              onChange({ hiringManager: user });
              setPickingManager(false);
            }}
            searchPlaceholder={t.vacancies.searchApprovers}
            loadingLabel={t.vacancies.loadingApprovers}
            emptyLabel={t.vacancies.noApproversFound}
          />
        ) : (
          <Button variant="secondary" onClick={() => setPickingManager(true)}>
            {t.vacancies.pickHiringManager}
          </Button>
        )}
        <p className={hintCls}>{t.vacancies.editHiringManagerHint}</p>
      </div>
    </fieldset>
  );
}
