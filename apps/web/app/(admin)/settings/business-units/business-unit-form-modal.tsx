'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Modal } from '../../../../components';
import { useOrgStructureMutation, type OrgBusinessUnit } from '../../../../lib/platform-api/org-structure';
import { useOrgErrorMessage } from './use-org-error-message';
import { alertCls, inputCls, labelCls, primaryBtn, secondaryBtn } from './units-styles';

const NAME_MAX = 120;
const CODE_MAX = 40;

interface BusinessUnitFormModalProps {
  /** Present = rename/edit that unit; absent = create a new one. */
  unit?: OrgBusinessUnit;
  companies: Array<{ id: string; name: string }>;
  onClose: () => void;
}

/** Create a business unit, or rename / re-code an existing one (C# org structure). */
export function BusinessUnitFormModal({ unit, companies, onClose }: BusinessUnitFormModalProps) {
  const { t } = useI18n();
  const errorMessage = useOrgErrorMessage();
  const [name, setName] = useState(unit?.name ?? '');
  const [code, setCode] = useState(unit?.code ?? '');
  const [companyId, setCompanyId] = useState(companies.length === 1 ? companies[0]!.id : '');

  const handlers = {
    onSuccess: () => {
      toast(unit ? t.units.unitUpdated : t.units.unitCreated, { type: 'success' });
      onClose();
    },
    onError: (error: unknown) => toast(errorMessage(error), { type: 'error' }),
  };
  const create = useOrgStructureMutation('createBusinessUnit', handlers);
  const update = useOrgStructureMutation('updateBusinessUnit', handlers);
  const active = unit ? update : create;

  const trimmedName = name.trim();
  const needsCompany = !unit && companies.length > 1;
  const canSubmit = trimmedName.length > 0 && (!needsCompany || companyId !== '') && !active.isPending;

  const submit = () => {
    if (!canSubmit) return;
    const trimmedCode = code.trim();
    if (unit) {
      update.mutate({ id: unit.id, name: trimmedName, code: trimmedCode === '' ? null : trimmedCode });
    } else {
      create.mutate({
        name: trimmedName,
        code: trimmedCode === '' ? undefined : trimmedCode,
        companyId: companyId === '' ? undefined : companyId,
      });
    }
  };

  return (
    <Modal title={unit ? t.units.editUnit : t.units.newUnit} onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label htmlFor="bu-name" className={labelCls}>
            {t.units.nameLabel}
          </label>
          <input
            id="bu-name"
            value={name}
            maxLength={NAME_MAX}
            onChange={(e) => setName(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label htmlFor="bu-code" className={labelCls}>
            {t.units.codeLabel}
          </label>
          <input
            id="bu-code"
            value={code}
            maxLength={CODE_MAX}
            onChange={(e) => setCode(e.target.value)}
            className={inputCls}
          />
        </div>
        {needsCompany && (
          <div>
            <label htmlFor="bu-company" className={labelCls}>
              {t.units.companyLabel}
            </label>
            <select
              id="bu-company"
              value={companyId}
              onChange={(e) => setCompanyId(e.target.value)}
              className={inputCls}
            >
              <option value="">{t.units.selectCompany}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {active.error && (
          <p role="alert" className={alertCls}>
            {errorMessage(active.error)}
          </p>
        )}
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <button type="button" onClick={onClose} className={secondaryBtn}>
          {t.units.cancel}
        </button>
        <button type="button" onClick={submit} disabled={!canSubmit} className={primaryBtn}>
          {active.isPending ? t.units.saving : t.units.save}
        </button>
      </div>
    </Modal>
  );
}
