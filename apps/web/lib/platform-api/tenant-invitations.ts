'use client';

// Tenant self-serve team invitations (finding F8) against the C# `/tenant-invitations` surface.
//
// The org is ALWAYS resolved server-side from the caller's session — no organizationId is ever
// sent. There is no legacy tRPC twin for this surface, so there is no fallback: when the flag or
// the platform base URL is missing the feature is simply unavailable (callers render that state).
//
// Paths go through the untyped `platformGetRaw`/`platformPostRaw` helpers on purpose: the zod
// schemas below are the source of truth for the wire contract, so this module compiles whether or
// not schema.d.ts has been regenerated with the new endpoints yet.

import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { isPlatformApiEnabled, platformGetRaw, platformPostRaw } from './client';

const isoDateTime = z.string().datetime({ offset: true });
const uuid = z.string().uuid();

export const tenantInvitationRolesSchema = z
  .object({
    roles: z.array(z.object({ slug: z.string().min(1).max(50), name: z.string().min(1).max(256) }).strict()).max(100),
  })
  .strict();

export const tenantInvitationSchema = z
  .object({
    id: uuid,
    email: z.string().min(1).max(254),
    roleSlug: z.string().min(1).max(50).nullable(),
    status: z.enum(['pending', 'sent', 'expired']),
    createdAt: isoDateTime,
    expiresAt: isoDateTime,
    sentAt: isoDateTime.nullable(),
  })
  .strict();

/** Page size the UI requests; the API accepts 1..100 and rejects (never clamps) anything else. */
export const TENANT_INVITATION_PAGE_SIZE = 50;

export const tenantInvitationListSchema = z
  .object({ invitations: z.array(tenantInvitationSchema).max(100), nextCursor: uuid.nullable() })
  .strict();

/**
 * `active` = pending/sent and not yet past expiry; `expired` = stored expired OR past expiry (the API reports
 * those with status `expired`); `all` = both.
 */
export const TENANT_INVITATION_STATUS_FILTERS = ['active', 'expired', 'all'] as const;
export type TenantInvitationStatusFilter = (typeof TENANT_INVITATION_STATUS_FILTERS)[number];

export const tenantInvitationCreateInputSchema = z
  .object({ email: z.string().trim().email().max(254), roleSlug: z.string().min(1).max(50) })
  .strict();

export const tenantInvitationCreateResponseSchema = z
  .object({
    id: uuid,
    organizationId: uuid,
    delivery: z.enum(['accepted', 'unconfirmed', 'changed', 'state_unconfirmed']),
  })
  .strict();

export const tenantInvitationResendResponseSchema = z
  .object({ id: uuid, status: z.literal('sent'), sentAt: isoDateTime, expiresAt: isoDateTime })
  .strict();

export const tenantInvitationRevokeResponseSchema = z.object({ id: uuid, status: z.literal('revoked') }).strict();

export type TenantInvitationRole = z.infer<typeof tenantInvitationRolesSchema>['roles'][number];
export type TenantInvitation = z.infer<typeof tenantInvitationSchema>;
export type TenantInvitationPage = z.infer<typeof tenantInvitationListSchema>;
export type TenantInvitationCreateInput = z.input<typeof tenantInvitationCreateInputSchema>;
export type TenantInvitationDelivery = z.infer<typeof tenantInvitationCreateResponseSchema>['delivery'];

/** Thrown (never sent) when the flag or the platform base URL is off — callers render "unavailable". */
export class TenantInvitationsUnavailableError extends Error {
  constructor() {
    super('Tenant invitations are unavailable.');
    this.name = 'TenantInvitationsUnavailableError';
  }
}

/** Dark by default: requires NEXT_PUBLIC_TENANT_INVITATIONS_VIA_CSHARP=true AND the platform URL. */
export function isTenantInvitationsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_TENANT_INVITATIONS_VIA_CSHARP === 'true' && isPlatformApiEnabled();
}

function assertEnabled(): void {
  if (!isTenantInvitationsEnabled()) throw new TenantInvitationsUnavailableError();
}

export async function fetchTenantInvitationRoles(): Promise<TenantInvitationRole[]> {
  assertEnabled();
  return tenantInvitationRolesSchema.parse(await platformGetRaw('/tenant-invitations/roles')).roles;
}

