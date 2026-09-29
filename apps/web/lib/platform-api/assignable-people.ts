'use client';

import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { trpc } from '../trpc';
import { isPlatformApiEnabled, platformGet, PlatformApiError } from './client';

// Dark cutover: pickers read the C# tenant people directory only when this build-time flag is set;
// otherwise they keep today's tRPC user.list call (which requires user:read, so recruiters get 403).
const VIA_CSHARP = process.env.NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP === 'true';

export const ASSIGNABLE_PEOPLE_MAX_LIMIT = 50;
const MAX_SEARCH_LENGTH = 100;

export type AssignablePurpose = 'interview_evaluator' | 'vacancy_approver' | 'offer_approver';

export interface AssignablePerson {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  avatar: string | null;
}

export type AssignablePeopleFailure = 'forbidden' | 'unavailable';

const personSchema = z
  .object({
    id: z.string().uuid(),
    firstName: z.string().max(200),
    lastName: z.string().max(200),
    email: z.string().max(320),
    avatarUrl: z.string().max(2048).nullable().optional(),
    roleSlugs: z.array(z.string().max(50)).max(20),
  })
  .strict();

const responseSchema = z.object({ people: z.array(personSchema).max(ASSIGNABLE_PEOPLE_MAX_LIMIT) }).strict();

interface Options {
  purpose: AssignablePurpose;
  search?: string;
  limit?: number;
  enabled?: boolean;
}

export interface AssignablePeopleState {
  people: AssignablePerson[];
  isLoading: boolean;
  /** Null while loading or on success; a stable failure kind the picker maps to an i18n message. */
  failure: AssignablePeopleFailure | null;
  refetch: () => void;
}

function isForbidden(error: unknown): boolean {
  if (error instanceof PlatformApiError) return error.status === 403;
  if (error && typeof error === 'object' && 'data' in error) {
    const data = (error as { data?: { code?: unknown } | null }).data;
    return data?.code === 'FORBIDDEN';
  }
  return false;
}

/**
 * People a picker may offer for `purpose`, from exactly ONE backend per build: the C# directory when
 * NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP is 'true', otherwise the legacy tRPC user.list. A C#
 * failure is surfaced as an error state and never silently retried against tRPC.
 */
export function useAssignablePeople({
  purpose,
  search,
  limit = ASSIGNABLE_PEOPLE_MAX_LIMIT,
  enabled = true,
}: Options): AssignablePeopleState {
  const term = search?.trim().slice(0, MAX_SEARCH_LENGTH) || undefined;
  const boundedLimit = Math.min(Math.max(1, Math.trunc(limit)), ASSIGNABLE_PEOPLE_MAX_LIMIT);

  const csharp = useQuery({
    queryKey: ['assignable-people', purpose, term ?? '', boundedLimit],
    enabled: VIA_CSHARP && enabled,
    retry: false,
    staleTime: 30_000,
    queryFn: async (): Promise<AssignablePerson[]> => {
      if (!isPlatformApiEnabled()) throw new Error('Platform API is not configured');
      const raw = await platformGet('/tenant/people/assignable', { purpose, search: term, limit: boundedLimit });
      return responseSchema.parse(raw).people.map((person) => ({
        id: person.id,
        firstName: person.firstName,
        lastName: person.lastName,
        email: person.email,
        avatar: person.avatarUrl ?? null,
      }));
    },
  });

  const legacy = trpc.user.list.useQuery(
    { limit: boundedLimit, search: term, isActive: true },
    { enabled: !VIA_CSHARP && enabled, retry: false, staleTime: 30_000 },
  );

  if (VIA_CSHARP) {
    return {
      people: csharp.data ?? [],
      isLoading: enabled && csharp.isLoading,
      failure: csharp.isError ? (isForbidden(csharp.error) ? 'forbidden' : 'unavailable') : null,
      refetch: () => void csharp.refetch(),
    };
  }
  return {
    people: (legacy.data?.users ?? []).map((user) => ({
      id: user.id,
      firstName: user.firstName,
      lastName: user.lastName,
      email: user.email,
      avatar: user.avatar ?? null,
    })),
    isLoading: enabled && legacy.isLoading,
    failure: legacy.isError ? (isForbidden(legacy.error) ? 'forbidden' : 'unavailable') : null,
    refetch: () => void legacy.refetch(),
  };
}
