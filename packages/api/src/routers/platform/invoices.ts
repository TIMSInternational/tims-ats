import { z } from 'zod';
import { router } from '../../trpc';
import { db, InvoiceStatus } from '@tims/db';
import { TRPCError } from '@trpc/server';
import { sendEmail } from '../../lib/ses';
import { platformProcedure } from './_common';

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
      limit: z.number().min(1).max(50).default(20),
      search: z.string().optional(),
      status: z.string().optional(),
      organizationId: z.string().uuid().optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const { page, limit, search, status, organizationId, dateFrom, dateTo } = input;
      const where: any = {};

      if (status === 'overdue') {
        where.status = 'pending';
        where.dueDate = { lt: new Date() };
      } else if (status) {
        where.status = status;
      }

      if (organizationId) where.organizationId = organizationId;
      if (search) {
        where.organization = { name: { contains: search, mode: 'insensitive' } };
      }
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) where.createdAt.gte = dateFrom;
        if (dateTo) where.createdAt.lte = dateTo;
      }

      const [invoices, total] = await Promise.all([
        db.invoice.findMany({
          where,
          take: limit,
          skip: page * limit,
          orderBy: { createdAt: 'desc' },
          include: {
            organization: { select: { id: true, name: true, slug: true } },
            lineItems: { orderBy: { sortOrder: 'asc' } },
          },
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
        include: {
          organization: {
            include: { billingProfile: true },
          },
          lineItems: { orderBy: { sortOrder: 'asc' } },
        },
      });
      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND' });
      return invoice;
    }),

  getNextInvoiceNumber: platformProcedure.query(async () => {
    const last = await db.invoice.findFirst({ orderBy: { invoiceNumber: 'desc' }, select: { invoiceNumber: true } });
    return (last?.invoiceNumber ?? 0) + 1;
  }),

  createInvoice: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      currency: z.string().default('USD'),
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
        include: {
          lineItems: { orderBy: { sortOrder: 'asc' } },
          organization: { select: { name: true, billingEmail: true }, },
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
      const data: any = { status: input.status };
      if (input.status === 'paid') data.paidAt = new Date();
      if (input.status === 'pending') data.paidAt = null;
      return db.invoice.update({ where: { id: input.id }, data });
    }),

  sendPaymentReminder: platformProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ input }) => {
      const invoice = await db.invoice.findUnique({
        where: { id: input.id },
        include: {
          organization: { include: { billingProfile: true } },
        },
      });
      if (!invoice) throw new TRPCError({ code: 'NOT_FOUND' });

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
      return { sent: true };
    }),

  exportInvoicesCsv: platformProcedure
    .input(z.object({
      status: z.string().optional(),
      organizationId: z.string().uuid().optional(),
      dateFrom: z.date().optional(),
      dateTo: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const where: any = {};
      if (input.status === 'overdue') {
        where.status = 'pending';
        where.dueDate = { lt: new Date() };
      } else if (input.status) {
        where.status = input.status;
      }
      if (input.organizationId) where.organizationId = input.organizationId;
      if (input.dateFrom || input.dateTo) {
        where.createdAt = {};
        if (input.dateFrom) where.createdAt.gte = input.dateFrom;
        if (input.dateTo) where.createdAt.lte = input.dateTo;
      }

      const invoices = await db.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: { organization: { select: { name: true } } },
      });

      const header = 'Numero,Organizacion,Monto,Moneda,Estado,Descripcion,Emision,Vencimiento,Pagada';
      const rows = invoices.map((inv) => {
        const fmt = (d: Date | null | undefined) => d ? new Intl.DateTimeFormat('es', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(d) : '';
        return [
          `INV-${inv.invoiceNumber}`,
          `"${inv.organization.name}"`,
          inv.amount,
          inv.currency,
          inv.status,
          `"${inv.description || ''}"`,
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
      limit: z.number().min(1).max(20).default(5),
    }))
    .query(async ({ input }) => {
      const [invoices, stats] = await Promise.all([
        db.invoice.findMany({
          where: { organizationId: input.organizationId },
          take: input.limit,
          orderBy: { createdAt: 'desc' },
          include: { lineItems: { orderBy: { sortOrder: 'asc' } } },
        }),
        db.invoice.aggregate({
          where: { organizationId: input.organizationId, status: InvoiceStatus.pending },
          _sum: { amount: true },
          _count: true,
        }),
      ]);

      const overdueCount = await db.invoice.count({
        where: {
          organizationId: input.organizationId,
          status: InvoiceStatus.pending,
          dueDate: { lt: new Date() },
        },
      });

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
      return db.billingProfile.findUnique({ where: { organizationId: input.organizationId } });
    }),

  upsertBillingProfile: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      companyName: z.string().optional(),
      taxId: z.string().optional(),
      address: z.string().optional(),
      city: z.string().optional(),
      state: z.string().optional(),
      country: z.string().optional(),
      zipCode: z.string().optional(),
      billingEmail: z.string().email().optional(),
      billingPhone: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { organizationId, ...data } = input;
      return db.billingProfile.upsert({
        where: { organizationId },
        create: { organizationId, ...data },
        update: data,
      });
    }),
});
