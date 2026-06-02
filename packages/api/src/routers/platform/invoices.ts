import { z } from 'zod';
import { router } from '../../trpc';
import { db, InvoiceStatus } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { sendEmail } from '../../lib/ses';
import { platformProcedure } from './_common';
import type { Prisma } from '@tims/db';

const invoiceListSelect = {
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

const invoiceDetailSelect = {
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

const STATUS_FILTER = z.enum(['draft', 'pending', 'paid', 'void', 'overdue']).optional();

function buildInvoiceWhere(input: {
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

export const invoicesRouter = router({
  getInvoiceKpis: platformProcedure.query(async () => {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const [paidThisMonth, pending, overdue, paidInvoices] = await Promise.all([
      db.invoice.aggregate({
        where: { status: InvoiceStatus.paid, paidAt: { gte: monthStart } },
        _sum: { amount: true },
      }),
      db.invoice.aggregate({
        where: { status: InvoiceStatus.pending },
        _sum: { amount: true },
        _count: true,
      }),
      db.invoice.count({
        where: { status: InvoiceStatus.pending, dueDate: { lt: now } },
      }),
      db.invoice.findMany({
        where: { status: InvoiceStatus.paid, paidAt: { not: null } },
        select: { createdAt: true, paidAt: true },
      }),
    ]);

    const avgDaysToPay = paidInvoices.length > 0
      ? Math.round(
          paidInvoices.reduce((sum, inv) => {
            const days = (inv.paidAt!.getTime() - inv.createdAt.getTime()) / (1000 * 60 * 60 * 24);
            return sum + days;
          }, 0) / paidInvoices.length
        )
      : 0;

    return {
      collected: paidThisMonth._sum.amount ?? 0,
      outstanding: pending._sum.amount ?? 0,
      overdueCount: overdue,
      avgDaysToPay,
    };
  }),

  listInvoices: platformProcedure
    .input(z.object({
      page: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(50).default(20),
      search: z.string().max(100).optional(),
      status: STATUS_FILTER,
      organizationId: z.string().uuid().optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const where = buildInvoiceWhere(input);

      const [invoices, total] = await Promise.all([
        db.invoice.findMany({
          where,
          take: input.limit,
          skip: input.page * input.limit,
          orderBy: { createdAt: 'desc' },
          select: invoiceListSelect,
        }),
        db.invoice.count({ where }),
      ]);

      return { invoices, total };
    }),

  getInvoice: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ input }) => {
      const invoice = await db.invoice.findUnique({
        where: { id: input.id },
        select: invoiceDetailSelect,
      });
      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND', message: 'Factura no encontrada' });
      return invoice;
    }),

  getNextInvoiceNumber: platformProcedure.query(async () => {
    const last = await db.invoice.findFirst({ orderBy: { invoiceNumber: 'desc' }, select: { invoiceNumber: true } });
    return (last?.invoiceNumber ?? 0) + 1;
  }),

  createInvoice: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      currency: z.string().max(5).default('USD'),
      description: z.string().max(500).optional(),
      invoiceDate: z.date().optional(),
      dueDate: z.date().optional(),
      poNumber: z.string().max(50).optional(),
      notes: z.string().max(1000).optional(),
      memo: z.string().max(500).optional(),
      taxRate: z.number().min(0).max(100).optional(),
      emailTo: z.string().email().optional(),
      emailCc: z.string().max(500).optional(),
      sendEmail: z.boolean().default(false),
      lineItems: z.array(z.object({
        description: z.string().min(1).max(300),
        quantity: z.number().int().positive(),
        unitPrice: z.number().min(0),
      })).min(1).max(50),
    }))
    .mutation(async ({ input }) => {
      const subtotal = input.lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0);
      const taxAmount = input.taxRate ? subtotal * (input.taxRate / 100) : 0;
      const amount = subtotal + taxAmount;

      const invoice = await db.invoice.create({
        data: {
          organizationId: input.organizationId,
          amount,
          subtotal,
          taxRate: input.taxRate,
          currency: input.currency,
          description: input.description,
          invoiceDate: input.invoiceDate || new Date(),
          dueDate: input.dueDate,
          poNumber: input.poNumber,
          notes: input.notes,
          memo: input.memo,
          emailTo: input.emailTo,
          emailCc: input.emailCc,
          status: InvoiceStatus.pending,
          lineItems: {
            create: input.lineItems.map((li, i) => ({
              description: li.description,
              quantity: li.quantity,
              unitPrice: li.unitPrice,
              total: li.quantity * li.unitPrice,
              sortOrder: i,
            })),
          },
        },
        select: {
          id: true,
          invoiceNumber: true,
          amount: true,
          currency: true,
          lineItems: {
            select: { description: true, quantity: true, unitPrice: true, total: true },
            orderBy: { sortOrder: 'asc' },
          },
          organization: { select: { name: true, billingEmail: true } },
        },
      });

      if (input.sendEmail && input.emailTo) {
        const amtFmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: input.currency }).format(amount);
        const dueFmt = input.dueDate ? new Intl.DateTimeFormat('es', { day: '2-digit', month: 'long', year: 'numeric' }).format(input.dueDate) : 'N/A';
        const invNum = `INV-${invoice.invoiceNumber}`;
        const lineItemsHtml = invoice.lineItems.map(li =>
          `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${li.description}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center;">${li.quantity}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">$${li.unitPrice.toFixed(2)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:right;">$${li.total.toFixed(2)}</td></tr>`
        ).join('');

        const ccAddresses = input.emailCc ? input.emailCc.split(',').map(e => e.trim()).filter(Boolean) : [];

        await sendEmail({
          to: [input.emailTo, ...ccAddresses],
          subject: `Nueva factura ${invNum} de TIMS ATS - ${amtFmt}`,
          html: `
            <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:40px 20px;">
              <div style="text-align:center;margin-bottom:32px;">
                <h1 style="color:#1F114C;font-size:24px;margin:0;">TIMS ATS</h1>
              </div>
              <div style="background:#f8f9fa;border-radius:12px;padding:32px;margin-bottom:24px;">
                <h2 style="color:#333;font-size:18px;margin:0 0 8px;">Nueva factura</h2>
                <p style="color:#585858;margin:0 0 16px;">Se ha generado una factura para <strong>${invoice.organization.name}</strong>.</p>
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
                  <div><span style="font-size:28px;font-weight:700;color:#333;">${amtFmt}</span></div>
                  <div style="text-align:right;"><span style="font-size:14px;font-weight:600;color:#585858;">${invNum}</span><br/><span style="font-size:12px;color:#8B8B8B;">Vence: ${dueFmt}</span></div>
                </div>
                <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
                  <tr style="background:#eee;"><th style="padding:8px;text-align:left;font-size:12px;">Item</th><th style="padding:8px;text-align:center;font-size:12px;">Cant.</th><th style="padding:8px;text-align:right;font-size:12px;">Precio</th><th style="padding:8px;text-align:right;font-size:12px;">Total</th></tr>
                  ${lineItemsHtml}
                  <tr><td colspan="3" style="padding:8px;text-align:right;font-weight:700;">Total</td><td style="padding:8px;text-align:right;font-weight:700;">${amtFmt}</td></tr>
                </table>
                ${input.memo ? `<p style="color:#585858;font-size:13px;margin:16px 0 0;"><strong>Memo:</strong> ${input.memo}</p>` : ''}
              </div>
              <p style="color:#8B8B8B;font-size:12px;text-align:center;">Este es un mensaje automatico de TIMS ATS.</p>
            </div>
          `,
        });
      }

      return invoice;
    }),

  updateInvoiceStatus: platformProcedure
    .input(z.object({
      id: z.string().uuid(),
      status: z.enum(['paid', 'void', 'pending']),
    }))
    .mutation(async ({ input }) => {
      const existing = await db.invoice.findUnique({
        where: { id: input.id },
        select: { id: true, status: true, organizationId: true },
      });
      if (!existing) throw new TRPCError({ code: 'NOT_FOUND', message: 'Factura no encontrada' });

      const data: { status: InvoiceStatus; paidAt?: Date | null } = {
        status: input.status as InvoiceStatus,
      };
      if (input.status === 'paid') data.paidAt = new Date();
      if (input.status === 'pending') data.paidAt = null;

      const updated = await db.invoice.update({
        where: { id: input.id },
        data,
        select: { id: true, status: true, invoiceNumber: true },
      });

      await db.auditLog.create({
        data: {
          action: `invoice_status_${input.status}`,
          entity: 'invoice',
          entityId: input.id,
          organizationId: existing.organizationId,
          metadata: { from: existing.status, to: input.status, invoiceNumber: updated.invoiceNumber },
        },
      });

      return updated;
    }),

  sendPaymentReminder: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const invoice = await db.invoice.findUnique({
        where: { id: input.id },
        select: {
          id: true,
          invoiceNumber: true,
          amount: true,
          currency: true,
          description: true,
          dueDate: true,
          organizationId: true,
          organization: {
            select: {
              name: true,
              billingEmail: true,
              billingProfile: { select: { billingEmail: true } },
            },
          },
        },
      });
      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND', message: 'Factura no encontrada' });

      const email = invoice.organization.billingProfile?.billingEmail
        || invoice.organization.billingEmail
        || null;
      if (!email) throw new TRPCError({ code: 'BAD_REQUEST', message: 'No billing email configured for this organization' });

      const amountFormatted = new Intl.NumberFormat('en-US', { style: 'currency', currency: invoice.currency }).format(invoice.amount);
      const invNum = `INV-${invoice.invoiceNumber}`;

      const sent = await sendEmail({
        to: email,
        subject: `Recordatorio de pago - Factura ${invNum} - TIMS ATS`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #1F114C; font-size: 24px; margin: 0;">TIMS ATS</h1>
            </div>
            <div style="background: #f8f9fa; border-radius: 12px; padding: 32px; margin-bottom: 24px;">
              <h2 style="color: #333; font-size: 18px; margin: 0 0 16px;">Recordatorio de Pago</h2>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 16px;">
                Estimado equipo de <strong>${invoice.organization.name}</strong>,
              </p>
              <p style="color: #585858; line-height: 1.6; margin: 0 0 16px;">
                Le recordamos que tiene una factura pendiente de pago:
              </p>
              <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                <tr><td style="padding: 8px 0; color: #8B8B8B;">Factura #</td><td style="padding: 8px 0; font-weight: 600;">${invNum}</td></tr>
                <tr><td style="padding: 8px 0; color: #8B8B8B;">Monto</td><td style="padding: 8px 0; font-weight: 600; color: #DD0C15;">${amountFormatted}</td></tr>
                ${invoice.dueDate ? `<tr><td style="padding: 8px 0; color: #8B8B8B;">Vencimiento</td><td style="padding: 8px 0; font-weight: 600;">${new Intl.DateTimeFormat('es', { day: '2-digit', month: 'long', year: 'numeric' }).format(invoice.dueDate)}</td></tr>` : ''}
              </table>
              ${invoice.description ? `<p style="color: #585858; margin: 16px 0 0;"><strong>Descripcion:</strong> ${invoice.description}</p>` : ''}
            </div>
            <p style="color: #8B8B8B; font-size: 12px; text-align: center;">
              Este es un mensaje automatico de TIMS ATS. Por favor no responda a este correo.
            </p>
          </div>
        `,
      });

      if (!sent) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to send email' });

      await db.auditLog.create({
        data: {
          action: 'payment_reminder_sent',
          entity: 'invoice',
          entityId: invoice.id,
          organizationId: invoice.organizationId,
          metadata: { billingEmail: email, invoiceNumber: invoice.invoiceNumber },
        },
      });

      return { sent: true };
    }),

  exportInvoicesCsv: platformProcedure
    .input(z.object({
      status: STATUS_FILTER,
      organizationId: z.string().uuid().optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const where = buildInvoiceWhere(input);

      const invoices = await db.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        select: {
          invoiceNumber: true,
          amount: true,
          currency: true,
          status: true,
          description: true,
          createdAt: true,
          dueDate: true,
          paidAt: true,
          organization: { select: { name: true } },
        },
      });

      const header = 'Numero,Organizacion,Monto,Moneda,Estado,Descripcion,Emision,Vencimiento,Pagada';
      const rows = invoices.map((inv) => {
        const fmt = (d: Date | null | undefined) => d ? new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) : '';
        return [
          `INV-${inv.invoiceNumber}`,
          `"${inv.organization.name.replace(/"/g, '""')}"`,
          inv.amount,
          inv.currency,
          inv.status,
          `"${(inv.description || '').replace(/"/g, '""')}"`,
          fmt(inv.createdAt),
          fmt(inv.dueDate),
          fmt(inv.paidAt),
        ].join(',');
      });

      return [header, ...rows].join('\n');
    }),

  getOrgInvoices: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      limit: z.number().int().min(1).max(20).default(5),
    }))
    .query(async ({ input }) => {
      const [invoices, stats, overdueCount] = await Promise.all([
        db.invoice.findMany({
          where: { organizationId: input.organizationId },
          take: input.limit,
          orderBy: { createdAt: 'desc' },
          select: invoiceListSelect,
        }),
        db.invoice.aggregate({
          where: { organizationId: input.organizationId, status: InvoiceStatus.pending },
          _sum: { amount: true },
          _count: true,
        }),
        db.invoice.count({
          where: {
            organizationId: input.organizationId,
            status: InvoiceStatus.pending,
            dueDate: { lt: new Date() },
          },
        }),
      ]);

      return {
        invoices,
        outstandingAmount: stats._sum.amount ?? 0,
        pendingCount: stats._count,
        overdueCount,
      };
    }),

  getBillingProfile: platformProcedure
    .input(z.object({ organizationId: z.string().uuid() }))
    .query(async ({ input }) => {
      return db.billingProfile.findUnique({
        where: { organizationId: input.organizationId },
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
      });
    }),

  upsertBillingProfile: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      companyName: z.string().max(200).optional(),
      taxId: z.string().max(50).optional(),
      address: z.string().max(300).optional(),
      city: z.string().max(100).optional(),
      state: z.string().max(100).optional(),
      country: z.string().max(100).optional(),
      zipCode: z.string().max(20).optional(),
      billingEmail: z.string().email().optional(),
      billingPhone: z.string().max(30).optional(),
    }))
    .mutation(async ({ input }) => {
      const { organizationId, ...data } = input;
      return db.billingProfile.upsert({
        where: { organizationId },
        create: { organizationId, ...data },
        update: data,
        select: {
          companyName: true,
          taxId: true,
          billingEmail: true,
        },
      });
    }),
});
