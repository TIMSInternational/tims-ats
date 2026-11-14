'use client';

import { useI18n } from '../../../../lib/i18n';
import { Button, FIELD_LABEL_CLASSES, inputClasses, selectClasses, textareaClasses } from '../../../../components';
import { currencyOptions } from '../../../../lib/currency-options';

interface InvoiceDetailsStepProps {
  invNumber: string;
  numberFailed: boolean;
  onRetryNumber: () => void;
  poNumber: string;
  setPoNumber: (v: string) => void;
  invoiceDate: string;
  setInvoiceDate: (v: string) => void;
  dueDate: string;
  setDueDate: (v: string) => void;
  currency: string;
  setCurrency: (v: string) => void;
  notes: string;
  setNotes: (v: string) => void;
}

/** Step 3 of the invoice wizard: number, PO, dates, currency and the internal note, each with a real label. */
export function InvoiceDetailsStep(props: InvoiceDetailsStepProps) {
  const { t } = useI18n();
  const iv = t.invoices;
  const currencyChoices = currencyOptions();
  return (
    <div>
      <h2 className="mb-2 font-display text-title font-semibold text-primary">{iv.invoiceDetails}</h2>
      <p className="mb-6 text-body text-secondary">{iv.detailsDesc}</p>
      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="invoice-number" className={FIELD_LABEL_CLASSES}>{iv.invoiceNumber}</label>
          <div className="flex items-center gap-2">
            <input id="invoice-number" type="text" value={props.invNumber} readOnly className={inputClasses('md', 'bg-surface font-mono')} />
            {props.numberFailed && (
              <Button size="sm" variant="tertiary" onClick={props.onRetryNumber}>{t.common.retry}</Button>
            )}
          </div>
        </div>
        <div>
          <label htmlFor="invoice-po" className={FIELD_LABEL_CLASSES}>{iv.poNumber}</label>
          <input id="invoice-po" type="text" value={props.poNumber} onChange={(e) => props.setPoNumber(e.target.value)} placeholder="PO-12345" className={inputClasses('md')} />
        </div>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="invoice-date" className={FIELD_LABEL_CLASSES}>{iv.invoiceDate}</label>
          <input id="invoice-date" type="date" required value={props.invoiceDate} onChange={(e) => props.setInvoiceDate(e.target.value)} className={inputClasses('md')} />
        </div>
        <div>
          <label htmlFor="invoice-due" className={FIELD_LABEL_CLASSES}>{iv.dueDate}</label>
          <input id="invoice-due" type="date" value={props.dueDate} onChange={(e) => props.setDueDate(e.target.value)} className={inputClasses('md')} />
        </div>
      </div>
      <div className="mb-4">
        <label htmlFor="invoice-currency" className={FIELD_LABEL_CLASSES}>{iv.currency}</label>
        <select id="invoice-currency" value={props.currency} onChange={(e) => props.setCurrency(e.target.value)} className={selectClasses('md')}>
          {currencyChoices.map((opt) => (
            <option key={opt.code} value={opt.code}>{opt.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="invoice-notes" className={FIELD_LABEL_CLASSES}>{iv.internalNote}</label>
        <textarea id="invoice-notes" value={props.notes} onChange={(e) => props.setNotes(e.target.value)} rows={2} placeholder={iv.internalNotePlaceholder} className={textareaClasses('resize-none')} />
      </div>
    </div>
  );
}