export async function fetchTenantInvitations(
  status: TenantInvitationStatusFilter = 'active',
  cursor?: string,
): Promise<TenantInvitationPage> {
  const parsedCursor = cursor === undefined ? undefined : uuid.parse(cursor);
  assertEnabled();
  return tenantInvitationListSchema.parse(
    await platformGetRaw('/tenant-invitations', {
      status,
      limit: TENANT_INVITATION_PAGE_SIZE,
      cursor: parsedCursor,
    }),
  );
}

export async function createTenantInvitation(input: TenantInvitationCreateInput): Promise<TenantInvitationDelivery> {
  const parsed = tenantInvitationCreateInputSchema.parse(input);
  assertEnabled();
  return tenantInvitationCreateResponseSchema.parse(await platformPostRaw('/tenant-invitations', parsed)).delivery;
}

export async function resendTenantInvitation(id: string): Promise<void> {
  const parsedId = uuid.parse(id);
  assertEnabled();
  // The same-origin relay requires a JSON body on POST; `{}` keeps the bodyless contract.
  const response = tenantInvitationResendResponseSchema.parse(
    await platformPostRaw('/tenant-invitations/{id}/resend', {}, { id: parsedId }),
  );
  if (response.id.toLowerCase() !== parsedId.toLowerCase())
    throw new Error('Invitation resend response does not match the requested invitation');
  if (Date.parse(response.expiresAt) <= Date.parse(response.sentAt))
    throw new Error('Invitation resend returned an invalid expiry');
}

export async function revokeTenantInvitation(id: string): Promise<void> {
  const parsedId = uuid.parse(id);
  assertEnabled();
  const response = tenantInvitationRevokeResponseSchema.parse(
    await platformPostRaw('/tenant-invitations/{id}/revoke', {}, { id: parsedId }),
  );
  if (response.id.toLowerCase() !== parsedId.toLowerCase())
    throw new Error('Invitation revoke response does not match the requested invitation');
}

const ROLES_KEY = ['tenant-invitations', 'roles'] as const;
const LIST_KEY = ['tenant-invitations', 'list'] as const;

export function useTenantInvitationRoles(enabled: boolean) {
  return useQuery({
    queryKey: ROLES_KEY,
    queryFn: fetchTenantInvitationRoles,
    enabled: enabled && isTenantInvitationsEnabled(),
    retry: false,
  });
}

/** Keyset-paged: `fetchNextPage()` passes the previous page's `nextCursor` (the last row it showed). */
export function useTenantInvitations(enabled: boolean, status: TenantInvitationStatusFilter) {
  return useInfiniteQuery({
    queryKey: [...LIST_KEY, status],
    queryFn: ({ pageParam }) => fetchTenantInvitations(status, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: enabled && isTenantInvitationsEnabled(),
    retry: false,
  });
}

type MutationCallbacks<T> = { onSuccess?: (value: T) => void; onError?: (error: Error) => void };

// Every mutation refreshes the pending list on settle — including on error, because an uncertain
// create/resend (transport failure, 409 changed, 503) may still have changed server state.
// retry:false on all of them: a replayed create/resend could send a second email.
function useInvitationMutation<TVars, TResult>(
  mutationFn: (vars: TVars) => Promise<TResult>,
  callbacks: MutationCallbacks<TResult>,
) {
  const queryClient = useQueryClient();
  return useMutation({
    retry: false,
    mutationFn,
    onSuccess: (value: TResult) => callbacks.onSuccess?.(value),
    onError: (error: Error) => callbacks.onError?.(error),
    onSettled: () => queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
}

export function useCreateTenantInvitation(callbacks: MutationCallbacks<TenantInvitationDelivery> = {}) {
  return useInvitationMutation(createTenantInvitation, callbacks);
}

export function useResendTenantInvitation(callbacks: MutationCallbacks<void> = {}) {
  return useInvitationMutation(resendTenantInvitation, callbacks);
}

export function useRevokeTenantInvitation(callbacks: MutationCallbacks<void> = {}) {
  return useInvitationMutation(revokeTenantInvitation, callbacks);
}
