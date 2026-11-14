'use client';

import { formatDateLong as fmtDateLong } from '../../../../lib/format-utils';
import { fmtCurrency, type LineItem } from './invoice-wizard.helpers';
import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { SegmentedControl } from '../../../../components';

interface PreviewPanelProps {
  step: number;
  previewTab: 'invoice' | 'email';
  setPreviewTab: (tab: 'invoice' | 'email') => void;
  orgName: string;
  orgEmail: string;
  emailTo: string;
  invNumber: string;
  poNumber: string;
  lineItems: LineItem[];
  subtotal: number;
  currency: string;
  invoiceDate: string;
  dueDate: string;
  memo: string;
  /** Visibility from the parent: below md the wizard swaps this pane with the form. */
  className?: string;
}

export function PreviewPanel({
  step,
  previewTab,
  setPreviewTab,
  orgName,
  orgEmail,
  emailTo,
  invNumber,
  poNumber,
  lineItems,
  subtotal,
  currency,
  invoiceDate,
  dueDate,
  memo,
  className = 'hidden md:block md:w-1/2',
}: PreviewPanelProps) {
  const { t } = useI18n();
  const iv = t.invoices;
  const items = lineItems.filter((li) => li.description);
  const total = fmtCurrency(subtotal, currency);
  const LABEL = 'mb-1 text-callout font-medium text-secondary';
  const emailBody = dueDate
    ? formatMessage(iv.emailBodyDue, { company: iv.fromCompanyName, n: invNumber, date: fmtDateLong(dueDate), amount: total })
    : formatMessage(iv.emailBody, { company: iv.fromCompanyName, n: invNumber, amount: total });

  return (
    <div className={`overflow-y-auto bg-surface p-3 md:p-6 ${className}`}>
      {step > 0 && (
        <>
          <SegmentedControl
            label={iv.previewLabel}
            className="mb-4"
            options={[
              { value: 'invoice' as const, label: iv.previewInvoice },
              { value: 'email' as const, label: iv.previewEmail },
            ]}
            value={previewTab}
            onChange={setPreviewTab}
          />

          {previewTab === 'invoice' && (
            <div className="rounded-xl bg-white p-5 shadow-card md:min-h-[600px] md:p-8">
              <h3 className="mb-6 font-display text-title font-semibold text-primary md:mb-8">{iv.docTitle}</h3>
              <div className="mb-6 grid grid-cols-1 gap-4 text-callout sm:grid-cols-3 md:mb-8">
                <div><p className={LABEL}>{iv.docFrom}</p><p className="font-semibold text-primary">{iv.fromCompanyName}</p><p className="break-all text-secondary">{iv.fromEmail}</p><p className="mt-1 text-secondary">{iv.fromAddress1}<br />{iv.fromAddress2}<br />{iv.fromCity}</p></div>
                <div><p className={LABEL}>{iv.docTo}</p><p className="font-semibold text-primary">{orgName || '\u2014'}</p><p className="break-all text-secondary">{emailTo || orgEmail || '\u2014'}</p></div>
                <div><p className={LABEL}>{iv.docDetails}</p><dl><div className="flex gap-2"><dt className="text-secondary">{iv.colInvoiceNo}</dt><dd className="font-semibold text-primary">{invNumber}</dd></div>{poNumber && <div className="flex gap-2"><dt className="text-secondary">{iv.colPoNo}</dt><dd className="font-semibold text-primary">{poNumber}</dd></div>}</dl></div>
              </div>
              <ul className="mb-4 divide-y divide-border border-y border-border text-callout">
                {items.map((li, i) => (
                  <li key={i} className="py-2">
                    <p className="text-primary">{li.description}</p>
                    <div className="mt-0.5 flex justify-between gap-2 tabular-nums">
                      <span className="text-secondary">{li.quantity} × {fmtCurrency(li.unitPrice, currency)}</span>
                      <span className="font-semibold text-primary">{fmtCurrency(li.quantity * li.unitPrice, currency)}</span>
                    </div>
                  </li>
                ))}
                {items.length === 0 && <li className="py-4 text-center text-secondary">{iv.emptyLineItems}</li>}
              </ul>
              <p className="flex justify-end gap-4"><span className="text-body font-semibold text-primary">{iv.total}</span><span className="text-heading font-semibold tabular-nums text-primary">{total}</span></p>
              <div className="mt-6 grid grid-cols-1 gap-4 border-t border-border pt-4 text-callout sm:grid-cols-2 md:mt-8">
                <div><p className={LABEL}>{iv.docTerms}</p><dl><div className="flex gap-2"><dt className="text-secondary">{iv.colInvoiceDate}</dt><dd className="font-medium text-primary">{invoiceDate ? fmtDateLong(invoiceDate) : '\u2014'}</dd></div><div className="flex gap-2"><dt className="text-secondary">{iv.colDueDate}</dt><dd className="font-medium text-primary">{dueDate ? fmtDateLong(dueDate) : '\u2014'}</dd></div></dl></div>
                {memo && <div><p className={LABEL}>{iv.memoLabel}</p><p className="text-primary">{memo}</p></div>}
              </div>
            </div>
          )}

          {previewTab === 'email' && (
            <div className="rounded-xl bg-white p-4 shadow-card md:min-h-[600px] md:p-6">
              <div className="mb-4 flex items-center gap-1.5"><svg className="size-4 text-secondary" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg><span className="text-callout font-medium text-secondary">{iv.emailSendToday}</span></div>
              <dl className="mb-4 space-y-2 rounded-lg border border-border p-3 text-callout">
                <div className="flex flex-wrap gap-x-2"><dt className="w-24 text-secondary">{iv.emailSubjectLabel}</dt><dd className="text-primary">{iv.emailSubject}</dd></div>
                <div className="flex flex-wrap gap-x-2"><dt className="w-24 text-secondary">{iv.emailPreviewLabel}</dt><dd className="text-primary">{iv.emailPreviewText}</dd></div>
                <div className="flex flex-wrap gap-x-2"><dt className="w-24 text-secondary">{iv.emailToLabel}</dt><dd className="break-all text-primary">{emailTo || orgEmail || '\u2014'}</dd></div>
                <div className="flex flex-wrap gap-x-2"><dt className="w-24 text-secondary">{iv.emailFromLabel}</dt><dd className="text-primary">{iv.emailFrom}</dd></div>
              </dl>
              <div className="overflow-hidden rounded-xl border border-border">
                <div className="bg-brand px-5 py-3 text-body font-semibold text-white">{iv.emailSenderName}</div>
                <div className="p-5">
                  <h3 className="mb-3 text-heading font-semibold text-primary">{iv.emailNewInvoice}</h3>
                  <p className="mb-5 text-body text-secondary">{emailBody}</p>
                  <div className="mb-4 flex items-center justify-between rounded-lg bg-surface p-4">
                    <div><span className="text-2xl font-semibold tabular-nums text-primary">{total}</span>{dueDate && <p className="mt-1 text-callout text-secondary">{formatMessage(iv.emailDue, { date: fmtDateLong(dueDate) })}</p>}</div>
                    <span className="text-body font-semibold text-secondary">{invNumber}</span>
                  </div>
                  {/* Preview only: the real email carries the link. */}
                  <div className="w-full rounded-lg bg-brand py-3 text-center text-body font-semibold text-white" aria-hidden="true">{iv.payInvoiceBtn}</div>
                </div>
              </div>
            </div>
          )}
        </>
      )}
      {step === 0 && (
        <div className="flex h-full items-center justify-center">
          <div className="text-center text-secondary"><svg className="mx-auto mb-3 size-12 text-muted" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg><p className="text-body">{iv.selectClientPreview}</p></div>
        </div>
      )}
    </div>
  );
}
