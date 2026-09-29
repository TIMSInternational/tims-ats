'use client';

// Tenant org structure (business units, teams, leaders, members, unit assignees) — C# only.
//
// Dark cutover: management is reachable only when NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP is 'true'
// (and the C# base URL is configured). There is deliberately NO tRPC fallback for these writes: the
// legacy tRPC surface is scheduled for deletion, so with the flag off the settings page keeps today's
// read-only viewer and says management needs the feature enabled.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { isPlatformApiEnabled, platformGetRaw, platformSendRaw, PlatformApiError } from './client';

const VIA_CSHARP = process.env.NEXT_PUBLIC_TENANT_ORG_STRUCTURE_VIA_CSHARP === 'true';

/** True when this build routes org-structure management to the C# service. */
export function isOrgStructureViaCSharp(): boolean {
  return VIA_CSHARP && isPlatformApiEnabled();
}

export const ORG_STRUCTURE_QUERY_KEY = ['org-structure'] as const;
export const ORG_STRUCTURE_OPTIONS_QUERY_KEY = ['org-structure', 'options'] as const;

// Caps mirror the documented server bounds (BUs 500 / teams 2000 / members 5000).
const MAX_UNITS = 500;
const MAX_TEAMS = 2000;
const MAX_PEOPLE = 5000;

const uuid = z.string().uuid();
const personSchema = z.object({ userId: uuid, fullName: z.string().max(400), email: z.string().max(320) }).strict();
const memberSchema = personSchema.extend({ role: z.string().max(50) }).strict();
const teamSchema = z
  .object({
    id: uuid,
    name: z.string().max(200),
    businessUnitId: uuid,
    isActive: z.boolean(),
    leader: personSchema.nullable(),
    members: z.array(memberSchema).max(MAX_PEOPLE),
  })
  .strict();
const businessUnitSchema = z
  .object({
    id: uuid,
    name: z.string().max(200),
    code: z.string().max(40).nullable(),
    companyId: uuid,
    isActive: z.boolean(),
    teamCount: z.number().int().min(0),
    unitAssignees: z.array(personSchema).max(MAX_PEOPLE),
    teams: z.array(teamSchema).max(MAX_TEAMS),
  })
  .strict();
const orgStructureSchema = z
  .object({
    businessUnits: z.array(businessUnitSchema).max(MAX_UNITS),
    companies: z.array(z.object({ id: uuid, name: z.string().max(200) }).strict()).max(MAX_UNITS),
  })
  .strict();

const optionsSchema = z
  .object({
    businessUnits: z
      .array(
        z
          .object({
            id: uuid,
            name: z.string().max(200),
            teams: z
              .array(z.object({ id: uuid, name: z.string().max(200), hasLeader: z.boolean() }).strict())
              .max(MAX_TEAMS),
          })
          .strict(),
      )
      .max(MAX_UNITS),
  })
  .strict();

// Write responses: only the id is relied on (the page refetches the tree after every write).
const createdSchema = z.object({ id: uuid });

export type OrgPerson = z.infer<typeof personSchema>;
export type OrgTeamMember = z.infer<typeof memberSchema>;
export type OrgTeam = z.infer<typeof teamSchema>;
export type OrgBusinessUnit = z.infer<typeof businessUnitSchema>;
export type OrgStructure = z.infer<typeof orgStructureSchema>;
export type OrgStructureOptions = z.infer<typeof optionsSchema>;

/** Full org tree for the settings screen (organization:read). Disabled unless the flag is on. */
export function useOrgStructure() {
  return useQuery({
    queryKey: ORG_STRUCTURE_QUERY_KEY,
    enabled: isOrgStructureViaCSharp(),
    retry: false,
    queryFn: async (): Promise<OrgStructure> => orgStructureSchema.parse(await platformGetRaw('/tenant/org-structure')),
  });
}

/** Active BUs + teams (no people data) for the vacancy wizard's pickers. */
export async function fetchOrgStructureOptions(): Promise<OrgStructureOptions> {
  return optionsSchema.parse(await platformGetRaw('/tenant/org-structure/options'));
}

