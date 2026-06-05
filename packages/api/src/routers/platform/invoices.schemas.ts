import { z } from 'zod';

export const STATUS_FILTER = z.enum(['draft', 'pending', 'paid', 'void', 'overdue']).optional();

export const listInvoicesInput = z.object({
  page: z.number().int().min(0).default(0),
  limit: z.number().int().min(1).max(50).default(20),
  search: z.string().max(100).optional(),
  status: STATUS_FILTER,
  organizationId: z.string().uuid().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
});

export const getInvoiceInput = z.object({ id: z.string().uuid() });

export const createInvoiceInput = z.object({
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
});

export const updateInvoiceStatusInput = z.object({
  id: z.string().uuid(),
  status: z.enum(['paid', 'void', 'pending']),
});

export const sendPaymentReminderInput = z.object({ id: z.string().uuid() });

export const exportInvoicesCsvInput = z.object({
  status: STATUS_FILTER,
  organizationId: z.string().uuid().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
});

export const getOrgInvoicesInput = z.object({
  organizationId: z.string().uuid(),
  limit: z.number().int().min(1).max(20).default(5),
});

export const getBillingProfileInput = z.object({ organizationId: z.string().uuid() });

export const upsertBillingProfileInput = z.object({
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
});
