'use client';

import { useState } from 'react';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { Button, Field, Modal, Select, TextInput } from '../../../../components';
import { useOrgStructureMutation, type OrgBusinessUnit } from '../../../../lib/platform-api/org-structure';
import { useOrgErrorMessage } from './use-org-error-message';

const NAME_MAX = 120;
const CODE_MAX = 40;
const FORM_ID = 'business-unit-form';

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
    // Project rule: every mutation toasts its failure; the dialog keeps its inline copy too.
    onError: (error: unknown) => toast(errorMessage(error), { type: 'error' }),
  };
  const create = useOrgStructureMutation('createBusinessUnit', handlers);
  const update = useOrgStructureMutation('updateBusinessUnit', handlers);
  const active = unit ? update : create;

  const trimmedName = name.trim();
  const needsCompany = !unit && companies.length > 1;
  const canSubmit = trimmedName.length > 0 && (!needsCompany || companyId !== '') && !active.isPending;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
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
    <Modal
      title={unit ? t.units.editUnit : t.units.newUnit}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t.units.cancel}
          </Button>
          <Button
            type="submit"
            form={FORM_ID}
            disabled={!canSubmit && !active.isPending}
            loading={active.isPending}
            loadingLabel={t.units.saving}
          >
            {unit ? t.units.saveChanges : t.units.createUnit}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} className="space-y-4">
        <Field id="bu-name" label={t.units.nameLabel}>
          <TextInput value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
        <Field id="bu-code" label={t.units.codeLabel}>
          <TextInput value={code} maxLength={CODE_MAX} onChange={(e) => setCode(e.target.value)} />
        </Field>
        {needsCompany && (
          <Field id="bu-company" label={t.units.companyLabel}>
            <Select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">{t.units.selectCompany}</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {active.error && (
          <p role="alert" className="rounded-lg bg-danger-bg px-3 py-2 text-callout text-danger">
            {errorMessage(active.error)}
          </p>
        )}
      </form>
    </Modal>
  );
}
