import { InvoiceStatus } from '@tims/db';
import type { Prisma } from '@tims/db';

export const invoiceListSelect = {
  id: true,
  invoiceNumber: true,
  organizationId: true,
  amount: true,
  currency: true,
  status: true,
  description: true,
  invoiceDate: true,
  dueDate: true,
  paidAt: true,
  poNumber: true,
  memo: true,
  createdAt: true,
  organization: { select: { id: true, name: true, slug: true } },
  lineItems: {
    select: { id: true, description: true, quantity: true, unitPrice: true, total: true, sortOrder: true },
    orderBy: { sortOrder: 'asc' as const },
  },
} as const;

export const invoiceDetailSelect = {
  ...invoiceListSelect,
  notes: true,
  emailTo: true,
  emailCc: true,
  organization: {
    select: {
      id: true,
      name: true,
      slug: true,
      billingEmail: true,
      billingProfile: {
        select: {
          companyName: true,
          taxId: true,
          address: true,
          city: true,
          state: true,
          country: true,
          zipCode: true,
          billingEmail: true,
          billingPhone: true,
        },
      },
    },
  },
} as const;

export function buildInvoiceWhere(input: {
  status?: string;
  organizationId?: string;
  search?: string;
  dateFrom?: Date;
  dateTo?: Date;
}): Prisma.InvoiceWhereInput {
  const where: Prisma.InvoiceWhereInput = {};

  if (input.status === 'overdue') {
    where.status = InvoiceStatus.pending;
    where.dueDate = { lt: new Date() };
  } else if (input.status) {
    where.status = input.status as InvoiceStatus;
  }

  if (input.organizationId) where.organizationId = input.organizationId;
  if (input.search?.trim()) {
    where.organization = { name: { contains: input.search.trim(), mode: 'insensitive' } };
  }
  if (input.dateFrom || input.dateTo) {
    const createdAt: Prisma.DateTimeFilter = {};
    if (input.dateFrom) createdAt.gte = input.dateFrom;
    if (input.dateTo) createdAt.lte = input.dateTo;
    where.createdAt = createdAt;
  }

  return where;
}

export function buildNewInvoiceEmailHtml(params: {
  organizationName: string;
  amtFmt: string;
  invNum: string;
  dueFmt: string;
  lineItemsHtml: string;
  memo?: string;
}): string {
  const { organizationName, amtFmt, invNum, dueFmt, lineItemsHtml, memo } = params;
  return `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;">
              <div style="text-align:center;margin-bottom:32px;">
                <h1 style="color:#1F114C;font-size:24px;margin:0;">TIMS ATS</h1>
              </div>
              <div style="background:#f8f9fa;border-radius:12px;padding:32px;margin-bottom:24px;">
                <h2 style="color:#333;font-size:18px;margin:0 0 8px;">Nueva factura</h2>
                <p style="color:#585858;margin:0 0 16px;">Se ha generado una factura para <strong>${organizationName}</strong>.</p>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
                  <div><span style="font-size:28px;font-weight:700;color:#333;">${amtFmt}</span></div>
                  <div style="text-align:right;"><span style="font-size:14px;font-weight:600;color:#585858;">${invNum}</span><br/><span style="font-size:12px;color:#8B8B8B;">Vence: ${dueFmt}</span></div>
                </div>
                <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                  <tr style="background:#eee;"><th style="padding:8px;text-align:left;font-size:12px;">Item</th><th style="padding:8px;text-align:center;font-size:12px;">Cant.</th><th style="padding:8px;text-align:right;font-size:12px;">Precio</th><th style="padding:8px;text-align:right;font-size:12px;">Total</th></tr>
                  ${lineItemsHtml}
                  <tr><td colspan="3" style="padding:8px;text-align:right;font-weight:700;">Total</td><td style="padding:8px;text-align:right;font-weight:700;">${amtFmt}</td></tr>
                </table>
                ${memo ? `<p style="color:#585858;font-size:13px;margin:16px 0 0;"><strong>Memo:</strong> ${memo}</p>` : ''}
              </div>
              <p style="color:#8B8B8B;font-size:12px;text-align:center;">Este es un mensaje automatico de TIMS ATS.</p>
            </div>
          `;
}

export function buildPaymentReminderEmailHtml(params: {
  organizationName: string;
  invNum: string;
  amountFormatted: string;
  dueDate?: Date | null;
  description?: string | null;
}): string {
  const { organizationName, invNum, amountFormatted, dueDate, description } = params;
  return `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #1F114C; font-size: 24px; margin: 0;">TIMS ATS</h1>
            </div>
            <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; margin-bottom: 24px;">
              <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Recordatorio de Pago</h2>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 16px;">
                Estimado equipo de <strong>${organizationName}</strong>,
              </p>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 16px;">
                Le recordamos que tiene una factura pendiente de pago:
              </p>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr><td style="padding: 8px 0; color: #8B8B8B;">Factura #</td><td style="padding: 8px 0; font-weight: 600;">${invNum}</td></tr>
                <tr><td style="padding: 8px 0; color: #8B8B8B;">Monto</td><td style="padding: 8px 0; font-weight: 600; color: #DD0C15;">${amountFormatted}</td></tr>
                ${dueDate ? `<tr><td style="padding: 8px 0; color: #8B8B8B;">Vencimiento</td><td style="padding: 8px 0; font-weight: 600;">${new Intl.DateTimeFormat('es', { day: '2-digit', month: 'long', year: 'numeric' }).format(dueDate)}</td></tr>` : ''}
              </table>
              ${description ? `<p style="color: #585858; margin: 16px 0 0;"><strong>Descripcion:</strong> ${description}</p>` : ''}
            </div>
            <p style="color: #8B8B8B; font-size: 12px; text-align: center;">
              Este es un mensaje automatico de TIMS ATS. Por favor no responda a este correo.
            </p>
          </div>
        `;
}
