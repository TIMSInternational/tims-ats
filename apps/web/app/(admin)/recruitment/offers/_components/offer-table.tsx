'use client';

import Link from 'next/link';
import { DataTable, EmptyState, StatusBadge, CandidateAvatar } from '../../../../../components';
import { useI18n } from '../../../../../lib/i18n/index';
import { formatDate, formatCurrency } from '../../../../../lib/format-utils';

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

interface OfferItem {
  id: string;
  salary: number;
  currency: string;
  status: string;
  sentAt: Date | string | null;
  expiresAt: Date | string | null;
  candidate: { id: string; firstName: string; lastName: string; email: string; avatar: string | null };
  vacancy: { id: string; title: string };
  approvals: Array<{ status: string }>;
}

interface OfferTableProps {
  items: OfferItem[];
  loading: boolean;
  statusFilter: string;
  onStatusChange: (status: string) => void;
  onSelectOffer: (id: string) => void;
}

export function OfferTable({ items, loading, statusFilter, onStatusChange, onSelectOffer }: OfferTableProps) {
  const { t } = useI18n();

  const columns = [
    { key: 'candidate', label: t.offers.colCandidate },
    { key: 'vacancy', label: t.offers.colVacancy },
    { key: 'salary', label: t.offers.colSalary },
    { key: 'status', label: t.offers.colStatus },
    { key: 'approvals', label: t.offers.colApprovals },
    { key: 'sent', label: t.offers.colSent },
    { key: 'actions', label: t.offers.colActions, align: 'right' as const },
  ];

  return (
    <>
      <div className="flex items-center gap-3 mb-4 flex-shrink-0">
        <select
          value={statusFilter}
          onChange={(e) => onStatusChange(e.target.value)}
          className="h-9 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#585858] bg-white focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20"
        >
          <option value="">{t.offers.allStatuses}</option>
          <option value="draft">{t.offers.statusDraft}</option>
          <option value="pending_approval">{t.offers.statusPending}</option>
          <option value="sent">{t.offers.statusSent}</option>
          <option value="accepted">{t.offers.statusAccepted}</option>
          <option value="declined">{t.offers.statusDeclined}</option>
        </select>
        {statusFilter && (
          <button
            onClick={() => onStatusChange('')}
            className="h-9 px-3 rounded-lg border border-[#EDEDED] text-xs text-[#8B8B8B] hover:bg-[#F6F6F6] transition"
          >
            {t.subscriptions.clearFilters}
          </button>
        )}
      </div>

      <DataTable
        columns={columns}
        loading={loading}
        skeletonRows={8}
        empty={
          <EmptyState
            icon={
              <svg className="w-10 h-10 text-[#ccc]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            }
            message={t.offers.noOffers}
            description={t.offers.noOffersDesc}
          />
        }
      >
        {items.map((offer) => {
          const approved = offer.approvals.filter((a) => a.status === 'approved').length;
          const total = offer.approvals.length;

          return (
            <tr
              key={offer.id}
              className="border-b border-[#F6F6F6] hover:bg-[#FAFAFA] transition cursor-pointer"
              onClick={() => onSelectOffer(offer.id)}
            >
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <CandidateAvatar
                    firstName={offer.candidate.firstName}
                    lastName={offer.candidate.lastName}
                    avatar={offer.candidate.avatar}
                    size="sm"
                  />
                  <div>
                    <p className="text-[13px] font-medium text-[#333]">
                      {offer.candidate.firstName} {offer.candidate.lastName}
                    </p>
                    <p className="text-[11px] text-[#8B8B8B]">{offer.candidate.email}</p>
                  </div>
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
                {total > 0 ? (
                  <div className="flex items-center gap-1.5">
                    <div className="flex -space-x-1">
                      {offer.approvals.map((a, i) => (
                        <div
                          key={i}
                          className={`w-5 h-5 rounded-full border-2 border-white flex items-center justify-center ${
                            a.status === 'approved'
                              ? 'bg-green-500'
                              : a.status === 'rejected'
                                ? 'bg-red-500'
                                : 'bg-[#EDEDED]'
                          }`}
                        >
                          {a.status === 'approved' && (
                            <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                              <path d="m4.5 12.75 6 6 9-13.5" />
                            </svg>
                          )}
                        </div>
                      ))}
                    </div>
                    <span className="text-[10px] text-[#8B8B8B]">{approved}/{total}</span>
                  </div>
                ) : (
                  <span className="text-[11px] text-[#8B8B8B]">—</span>
                )}
              </td>
              <td className="px-4 py-3">
                <span className="text-[12px] text-[#8B8B8B]">{offer.sentAt ? formatDate(offer.sentAt) : '—'}</span>
              </td>
              <td className="px-4 py-3 text-right">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectOffer(offer.id);
                  }}
                  className="h-7 px-2.5 rounded-md text-[11px] text-[#585858] border border-[#EDEDED] hover:bg-[#F6F6F6] transition inline-flex items-center"
                >
                  {t.offers.viewDetail}
                </button>
              </td>
            </tr>
          );
        })}
      </DataTable>
    </>
  );
}
