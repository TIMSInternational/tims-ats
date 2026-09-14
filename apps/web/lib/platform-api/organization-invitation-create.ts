'use client';

import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { trpc } from '../trpc';
import { useI18n } from '../i18n';
import { isPlatformApiEnabled, platformPost } from './client';

const inputSchema = z.object({
  email: z.string().email().max(254),
  organizationName: z.string().min(2).max(100).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/),
  organizationSlug: z.string().min(2).max(63).regex(/^[a-z0-9-]+$/),
  organizationPlan: z.enum(['trial', 'starter', 'professional', 'enterprise']).default('trial'),
}).strict();
const responseSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  delivery: z.enum(['accepted', 'unconfirmed', 'changed', 'state_unconfirmed']),
}).strict();
const viaCSharp = process.env.NEXT_PUBLIC_ORG_INVITATION_CREATE_VIA_CSHARP === 'true';

export function useOrganizationInvitationCreate(options: {
  onSuccess?: (delivery: z.infer<typeof responseSchema>['delivery'] | 'legacy') => void;
  onError?: (error: Error) => void;
} = {}) {
  const { t } = useI18n();
  const legacy = trpc.platform.createOrgInvitation.useMutation({ retry: false });
  return useMutation({
    retry: false,
    mutationFn: async (input: z.input<typeof inputSchema>) => {
      const parsed = inputSchema.parse(input);
      if (!viaCSharp) {
        await legacy.mutateAsync(parsed);
        return 'legacy' as const;
      }
      if (!isPlatformApiEnabled()) throw new Error(t.invitations.creationUnavailable);
      const result = responseSchema.parse(await platformPost('/platform/invitations/organizations', parsed));
      return result.delivery;
    },
    ...options,
  });
}
