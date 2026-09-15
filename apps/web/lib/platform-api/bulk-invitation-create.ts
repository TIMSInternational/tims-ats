'use client';

import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { trpc } from '../trpc';
import { useI18n } from '../i18n';
import { isPlatformApiEnabled, platformPost } from './client';

const inputSchema = z.object({
  organizationId: z.string().uuid().refine(id => id !== '00000000-0000-0000-0000-000000000000'),
  users: z.array(z.object({
    email: z.string().email().max(254),
    roleSlug: z.string().min(1).max(50).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/).optional(),
    firstName: z.string().max(100).optional(), lastName: z.string().max(100).optional(),
  }).strict()).min(1).max(200),
}).strict();
const reasonSchema = z.enum(['duplicate_row', 'already_invited', 'organization_unavailable', 'role_unavailable', 'delivery_unconfirmed', 'state_changed', 'state_unconfirmed', 'not_attempted', 'operation_unconfirmed']);
const resultSchema = z.object({ index: z.number().int().min(0).max(199), email: z.string().email().max(254), status: z.enum(['sent', 'duplicate', 'error']), reason: reasonSchema.nullable() }).strict();
const count = z.number().int().min(0).max(200);
const summarySchema = z.object({ total: count, sent: count, duplicates: count, errors: count }).strict();
const responseSchema = z.object({ results: z.array(resultSchema).min(1).max(200), summary: summarySchema }).strict();
const legacySchema = z.object({ results: z.array(z.object({ email: z.string().email().max(254), status: z.enum(['sent', 'duplicate', 'error']), message: z.string().max(500).optional() }).strict()).max(200), summary: summarySchema }).strict();
export type BulkInvitationResponse = z.infer<typeof responseSchema>;
const viaCSharp = process.env.NEXT_PUBLIC_BULK_INVITATION_VIA_CSHARP === 'true';

export function useBulkInvitationCreate(options: { onSuccess?: (result: BulkInvitationResponse) => void; onError?: (error: Error) => void } = {}) {
  const { t } = useI18n();
  const legacy = trpc.platform.bulkInviteUsers.useMutation({ retry: false });
  return useMutation({
    retry: false,
    mutationFn: async (input: z.input<typeof inputSchema>): Promise<BulkInvitationResponse> => {
      const parsed = inputSchema.parse(input);
      let response: BulkInvitationResponse;
      if (!viaCSharp) {
        const result = legacySchema.parse(await legacy.mutateAsync(parsed));
        response = { summary: result.summary, results: result.results.map((row, index) => ({ index, email: row.email, status: row.status, reason: row.status === 'sent' ? null : row.status === 'duplicate' ? 'already_invited' : 'operation_unconfirmed' })) };
      } else {
        if (!isPlatformApiEnabled()) throw new Error(t.invitations.creationUnavailable);
        response = responseSchema.parse(await platformPost('/platform/invitations/bulk', parsed));
      }
      const rows = response.results;
      if (rows.length !== parsed.users.length || rows.some((r, i) => r.index !== i || r.email !== parsed.users[i]?.email) ||
          response.summary.total !== rows.length || response.summary.sent !== rows.filter(r => r.status === 'sent').length ||
          response.summary.duplicates !== rows.filter(r => r.status === 'duplicate').length || response.summary.errors !== rows.filter(r => r.status === 'error').length ||
          rows.some(r => r.status === 'sent' ? r.reason !== null : r.status === 'duplicate' ? !['duplicate_row', 'already_invited'].includes(r.reason ?? '') : r.reason === null || ['duplicate_row', 'already_invited'].includes(r.reason)))
        throw new Error(t.invitations.bulkResponseUnconfirmed);
      return response;
    },
    ...options,
  });
}
