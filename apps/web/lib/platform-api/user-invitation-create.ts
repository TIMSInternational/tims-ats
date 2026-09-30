'use client';

import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { ASSIGNABLE_STAFF_ROLES } from '@tims/shared';
import { trpc } from '../trpc';
import { useI18n } from '../i18n';
import { isPlatformApiEnabled, platformPost } from './client';

const inputSchema = z.object({
  email: z.string().email().max(254),
  organizationId: z.string().uuid().refine(id => id !== '00000000-0000-0000-0000-000000000000'),
  roleSlug: z.string().min(1).max(50).pipe(z.enum(ASSIGNABLE_STAFF_ROLES)).optional(),
}).strict();
const responseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  delivery: z.enum(['accepted', 'unconfirmed', 'changed', 'state_unconfirmed']),
}).strict();
const viaCSharp = process.env.NEXT_PUBLIC_USER_INVITATION_CREATE_VIA_CSHARP === 'true';

export function useUserInvitationCreate(options: {
  onSuccess?: (delivery: z.infer<typeof responseSchema>['delivery'] | 'legacy') => void;
  onError?: (error: Error) => void;
} = {}) {
  const { t } = useI18n();
  const legacy = trpc.platform.createUserInvitation.useMutation({ retry: false });
  return useMutation({
    retry: false,
    mutationFn: async (input: z.input<typeof inputSchema>) => {
      const parsed = inputSchema.parse(input);
      if (!viaCSharp) {
        await legacy.mutateAsync(parsed);
        return 'legacy' as const;
      }
      if (!isPlatformApiEnabled()) throw new Error(t.invitations.creationUnavailable);
      const result = responseSchema.parse(await platformPost('/platform/invitations/users', parsed));
      if (result.organizationId.toLowerCase() !== parsed.organizationId.toLowerCase())
        throw new Error(t.invitations.creationFailed);
      return result.delivery;
    },
    ...options,
  });
}
