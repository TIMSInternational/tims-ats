'use client';

import { useState, useEffect } from 'react';
import { trpc } from '../../../../lib/trpc';
import { toast } from '../../../../lib/toast';
import { useI18n } from '../../../../lib/i18n';
import type { OrganizationListItem } from '../../../../lib/trpc-types';
import { fmtCurrency, fmtDateLong } from './_helpers';

interface LineItem { description: string; quantity: number; unitPrice: number; }

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

  const nextNum = trpc.platform.getNextInvoiceNumber.useQuery();
  const createInvoice = trpc.platform.createInvoice.useMutation({
    onSuccess: () => { toast('Factura creada exitosamente', { type: 'success' }); onSuccess(); },
    onError: (err) => { toast(err.message || 'Error al crear factura', { type: 'error' }); },
  });

  const subtotal = lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
  const invNumber = `INV-${nextNum.data ?? '...'}`;

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

  const STEPS = [t.invoices.stepCustomer, t.invoices.stepSetup, t.invoices.stepDetails, t.invoices.stepReview];

  return (
    <div className="h-full flex flex-col bg-[#FAFAFA]">
      {/* Top bar */}
      <div className="flex items-center justify-between px-6 py-4 bg-white border-b border-[#EDEDED] flex-shrink-0">
        <div className="flex items-center gap-4">
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#F6F6F6] flex items-center justify-center text-[#8B8B8B] transition">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
          <h1 className="text-lg font-semibold text-[#333]">{t.invoices.wizardTitle}</h1>
        </div>
        <div className="flex items-center gap-1">
          {STEPS.map((s, i) => (
            <div key={i} className="flex items-center gap-1">
              {i > 0 && <div className={`w-6 h-[2px] ${i <= step ? 'bg-[#1F114C]' : 'bg-[#EDEDED]'}`} />}
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold ${i < step ? 'bg-[#1F114C] text-white' : i === step ? 'bg-[#1F114C] text-white' : 'bg-[#EDEDED] text-[#8B8B8B]'}`}>{i + 1}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Left -- Form */}
        <div className="w-1/2 overflow-y-auto p-8 border-r border-[#EDEDED]">
          {step === 0 && (
            <div>
              <h2 className="text-2xl font-semibold text-[#333] mb-2">{t.invoices.selectCustomer}</h2>
              <p className="text-sm text-[#8B8B8B] mb-6">{t.invoices.selectCustomerDesc}</p>
              <input type="text" value={orgSearch} onChange={(e) => { setOrgSearch(e.target.value); setOrgId(''); }} placeholder={t.invoices.searchOrg} className="w-full h-11 px-4 rounded-xl border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 mb-2" />
              {orgId && <div className="flex items-center gap-3 p-4 rounded-xl bg-[#1F114C]/5 border border-[#1F114C]/10 mt-4">
                <div className="w-10 h-10 rounded-lg bg-[#1F114C] flex items-center justify-center text-white text-sm font-bold">{orgName.slice(0, 2).toUpperCase()}</div>
                <div className="flex-1"><p className="text-sm font-semibold text-[#333]">{orgName}</p><p className="text-xs text-[#8B8B8B]">{orgEmail || 'Sin email'}</p></div>
                <button onClick={() => { setOrgId(''); setOrgSearch(''); setOrgName(''); }} className="text-xs text-[#1F114C] font-medium hover:underline">Cambiar</button>
              </div>}
              {orgSearch && !orgId && orgs.data && <div className="mt-1 bg-white border border-[#EDEDED] rounded-xl shadow-lg max-h-60 overflow-y-auto">
                {orgs.data.organizations.length === 0 && <p className="px-4 py-3 text-sm text-[#8B8B8B]">Sin resultados</p>}
                {orgs.data.organizations.map((org) => (
                  <button key={org.id} type="button" onClick={() => selectOrg(org)} className="w-full text-left px-4 py-3 text-sm hover:bg-[#F6F6F6] transition flex items-center gap-3 border-b border-[#F6F6F6] last:border-0">
                    <div className="w-8 h-8 rounded-md bg-[#1F114C] flex items-center justify-center text-white text-[10px] font-bold">{org.name.slice(0, 2).toUpperCase()}</div>
                    <div><span className="font-medium text-[#333]">{org.name}</span><br /><span className="text-xs text-[#8B8B8B]">{org.slug}</span></div>
                  </button>
                ))}
              </div>}
            </div>
          )}

          {step === 1 && (
            <div>
              <h2 className="text-2xl font-semibold text-[#333] mb-2">{t.invoices.invoiceSetup}</h2>
              <p className="text-sm text-[#8B8B8B] mb-6">Agrega los items y detalles de la factura.</p>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-[#F6F6F6] mb-6">
                <div className="w-9 h-9 rounded-lg bg-[#1F114C] flex items-center justify-center text-white text-xs font-bold">{orgName.slice(0, 2).toUpperCase()}</div>
                <div className="flex-1"><p className="text-sm font-semibold text-[#333]">{orgName}</p><p className="text-[11px] text-[#8B8B8B]">{orgEmail}</p></div>
                <button onClick={() => setStep(0)} className="text-xs text-[#1F114C] font-medium hover:underline">Editar</button>
              </div>
              <div className="mb-4">
                <div className="grid grid-cols-[1fr_70px_100px_32px] gap-2 mb-2">
                  <span className="text-xs font-medium text-[#585858]">{t.invoices.item}</span>
                  <span className="text-xs font-medium text-[#585858]">{t.invoices.quantity}</span>
                  <span className="text-xs font-medium text-[#585858]">{t.invoices.unitPrice}</span>
                  <span />
                </div>
                {lineItems.map((li, i) => (
                  <div key={i} className="grid grid-cols-[1fr_70px_100px_32px] gap-2 mb-2">
                    <input type="text" value={li.description} onChange={(e) => updateLine(i, 'description', e.target.value)} placeholder="Descripcion del item..." className="h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
                    <input type="number" min="1" value={li.quantity} onChange={(e) => updateLine(i, 'quantity', parseInt(e.target.value) || 1)} className="h-10 px-2 rounded-lg border border-[#EDEDED] text-sm text-[#333] text-center focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#8B8B8B] text-sm">$</span>
                      <input type="number" step="0.01" min="0" value={li.unitPrice || ''} onChange={(e) => updateLine(i, 'unitPrice', parseFloat(e.target.value) || 0)} placeholder="0.00" className="h-10 pl-7 pr-2 rounded-lg border border-[#EDEDED] text-sm text-[#333] w-full focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" />
                    </div>
                    <button onClick={() => removeLine(i)} className="h-10 w-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-[#8B8B8B] hover:text-[#DD0C15] transition" disabled={lineItems.length <= 1}>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </div>
                ))}
                <button onClick={addLine} className="text-xs text-[#1F114C] font-medium hover:underline flex items-center gap-1 mt-1"><svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4" /></svg>{t.invoices.addItem}</button>
              </div>
              <div className="flex justify-between items-center py-3 border-t border-[#EDEDED]">
                <span className="text-base font-semibold text-[#333]">{t.invoices.total}</span>
                <span className="text-xl font-bold text-[#333]">{fmtCurrency(subtotal, currency)}</span>
              </div>
              <div className="mt-4">
                <label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.memo}</label>
                <textarea value={memo} onChange={(e) => setMemo(e.target.value)} rows={2} placeholder="Detalles adicionales para el cliente..." className="w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 resize-none" />
              </div>
            </div>
          )}

          {step === 2 && (
            <div>
              <h2 className="text-2xl font-semibold text-[#333] mb-2">{t.invoices.invoiceDetails}</h2>
              <p className="text-sm text-[#8B8B8B] mb-6">Numero de factura, fechas y referencia.</p>
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.invoiceNumber}</label><input type="text" value={invNumber} readOnly className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] bg-[#F6F6F6] font-mono" /></div>
                <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.poNumber}</label><input type="text" value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="PO-12345" className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" /></div>
              </div>
              <div className="grid grid-cols-2 gap-4 mb-6">
                <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.invoiceDate}</label><input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" /></div>
                <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.dueDate}</label><input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" /></div>
              </div>
              <div className="mb-4">
                <label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.currency}</label>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20">
                  <option value="USD">USD - Dolar americano</option><option value="COP">COP - Peso colombiano</option><option value="EUR">EUR - Euro</option><option value="MXN">MXN - Peso mexicano</option>
                </select>
              </div>
              <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.internalNote}</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Solo visible para el equipo..." className="w-full px-3 py-2 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20 resize-none" /></div>
            </div>
          )}

          {step === 3 && (
            <div>
              <h2 className="text-2xl font-semibold text-[#333] mb-2">{t.invoices.reviewAndSend}</h2>
              <div className="flex items-center justify-between mb-4 p-3 rounded-xl bg-[#F6F6F6]">
                <div><p className="text-xs text-[#8B8B8B]">{t.invoices.invoiceTo}</p><p className="text-sm font-semibold text-[#333]">{orgName}</p></div>
                {dueDate && <div className="flex items-center gap-1.5 bg-white px-3 py-1.5 rounded-lg border border-[#EDEDED]"><svg className="w-3.5 h-3.5 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg><span className="text-xs font-medium text-[#585858]">Vence {fmtDateLong(dueDate)}</span></div>}
              </div>
              <div className="text-3xl font-bold text-[#333] mb-6">{fmtCurrency(subtotal, currency)}</div>
              <div className="space-y-4">
                <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.emailTo}</label><input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder={orgEmail || 'email@empresa.com'} className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" /></div>
                <div><label className="text-xs font-medium text-[#585858] mb-1 block">{t.invoices.cc}</label><input type="text" value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="cc@empresa.com" className="w-full h-10 px-3 rounded-lg border border-[#EDEDED] text-sm text-[#333] placeholder:text-[#8B8B8B] focus:outline-none focus:ring-2 focus:ring-[#1F114C]/20" /></div>
              </div>
            </div>
          )}
        </div>

        {/* Right -- Live Preview */}
        <div className="w-1/2 overflow-y-auto bg-[#F0F0F0] p-6">
          {step > 0 && (
            <>
              <div className="flex gap-4 mb-4">
                <button onClick={() => setPreviewTab('invoice')} className={`text-sm font-medium pb-1 ${previewTab === 'invoice' ? 'text-[#333] border-b-2 border-[#333]' : 'text-[#8B8B8B] hover:text-[#585858]'}`}>Factura</button>
                <button onClick={() => setPreviewTab('email')} className={`text-sm font-medium pb-1 ${previewTab === 'email' ? 'text-[#333] border-b-2 border-[#333]' : 'text-[#8B8B8B] hover:text-[#585858]'}`}>Email</button>
              </div>

              {previewTab === 'invoice' && (
                <div className="bg-white rounded-xl shadow-lg p-8 min-h-[600px]">
                  <div className="flex justify-between items-start mb-8">
                    <h3 className="text-2xl font-bold text-[#333]">Invoice</h3>
                    <div className="w-10 h-10 rounded-lg bg-[#DD0C15] flex items-center justify-center"><span className="text-white text-sm font-bold">T</span></div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mb-8 text-xs">
                    <div><p className="text-[#8B8B8B] mb-1 font-medium">From</p><p className="font-semibold text-[#333]">NEXA DEV LLC</p><p className="text-[#585858]">federico@nexadev.ai</p><p className="text-[#585858] mt-1">2 South Biscayne Boulevard<br />Ste 3200-5640<br />Miami, FL 33131</p></div>
                    <div><p className="text-[#8B8B8B] mb-1 font-medium">To</p><p className="font-semibold text-[#333]">{orgName || '...'}</p><p className="text-[#585858]">{emailTo || orgEmail || '...'}</p></div>
                    <div><p className="text-[#8B8B8B] mb-1 font-medium">Details</p><table className="text-[11px]"><tbody><tr><td className="text-[#8B8B8B] pr-2">Invoice no.</td><td className="font-semibold">{invNumber}</td></tr>{poNumber && <tr><td className="text-[#8B8B8B] pr-2">PO no.</td><td className="font-semibold">{poNumber}</td></tr>}</tbody></table></div>
                  </div>
                  <table className="w-full text-xs mb-4">
                    <thead><tr className="border-b border-[#EDEDED]"><th className="text-left py-2 text-[#8B8B8B] font-medium">Item</th><th className="text-center py-2 text-[#8B8B8B] font-medium">Quantity</th><th className="text-right py-2 text-[#8B8B8B] font-medium">Unit price</th><th className="text-right py-2 text-[#8B8B8B] font-medium">Total</th></tr></thead>
                    <tbody>
                      {lineItems.filter(li => li.description).map((li, i) => (
                        <tr key={i} className="border-b border-[#F6F6F6]"><td className="py-2 text-[#333]">{li.description}</td><td className="py-2 text-center text-[#585858]">{li.quantity}</td><td className="py-2 text-right text-[#585858]">${li.unitPrice.toFixed(2)}</td><td className="py-2 text-right font-semibold text-[#333]">${(li.quantity * li.unitPrice).toFixed(2)}</td></tr>
                      ))}
                      {lineItems.filter(li => li.description).length === 0 && <tr><td colSpan={4} className="py-4 text-center text-[#8B8B8B]">Agrega items en el formulario</td></tr>}
                    </tbody>
                  </table>
                  <div className="flex justify-end"><div className="text-right"><span className="text-sm font-bold text-[#333]">Total</span><span className="text-lg font-bold text-[#333] ml-4">{fmtCurrency(subtotal, currency)}</span></div></div>
                  <div className="grid grid-cols-2 gap-4 mt-8 pt-4 border-t border-[#EDEDED] text-xs">
                    <div><p className="text-[#8B8B8B] font-medium mb-1">Terms</p><table><tbody><tr><td className="text-[#8B8B8B] pr-2">Invoice date</td><td className="font-medium">{invoiceDate ? fmtDateLong(invoiceDate) : '\u2014'}</td></tr><tr><td className="text-[#8B8B8B] pr-2">Due date</td><td className="font-medium">{dueDate ? fmtDateLong(dueDate) : '\u2014'}</td></tr></tbody></table></div>
                    {memo && <div><p className="text-[#8B8B8B] font-medium mb-1">Memo</p><p className="text-[#585858]">{memo}</p></div>}
                  </div>
                </div>
              )}

              {previewTab === 'email' && (
                <div className="bg-white rounded-xl shadow-lg p-6 min-h-[600px]">
                  <div className="flex items-center gap-1.5 mb-4"><svg className="w-4 h-4 text-[#8B8B8B]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg><span className="text-xs font-medium text-[#585858]">Enviar hoy</span></div>
                  <div className="bg-[#1a1a2e] rounded-xl p-6 text-white">
                    <div className="space-y-3 text-xs mb-6">
                      <div className="flex"><span className="text-white/50 w-24">Subject:</span><span>NEXA DEV LLC te envio una nueva factura</span></div>
                      <div className="flex"><span className="text-white/50 w-24">Preview Text:</span><span>Revisa y paga tu factura</span></div>
                      <div className="flex"><span className="text-white/50 w-24">To:</span><span className="bg-[#1F114C] px-2 py-0.5 rounded">{emailTo || orgEmail || '...'}</span></div>
                      <div className="flex"><span className="text-white/50 w-24">From:</span><span>TIMS ATS &lt;noreply@nexadev.ai&gt;</span></div>
                    </div>
                    <div className="bg-[#0f0f23] rounded-xl p-6">
                      <div className="flex items-center gap-2 mb-4"><div className="w-8 h-8 rounded-lg bg-[#DD0C15] flex items-center justify-center"><span className="text-white text-[10px] font-bold">T</span></div><span className="text-sm font-semibold">TIMS ATS</span></div>
                      <h3 className="text-lg font-bold mb-4">Te han enviado una nueva factura</h3>
                      <p className="text-sm text-white/70 mb-6">NEXA DEV LLC te envio la factura {invNumber}{dueDate ? ` con vencimiento el ${fmtDateLong(dueDate)}` : ''} por {fmtCurrency(subtotal, currency)}.</p>
                      <div className="bg-[#1a1a3e] rounded-lg p-4 flex justify-between items-center mb-4">
                        <div><span className="text-2xl font-bold">{fmtCurrency(subtotal, currency)}</span>{dueDate && <p className="text-xs text-white/50 mt-1">Vence {fmtDateLong(dueDate)}</p>}</div>
                        <span className="text-sm font-semibold text-white/60">{invNumber}</span>
                      </div>
                      <button className="w-full bg-[#1F114C] text-white py-3 rounded-lg font-semibold text-sm">Pagar Factura</button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
          {step === 0 && (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-[#8B8B8B]"><svg className="w-16 h-16 mx-auto mb-3 text-[#EDEDED]" fill="none" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24"><path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg><p className="text-sm">Selecciona un cliente para ver la vista previa</p></div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom nav */}
      <div className="flex items-center justify-center gap-3 px-6 py-4 bg-white border-t border-[#EDEDED] flex-shrink-0">
        {step > 0 && <button onClick={() => setStep(step - 1)} className="h-10 px-5 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition flex items-center gap-1.5"><svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" /></svg>{t.invoices.back}</button>}
        {step < 3 && <button onClick={() => setStep(step + 1)} disabled={!canNext()} className="h-10 px-6 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-40 flex items-center gap-1.5">{t.invoices.next}<svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg></button>}
        {step === 3 && <>
          <button onClick={() => handleSubmit(false)} disabled={createInvoice.isPending} className="h-10 px-5 rounded-lg border border-[#EDEDED] text-sm font-medium text-[#585858] hover:bg-[#F6F6F6] transition disabled:opacity-50">{t.invoices.createOnly}</button>
          <button onClick={() => handleSubmit(true)} disabled={createInvoice.isPending} className="h-10 px-6 rounded-lg bg-[#1F114C] text-white text-sm font-medium hover:bg-[#2a1866] transition disabled:opacity-50 flex items-center gap-1.5">{createInvoice.isPending ? t.invoices.creating : t.invoices.createAndSend}<svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 5l7 7-7 7" /></svg></button>
        </>}
      </div>
    </div>
  );
}
