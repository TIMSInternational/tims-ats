'use client';

import { useI18n } from '../../../../lib/i18n';
import { Button, ErrorState, FIELD_LABEL_CLASSES, Select, TextInput } from '../../../../components';
import { ACTION_OPTIONS, ENTITY_OPTIONS } from './audit-options';
import { AuditFilterChip as Chip } from './audit-filter-chip';

export interface AuditFilterValues {
  action: string;
  entity: string;
  organizationId: string;
  dateFrom: string;
  dateTo: string;
}

interface AuditFiltersProps {
  values: AuditFilterValues;
  onChange: (patch: Partial<AuditFilterValues>) => void;
  onClear: () => void;
  orgs: { id: string; name: string }[];
  orgsError: unknown;
  isOrgsError: boolean;
  onRetryOrgs: () => void;
}

const LABEL = FIELD_LABEL_CLASSES;

/** The audit filters: a labelled date range, action, entity and organization; active filters as chips. */
export function AuditFilters({
  values,
  onChange,
  onClear,
  orgs,
  orgsError,
  isOrgsError,
  onRetryOrgs,
}: AuditFiltersProps) {
  const { t } = useI18n();
  const au = t.audit;
  const actionLabel = (slug: string) => (au.actions as Record<string, string>)[slug] ?? slug;
  const entityLabel = (slug: string) => (au.entities as Record<string, string>)[slug] ?? slug;
  const { action, entity, organizationId, dateFrom, dateTo } = values;
  const orgName = orgs.find((o) => o.id === organizationId)?.name ?? organizationId;
  const hasActiveFilters = Boolean(action || entity || organizationId || dateFrom || dateTo);

  return (
    <div role="search" aria-label={au.filtersLabel} className="rounded-xl bg-white p-4 shadow-card">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <fieldset className="grid grid-cols-2 gap-2 sm:col-span-2">
          <legend className="sr-only">{au.dateRange}</legend>
          <div>
            <label htmlFor="audit-date-from" className={LABEL}>
              {au.dateFrom}
            </label>
            <TextInput
              id="audit-date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => onChange({ dateFrom: e.target.value })}
            />
          </div>
          <div>
            <label htmlFor="audit-date-to" className={LABEL}>
              {au.dateTo}
            </label>
            <TextInput
              id="audit-date-to"
              type="date"
              value={dateTo}
              onChange={(e) => onChange({ dateTo: e.target.value })}
            />
          </div>
        </fieldset>
        <div>
          <label htmlFor="audit-action" className={LABEL}>
            {au.actionLabel}
          </label>
          <Select id="audit-action" value={action} onChange={(e) => onChange({ action: e.target.value })}>
            <option value="">{au.allActions}</option>
            {ACTION_OPTIONS.map((a) => (
              <option key={a} value={a}>
                {actionLabel(a)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="audit-entity" className={LABEL}>
            {au.entityLabel}
          </label>
          <Select id="audit-entity" value={entity} onChange={(e) => onChange({ entity: e.target.value })}>
            <option value="">{au.allEntities}</option>
            {ENTITY_OPTIONS.map((e) => (
              <option key={e} value={e}>
                {entityLabel(e)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label htmlFor="audit-org" className={LABEL}>
            {au.orgLabel}
          </label>
          {isOrgsError ? (
            <ErrorState size="inline" onRetry={onRetryOrgs} error={orgsError} message={au.orgsLoadError} />
          ) : (
            <Select
              id="audit-org"
              value={organizationId}
              onChange={(e) => onChange({ organizationId: e.target.value })}
            >
              <option value="">{au.allOrganizations}</option>
              {orgs.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>
      {hasActiveFilters && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-callout text-secondary">{au.activeFilters}:</span>
          {action && (
            <Chip
              label={actionLabel(action)}
              removeLabel={`${t.common.removeFilter}: ${actionLabel(action)}`}
              onRemove={() => onChange({ action: '' })}
            />
          )}
          {entity && (
            <Chip
              label={entityLabel(entity)}
              removeLabel={`${t.common.removeFilter}: ${entityLabel(entity)}`}
              onRemove={() => onChange({ entity: '' })}
            />
          )}
          {organizationId && (
            <Chip
              label={orgName}
              removeLabel={`${t.common.removeFilter}: ${orgName}`}
              onRemove={() => onChange({ organizationId: '' })}
            />
          )}
          {(dateFrom || dateTo) && (
            <Chip
              label={`${dateFrom || '…'} – ${dateTo || '…'}`}
              removeLabel={`${t.common.removeFilter}: ${au.dateRange}`}
              onRemove={() => onChange({ dateFrom: '', dateTo: '' })}
            />
          )}
          <Button size="sm" variant="tertiary" onClick={onClear}>
            {au.clearAll}
          </Button>
        </div>
      )}
    </div>
  );
}
