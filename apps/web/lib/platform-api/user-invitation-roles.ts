'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { platformGet, isPlatformApiEnabled } from './client';
import { useI18n } from '../i18n';

const responseSchema = z.object({ roles: z.array(z.object({ slug: z.string().min(1).max(50), name: z.string().min(1).max(256) }).strict()).max(100) }).strict();
const viaCSharp = process.env.NEXT_PUBLIC_USER_INVITATION_CREATE_VIA_CSHARP === 'true';
export function useUserInvitationRoles(organizationId: string, legacyRoles: { slug: string; label: string }[]) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ['user-invitation-roles', organizationId],
    enabled: viaCSharp && z.string().uuid().safeParse(organizationId).success,
    retry: false,
    queryFn: async () => {
      if (!isPlatformApiEnabled()) throw new Error(t.invitations.creationUnavailable);
      const response = responseSchema.parse(await platformGet('/platform/invitations/organizations/{id}/roles', undefined, { id: organizationId }));
      return response.roles.map(role => ({ slug: role.slug, label: role.name }));
    },
  });
  return { roles: viaCSharp ? query.data ?? [] : legacyRoles, isError: viaCSharp && query.isError, refetch: query.refetch };
}
