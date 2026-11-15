'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { toast } from '../../../../lib/toast';
import {
  Button,
  CandidateAvatar,
  ConfirmDialog,
  ErrorState,
  Field,
  PageHeader,
  Select,
  Skeleton,
} from '../../../../components';
import { AssignUserModal } from './assign-user-modal';
import { isPilotScope } from '../../../../lib/launch-scope';

interface RemoveTarget {
  userId: string;
  name: string;
}

/** Today's viewer (tRPC): browse units and manage unit assignees. Used while the C# org-structure flag is off. */
export function LegacyBusinessUnitsView() {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);
  const [removing, setRemoving] = useState<RemoveTarget | null>(null);

  const companies = trpc.organization.listCompanies.useQuery();
  const units = trpc.organization.listBusinessUnits.useQuery({ companyId: companyId! }, { enabled: !!companyId });
  const members = trpc.organization.listUnitMembers.useQuery({ businessUnitId: unitId! }, { enabled: !!unitId });

  const unassign = trpc.organization.unassignUserFromUnit.useMutation({
    onSuccess: () => {
      setRemoving(null);
      toast(t.units.removed, { type: 'success' });
      if (unitId) utils.organization.listUnitMembers.invalidate({ businessUnitId: unitId });
    },
    // Project rule: every mutation toasts its failure; the confirm dialog keeps its inline copy too.
    onError: () => toast(t.units.errorGeneric, { type: 'error' }),
  });

  const memberRows = members.data ?? [];
  const assignedIds = memberRows.map((m) => m.user.id);

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <PageHeader title={t.units.title} />

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-5 md:px-6 md:py-6">
        {/* In the pilot the organization structure stays off by decision, so "ask support to enable it" would
            send admins to a request support must refuse (D-12). */}
        <p
          role="status"
          className="rounded-lg border border-warning/30 bg-warning-bg px-4 py-3 text-callout text-primary"
        >
          {isPilotScope() ? t.units.managementDisabledPilot : t.units.managementDisabled}
        </p>

        <div className="rounded-xl bg-white p-5 shadow-card">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              {companies.isLoading ? (
                <Skeleton className="h-9 w-full rounded-lg" />
              ) : companies.isError ? (
                <ErrorState size="compact" onRetry={() => companies.refetch()} error={companies.error} />
              ) : (companies.data ?? []).length === 0 ? (
                <p className="py-2 text-body text-secondary">{t.units.noCompanies}</p>
              ) : (
                <Field id="legacy-units-company" label={t.units.selectCompany}>
                  <Select
                    value={companyId ?? ''}
                    onChange={(e) => {
                      setCompanyId(e.target.value || null);
                      setUnitId(null);
                    }}
                  >
                    <option value="">{t.units.selectCompany}</option>
                    {(companies.data ?? []).map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <div>
              {units.isError ? (
                <ErrorState size="compact" onRetry={() => units.refetch()} error={units.error} />
              ) : companyId && units.data && units.data.length === 0 ? (
                <p className="py-2 text-body text-secondary">{t.units.noUnits}</p>
              ) : (
                <Field id="legacy-units-unit" label={t.units.selectUnit}>
                  <Select
                    value={unitId ?? ''}
                    onChange={(e) => setUnitId(e.target.value || null)}
                    disabled={!companyId || units.isLoading}
                  >
                    <option value="">{t.units.selectUnit}</option>
                    {(units.data ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
          </div>
        </div>

        {unitId && (
          <section aria-labelledby="legacy-unit-members" className="rounded-xl bg-white p-5 shadow-card">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 id="legacy-unit-members" className="text-subheading font-semibold text-primary">
                {t.units.membersTitle}
              </h2>
              <Button onClick={() => setShowAssign(true)}>{t.units.assignUser}</Button>
            </div>

            {members.isLoading ? (
              <Skeleton className="h-24 w-full rounded-lg" />
            ) : members.isError ? (
              <ErrorState size="compact" message={t.units.membersLoadError} onRetry={() => members.refetch()} />
            ) : memberRows.length === 0 ? (
              <p className="py-6 text-center text-body text-secondary">{t.units.noAssignees}</p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {memberRows.map((m) => {
                  const name = `${m.user.firstName} ${m.user.lastName}`;
                  return (
                    <li key={m.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        <CandidateAvatar
                          firstName={m.user.firstName}
                          lastName={m.user.lastName}
                          avatar={m.user.avatar}
                          size="sm"
                          decorative
                        />
                        <div className="min-w-0">
                          <p className="truncate text-body font-medium text-primary">{name}</p>
                          <p className="truncate text-callout text-secondary">{m.user.email}</p>
                        </div>
                      </div>
                      <Button
                        variant="tertiary"
                        size="sm"
                        disabled={unassign.isPending}
                        onClick={() => setRemoving({ userId: m.user.id, name })}
                      >
                        {t.units.remove}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}
      </div>

      {showAssign && unitId && (
        <AssignUserModal
          businessUnitId={unitId}
          excludeIds={assignedIds}
          onClose={() => setShowAssign(false)}
          onAssigned={() => {
            setShowAssign(false);
            utils.organization.listUnitMembers.invalidate({ businessUnitId: unitId });
          }}
        />
      )}

      {removing && unitId && (
        <ConfirmDialog
          title={formatMessage(t.units.removeAssigneeTitle, { name: removing.name })}
          description={t.units.removeLegacyBody}
          confirmLabel={t.units.removeFromUnit}
          confirmingLabel={t.units.removing}
          destructive
          loading={unassign.isPending}
          error={unassign.isError ? t.units.errorGeneric : undefined}
          onConfirm={() => unassign.mutate({ userId: removing.userId, businessUnitId: unitId })}
          onCancel={() => {
            unassign.reset();
            setRemoving(null);
          }}
        />
      )}
    </div>
  );
}
