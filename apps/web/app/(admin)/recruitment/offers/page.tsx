'use client';

import { useState } from 'react';
import Link from 'next/link';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import { formatDate, formatCurrency } from '../../../../lib/format-utils';
import { DataTable, EmptyState, StatusBadge, CandidateAvatar } from '../../../../components';

const STATUS_MAP: Record<string, { cls: string; label: string }> = {
  draft: { cls: 'bg-gray-100 text-gray-600', label: 'Borrador' },
  pending_approval: { cls: 'bg-amber-50 text-amber-600 border border-amber-200', label: 'Pendiente' },
  approved: { cls: 'bg-blue-50 text-blue-600 border border-blue-200', label: 'Aprobada' },
  sent: { cls: 'bg-violet-50 text-violet-600 border border-violet-200', label: 'Enviada' },
  accepted: { cls: 'bg-green-50 text-green-600 border border-green-200', label: 'Aceptada' },
  declined: { cls: 'bg-red-50 text-red-600', label: 'Rechazada' },
  expired: { cls: 'bg-gray-100 text-gray-500', label: 'Expirada' },
  withdrawn: { cls: 'bg-gray-100 text-gray-500', label: 'Retirada' },
};

export default function OffersPage() {
  const { t } = useI18n();
  const [statusFilter, setStatusFilter] = useState('');

  const offers = trpc.offer.list.useQuery({
    pageSize: 50,
    status: statusFilter || undefined,
  });

  const items = offers.data?.items ?? [];

  const columns = [
    { key: 'candidate', label: t.candidates.colName },
    { key: 'vacancy', label: t.sidebar.vacancies },
    { key: 'salary', label: t.vacancies.salary },
    { key: 'status', label: t.common.status },
    { key: 'sent', label: 'Enviada' },
    { key: 'expires', label: 'Expira' },
    { key: 'actions', label: t.common.actions, align: 'right' as const },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden p-6">
      {/* Filters */}
      <div className="flex items-center gap-3 mb-4 flex-shrink-0">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
        >
          <option value="">Todos los estados</option>
          <option value="draft">Borrador</option>
          <option value="pending_approval">Pendiente</option>
          <option value="sent">Enviada</option>
          <option value="accepted">Aceptada</option>
          <option value="declined">Rechazada</option>
        </select>

        {statusFilter && (
          <button onClick={() => setStatusFilter('')} className="h-9 px-3 rounded-lg border border-[#EDEDED] text-xs text-[#8B8B8B] hover:bg-[#F6F6F6] transition">
            {t.subscriptions.clearFilters}
          </button>
        )}
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        loading={offers.isLoading}
        skeletonRows={8}
        empty={
          <EmptyState
            icon={<svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>}
            message="No hay ofertas registradas"
            description="Las ofertas se crean desde el pipeline de candidatos"
          />
        }
      >
        {items.map((offer) => (
          <tr key={offer.id} className="border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition">
            <td className="px-4 py-3">
              <div className="flex items-center gap-2">
                <CandidateAvatar
                  firstName={offer.candidate.firstName}
                  lastName={offer.candidate.lastName}
                  avatar={offer.candidate.avatar}
                  size="sm"
                />
                <Link href={`/recruitment/candidates/${offer.candidate.id}`} className="text-[13px] font-medium text-[#333] hover:underline">
                  {offer.candidate.firstName} {offer.candidate.lastName}
                </Link>
              </div>
            </td>
            <td className="px-4 py-3">
              <span className="text-[12px] text-[#585858]">{offer.vacancy.title}</span>
            </td>
            <td className="px-4 py-3">
              <span className="text-[13px] font-medium text-[#333]">
                {formatCurrency(offer.salary, offer.currency)}
              </span>
            </td>
            <td className="px-4 py-3">
              <StatusBadge status={offer.status} map={STATUS_MAP} />
            </td>
            <td className="px-4 py-3">
              <span className="text-[12px] text-[#8B8B8B]">{offer.sentAt ? formatDate(offer.sentAt) : '—'}</span>
            </td>
            <td className="px-4 py-3">
              <span className={`text-[12px] ${offer.expiresAt && new Date(offer.expiresAt) < new Date() ? 'text-[#DD0C15] font-medium' : 'text-[#8B8B8B]'}`}>
                {offer.expiresAt ? formatDate(offer.expiresAt) : '—'}
              </span>
            </td>
            <td className="px-4 py-3 text-right">
              <Link
                href={`/recruitment/candidates/${offer.candidate.id}`}
                className="h-7 px-2.5 rounded-md text-[11px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition inline-flex items-center"
              >
                {t.vacancies.viewDetails}
              </Link>
            </td>
          </tr>
        ))}
      </DataTable>
    </div>
  );
}
