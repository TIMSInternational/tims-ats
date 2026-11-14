'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { roleLabel } from '../../../../lib/role-labels';
import { BUTTON_GROUP_CLASSES, Button, FIELD_LABEL_CLASSES, StatusBadge, selectClasses } from '../../../../components';
import type { ParsedRow } from './invite-wizard.helpers';

const MAP_FIELDS = ['email', 'firstName', 'lastName', 'role'] as const;
const TH = 'px-3 py-2 text-left text-callout font-semibold text-secondary';

interface BulkMapStepProps {
  rawHeaders: string[];
  rawRows: string[][];
  colMap: Record<string, string>;
  setColMap: (map: Record<string, string>) => void;
  setBulkStep: (step: 'upload') => void;
  onConfirm: () => void;
}

export function BulkMapStep({ rawHeaders, rawRows, colMap, setColMap, setBulkStep, onConfirm }: BulkMapStepProps) {
  const { t } = useI18n();
  const u = t.users;
  const fieldLabel: Record<(typeof MAP_FIELDS)[number], string> = {
    email: u.mapFieldEmail,
    firstName: u.mapFieldFirstName,
    lastName: u.mapFieldLastName,
    role: u.mapFieldRole,
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-2">
        <h3 className="text-subheading font-semibold text-primary">{u.mapColumns}</h3>
        <span className="text-callout text-secondary">{formatMessage(u.rowsDetected, { count: rawRows.length })}</span>
      </div>
      <p className="text-callout text-secondary">{u.mapColumnsDesc}</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {MAP_FIELDS.map((field) => (
          <div key={field}>
            <label htmlFor={`bulk-map-${field}`} className={FIELD_LABEL_CLASSES}>
              {fieldLabel[field]}
            </label>
            <select
              id={`bulk-map-${field}`}
              value={colMap[field] || ''}
              aria-invalid={(field === 'email' && !colMap[field]) || undefined}
              onChange={(e) => setColMap({ ...colMap, [field]: e.target.value })}
              className={selectClasses('md')}
            >
              <option value="">{u.doNotMap}</option>
              {rawHeaders.map((h) => (
                <option key={h} value={h}>
                  {h}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      {rawRows.length > 0 && (
        <div className="overflow-x-auto rounded-lg bg-surface p-3">
          <p className="mb-2 text-callout font-semibold text-secondary">{u.previewFirst3}</p>
          <table className="w-full text-callout">
            <thead>
              <tr className="border-b border-border">
                {rawHeaders.map((h) => (
                  <th key={h} scope="col" className="px-2 py-1 text-left font-medium text-secondary">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rawRows.slice(0, 3).map((row, i) => (
                <tr key={i} className="border-b border-border">
                  {row.map((c, j) => (
                    <td key={j} className="px-2 py-1 text-primary">
                      {c}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className={`${BUTTON_GROUP_CLASSES} pt-2`}>
        <Button variant="secondary" onClick={() => setBulkStep('upload')}>
          {t.common.back}
        </Button>
        <Button onClick={onConfirm} disabled={!colMap.email}>
          {u.continueStep}
        </Button>
      </div>
    </div>
  );
}

interface BulkPreviewStepProps {
  parsedUsers: ParsedRow[];
  bulkOrgId: string;
  isPending: boolean;
  setBulkStep: (step: 'map') => void;
  onSubmit: () => void;
}

export function BulkPreviewStep({ parsedUsers, bulkOrgId, isPending, setBulkStep, onSubmit }: BulkPreviewStepProps) {
  const { t } = useI18n();
  const u = t.users;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-subheading font-semibold text-primary">{u.confirmImport}</h3>
        <StatusBadge tone="brand" icon="none">
          {formatMessage(u.validUsers, { count: parsedUsers.length })}
        </StatusBadge>
      </div>
      <div className="max-h-60 overflow-y-auto rounded-lg border border-border">
        <table className="w-full text-callout">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-border">
              <th scope="col" className={TH}>{t.common.email}</th>
              <th scope="col" className={TH}>{t.common.name}</th>
              <th scope="col" className={TH}>{u.colRole}</th>
            </tr>
          </thead>
          <tbody>
            {parsedUsers.map((row, i) => (
              <tr key={i} className="border-b border-border">
                <td className="break-all px-3 py-2 text-primary">{row.email}</td>
                <td className="px-3 py-2 text-secondary">{[row.firstName, row.lastName].filter(Boolean).join(' ') || '—'}</td>
                <td className="px-3 py-2">
                  <StatusBadge tone="neutral" icon="none">
                    {row.role?.trim() ? roleLabel(t.roles, row.role.trim()) : t.teamSettings.noRole}
                  </StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={`${BUTTON_GROUP_CLASSES} pt-2`}>
        <Button variant="secondary" onClick={() => setBulkStep('map')}>
          {t.common.back}
        </Button>
        <Button onClick={onSubmit} disabled={!bulkOrgId} loading={isPending} loadingLabel={u.importing}>
          {formatMessage(u.inviteNUsers, { count: parsedUsers.length })}
        </Button>
      </div>
    </div>
  );
}
