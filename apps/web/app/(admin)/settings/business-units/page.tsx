'use client';

import { useState } from 'react';
import { trpc } from '../../../../lib/trpc';
import { useI18n } from '../../../../lib/i18n';
import { toast } from '../../../../lib/toast';
import { CandidateAvatar, Skeleton, ErrorState } from '../../../../components';
import { AssignUserModal } from './assign-user-modal';

export default function BusinessUnitsPage() {
  const { t } = useI18n();
  const utils = trpc.useUtils();

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [unitId, setUnitId] = useState<string | null>(null);
  const [showAssign, setShowAssign] = useState(false);

  const companies = trpc.organization.listCompanies.useQuery();
  const units = trpc.organization.listBusinessUnits.useQuery(
    { companyId: companyId! },
    { enabled: !!companyId },
  );
  const members = trpc.organization.listUnitMembers.useQuery(
    { businessUnitId: unitId! },
    { enabled: !!unitId },
  );

  const unassign = trpc.organization.unassignUserFromUnit.useMutation({
    onSuccess: () => {
      toast(t.units.removed, { type: 'success' });
      if (unitId) utils.organization.listUnitMembers.invalidate({ businessUnitId: unitId });
    },
    onError: (err) => {
      toast(err.message, { type: 'error' });
    },
  });

  const memberRows = members.data ?? [];
  const assignedIds = memberRows.map((m) => m.user.id);

  const onRemove = (userId: string) => {
    if (!unitId) return;
    if (window.confirm(t.units.removeConfirm)) {
      unassign.mutate({ userId, businessUnitId: unitId });
    }
  };

  return (
    <div className="flex flex-col flex-1 min-w-0 h-full">
      {/* Top Bar */}
      <div className="flex flex-wrap items-center justify-between gap-y-2 px-4 md:px-6 min-h-16 py-2 bg-white border-b border-[#EDEDED] shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[13px] text-[#8B8B8B]">{t.units.breadcrumbParent}</span>
          <svg className="w-3 h-3 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="m9 18 6-6-6-6" /></svg>
          <span className="text-sm font-medium text-[#1F114C]">{t.units.title}</span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-5">
        {/* Selectors */}
        <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5 mb-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.units.selectCompany}</label>
              {companies.isLoading ? (
                <Skeleton className="h-9 w-full rounded-lg" />
              ) : companies.isError ? (
                <ErrorState onRetry={() => companies.refetch()} />
              ) : (
                <select
                  value={companyId ?? ''}
                  onChange={(e) => {
                    setCompanyId(e.target.value || null);
                    setUnitId(null);
                  }}
                  className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40"
                >
                  <option value="">{t.units.selectCompany}</option>
                  {(companies.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <label className="block text-[12px] font-medium text-[#585858] mb-1.5">{t.units.selectUnit}</label>
              {units.isError ? (
                <ErrorState onRetry={() => units.refetch()} />
              ) : (
                <select
                  value={unitId ?? ''}
                  onChange={(e) => setUnitId(e.target.value || null)}
                  disabled={!companyId || units.isLoading}
                  className="w-full bg-white border border-[#EDEDED] rounded-lg px-3 h-9 text-[13px] text-[#333] focus:outline-none focus:border-[#1F114C]/40 disabled:bg-[#F6F6F6] disabled:text-[#B8B8B8]"
                >
                  <option value="">{t.units.selectUnit}</option>
                  {(units.data ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>

        {/* Members */}
        {unitId && (
          <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-[13px] font-semibold text-[#1F114C]">{t.units.membersTitle}</h3>
              <button
                onClick={() => setShowAssign(true)}
                className="flex items-center gap-1.5 bg-[#DD0C15] text-white px-4 h-8 rounded-lg text-[12px] font-medium hover:bg-[#c00b13] transition"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4.5v15m7.5-7.5h-15" /></svg>
                {t.units.assignUser}
              </button>
            </div>

            {members.isLoading ? (
              <Skeleton className="h-24 w-full rounded-lg" />
            ) : members.isError ? (
              <p className="text-[12px] text-[#DD0C15]">{members.error.message}</p>
            ) : memberRows.length === 0 ? (
              <p className="text-[12px] text-[#8B8B8B] py-6 text-center">{t.units.noMembers}</p>
            ) : (
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-[#8B8B8B] border-b border-[#EDEDED]">
                    <th className="text-left pb-2 font-medium">{t.units.member}</th>
                    <th className="text-left pb-2 font-medium">{t.units.email}</th>
                    <th className="text-right pb-2 font-medium">{t.units.actions}</th>
                  </tr>
                </thead>
                <tbody className="text-[#333]">
                  {memberRows.map((m) => (
                    <tr key={m.id} className="border-b border-[#F6F6F6]">
                      <td className="py-2.5">
                        <div className="flex items-center gap-2.5">
                          <CandidateAvatar firstName={m.user.firstName} lastName={m.user.lastName} avatar={m.user.avatar} size="sm" />
                          <span className="font-medium">{m.user.firstName} {m.user.lastName}</span>
                        </div>
                      </td>
                      <td className="py-2.5 text-[#585858]">{m.user.email}</td>
                      <td className="py-2.5 text-right">
                        <button
                          onClick={() => onRemove(m.user.id)}
                          disabled={unassign.isPending}
                          className="h-7 px-2.5 rounded-md text-[11px] text-[#DD0C15] border border-red-200 hover:bg-red-50 transition disabled:opacity-50"
                        >
                          {t.units.remove}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
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
    </div>
  );
}
