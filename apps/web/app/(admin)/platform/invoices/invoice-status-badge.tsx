'use client';

import { useI18n } from '../../../../lib/i18n';
import { StatusBadge } from '../../../../components';
import { invoiceStatus } from '../organizations/plan-label';

interface InvoiceStatusBadgeProps {
  status: string;
  dueDate?: Date | string | null;
}

/** An invoice status as a word with an outcome icon (never colour alone). Pending past its due date reads "Vencida". */
export function InvoiceStatusBadge({ status, dueDate }: InvoiceStatusBadgeProps) {
  const { t } = useI18n();
  const isOverdue = status === 'pending' && dueDate && new Date(dueDate) < new Date();
  const entry = invoiceStatus(isOverdue ? 'overdue' : status, t);
  return <StatusBadge tone={entry.tone}>{entry.label}</StatusBadge>;
}
