'use client';

import { formatDateLong as fmtDateLong } from '../../../../lib/format-utils';
import { fmtCurrency, type LineItem } from './invoice-wizard.helpers';

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
}: PreviewPanelProps) {
  return (
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
                <div><p className="text-[#8B8B8B] font-medium mb-1">Terms</p><table><tbody><tr><td className="text-[#8B8B8B] pr-2">Invoice date</td><td className="font-medium">{invoiceDate ? fmtDateLong(invoiceDate) : '—'}</td></tr><tr><td className="text-[#8B8B8B] pr-2">Due date</td><td className="font-medium">{dueDate ? fmtDateLong(dueDate) : '—'}</td></tr></tbody></table></div>
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
  );
}
