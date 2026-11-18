'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { platformGet, isPlatformApiEnabled } from './client';
import { useI18n } from '../i18n';
import { roleOptions, staffRoleOptions } from '../role-labels';

const responseSchema = z
  .object({
    roles: z.array(z.object({ slug: z.string().min(1).max(50), name: z.string().min(1).max(256) }).strict()).max(100),
  })
  .strict();
const viaCSharp = process.env.NEXT_PUBLIC_USER_INVITATION_CREATE_VIA_CSHARP === 'true';

/**
 * The roles the platform owner may pick when inviting into `organizationId`: the organization's active roles
 * from C# when the flag is on, otherwise the static staff catalogue. Either way they are labelled from the
 * shared role map (not the seeded DB name) and filtered by the launch scope (PILOT_HIDDEN_ROLE_SLUGS).
 */
export function useUserInvitationRoles(organizationId: string) {
  const { t } = useI18n();
  const query = useQuery({
    queryKey: ['user-invitation-roles', organizationId],
    enabled: viaCSharp && z.string().uuid().safeParse(organizationId).success,
    retry: false,
    queryFn: async () => {
      if (!isPlatformApiEnabled()) throw new Error(t.invitations.creationUnavailable);
      const response = responseSchema.parse(
        await platformGet('/platform/invitations/organizations/{id}/roles', undefined, { id: organizationId }),
      );
      return response.roles.map((role) => ({ slug: role.slug }));
    },
  });
  const roles = viaCSharp ? roleOptions(query.data ?? [], t.roles) : staffRoleOptions(t.roles);
  return { roles, isError: viaCSharp && query.isError, refetch: query.refetch };
}
