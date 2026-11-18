'use client';

import { useState, useEffect } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import type { OrganizationListItem } from '../../../../lib/trpc-types';
import { formatDateLong as fmtDateLong } from '../../../../lib/format-utils';
import { formatMessage } from '../../../../lib/i18n/format';
import { Button, ConfirmDialog, ErrorState, IconButton, SegmentedControl, Stepper, inputClasses } from '../../../../components';
import { fmtCurrency, type LineItem } from './invoice-wizard.helpers';
import { PreviewPanel } from './invoice-wizard.parts';
import { InvoiceSetupStep } from './invoice-setup-step';
import { InvoiceDetailsStep } from './invoice-details-step';

export function InvoiceWizard({ onClose, onSuccess, preselectedOrgId }: { onClose: () => void; onSuccess: () => void; preselectedOrgId?: string }) {
  const { t } = useI18n();
  const [step, setStep] = useState(0);
  const [previewTab, setPreviewTab] = useState<'invoice' | 'email'>('invoice');

  const [orgId, setOrgId] = useState('');
  const [orgSearch, setOrgSearch] = useState('');
  const [orgName, setOrgName] = useState('');
  const [orgEmail, setOrgEmail] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [lineItems, setLineItems] = useState<LineItem[]>([{ description: '', quantity: 1, unitPrice: 0 }]);
  const [memo, setMemo] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [emailTo, setEmailTo] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [mobilePane, setMobilePane] = useState<'form' | 'preview'>('form');

  const orgs = trpc.platform.listOrganizations.useQuery({ search: orgSearch || undefined, limit: 10, page: 0 });
  const preselectedOrgQuery = trpc.platform.getOrganization.useQuery(
    { id: preselectedOrgId! },
    { enabled: !!preselectedOrgId && !orgId },
  );

  useEffect(() => {
    if (preselectedOrgId && !orgId && preselectedOrgQuery.data) {
      const org = preselectedOrgQuery.data;
      const bEmail = org.billingProfile?.billingEmail || '';
      setOrgId(org.id);
      setOrgSearch(org.name);
      setOrgName(org.name);
      setEmailTo(bEmail);
      setOrgEmail(bEmail);
      setStep(1);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedOrgQuery.data]);

  useEffect(() => {
    if (preselectedOrgId && !orgId && preselectedOrgQuery.isError) {
      toast(t.invoices.customerLoadError, { type: 'error' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselectedOrgQuery.isError]);

  const previewQuery = trpc.platform.getAiInterviewBillingPreview.useQuery(
    { organizationId: orgId },
    { enabled: false },
  );

  const loadAiInterviewCharges = async () => {
    const result = await previewQuery.refetch();
    if (result.isError) {
      toast(t.invoices.aiChargesError, { type: 'error' });
      return;
    }
    if (!result.data) return;
    const incoming: LineItem[] = result.data.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      unitPrice: li.unitPrice,
    }));
    setLineItems((prev) => {
      const isPlaceholder = prev.length === 1 && !prev[0].description && prev[0].unitPrice === 0;
      return isPlaceholder ? incoming : [...prev, ...incoming];
    });
  };

  const nextNum = trpc.platform.getNextInvoiceNumber.useQuery();
  const createInvoice = trpc.platform.createInvoice.useMutation({
    onSuccess: () => { toast(t.invoices.created, { type: 'success' }); onSuccess(); },
    onError: (err) => { toast(err.message || t.invoices.createError, { type: 'error' }); },
  });

  const subtotal = lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
  const invNumber = nextNum.isError ? t.invoices.numberUnavailable : `INV-${nextNum.data ?? '…'}`;

  const addLine = () => setLineItems([...lineItems, { description: '', quantity: 1, unitPrice: 0 }]);
  const removeLine = (i: number) => { if (lineItems.length > 1) setLineItems(lineItems.filter((_, idx) => idx !== i)); };
  const updateLine = (i: number, field: keyof LineItem, val: string | number) => {
    const updated = [...lineItems];
    updated[i] = { ...updated[i], [field]: val };
    setLineItems(updated);
  };

  const selectOrg = (org: OrganizationListItem) => {
    setOrgId(org.id); setOrgSearch(org.name); setOrgName(org.name);
    setEmailTo(org.billingEmail || '');
    setOrgEmail(org.billingEmail || '');
    setStep(1);
  };

  const canNext = () => {
    if (step === 0) return !!orgId;
    if (step === 1) return lineItems.some(li => li.description && li.unitPrice > 0);
    if (step === 2) return !!invoiceDate;
    return true;
  };

  const handleSubmit = (send: boolean) => {
    const validItems = lineItems.filter(li => li.description && li.unitPrice > 0);
    if (!orgId || validItems.length === 0) return;
    createInvoice.mutate({
      organizationId: orgId,
      currency,
      invoiceDate: new Date(invoiceDate),
      dueDate: dueDate ? new Date(dueDate) : undefined,
      poNumber: poNumber || undefined,
      notes: notes || undefined,
      memo: memo || undefined,
      emailTo: emailTo || undefined,
      emailCc: emailCc || undefined,
      sendEmail: send,
      lineItems: validItems,
    });
  };

  const iv = t.invoices;
  const STEPS = [iv.stepCustomer, iv.stepSetup, iv.stepDetails, iv.stepReview];
  // Anything typed beyond the customer counts as work the close button must not drop silently (alerts.md).
  const dirty = lineItems.some((li) => li.description || li.unitPrice > 0) || Boolean(memo || notes || poNumber || dueDate || emailCc);
  const requestClose = () => (dirty ? setConfirmDiscard(true) : onClose());
  const showPreview = step > 0 && mobilePane === 'preview';

  return (
    <div className="flex h-full flex-col bg-surface-hover">
      {/* Top bar */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-white px-4 py-3 md:px-6">
        <div className="flex items-center gap-2 md:gap-4">
          <IconButton label={t.common.close} onClick={requestClose}>
            <svg className="size-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </IconButton>
          <h1 className="font-display text-title font-semibold text-brand">{iv.wizardTitle}</h1>
        </div>
        <Stepper steps={STEPS} current={step} />
      </div>

      {step > 0 && (
        <div className="shrink-0 border-b border-border bg-white px-4 py-2 md:hidden">
          <SegmentedControl
            label={iv.mobilePaneLabel}
            fullWidth
            options={[
              { value: 'form' as const, label: iv.paneForm },
              { value: 'preview' as const, label: iv.panePreview },
            ]}
            value={mobilePane}
            onChange={setMobilePane}
          />
        </div>
      )}

      {/* Main content */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Left -- Form */}
        <div className={`w-full overflow-y-auto border-border p-4 md:block md:w-1/2 md:border-r md:p-8 ${showPreview ? 'hidden' : ''}`}>
          {step === 0 && (
            <div>
              <h2 className="mb-2 font-display text-title font-semibold text-primary">{iv.selectCustomer}</h2>
              <p className="mb-6 text-body text-secondary">{iv.selectCustomerDesc}</p>
              <label htmlFor="invoice-customer" className="sr-only">{iv.selectCustomer}</label>
              <input id="invoice-customer" type="search" autoComplete="off" value={orgSearch} onChange={(e) => { setOrgSearch(e.target.value); setOrgId(''); }} placeholder={iv.searchOrg} className={inputClasses('lg', 'mb-2')} />
              {orgId && <div className="mt-4 flex items-center gap-3 rounded-xl border border-brand/10 bg-brand-tint p-4">
                <div className="min-w-0 flex-1"><p className="text-body font-semibold text-primary">{orgName}</p><p className="break-all text-callout text-secondary">{orgEmail || iv.noEmail}</p></div>
                <Button size="sm" variant="tertiary" onClick={() => { setOrgId(''); setOrgSearch(''); setOrgName(''); }}>{iv.changeCustomer}</Button>
              </div>}
              {orgSearch && !orgId && orgs.isError && <ErrorState size="inline" onRetry={() => orgs.refetch()} error={orgs.error} />}
              {orgSearch && !orgId && orgs.data && <div className="mt-1 max-h-60 overflow-y-auto rounded-xl border border-border bg-white shadow-popover">
                {orgs.data.organizations.length === 0 && <p role="status" className="px-4 py-3 text-body text-secondary">{t.common.noResults}</p>}
                {orgs.data.organizations.map((org) => (
                  <button key={org.id} type="button" onClick={() => selectOrg(org)} className="flex w-full items-center gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-surface">
                    <span><span className="text-body font-medium text-primary">{org.name}</span><br /><span className="text-callout text-secondary">{org.slug}</span></span>
                  </button>
                ))}
              </div>}
            </div>
          )}

          {step === 1 && (
            <InvoiceSetupStep
              orgName={orgName}
              orgEmail={orgEmail}
              onEditCustomer={() => setStep(0)}
              lineItems={lineItems}
              currency={currency}
              subtotal={subtotal}
              memo={memo}
              setMemo={setMemo}
              addLine={addLine}
              removeLine={removeLine}
              updateLine={updateLine}
              canLoadAi={Boolean(orgId)}
              aiLoading={previewQuery.isFetching}
              onLoadAi={loadAiInterviewCharges}
            />
          )}

          {step === 2 && (
            <InvoiceDetailsStep
              invNumber={invNumber}
              numberFailed={nextNum.isError}
              onRetryNumber={() => nextNum.refetch()}
              poNumber={poNumber}
              setPoNumber={setPoNumber}
              invoiceDate={invoiceDate}
              setInvoiceDate={setInvoiceDate}
              dueDate={dueDate}
              setDueDate={setDueDate}
              currency={currency}
              setCurrency={setCurrency}
              notes={notes}
              setNotes={setNotes}
            />
          )}

          {step === 3 && (
            <div>
              <h2 className="mb-2 font-display text-title font-semibold text-primary">{iv.reviewAndSend}</h2>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface p-3">
                <div><p className="text-callout text-secondary">{iv.invoiceTo}</p><p className="text-body font-semibold text-primary">{orgName}</p></div>
                {dueDate && <p className="rounded-lg border border-border bg-white px-3 py-1.5 text-callout font-medium text-secondary">{formatMessage(iv.emailDue, { date: fmtDateLong(dueDate) })}</p>}
              </div>
              <p className="mb-6 text-3xl font-semibold tabular-nums text-primary">{fmtCurrency(subtotal, currency)}</p>
              <div className="space-y-4">
                <div><label htmlFor="invoice-email-to" className="mb-1.5 block text-body font-medium text-primary">{iv.emailTo}</label><input id="invoice-email-to" type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder={orgEmail || 'email@empresa.com'} className={inputClasses('md')} /></div>
                <div><label htmlFor="invoice-email-cc" className="mb-1.5 block text-body font-medium text-primary">{iv.cc}</label><input id="invoice-email-cc" type="text" value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="cc@empresa.com" className={inputClasses('md')} /></div>
              </div>
            </div>
          )}
        </div>

        {/* Right -- Live Preview (phones: swapped in by the switch above) */}
        <PreviewPanel
          className={`md:block md:w-1/2 ${showPreview ? 'w-full' : 'hidden'}`}
          step={step}
          previewTab={previewTab}
          setPreviewTab={setPreviewTab}
          orgName={orgName}
          orgEmail={orgEmail}
          emailTo={emailTo}
          invNumber={invNumber}
          poNumber={poNumber}
          lineItems={lineItems}
          subtotal={subtotal}
          currency={currency}
          invoiceDate={invoiceDate}
          dueDate={dueDate}
          memo={memo}
        />
      </div>

      {/* Bottom nav: Atrás leading, the primary trailing */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border bg-white px-4 py-3 md:px-6">
        <div>{step > 0 && <Button variant="secondary" onClick={() => setStep(step - 1)}>{iv.back}</Button>}</div>
        <div className="flex flex-wrap items-center gap-2">
          {step < 3 && <Button onClick={() => setStep(step + 1)} disabled={!canNext()}>{iv.next}</Button>}
          {step === 3 && <>
            <Button variant="secondary" onClick={() => handleSubmit(false)} disabled={createInvoice.isPending}>{iv.createOnly}</Button>
            <Button onClick={() => handleSubmit(true)} loading={createInvoice.isPending} loadingLabel={iv.creating}>{iv.createAndSend}</Button>
          </>}
        </div>
      </div>

      {confirmDiscard && (
        <ConfirmDialog
          title={iv.discardTitle}
          description={t.common.discardBody}
          confirmLabel={iv.discardInvoice}
          destructive
          onConfirm={onClose}
          onCancel={() => setConfirmDiscard(false)}
        />
      )}
    </div>
  );
}
