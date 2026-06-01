'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { trpc } from '../../../../../../lib/trpc';
import { useI18n } from '../../../../../../lib/i18n';
import { Skeleton } from '../../org-utils';
import { BillingProfileDrawer } from '../../../invoices/billing-drawer';

function fmtCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 2 }).format(value);
}

function fmtDate(date: string | Date | null | undefined): string {
  if (!date) return '\u2014';
  return new Intl.DateTimeFormat('es', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(date));
}

function InvoiceStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    paid: 'bg-green-100 text-green-700',
    pending: 'bg-amber-100 text-amber-700',
    overdue: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-600',
    draft: 'bg-blue-100 text-blue-600',
  };
  const cls = styles[status] || 'bg-gray-100 text-gray-600';
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`}>{status}</span>;
}

export function BillingSection({ organizationId }: { organizationId: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const [showDrawer, setShowDrawer] = useState(false);

  const profile = trpc.platform.getBillingProfile.useQuery({ organizationId });
  const invoices = trpc.platform.getOrgInvoices.useQuery({ organizationId });

  const bp = profile.data;
  const invData = invoices.data;

  return (
    <div className="space-y-6">
      {/* Billing profile card */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-[#333]">Perfil de Facturacion</h3>
          <button onClick={() => setShowDrawer(true)} className="h-8 px-3 rounded-lg border border-[#EDEDED] text-xs text-[#585858] font-medium hover:bg-[#F6F6F6] transition">
            {t.common.edit}
          </button>
        </div>
        {profile.isLoading ? (
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i}><Skeleton className="h-3 w-20 mb-1" /><Skeleton className="h-4 w-32" /></div>
            ))}
          </div>
        ) : bp ? (
          <div className="grid grid-cols-3 gap-4">
            <div><span className="text-xs text-[#8B8B8B]">Empresa</span><p className="text-sm text-[#333] mt-0.5">{bp.companyName || '\u2014'}</p></div>
            <div><span className="text-xs text-[#8B8B8B]">NIT / Tax ID</span><p className="text-sm text-[#333] mt-0.5">{bp.taxId || '\u2014'}</p></div>
            <div><span className="text-xs text-[#8B8B8B]">Email de Facturacion</span><p className="text-sm text-[#333] mt-0.5">{bp.billingEmail || '\u2014'}</p></div>
            <div><span className="text-xs text-[#8B8B8B]">Direccion</span><p className="text-sm text-[#333] mt-0.5">{bp.address || '\u2014'}</p></div>
            <div><span className="text-xs text-[#8B8B8B]">Telefono</span><p className="text-sm text-[#333] mt-0.5">{bp.billingPhone || '\u2014'}</p></div>
            <div><span className="text-xs text-[#8B8B8B]">Ciudad</span><p className="text-sm text-[#333] mt-0.5">{bp.city || '\u2014'}{bp.state ? `, ${bp.state}` : ''}</p></div>
          </div>
        ) : (
          <p className="text-xs text-[#8B8B8B]">No hay perfil de facturacion configurado</p>
        )}
      </div>

      {/* Outstanding summary */}
      {invData && (invData.pendingCount > 0 || invData.overdueCount > 0) && (
        <div className="flex gap-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <span className="text-xs text-amber-700 font-medium">Pendiente: {fmtCurrency(Number(invData.outstandingAmount))}</span>
            <span className="text-[10px] text-amber-600">({invData.pendingCount} facturas)</span>
          </div>
          {invData.overdueCount > 0 && (
            <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#DD0C15] animate-pulse" />
              <span className="text-xs text-[#DD0C15] font-medium">{invData.overdueCount} vencida{invData.overdueCount > 1 ? 's' : ''}</span>
            </div>
          )}
        </div>
      )}

      {/* Recent invoices */}
      <div className="bg-white rounded-xl shadow-[0_1px_4px_rgba(0,0,0,0.06)] overflow-hidden">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#EDEDED]">
          <h3 className="text-sm font-semibold text-[#333]">Facturas Recientes</h3>
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push(`/platform/invoices?create=true&org=${organizationId}`)}
              className="h-7 px-3 rounded-lg bg-[#1F114C] text-[10px] text-white font-medium hover:bg-[#2a1866] transition flex items-center gap-1.5"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>
              Nueva Factura
            </button>
            <Link href={`/platform/invoices?org=${organizationId}`} className="text-xs text-[#1F114C] hover:underline font-medium">
              Ver todas las facturas
            </Link>
          </div>
        </div>
        {invoices.isLoading ? (
          <div className="p-5 space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 animate-pulse">
                <Skeleton className="h-3 w-20" /><Skeleton className="h-3 w-16" /><Skeleton className="h-5 w-14 rounded-full" /><Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
        ) : !invData || invData.invoices.length === 0 ? (
          <div className="py-12 text-center">
            <svg className="w-10 h-10 text-[#EDEDED] mx-auto mb-2" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
              <path d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
            <p className="text-xs text-[#8B8B8B]">No hay facturas para esta organizacion</p>
          </div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-[#EDEDED]">
                <th className="px-5 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Factura</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Monto</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Moneda</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Estado</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Fecha</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Vencimiento</th>
                <th className="px-4 py-3 text-[11px] font-semibold text-[#8B8B8B] uppercase tracking-wider">Pagada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#F3F3F3]">
              {invData.invoices.map((inv) => (
                <tr key={inv.id} className="hover:bg-[#FAFAFA]">
                  <td className="px-5 py-2.5 text-sm text-[#1F114C] font-medium">{inv.invoiceNumber}</td>
                  <td className="px-4 py-2.5 text-sm text-[#333] font-medium">{fmtCurrency(Number(inv.amount), inv.currency)}</td>
                  <td className="px-4 py-2.5 text-xs text-[#8B8B8B]">{inv.currency}</td>
                  <td className="px-4 py-2.5"><InvoiceStatusBadge status={inv.status} /></td>
                  <td className="px-4 py-2.5 text-xs text-[#8B8B8B]">{fmtDate(inv.invoiceDate)}</td>
                  <td className="px-4 py-2.5 text-xs text-[#8B8B8B]">{fmtDate(inv.dueDate)}</td>
                  <td className="px-4 py-2.5 text-xs text-[#8B8B8B]">{fmtDate(inv.paidAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showDrawer && <BillingProfileDrawer organizationId={organizationId} onClose={() => setShowDrawer(false)} />}
    </div>
  );
}
