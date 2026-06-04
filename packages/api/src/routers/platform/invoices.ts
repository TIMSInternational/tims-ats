import { router } from '../../trpc';
import { db, InvoiceStatus } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { sendEmail } from '../../lib/ses';
import { platformProcedure } from './_common';
import {
  invoiceListSelect,
  invoiceDetailSelect,
  buildInvoiceWhere,
  buildNewInvoiceEmailHtml,
  buildPaymentReminderEmailHtml,
} from './invoices.helpers';
import {
  listInvoicesInput,
  getInvoiceInput,
  createInvoiceInput,
  updateInvoiceStatusInput,
  sendPaymentReminderInput,
  exportInvoicesCsvInput,
  getOrgInvoicesInput,
  getBillingProfileInput,
  upsertBillingProfileInput,
} from './invoices.schemas';

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
    .input(listInvoicesInput)
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
    .input(getInvoiceInput)
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
    .input(createInvoiceInput)
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
          html: buildNewInvoiceEmailHtml({
            organizationName: invoice.organization.name,
            amtFmt,
            invNum,
            dueFmt,
            lineItemsHtml,
            memo: input.memo,
          }),
        });
      }

      return invoice;
    }),

  updateInvoiceStatus: platformProcedure
    .input(updateInvoiceStatusInput)
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
    .input(sendPaymentReminderInput)
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
        html: buildPaymentReminderEmailHtml({
          organizationName: invoice.organization.name,
          invNum,
          amountFormatted,
          dueDate: invoice.dueDate,
          description: invoice.description,
        }),
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
    .input(exportInvoicesCsvInput)
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
    .input(getOrgInvoicesInput)
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
    .input(getBillingProfileInput)
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
    .input(upsertBillingProfileInput)
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
