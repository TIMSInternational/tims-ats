'use client';

import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformPost } from './client';

const inputSchema = z.object({ id: z.string().uuid() }).strict();
const responseSchema = z
  .object({
    id: z.string().uuid(),
    status: z.literal('sent'),
    sentAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
  })
  .strict();

const viaCSharp = process.env.NEXT_PUBLIC_INVITATION_RESEND_VIA_CSHARP === 'true';

export function useInvitationResend(
  options: {
    onSuccess?: () => void;
    onError?: (error: Error) => void;
  } = {},
) {
  const legacy = trpc.platform.resendInvitation.useMutation({ retry: false });
  return useMutation({
    retry: false,
    mutationFn: async (input: z.infer<typeof inputSchema>) => {
      const parsed = inputSchema.parse(input);
      if (!viaCSharp) {
        await legacy.mutateAsync(parsed);
        return;
      }
      if (!isPlatformApiEnabled()) throw new Error('Invitation resend is unavailable. Please contact an administrator.');
      const response = responseSchema.parse(
        await platformPost('/platform/invitations/{id}/resend', undefined, { id: parsed.id }),
      );
      if (response.id.toLowerCase() !== parsed.id.toLowerCase())
        throw new Error('Invitation resend response does not match the requested invitation');
      if (Date.parse(response.expiresAt) <= Date.parse(response.sentAt))
        throw new Error('Invitation resend returned an invalid expiry');
    },
    ...options,
  });
}
