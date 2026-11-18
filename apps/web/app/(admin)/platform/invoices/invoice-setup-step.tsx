'use client';

import { useI18n } from '../../../../lib/i18n';
import { formatMessage } from '../../../../lib/i18n/format';
import { Button, FIELD_LABEL_CLASSES, IconButton, inputClasses, textareaClasses } from '../../../../components';
import { fmtCurrency, type LineItem } from './invoice-wizard.helpers';

interface InvoiceSetupStepProps {
  orgName: string;
  orgEmail: string;
  onEditCustomer: () => void;
  lineItems: LineItem[];
  currency: string;
  subtotal: number;
  memo: string;
  setMemo: (memo: string) => void;
  addLine: () => void;
  removeLine: (index: number) => void;
  updateLine: (index: number, field: keyof LineItem, value: string | number) => void;
  canLoadAi: boolean;
  aiLoading: boolean;
  onLoadAi: () => void;
}

/** Step 2 of the invoice wizard: line items (each input named by its line), total and payer memo. */
export function InvoiceSetupStep({
  orgName,
  orgEmail,
  onEditCustomer,
  lineItems,
  currency,
  subtotal,
  memo,
  setMemo,
  addLine,
  removeLine,
  updateLine,
  canLoadAi,
  aiLoading,
  onLoadAi,
}: InvoiceSetupStepProps) {
  const { t } = useI18n();
  const iv = t.invoices;
  return (
    <div>
      <h2 className="mb-2 font-display text-title font-semibold text-primary">{iv.invoiceSetup}</h2>
      <p className="mb-6 text-body text-secondary">{iv.setupDesc}</p>
      <div className="mb-6 flex items-center gap-3 rounded-xl bg-surface p-3">
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold text-primary">{orgName}</p>
          <p className="break-all text-callout text-secondary">{orgEmail || iv.noEmail}</p>
        </div>
        <Button size="sm" variant="tertiary" onClick={onEditCustomer}>{iv.changeCustomer}</Button>
      </div>
      <div className="mb-4">
        <div className="mb-2 hidden grid-cols-[1fr_4.5rem_7rem_2.75rem] gap-2 sm:grid" aria-hidden="true">
          <span className="text-callout font-medium text-secondary">{iv.item}</span>
          <span className="text-callout font-medium text-secondary">{iv.quantity}</span>
          <span className="text-callout font-medium text-secondary">{iv.unitPrice}</span>
          <span />
        </div>
        <ul className="space-y-3 sm:space-y-2">
          {lineItems.map((li, i) => {
            const n = i + 1;
            return (
              <li key={i} className="grid grid-cols-[1fr_4.5rem_2.75rem] gap-2 sm:grid-cols-[1fr_4.5rem_7rem_2.75rem]">
                <input
                  type="text"
                  value={li.description}
                  onChange={(e) => updateLine(i, 'description', e.target.value)}
                  placeholder={iv.itemDescPlaceholder}
                  aria-label={formatMessage(iv.lineDescription, { n })}
                  className={inputClasses('md', 'col-span-3 sm:col-span-1')}
                />
                <input
                  type="number"
                  min="1"
                  value={li.quantity}
                  onChange={(e) => updateLine(i, 'quantity', parseInt(e.target.value) || 1)}
                  aria-label={formatMessage(iv.lineQuantity, { n })}
                  className={inputClasses('md', 'text-center tabular-nums')}
                />
                <div className="relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-caption font-semibold text-secondary" aria-hidden="true">{currency}</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={li.unitPrice || ''}
                    onChange={(e) => updateLine(i, 'unitPrice', parseFloat(e.target.value) || 0)}
                    placeholder="0.00"
                    aria-label={formatMessage(iv.lineUnitPrice, { n, currency })}
                    className={inputClasses('md', 'pl-11 tabular-nums')}
                  />
                </div>
                <IconButton
                  label={formatMessage(iv.removeLineN, { n })}
                  variant="destructive"
                  onClick={() => removeLine(i)}
                  disabled={lineItems.length <= 1}
                >
                  <svg className="size-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18L18 6M6 6l12 12" /></svg>
                </IconButton>
              </li>
            );
          })}
        </ul>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button size="sm" variant="tertiary" onClick={addLine}>{iv.addItem}</Button>
          {canLoadAi && (
            <Button size="sm" variant="tertiary" onClick={onLoadAi} loading={aiLoading}>
              {iv.loadAiInterviewCharges}
            </Button>
          )}
        </div>
      </div>
      <div className="flex items-center justify-between border-t border-border py-3">
        <span className="text-subheading font-semibold text-primary">{iv.total}</span>
        <span className="text-xl font-semibold tabular-nums text-primary">{fmtCurrency(subtotal, currency)}</span>
      </div>
      <div className="mt-4">
        <label htmlFor="invoice-memo" className={FIELD_LABEL_CLASSES}>{iv.memo}</label>
        <textarea id="invoice-memo" value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder={iv.memoPlaceholder} className={textareaClasses('resize-none')} />
      </div>
    </div>
  );
}
