'use client';

import { useI18n } from '../../../../lib/i18n';

interface InvoiceStatusBadgeProps {
  status: string;
  dueDate?: Date | string | null;
}

export function InvoiceStatusBadge({ status, dueDate }: InvoiceStatusBadgeProps) {
  const { t } = useI18n();

  const isOverdue = status === 'pending' && dueDate && new Date(dueDate) < new Date();

  if (isOverdue) {
    return <span className="px-2 py-1 rounded-full text-[10px] font-bold bg-red-100 text-red-700">{t.invoices.statusOverdue}</span>;
  }

  const map: Record<string, { cls: string; label: string }> = {
    draft: { cls: 'bg-gray-100 text-gray-600', label: t.invoices.statusDraft },
    pending: { cls: 'bg-amber-100 text-amber-700', label: t.invoices.statusPending },
    paid: { cls: 'bg-green-100 text-green-700', label: t.invoices.statusPaid },
    void: { cls: 'bg-gray-100 text-gray-500', label: t.invoices.statusVoid },
  };
  const entry = map[status] || { cls: 'bg-gray-100 text-gray-600', label: status };

  return <span className={`px-2 py-1 rounded-full text-[10px] font-bold ${entry.cls}`}>{entry.label}</span>;
}
