import React from 'react';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// #317: every UserPicker must name the purpose of the mutation it feeds, so non-admin roles read the C#
// assignable-people directory (gated on that mutation's permission) instead of tRPC user.list (user:read).
process.env.NEXT_PUBLIC_TIMS_PLATFORM_API_URL = 'https://csharp.test';
process.env.NEXT_PUBLIC_TENANT_PEOPLE_DIRECTORY_VIA_CSHARP = 'true';

const APP_DIR = join(__dirname, '../../apps/web/app');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith('.tsx') ? [path] : [];
  });
}

/**
 * The text of a JSX opening tag starting at `start`, scanned to its closing `>` at brace depth 0 — so an
 * arrow-function prop (`onSelect={(id) => …}`) or a `>` inside a string/expression does not end it early.
 */
function openingTag(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const ch = source[i]!;
    if (quote) {
      if (ch === quote && source[i - 1] !== '\\') quote = null;
    } else if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
    } else if (ch === '>' && depth === 0) {
      return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

/** `purpose="…"` for every `<UserPicker` JSX element in a file, in order (null = no purpose prop). */
function pickerPurposes(source: string): Array<string | null> {
  const purposes: Array<string | null> = [];
  for (const match of source.matchAll(/<UserPicker\b/g)) {
    const tag = openingTag(source, match.index!);
    // Only top-level props count: strip nested {…} expressions before looking for purpose="…".
    let topLevel = '';
    let depth = 0;
    for (const ch of tag) {
      if (ch === '{') depth++;
      if (depth === 0) topLevel += ch;
      if (ch === '}') depth--;
    }
    const prop = /\bpurpose="([a-z0-9_]+)"/.exec(topLevel);
    purposes.push(prop ? prop[1]! : null);
  }
  return purposes;
}

// The mutation each picker feeds decides its purpose (services/Tims.Platform AssignablePurposes.RuleFor).
const EXPECTED: Record<string, Array<string>> = {
  '(admin)/learning/enroll-modal.tsx': ['learning_enrollee'],
  '(admin)/people/onboarding/create-plan-modal.tsx': ['onboarding_hire', 'colleague'],
  '(admin)/people/performance/create-commitment-modal.tsx': ['performance_subject'],
  '(admin)/people/performance/create-okr-modal.tsx': ['performance_subject'],
  '(admin)/people/performance/log-coaching-modal.tsx': ['performance_subject', 'colleague'],
  '(admin)/people/performance/feedback-modal.tsx': ['colleague'],
  '(admin)/people/performance/recognition-modal.tsx': ['colleague'],
  '(admin)/settings/business-units/assign-user-modal.tsx': ['org_structure_member'],
  '(admin)/settings/business-units/team-members-modal.tsx': ['org_structure_member'],
  '(admin)/settings/business-units/user-business-unit-modal.tsx': ['org_structure_member'],
  '(admin)/settings/business-units/person-picker-modal.tsx': ['org_structure_member'],
  '(admin)/talent/360/assign-raters-form.tsx': ['evaluation360_participant', 'evaluation360_participant'],
  '(admin)/talent/succession/add-successor-modal.tsx': ['succession_candidate'],
  '(admin)/talent/nine-box/committee-members-panel.tsx': ['ninebox_committee_member'],
  '(admin)/recruitment/offers/_components/offer-approval-actions.tsx': ['offer_approver'],
  '(admin)/recruitment/interviews/evaluators-modal.tsx': ['interview_evaluator'],
  '(admin)/recruitment/vacancies/create-modal.org-fields.tsx': ['vacancy_assignee'],
  '(admin)/recruitment/vacancies/[id]/submit-approval-modal.tsx': ['vacancy_approver'],
};

describe('picker tag scanner', () => {
  it('reads purpose past arrow-function props and ignores purpose-like text inside expressions', () => {
    const src = `<UserPicker onSelect={(id) => pick(id > 0 ? 'purpose="x"' : id)} purpose="colleague" />
      <UserPicker onSelect={() => set({ purpose: 'y' })} disabled={a > b} />`;
    expect(pickerPurposes(src)).toEqual(['colleague', null]);
  });
});

describe('UserPicker call sites (#317)', () => {
  const sites = tsxFiles(APP_DIR)
    .map((path) => ({ path: relative(APP_DIR, path), purposes: pickerPurposes(readFileSync(path, 'utf8')) }))
    .filter((site) => site.purposes.length > 0);

  it('every picker in the app passes a purpose (none falls back to tRPC user.list)', () => {
    const missing = sites.filter((site) => site.purposes.includes(null)).map((site) => site.path);
    expect(missing).toEqual([]);
  });

  it('each picker names the purpose of the mutation it feeds', () => {
    const actual = Object.fromEntries(sites.map((site) => [site.path, site.purposes]));
    expect(actual).toEqual(EXPECTED);
  });
});

const userListOptions = vi.hoisted(() => [] as Array<{ enabled?: boolean } | undefined>);
const idleQuery = vi.hoisted(() => (_input: unknown, options?: { enabled?: boolean }) => {
  userListOptions.push(options);
  return { data: undefined, isLoading: false, isError: false, error: null, refetch: vi.fn() };
});
vi.mock('../../apps/web/lib/trpc', () => ({
  trpc: {
    useUtils: () => ({ performance: { listFeedback: { invalidate: vi.fn() } } }),
    user: { list: { useQuery: idleQuery } },
    performance: { submitFeedback: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) } },
  },
}));
vi.mock('@tims/auth/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getSession: async () => ({ data: { session: { access_token: 'test-token' } } }) },
  }),
}));
const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

beforeEach(() => {
  userListOptions.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ people: [] }), { status: 200 }));
});

describe('feedback recipient picker (#317 worst case: any employee)', () => {
  it('reads the C# directory as a colleague and never enables tRPC user.list', async () => {
    const { FeedbackModal } = await import('../../apps/web/app/(admin)/people/performance/feedback-modal');
    render(
      <QueryClientProvider client={new QueryClient()}>
        <FeedbackModal onClose={vi.fn()} />
      </QueryClientProvider>,
    );

    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([url]) => String(url))).toContain(
        '/api/platform/tenant/people/assignable?purpose=colleague&limit=25',
      ),
    );
    expect(userListOptions.length).toBeGreaterThan(0);
    expect(userListOptions.every((options) => options?.enabled === false)).toBe(true);
  });
});
