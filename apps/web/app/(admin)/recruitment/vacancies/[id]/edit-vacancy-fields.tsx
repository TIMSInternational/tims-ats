'use client';

import { useState } from 'react';
import { useI18n } from '../../../../../lib/i18n';
import { UserPicker } from '../../../../../components';
import { currencyOptions } from '../../../../../lib/currency-options';
import { CONTRACT_TYPES, inputCls, labelCls, textareaCls } from '../create-modal.helpers';
import type { EditVacancyForm, Priority, RemotePolicy, SalaryPeriod } from './edit-vacancy-form';

interface EditVacancyFieldsProps {
  form: EditVacancyForm;
  onChange: (patch: Partial<EditVacancyForm>) => void;
  disabled: boolean;
}

const hintCls = 'text-[11px] text-[#8B8B8B] mt-1';

/** The editable fields of the vacancy "Editar" drawer, laid out for the drawer's single column. */
export function EditVacancyFields({ form, onChange, disabled }: EditVacancyFieldsProps) {
  const { t } = useI18n();
  const [pickingManager, setPickingManager] = useState(false);
  const currencies = currencyOptions();
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

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="edit-vacancy-modality" className={labelCls}>
            {t.vacancies.workModality}
          </label>
          <select
            id="edit-vacancy-modality"
            value={form.remotePolicy}
            className={`${inputCls} bg-white`}
            onChange={(e) => onChange({ remotePolicy: e.target.value as RemotePolicy | '' })}
          >
            {form.remotePolicy === '' && <option value="">—</option>}
            <option value="onsite">{t.vacancies.onsite}</option>
            <option value="hybrid">{t.vacancies.hybrid}</option>
            <option value="remote">{t.vacancies.remote}</option>
          </select>
        </div>
        <div>
          <label htmlFor="edit-vacancy-contract" className={labelCls}>
            {t.vacancies.contractTypeLabel}
          </label>
          <select
            id="edit-vacancy-contract"
            value={form.contractType}
            className={`${inputCls} bg-white`}
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
            min={1}
            max={100}
            value={form.positions}
            className={inputCls}
            onChange={(e) => onChange({ positions: Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)) })}
          />
        </div>
        <div>
          <label htmlFor="edit-vacancy-priority" className={labelCls}>
            {t.vacancies.priority}
          </label>
          <select
            id="edit-vacancy-priority"
            value={form.priority}
            className={`${inputCls} bg-white`}
            onChange={(e) => onChange({ priority: e.target.value as Priority })}
          >
            <option value="low">{t.vacancies.priorityLow}</option>
            <option value="medium">{t.vacancies.priorityMedium}</option>
            <option value="high">{t.vacancies.priorityHigh}</option>
            <option value="urgent">{t.vacancies.priorityUrgent}</option>
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="edit-vacancy-description" className={labelCls}>
          {t.vacancies.description}
        </label>
        <textarea
          id="edit-vacancy-description"
          value={form.description}
          maxLength={5000}
          rows={10}
          className={textareaCls}
          onChange={(e) => onChange({ description: e.target.value })}
        />
        <p className={hintCls}>{t.vacancies.editDescriptionHint}</p>
      </div>

      <div className="border-t border-[#EDEDED] pt-4">
        <p className="text-[13px] font-medium text-[#1F114C] mb-3">{t.vacancies.salaryRange}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="edit-vacancy-salary-min" className={labelCls}>
              {t.vacancies.salaryMin}
            </label>
            <input
              id="edit-vacancy-salary-min"
              type="number"
              min={0}
              value={form.salaryMin}
              className={inputCls}
              placeholder={t.vacancies.salaryMinPlaceholder}
              onChange={(e) => onChange({ salaryMin: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="edit-vacancy-salary-max" className={labelCls}>
              {t.vacancies.salaryMax}
            </label>
            <input
              id="edit-vacancy-salary-max"
              type="number"
              min={0}
              value={form.salaryMax}
              className={inputCls}
              placeholder={t.vacancies.salaryMaxPlaceholder}
              onChange={(e) => onChange({ salaryMax: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="edit-vacancy-currency" className={labelCls}>
              {t.vacancies.currency}
            </label>
            <select
              id="edit-vacancy-currency"
              value={form.currency}
              className={`${inputCls} bg-white`}
              onChange={(e) => onChange({ currency: e.target.value })}
            >
              {!currencies.some((c) => c.code === form.currency) && (
                <option value={form.currency}>{form.currency}</option>
              )}
              {currencies.map((opt) => (
                <option key={opt.code} value={opt.code}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="edit-vacancy-period" className={labelCls}>
              {t.vacancies.period}
            </label>
            <select
              id="edit-vacancy-period"
              value={form.salaryPeriod}
              className={`${inputCls} bg-white`}
              onChange={(e) => onChange({ salaryPeriod: e.target.value as SalaryPeriod })}
            >
              <option value="monthly">{t.vacancies.monthly}</option>
              <option value="yearly">{t.vacancies.yearly}</option>
            </select>
          </div>
        </div>
      </div>

      <div className="border-t border-[#EDEDED] pt-4">
        <p className={labelCls}>{t.vacancies.hiringManager}</p>
        {form.hiringManager ? (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-[#EDEDED] px-3 h-10">
            <span className="text-sm text-[#333] truncate">
              {form.hiringManager.firstName} {form.hiringManager.lastName}
            </span>
            <button
              type="button"
              onClick={() => onChange({ hiringManager: null })}
              className="text-[12px] text-[#DD0C15] font-medium"
            >
              {t.vacancies.clearHiringManager}
            </button>
          </div>
        ) : pickingManager ? (
          <UserPicker
            // Same directory as the create wizard (every active member may be the vacancy's hiring manager).
            purpose="vacancy_assignee"
            autoFocus={false}
            onSelect={(_id, user) => {
              onChange({ hiringManager: user });
              setPickingManager(false);
            }}
            searchPlaceholder={t.vacancies.searchApprovers}
            loadingLabel={t.vacancies.loadingApprovers}
            emptyLabel={t.vacancies.noApproversFound}
          />
        ) : (
          <button
            type="button"
            onClick={() => setPickingManager(true)}
            className="h-9 px-3 rounded-lg border border-[#EDEDED] text-[12px] text-[#1F114C] font-medium hover:bg-[#F6F6F6] transition"
          >
            {t.vacancies.pickHiringManager}
          </button>
        )}
        <p className={hintCls}>{t.vacancies.editHiringManagerHint}</p>
      </div>
    </fieldset>
  );
}