export interface CreateBusinessUnitInput {
  name: string;
  code?: string;
  companyId?: string;
}
export interface UpdateBusinessUnitInput {
  id: string;
  name?: string;
  code?: string | null;
  isActive?: boolean;
}
export interface CreateTeamInput {
  businessUnitId: string;
  name: string;
  leaderUserId?: string;
}
export interface UpdateTeamInput {
  id: string;
  name?: string;
  isActive?: boolean;
  /** `null` clears the leader; omit to leave it unchanged. */
  leaderUserId?: string | null;
}
export interface TeamMemberInput {
  teamId: string;
  userId: string;
  role?: 'member' | 'lead';
}
export interface UnitAssigneeInput {
  businessUnitId: string;
  userId: string;
}
export interface UserBusinessUnitInput {
  userId: string;
  businessUnitId: string | null;
}

const BU = '/tenant/org-structure/business-units';
const TEAMS = '/tenant/org-structure/teams';

async function parseCreated(raw: unknown): Promise<{ id: string }> {
  return createdSchema.parse(raw);
}

/** Each org-structure write, keyed by name, so the UI and tests exercise exactly one request shape. */
export const orgStructureApi = {
  createBusinessUnit: async (input: CreateBusinessUnitInput) => parseCreated(await platformSendRaw('POST', BU, input)),
  updateBusinessUnit: async ({ id, ...body }: UpdateBusinessUnitInput) =>
    void (await platformSendRaw('PATCH', `${BU}/{id}`, body, { id })),
  createTeam: async (input: CreateTeamInput) => parseCreated(await platformSendRaw('POST', TEAMS, input)),
  updateTeam: async ({ id, ...body }: UpdateTeamInput) =>
    void (await platformSendRaw('PATCH', `${TEAMS}/{id}`, body, { id })),
  addTeamMember: async ({ teamId, userId, role }: TeamMemberInput) =>
    void (await platformSendRaw('PUT', `${TEAMS}/{teamId}/members/{userId}`, role ? { role } : {}, { teamId, userId })),
  removeTeamMember: async ({ teamId, userId }: TeamMemberInput) =>
    void (await platformSendRaw('DELETE', `${TEAMS}/{teamId}/members/{userId}`, undefined, { teamId, userId })),
  addUnitAssignee: async ({ businessUnitId, userId }: UnitAssigneeInput) =>
    void (await platformSendRaw('PUT', `${BU}/{businessUnitId}/assignees/{userId}`, undefined, {
      businessUnitId,
      userId,
    })),
  removeUnitAssignee: async ({ businessUnitId, userId }: UnitAssigneeInput) =>
    void (await platformSendRaw('DELETE', `${BU}/{businessUnitId}/assignees/{userId}`, undefined, {
      businessUnitId,
      userId,
    })),
  setUserBusinessUnit: async ({ userId, businessUnitId }: UserBusinessUnitInput) =>
    void (await platformSendRaw(
      'PUT',
      '/tenant/org-structure/users/{userId}/business-unit',
      { businessUnitId },
      { userId },
    )),
};

export type OrgStructureOperation = keyof typeof orgStructureApi;
type InputOf<K extends OrgStructureOperation> = Parameters<(typeof orgStructureApi)[K]>[0];

interface OrgMutationOptions {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

/** One org-structure write; refreshes the tree and the vacancy-wizard options on success. */
export function useOrgStructureMutation<K extends OrgStructureOperation>(operation: K, options?: OrgMutationOptions) {
  const queryClient = useQueryClient();
  return useMutation<unknown, Error, InputOf<K>>({
    mutationFn: async (input: InputOf<K>) => {
      if (!isOrgStructureViaCSharp()) throw new Error('Org structure management is not enabled');
      const fn = orgStructureApi[operation] as (value: InputOf<K>) => Promise<unknown>;
      return fn(input);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ORG_STRUCTURE_QUERY_KEY });
      options?.onSuccess?.();
    },
    onError: (error: Error) => options?.onError?.(error),
  });
}

export type OrgStructureErrorKind = 'has_active_teams' | 'forbidden' | 'not_found' | 'conflict' | 'other';

/** Stable classification of a failed org-structure call, so the UI maps it to a translated message. */
export function classifyOrgStructureError(error: unknown): OrgStructureErrorKind {
  if (error instanceof PlatformApiError) {
    if (error.code === 'business_unit_has_active_teams') return 'has_active_teams';
    if (error.status === 403) return 'forbidden';
    if (error.status === 404) return 'not_found';
    if (error.status === 409) return 'conflict';
  }
  return 'other';
}
