# AI Voice Interview — Paid Add-on + Per-Type Duration Caps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI Voice Interview a platform-controlled, paid per-org add-on (flat monthly fee + per-minute usage billing) with a per-interview-type duration cap that auto-ends calls.

**Architecture:** The `AiAgentOrgConfig` row for the `ai-voice-interview` agent is the per-org control record. We extend it with billing + cap columns, add a fail-closed `assertAiInterviewEnabled(orgId)` gate at the top of `aiInterview.create`/`start`, resolve a per-type duration cap at `create` (stored on `AiInterviewSession.maxDurationSeconds`), auto-end the call client-side, record per-minute billable usage in the post-call webhook, surface the add-on fee to billing, and add platform-owner-only admin controls. Pure logic is unit-tested; impure db/UI wiring is covered by static-source tripwire tests (the repo's established pattern).

**Tech Stack:** Next.js 15 (App Router) · tRPC · Prisma (PostgreSQL/Supabase, multi-file schema folder) · TypeScript strict · Vitest 4 (node env, `tests/**/*.test.ts`) · i18n via `apps/web/lib/i18n/{en,es}.json`.

## Global Constraints

- **TypeScript strict, no `any`.** No `// @ts-ignore`. Narrow `unknown`; never `as any`. (CLAUDE.md)
- **Tenant isolation.** Every tenant-context query filters by `organizationId`. Candidate/token paths (publicProcedure, no RLS GUC) use `systemDb` with an **explicit** `organizationId` filter — never `tenantDb` (it returns zero rows without the GUC).
- **No inline styles** in `.tsx` (`style={{` is a tripwire failure). Tailwind classes only.
- **i18n both locales.** Every new user-facing string added to BOTH `apps/web/lib/i18n/en.json` AND `apps/web/lib/i18n/es.json`, with identical key sets.
- **Prisma `Json` columns:** declare `Json?` (nullable) / `Json` (required); add `@map("snake_case")` only when column name differs. Postgres maps to `jsonb`.
- **Prod is NOT prisma-migrate-managed.** Every schema change ships a hand-written idempotent `migration.sql` applied via `npx prisma db execute --file=...`. Match the style in `migrations/20260624000000_ai_interview_session/migration.sql` (idempotent `DO $$ ... EXCEPTION WHEN duplicate_column THEN NULL; END $$;`, snake_case quoted columns).
- **Tests live centrally** under `tests/` (NOT co-located); vitest `include: ['tests/**/*.test.ts']`, node env, `globals: true`. New tests go in `tests/access/`. Run one file: `npx vitest run tests/access/<file>.test.ts` from repo root.
- **The agent slug `'ai-voice-interview'`** is the single source of truth for the voice-interview agent. Use the exported `AI_VOICE_INTERVIEW_SLUG` constant (introduced in Task 2) — do not re-introduce bare literals.
- **Type-check gate (must pass before each commit):** `pnpm --filter @tims/api exec tsc --noEmit` and (for web changes) `cd apps/web && npx tsc --noEmit`.

## Feature-enabled rule (the whole feature hinges on this)

The AI Voice Interview is **ON** for an org iff an `AiAgentOrgConfig` row exists for the `ai-voice-interview` agent with `enabled = true`. No row, or `enabled = false` → **OFF**. This gate logic is specific to the `ai-voice-interview` agent path; it does NOT change the generic `AiAgentOrgConfig.enabled` default (`true`) for other agents.

## File Structure

**New files:**
- `packages/db/prisma/migrations/20260628000000_ai_interview_addon_caps/migration.sql` — additive columns (config billing/cap cols + `ai_interview_sessions.max_duration_seconds`); Slice 2 extends with a second migration for the billable column.
- `packages/api/src/services/ai-interview-access.service.ts` — `AI_VOICE_INTERVIEW_SLUG`, the `AiInterviewConfig` type, pure `isEnabledConfig` + `resolveMaxDurationSeconds`, impure `loadAiInterviewConfig` / `isAiInterviewEnabled` / `assertAiInterviewEnabled`.
- `packages/api/src/services/ai-interview-billing.ts` — pure `computeInterviewBillableUsd` (Slice 2).
- `apps/web/app/(portal)/ai-interview/[token]/should-auto-end.ts` — pure `shouldAutoEnd`.
- `tests/access/ai-interview-access-helpers.test.ts` — behavioral (pure) + tripwire (impure) for the access service.
- `tests/access/ai-interview-caps.test.ts` — behavioral for `resolveMaxDurationSeconds`.
- `tests/access/ai-interview-should-auto-end.test.ts` — behavioral for `shouldAutoEnd`.
- `tests/access/ai-interview-addon-gate.test.ts` — tripwires for router/service/recruiter-UI/call-UI gating.
- `tests/access/ai-interview-billing.test.ts` — behavioral for `computeInterviewBillableUsd` + webhook tripwire (Slice 2).
- `tests/access/ai-interview-platform-admin.test.ts` — tripwire for platform admin controls + i18n (Slice 2).

**Modified files:**
- `packages/db/prisma/schema/ai-agent.prisma` — add 4 columns to `AiAgentOrgConfig`; add `billableUsd` to `AiAgentUsageLog` (Slice 2).
- `packages/db/prisma/schema/ai-interview.prisma` — add `maxDurationSeconds` to `AiInterviewSession`.
- `packages/api/src/routers/ai-interview.ts` — `create` gate (via service), `start` gate + return `maxDurationSeconds` + use it in `getSignedUrl`, new `isEnabled` query, billable wiring touch (Slice 2 via webhook only).
- `packages/api/src/services/ai-interview.service.ts` — `createAiInterviewSession` calls the gate + resolves/stores the cap; `processPostCallWebhook` records billable usage (Slice 2).
- `packages/api/src/repositories/ai-interview.repository.ts` — `createSession` accepts `maxDurationSeconds`; session selects include `maxDurationSeconds`.
- `packages/api/src/routers/platform/ai-agents.ts` — extend `updateAiAgentOrgConfig` input (Slice 2).
- `apps/web/app/(admin)/recruitment/interviews/page.tsx` + `interview-table.tsx` — `isEnabled` query + hide/upsell.
- `apps/web/app/(portal)/ai-interview/[token]/use-interview-call.ts` + `call-shell.tsx` — thread `maxDurationSeconds`, auto-end.
- `apps/web/app/(admin)/platform/ai-agents/agent-detail-drawer.tsx` — add-on/cap form controls (Slice 2).
- `apps/web/lib/i18n/en.json` + `es.json` — new keys (upsell, duration cap, billing labels).

---

# Slice 1 — Gate + Caps

> Outcome of this slice: the feature is fully **gated** (platform-controlled on/off) and **cost-capped** (per-type duration cap, app-side auto-end). No billing/monetization yet (Slice 2). Slice 1 is independently shippable: when no config row exists the feature is OFF everywhere (recruiter button hidden, `create`/`start` throw FORBIDDEN), which is the correct default.

### Task 1: Schema + migration — config billing/cap columns + session cap column

**Files:**
- Modify: `packages/db/prisma/schema/ai-agent.prisma` (model `AiAgentOrgConfig`, lines 21–36)
- Modify: `packages/db/prisma/schema/ai-interview.prisma` (model `AiInterviewSession`, lines 15–46)
- Create: `packages/db/prisma/migrations/20260628000000_ai_interview_addon_caps/migration.sql`
- Test: `tests/access/ai-interview-addon-gate.test.ts` (schema/migration tripwire portion)

**Interfaces:**
- Produces: `AiAgentOrgConfig.addonMonthlyFeeUsd: Float?`, `.billableUsdPerMinute: Float?`, `.aiInterviewDefaultMaxMinutes: Int?`, `.aiInterviewMaxMinutesByType: Json?`; `AiInterviewSession.maxDurationSeconds: Int?`. DB columns `addon_monthly_fee_usd`, `billable_usd_per_minute`, `ai_interview_default_max_minutes`, `ai_interview_max_minutes_by_type`, `max_duration_seconds`.

- [ ] **Step 1: Write the failing tripwire test**

Create `tests/access/ai-interview-addon-gate.test.ts`:

```ts
// tests/access/ai-interview-addon-gate.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('schema: AiAgentOrgConfig add-on + cap columns', () => {
  const src = read('packages/db/prisma/schema/ai-agent.prisma');
  it('adds the four config columns', () => {
    expect(src).toMatch(/addonMonthlyFeeUsd\s+Float\?\s+@map\("addon_monthly_fee_usd"\)/);
    expect(src).toMatch(/billableUsdPerMinute\s+Float\?\s+@map\("billable_usd_per_minute"\)/);
    expect(src).toMatch(/aiInterviewDefaultMaxMinutes\s+Int\?\s+@map\("ai_interview_default_max_minutes"\)/);
    expect(src).toMatch(/aiInterviewMaxMinutesByType\s+Json\?\s+@map\("ai_interview_max_minutes_by_type"\)/);
  });
});

describe('schema: AiInterviewSession duration cap column', () => {
  const src = read('packages/db/prisma/schema/ai-interview.prisma');
  it('adds maxDurationSeconds', () => {
    expect(src).toMatch(/maxDurationSeconds\s+Int\?\s+@map\("max_duration_seconds"\)/);
  });
});

describe('migration: ai_interview_addon_caps', () => {
  const sql = read('packages/db/prisma/migrations/20260628000000_ai_interview_addon_caps/migration.sql');
  it('adds all five columns idempotently', () => {
    expect(sql).toContain('addon_monthly_fee_usd');
    expect(sql).toContain('billable_usd_per_minute');
    expect(sql).toContain('ai_interview_default_max_minutes');
    expect(sql).toContain('ai_interview_max_minutes_by_type');
    expect(sql).toContain('max_duration_seconds');
    expect(sql).toContain('duplicate_column'); // idempotent guards present
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/access/ai-interview-addon-gate.test.ts`
Expected: FAIL (columns/migration not present).

- [ ] **Step 3: Add the Prisma columns**

In `packages/db/prisma/schema/ai-agent.prisma`, inside `model AiAgentOrgConfig`, after the `monthlyBudget` line, add:

```prisma
  // AI Voice Interview paid add-on (gate logic specific to the ai-voice-interview agent).
  addonMonthlyFeeUsd           Float?   @map("addon_monthly_fee_usd")
  billableUsdPerMinute         Float?   @map("billable_usd_per_minute")
  aiInterviewDefaultMaxMinutes Int?     @map("ai_interview_default_max_minutes")
  aiInterviewMaxMinutesByType  Json?    @map("ai_interview_max_minutes_by_type")
```

In `packages/db/prisma/schema/ai-interview.prisma`, inside `model AiInterviewSession`, after the `durationSeconds` line, add:

```prisma
  maxDurationSeconds       Int?              @map("max_duration_seconds")
```

- [ ] **Step 4: Write the migration SQL**

Create `packages/db/prisma/migrations/20260628000000_ai_interview_addon_caps/migration.sql`:

```sql
-- AI Voice Interview — paid add-on + per-type duration caps.
-- Additive only (new nullable columns); no RLS change (both tables already carry
-- the tenant_isolation policy). Prod is NOT prisma-migrate-managed; apply via:
--   npx prisma db execute --file=packages/db/prisma/migrations/20260628000000_ai_interview_addon_caps/migration.sql

-- 1) AiAgentOrgConfig: billing + cap columns (only meaningful for the ai-voice-interview agent row).
DO $$ BEGIN
  ALTER TABLE "ai_agent_org_configs" ADD COLUMN "addon_monthly_fee_usd" DOUBLE PRECISION;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_agent_org_configs" ADD COLUMN "billable_usd_per_minute" DOUBLE PRECISION;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_agent_org_configs" ADD COLUMN "ai_interview_default_max_minutes" INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ai_agent_org_configs" ADD COLUMN "ai_interview_max_minutes_by_type" JSONB;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;

-- 2) AiInterviewSession: per-session resolved duration cap (seconds).
DO $$ BEGIN
  ALTER TABLE "ai_interview_sessions" ADD COLUMN "max_duration_seconds" INTEGER;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
```

- [ ] **Step 5: Regenerate the Prisma client**

Run: `cd packages/db && npx prisma generate && cd ../..`
Expected: client regenerated, exit 0 (the new fields appear on the generated types).

- [ ] **Step 6: Run test to verify it passes + tsc**

Run: `npx vitest run tests/access/ai-interview-addon-gate.test.ts`
Expected: PASS (schema + migration describe blocks).
Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema/ai-agent.prisma packages/db/prisma/schema/ai-interview.prisma packages/db/prisma/migrations/20260628000000_ai_interview_addon_caps/ tests/access/ai-interview-addon-gate.test.ts
git commit -m "feat(ai-interview): schema + migration for add-on billing/cap columns"
```

---

### Task 2: Pure helpers — slug constant, enabled check, cap resolver

**Files:**
- Create: `packages/api/src/services/ai-interview-access.service.ts` (pure exports only in this task)
- Test: `tests/access/ai-interview-caps.test.ts`

**Interfaces:**
- Produces:
  - `export const AI_VOICE_INTERVIEW_SLUG = 'ai-voice-interview'`
  - `export const AI_INTERVIEW_DEFAULT_MAX_MINUTES = 15`
  - `export interface AiInterviewConfig { enabled: boolean; monthlyBudget: number | null; billableUsdPerMinute: number | null; addonMonthlyFeeUsd: number | null; aiInterviewDefaultMaxMinutes: number | null; aiInterviewMaxMinutesByType: unknown }`
  - `export function isEnabledConfig(config: AiInterviewConfig | null): boolean`
  - `export function resolveMaxDurationSeconds(interviewType: string, config: AiInterviewConfig | null): number`
- Consumes: nothing (pure, no db import in this task).

- [ ] **Step 1: Write the failing test**

Create `tests/access/ai-interview-caps.test.ts`:

```ts
// tests/access/ai-interview-caps.test.ts
import { describe, it, expect } from 'vitest';
import {
  isEnabledConfig,
  resolveMaxDurationSeconds,
  AI_VOICE_INTERVIEW_SLUG,
  AI_INTERVIEW_DEFAULT_MAX_MINUTES,
  type AiInterviewConfig,
} from '../../packages/api/src/services/ai-interview-access.service';

const base: AiInterviewConfig = {
  enabled: true,
  monthlyBudget: null,
  billableUsdPerMinute: null,
  addonMonthlyFeeUsd: null,
  aiInterviewDefaultMaxMinutes: null,
  aiInterviewMaxMinutesByType: null,
};

describe('AI_VOICE_INTERVIEW_SLUG', () => {
  it('is the canonical agent slug', () => {
    expect(AI_VOICE_INTERVIEW_SLUG).toBe('ai-voice-interview');
    expect(AI_INTERVIEW_DEFAULT_MAX_MINUTES).toBe(15);
  });
});

describe('isEnabledConfig', () => {
  it('false when no row', () => {
    expect(isEnabledConfig(null)).toBe(false);
  });
  it('false when disabled', () => {
    expect(isEnabledConfig({ ...base, enabled: false })).toBe(false);
  });
  it('true when enabled row present', () => {
    expect(isEnabledConfig({ ...base, enabled: true })).toBe(true);
  });
});

describe('resolveMaxDurationSeconds', () => {
  it('falls back to 15 min when nothing configured', () => {
    expect(resolveMaxDurationSeconds('technical', null)).toBe(15 * 60);
    expect(resolveMaxDurationSeconds('technical', base)).toBe(15 * 60);
  });
  it('uses org default when set and no override matches', () => {
    expect(resolveMaxDurationSeconds('technical', { ...base, aiInterviewDefaultMaxMinutes: 20 })).toBe(20 * 60);
  });
  it('prefers a per-type override over the default', () => {
    const config = { ...base, aiInterviewDefaultMaxMinutes: 20, aiInterviewMaxMinutesByType: { technical: 30 } };
    expect(resolveMaxDurationSeconds('technical', config)).toBe(30 * 60);
    expect(resolveMaxDurationSeconds('cultural', config)).toBe(20 * 60); // unmatched type → default
  });
  it('ignores a malformed override map (non-numeric / non-object) and uses default/fallback', () => {
    expect(resolveMaxDurationSeconds('technical', { ...base, aiInterviewMaxMinutesByType: 'garbage' })).toBe(15 * 60);
    expect(resolveMaxDurationSeconds('technical', { ...base, aiInterviewMaxMinutesByType: { technical: 'nope' } })).toBe(15 * 60);
  });
  it('ignores non-positive override/default values', () => {
    expect(resolveMaxDurationSeconds('technical', { ...base, aiInterviewMaxMinutesByType: { technical: 0 } })).toBe(15 * 60);
    expect(resolveMaxDurationSeconds('technical', { ...base, aiInterviewDefaultMaxMinutes: -5 })).toBe(15 * 60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/access/ai-interview-caps.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the pure helpers**

Create `packages/api/src/services/ai-interview-access.service.ts`:

```ts
// packages/api/src/services/ai-interview-access.service.ts
// Access + cap resolution for the AI Voice Interview paid add-on.
// Pure helpers here are unit-tested; impure db loaders (added in Task 3) are
// covered by static-source tripwires.

/** The single source of truth for the voice-interview agent slug. */
export const AI_VOICE_INTERVIEW_SLUG = 'ai-voice-interview';

/** Org-default duration cap (minutes) when nothing is configured. */
export const AI_INTERVIEW_DEFAULT_MAX_MINUTES = 15;

/** The subset of the ai-voice-interview AiAgentOrgConfig row this feature reads. */
export interface AiInterviewConfig {
  enabled: boolean;
  monthlyBudget: number | null;
  billableUsdPerMinute: number | null;
  addonMonthlyFeeUsd: number | null;
  aiInterviewDefaultMaxMinutes: number | null;
  aiInterviewMaxMinutesByType: unknown;
}

/** Feature is ON iff a config row exists with enabled === true. */
export function isEnabledConfig(config: AiInterviewConfig | null): boolean {
  return config?.enabled === true;
}

/** A positive integer minute count, or null. */
function positiveMinutes(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Resolve the per-interview duration cap in SECONDS:
 *   override[type] ?? orgDefault ?? 15 (minutes) * 60.
 * Malformed/zero/negative values are ignored (treated as unset).
 */
export function resolveMaxDurationSeconds(
  interviewType: string,
  config: AiInterviewConfig | null,
): number {
  let overrideMinutes: number | null = null;
  const map = config?.aiInterviewMaxMinutesByType;
  if (map !== null && typeof map === 'object' && !Array.isArray(map)) {
    overrideMinutes = positiveMinutes((map as Record<string, unknown>)[interviewType]);
  }
  const defaultMinutes = positiveMinutes(config?.aiInterviewDefaultMaxMinutes);
  const minutes = overrideMinutes ?? defaultMinutes ?? AI_INTERVIEW_DEFAULT_MAX_MINUTES;
  return minutes * 60;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/access/ai-interview-caps.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: tsc + commit**

Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: exit 0.

```bash
git add packages/api/src/services/ai-interview-access.service.ts tests/access/ai-interview-caps.test.ts
git commit -m "feat(ai-interview): pure enabled-check + per-type duration cap resolver"
```

---

### Task 3: Impure access loaders — loadAiInterviewConfig / isAiInterviewEnabled / assertAiInterviewEnabled

**Files:**
- Modify: `packages/api/src/services/ai-interview-access.service.ts` (append impure exports)
- Test: `tests/access/ai-interview-access-helpers.test.ts`

**Interfaces:**
- Consumes: `systemDb` (privileged Prisma client) from `@tims/db`; `TRPCError` from `@trpc/server`; `AI_VOICE_INTERVIEW_SLUG`, `AiInterviewConfig`, `isEnabledConfig` from this module.
- Produces:
  - `export async function loadAiInterviewConfig(organizationId: string): Promise<AiInterviewConfig | null>`
  - `export async function isAiInterviewEnabled(organizationId: string): Promise<boolean>`
  - `export async function assertAiInterviewEnabled(organizationId: string): Promise<AiInterviewConfig>` — throws `TRPCError({ code: 'FORBIDDEN' })` when off; returns the config when on.

> **Why `systemDb`:** `assertAiInterviewEnabled` is called from the candidate `start` path (`publicProcedure`, no tenant RLS GUC). `tenantDb` would return zero rows there and wrongly hard-fail every candidate. `systemDb` (BYPASSRLS) + an explicit `organizationId` filter is the correct, safe pattern (mirrors `findSessionByConversationId`). The recruiter paths run under tenant context, but using `systemDb` with an explicit org filter is consistent and equally safe.

- [ ] **Step 1: Write the failing tripwire test**

Create `tests/access/ai-interview-access-helpers.test.ts`:

```ts
// tests/access/ai-interview-access-helpers.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('ai-interview-access.service impure loaders', () => {
  const src = read('packages/api/src/services/ai-interview-access.service.ts');

  it('exports the three loaders', () => {
    expect(src).toContain('export async function loadAiInterviewConfig');
    expect(src).toContain('export async function isAiInterviewEnabled');
    expect(src).toContain('export async function assertAiInterviewEnabled');
  });
  it('uses systemDb (not tenantDb) with an explicit organizationId filter', () => {
    expect(src).toMatch(/import\s+\{[^}]*\bdb as systemDb\b[^}]*\}\s+from\s+'@tims\/db'/);
    expect(src).not.toMatch(/\btenantDb\b/);
    expect(src).toContain('organizationId');
    expect(src).toContain('AI_VOICE_INTERVIEW_SLUG');
  });
  it('assert throws FORBIDDEN when off', () => {
    expect(src).toContain("code: 'FORBIDDEN'");
    expect(src).toContain('isEnabledConfig');
  });
  it('selects the cap + billing columns it returns', () => {
    expect(src).toContain('billableUsdPerMinute');
    expect(src).toContain('aiInterviewDefaultMaxMinutes');
    expect(src).toContain('aiInterviewMaxMinutesByType');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/access/ai-interview-access-helpers.test.ts`
Expected: FAIL (loaders not present).

- [ ] **Step 3: Append the impure loaders**

At the TOP of `packages/api/src/services/ai-interview-access.service.ts`, add imports:

```ts
import { db as systemDb } from '@tims/db';
import { TRPCError } from '@trpc/server';
```

At the END of the file, append:

```ts
/**
 * Load the ai-voice-interview AiAgentOrgConfig for an org, or null.
 * Uses systemDb + explicit organizationId filter so it works in the
 * candidate (publicProcedure, no RLS GUC) path as well as recruiter paths.
 */
export async function loadAiInterviewConfig(
  organizationId: string,
): Promise<AiInterviewConfig | null> {
  const config = await systemDb.aiAgentOrgConfig.findFirst({
    where: { organizationId, agent: { slug: AI_VOICE_INTERVIEW_SLUG } },
    select: {
      enabled: true,
      monthlyBudget: true,
      billableUsdPerMinute: true,
      addonMonthlyFeeUsd: true,
      aiInterviewDefaultMaxMinutes: true,
      aiInterviewMaxMinutesByType: true,
    },
  });
  return config;
}

/** True iff the feature is enabled for the org. */
export async function isAiInterviewEnabled(organizationId: string): Promise<boolean> {
  return isEnabledConfig(await loadAiInterviewConfig(organizationId));
}

/**
 * Fail-closed gate. Throws FORBIDDEN when the feature is off for the org;
 * returns the config (so callers reuse billing/cap fields without a 2nd query).
 */
export async function assertAiInterviewEnabled(
  organizationId: string,
): Promise<AiInterviewConfig> {
  const config = await loadAiInterviewConfig(organizationId);
  if (!isEnabledConfig(config)) {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'AI Voice Interview is not enabled for this organization',
    });
  }
  // isEnabledConfig narrowed config to non-null.
  return config as AiInterviewConfig;
}
```

> Note: the Prisma `select` returns `aiInterviewMaxMinutesByType` as `Prisma.JsonValue`, which is assignable to the `unknown` field on `AiInterviewConfig`. The other selected fields match the interface types.

- [ ] **Step 4: Run test + tsc**

Run: `npx vitest run tests/access/ai-interview-access-helpers.test.ts`
Expected: PASS.
Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/services/ai-interview-access.service.ts tests/access/ai-interview-access-helpers.test.ts
git commit -m "feat(ai-interview): fail-closed assertAiInterviewEnabled gate (systemDb)"
```

---

### Task 4: Wire `create` — gate + resolve/store the duration cap

**Files:**
- Modify: `packages/api/src/services/ai-interview.service.ts` (`createAiInterviewSession`, lines 62–101)
- Modify: `packages/api/src/repositories/ai-interview.repository.ts` (`createSession` signature + its session select)
- Test: append to `tests/access/ai-interview-addon-gate.test.ts`

**Interfaces:**
- Consumes: `assertAiInterviewEnabled`, `resolveMaxDurationSeconds` from `./ai-interview-access.service`. The loaded interview already exposes `interview.type` (used by `generateInterviewGuide`).
- Produces: `createSession(...)` now accepts `maxDurationSeconds: number`; the created `AiInterviewSession` row stores it.

- [ ] **Step 1: Write the failing tripwire test**

Append to `tests/access/ai-interview-addon-gate.test.ts`:

```ts
describe('create wiring: gate + cap', () => {
  const svc = read('packages/api/src/services/ai-interview.service.ts');
  const repo = read('packages/api/src/repositories/ai-interview.repository.ts');
  it('createAiInterviewSession asserts the feature is enabled', () => {
    expect(svc).toContain('assertAiInterviewEnabled');
  });
  it('resolves and persists maxDurationSeconds at create', () => {
    expect(svc).toContain('resolveMaxDurationSeconds');
    expect(svc).toContain('maxDurationSeconds');
  });
  it('repository createSession accepts + writes maxDurationSeconds', () => {
    expect(repo).toContain('maxDurationSeconds');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/access/ai-interview-addon-gate.test.ts -t "create wiring"`
Expected: FAIL.

- [ ] **Step 3: Update the repository `createSession`**

In `packages/api/src/repositories/ai-interview.repository.ts`, find `createSession`. Add `maxDurationSeconds: number;` to its args type, and `maxDurationSeconds: args.maxDurationSeconds,` to the `data` object of the create call. Also add `maxDurationSeconds: true` to any session `select` that the create returns / that `findSessionByCandidateToken` uses (so Task 5 can read it). Concretely, in the `createSession` args interface add:

```ts
    maxDurationSeconds: number;
```

and in its `create({ data: { ... } })` add:

```ts
      maxDurationSeconds: args.maxDurationSeconds,
```

- [ ] **Step 4: Update `createAiInterviewSession`**

In `packages/api/src/services/ai-interview.service.ts`, add the import near the existing service imports:

```ts
import { assertAiInterviewEnabled, resolveMaxDurationSeconds } from './ai-interview-access.service';
```

Inside `createAiInterviewSession`, immediately after destructuring args (line ~67), add the gate:

```ts
      const config = await assertAiInterviewEnabled(organizationId);
```

After the interview is loaded and validated (after the `if (!interview)` block, ~line 76), resolve the cap:

```ts
      const maxDurationSeconds = resolveMaxDurationSeconds(interview.type, config);
```

In the `aiInterviewRepository.createSession({ ... })` call, add:

```ts
        maxDurationSeconds,
```

- [ ] **Step 5: Run test + tsc**

Run: `npx vitest run tests/access/ai-interview-addon-gate.test.ts -t "create wiring"`
Expected: PASS.
Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/services/ai-interview.service.ts packages/api/src/repositories/ai-interview.repository.ts tests/access/ai-interview-addon-gate.test.ts
git commit -m "feat(ai-interview): gate create + resolve/store per-type duration cap"
```

---

### Task 5: Wire `start` — gate + return maxDurationSeconds + use it for the EL cap

**Files:**
- Modify: `packages/api/src/routers/ai-interview.ts` (`start`, lines 184–289)
- Modify: `packages/api/src/repositories/ai-interview.repository.ts` (`findSessionByCandidateToken` select → include `maxDurationSeconds`)
- Test: append to `tests/access/ai-interview-addon-gate.test.ts`

**Interfaces:**
- Consumes: `assertAiInterviewEnabled` from `../services/ai-interview-access.service`; `session.maxDurationSeconds` (now selected).
- Produces: `aiInterview.start` returns `{ signedUrl, dynamicVariables, maxDurationSeconds }`. `getSignedUrl` is called with `maxDurationSeconds: session.maxDurationSeconds ?? AI_INTERVIEW_DEFAULT_MAX_MINUTES * 60`.

- [ ] **Step 1: Write the failing tripwire test**

Append to `tests/access/ai-interview-addon-gate.test.ts`:

```ts
describe('start wiring: gate + cap return', () => {
  const router = read('packages/api/src/routers/ai-interview.ts');
  const repo = read('packages/api/src/repositories/ai-interview.repository.ts');
  it('start asserts the feature is enabled (before budget gate)', () => {
    expect(router).toContain('assertAiInterviewEnabled');
    // gate appears before the budget-spend aggregate
    expect(router.indexOf('assertAiInterviewEnabled')).toBeLessThan(router.indexOf('aiAgentUsageLog.aggregate'));
  });
  it('start returns maxDurationSeconds and feeds it to getSignedUrl', () => {
    expect(router).toMatch(/maxDurationSeconds:\s*session\.maxDurationSeconds/);
    expect(router).not.toContain('maxDurationSeconds: 3600');
  });
  it('candidate-token session select includes maxDurationSeconds', () => {
    expect(repo).toContain('maxDurationSeconds');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/access/ai-interview-addon-gate.test.ts -t "start wiring"`
Expected: FAIL.

- [ ] **Step 3: Add `maxDurationSeconds` to the candidate-token session select**

In `packages/api/src/repositories/ai-interview.repository.ts`, find the `select` used by `findSessionByCandidateToken` (the constant/object returning `id, organizationId, status, consentedAt, guideQuestions, elevenlabsAgentId`, etc.) and add:

```ts
    maxDurationSeconds: true,
```

- [ ] **Step 4: Wire the gate + return in `start`**

In `packages/api/src/routers/ai-interview.ts`, add the import:

```ts
import { assertAiInterviewEnabled, AI_INTERVIEW_DEFAULT_MAX_MINUTES } from '../services/ai-interview-access.service';
```

In `start`, immediately AFTER Gate 2 resolves the session (after the `if (!session)` NOT_FOUND check, ~line 199) and BEFORE the status/consent/budget gates, add:

```ts
        // Feature gate: AI Voice Interview must be enabled for this org (paid add-on).
        await assertAiInterviewEnabled(session.organizationId);
```

Replace the hardcoded `getSignedUrl` cap (line 265) `maxDurationSeconds: 3600,` with:

```ts
          maxDurationSeconds: session.maxDurationSeconds ?? AI_INTERVIEW_DEFAULT_MAX_MINUTES * 60,
```

Update the return object (lines 285–288) to include the cap:

```ts
        return {
          signedUrl: result.signedUrl,
          dynamicVariables,
          maxDurationSeconds: session.maxDurationSeconds ?? AI_INTERVIEW_DEFAULT_MAX_MINUTES * 60,
        };
```

- [ ] **Step 5: Run test + tsc**

Run: `npx vitest run tests/access/ai-interview-addon-gate.test.ts -t "start wiring"`
Expected: PASS.
Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add packages/api/src/routers/ai-interview.ts packages/api/src/repositories/ai-interview.repository.ts tests/access/ai-interview-addon-gate.test.ts
git commit -m "feat(ai-interview): gate start + return/enforce per-session duration cap"
```

---

### Task 6: `aiInterview.isEnabled` query (recruiter-facing flag)

**Files:**
- Modify: `packages/api/src/routers/ai-interview.ts` (add procedure)
- Test: append to `tests/access/ai-interview-addon-gate.test.ts`

**Interfaces:**
- Consumes: `isAiInterviewEnabled` from `../services/ai-interview-access.service`; `protectedProcedure` (already importable — currently the router imports `publicProcedure, permissionProcedure`; add `protectedProcedure`).
- Produces: `aiInterview.isEnabled` → `Promise<boolean>` (reads `ctx.user.organizationId`).

- [ ] **Step 1: Write the failing tripwire test**

Append to `tests/access/ai-interview-addon-gate.test.ts`:

```ts
describe('isEnabled query', () => {
  const router = read('packages/api/src/routers/ai-interview.ts');
  it('exposes a protected isEnabled query reading the org config', () => {
    expect(router).toMatch(/isEnabled:\s*protectedProcedure/);
    expect(router).toContain('isAiInterviewEnabled');
    expect(router).toContain('ctx.user.organizationId');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/access/ai-interview-addon-gate.test.ts -t "isEnabled query"`
Expected: FAIL.

- [ ] **Step 3: Add the procedure**

In `packages/api/src/routers/ai-interview.ts`, extend the trpc import to include `protectedProcedure`:

```ts
import { router, publicProcedure, protectedProcedure, permissionProcedure } from '../trpc';
```

Add `isAiInterviewEnabled` to the access-service import (Task 5 added `assertAiInterviewEnabled, AI_INTERVIEW_DEFAULT_MAX_MINUTES`):

```ts
import { assertAiInterviewEnabled, isAiInterviewEnabled, AI_INTERVIEW_DEFAULT_MAX_MINUTES } from '../services/ai-interview-access.service';
```

Add this procedure inside the `router({ ... })` (alongside `create`):

```ts
    isEnabled: protectedProcedure.query(async ({ ctx }) => {
      return isAiInterviewEnabled(ctx.user.organizationId);
    }),
```

- [ ] **Step 4: Run test + tsc**

Run: `npx vitest run tests/access/ai-interview-addon-gate.test.ts -t "isEnabled query"`
Expected: PASS.
Run: `pnpm --filter @tims/api exec tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/api/src/routers/ai-interview.ts tests/access/ai-interview-addon-gate.test.ts
git commit -m "feat(ai-interview): aiInterview.isEnabled query for recruiter gating"
```

---

### Task 7: Recruiter UI — hide button + upsell when off

**Files:**
- Modify: `apps/web/app/(admin)/recruitment/interviews/page.tsx` (add query, pass prop)
- Modify: `apps/web/app/(admin)/recruitment/interviews/interview-table.tsx` (gate button + upsell)
- Modify: `apps/web/lib/i18n/en.json` + `apps/web/lib/i18n/es.json` (upsell keys)
- Test: append to `tests/access/ai-interview-addon-gate.test.ts`

**Interfaces:**
- Consumes: `trpc.aiInterview.isEnabled.useQuery()`; new i18n keys `interviews.aiScreenUpsellTitle`, `interviews.aiScreenUpsellBody`.
- Produces: `InterviewTableProps.aiScreenEnabled: boolean`.

- [ ] **Step 1: Write the failing tripwire test**

Append to `tests/access/ai-interview-addon-gate.test.ts`:

```ts
describe('recruiter UI gating', () => {
  const page = read('apps/web/app/(admin)/recruitment/interviews/page.tsx');
  const table = read('apps/web/app/(admin)/recruitment/interviews/interview-table.tsx');
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));

  it('page queries isEnabled and passes the flag to the table', () => {
    expect(page).toContain('aiInterview.isEnabled.useQuery');
    expect(page).toContain('aiScreenEnabled');
  });
  it('table gates the AI screen button on aiScreenEnabled and offers an upsell', () => {
    expect(table).toContain('aiScreenEnabled');
    expect(table).toContain('aiScreenUpsell');
    expect(table).not.toContain('style={{');
  });
  it('both locales define the upsell keys', () => {
    for (const dict of [en, es]) {
      expect(dict.interviews.aiScreenUpsellTitle).toBeTruthy();
      expect(dict.interviews.aiScreenUpsellBody).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/access/ai-interview-addon-gate.test.ts -t "recruiter UI"`
Expected: FAIL.

- [ ] **Step 3: Add i18n keys (both locales)**

In `apps/web/lib/i18n/en.json`, inside the `interviews` object, add:

```json
    "aiScreenUpsellTitle": "AI Voice Interview add-on",
    "aiScreenUpsellBody": "Available as an add-on — contact your account manager to enable AI voice screening.",
```

In `apps/web/lib/i18n/es.json`, inside the `interviews` object, add:

```json
    "aiScreenUpsellTitle": "Complemento de Entrevista IA por voz",
    "aiScreenUpsellBody": "Disponible como complemento — contacte a su ejecutivo de cuenta para habilitar la entrevista por voz con IA.",
```

- [ ] **Step 4: Thread the flag through the page**

In `apps/web/app/(admin)/recruitment/interviews/page.tsx`, near the existing `trpc.interview.list.useQuery(...)`, add:

```tsx
  const aiScreenEnabled = trpc.aiInterview.isEnabled.useQuery().data ?? false;
```

In the `<InterviewTable ... />` render, add the prop:

```tsx
          aiScreenEnabled={aiScreenEnabled}
```

- [ ] **Step 5: Gate the button + add upsell in the table**

In `apps/web/app/(admin)/recruitment/interviews/interview-table.tsx`, add to `InterviewTableProps`:

```tsx
  aiScreenEnabled: boolean;
```

Destructure `aiScreenEnabled` in the component signature. Replace the AI screen button (lines 143–149) with a gated version: when enabled, render the existing button; when disabled, render a disabled button with an upsell title (tooltip). Use the i18n strings via the existing `t` object:

```tsx
              {aiScreenEnabled ? (
                <button
                  type="button"
                  onClick={() => onStartAiScreen(iv.id)}
                  className="h-7 px-2.5 rounded-md text-[11px] text-[#1F114C] border border-[#EDEDED] hover:bg-[#F6F6F6] transition"
                >
                  {t.interviews.startAiScreen}
                </button>
              ) : (
                <button
                  type="button"
                  disabled
                  title={`${t.interviews.aiScreenUpsellTitle}: ${t.interviews.aiScreenUpsellBody}`}
                  className="h-7 px-2.5 rounded-md text-[11px] text-[#9CA3AF] border border-[#EDEDED] cursor-not-allowed"
                >
                  {t.interviews.startAiScreen}
                </button>
              )}
```

- [ ] **Step 6: Run test + web tsc**

Run: `npx vitest run tests/access/ai-interview-addon-gate.test.ts -t "recruiter UI"`
Expected: PASS.
Run: `cd apps/web && npx tsc --noEmit && cd ../..`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(admin)/recruitment/interviews/page.tsx" "apps/web/app/(admin)/recruitment/interviews/interview-table.tsx" apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json tests/access/ai-interview-addon-gate.test.ts
git commit -m "feat(ai-interview): recruiter hides AI screen + shows upsell when add-on off"
```

---

### Task 8: Call-UI auto-end at the duration cap

**Files:**
- Create: `apps/web/app/(portal)/ai-interview/[token]/should-auto-end.ts`
- Modify: `apps/web/app/(portal)/ai-interview/[token]/use-interview-call.ts` (thread `maxDurationSeconds`)
- Modify: `apps/web/app/(portal)/ai-interview/[token]/call-shell.tsx` (expose secs, auto-end effect)
- Modify: `apps/web/lib/i18n/en.json` + `es.json` (time's-up key)
- Test: `tests/access/ai-interview-should-auto-end.test.ts` (behavioral) + append wiring tripwire to `tests/access/ai-interview-addon-gate.test.ts`

**Interfaces:**
- Consumes: `aiInterview.start` now returns `maxDurationSeconds` (Task 5).
- Produces: `export function shouldAutoEnd(elapsedSeconds: number, maxDurationSeconds: number | null): boolean`. `InterviewCall` gains `maxDurationSeconds: number | null`.

- [ ] **Step 1: Write the failing behavioral test**

Create `tests/access/ai-interview-should-auto-end.test.ts`:

```ts
// tests/access/ai-interview-should-auto-end.test.ts
import { describe, it, expect } from 'vitest';
import { shouldAutoEnd } from '../../apps/web/app/(portal)/ai-interview/[token]/should-auto-end';

describe('shouldAutoEnd', () => {
  it('false before the cap', () => {
    expect(shouldAutoEnd(100, 900)).toBe(false);
  });
  it('true at or past the cap', () => {
    expect(shouldAutoEnd(900, 900)).toBe(true);
    expect(shouldAutoEnd(901, 900)).toBe(true);
  });
  it('never auto-ends when cap is null or non-positive (no cap)', () => {
    expect(shouldAutoEnd(99999, null)).toBe(false);
    expect(shouldAutoEnd(99999, 0)).toBe(false);
    expect(shouldAutoEnd(99999, -5)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/access/ai-interview-should-auto-end.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the pure helper**

Create `apps/web/app/(portal)/ai-interview/[token]/should-auto-end.ts`:

```ts
// apps/web/app/(portal)/ai-interview/[token]/should-auto-end.ts
// Pure decision: has the call reached its duration cap and should auto-end?
// A null/non-positive cap means "no cap" (never auto-end client-side; the EL
// agent's global 900s cap remains the backstop).

export function shouldAutoEnd(elapsedSeconds: number, maxDurationSeconds: number | null): boolean {
  if (maxDurationSeconds === null || maxDurationSeconds <= 0) return false;
  return elapsedSeconds >= maxDurationSeconds;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/access/ai-interview-should-auto-end.test.ts`
Expected: PASS.

- [ ] **Step 5: Thread `maxDurationSeconds` through the hook**

In `apps/web/app/(portal)/ai-interview/[token]/use-interview-call.ts`:
- Add `maxDurationSeconds: number | null;` to the `InterviewCall` interface (lines 11–20).
- Add hook state: `const [maxDurationSeconds, setMaxDurationSeconds] = useState<number | null>(null);`
- In the `start` mutation `onSuccess` (line 66), capture it:

```ts
        onSuccess: ({ signedUrl, dynamicVariables, maxDurationSeconds: cap }) => {
          setMaxDurationSeconds(cap ?? null);
          void conversation.startSession({ signedUrl, dynamicVariables });
        },
```

- Add `maxDurationSeconds` to the hook's returned object (line ~99).

- [ ] **Step 6: Auto-end in CallShell**

In `apps/web/app/(portal)/ai-interview/[token]/call-shell.tsx`:
- Refactor `useElapsed` (lines 11–21) to also return the raw seconds, e.g. return `{ label, secs }` instead of just the string; update the call site at line 26 and the render at line 43 to use `.label`.
- Add an auto-end effect that ends the call once the cap is reached:

```tsx
  const { label: elapsed, secs } = useElapsed(call.status === 'connected');

  useEffect(() => {
    if (call.status === 'connected' && shouldAutoEnd(secs, call.maxDurationSeconds)) {
      call.end();
    }
  }, [secs, call]);
```

- Import the helper at the top: `import { shouldAutoEnd } from './should-auto-end';` and ensure `useEffect` is imported from `react`.

- [ ] **Step 7: Add the time's-up i18n key (both locales) — optional copy**

In `apps/web/lib/i18n/en.json` `aiInterview` object add `"timeUp": "Time's up — ending the interview."`; in `es.json` add `"timeUp": "Se acabó el tiempo — finalizando la entrevista."`. (Display is optional; the key must exist in both for the locale-parity tripwire.)

- [ ] **Step 8: Append the wiring tripwire**

Append to `tests/access/ai-interview-addon-gate.test.ts`:

```ts
describe('call-UI auto-end wiring', () => {
  const DIR = 'apps/web/app/(portal)/ai-interview/[token]';
  const hook = read(`${DIR}/use-interview-call.ts`);
  const shell = read(`${DIR}/call-shell.tsx`);
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));
  it('hook exposes maxDurationSeconds from start', () => {
    expect(hook).toContain('maxDurationSeconds');
    expect(hook).not.toMatch(/:\s*any\b/);
  });
  it('shell auto-ends via shouldAutoEnd', () => {
    expect(shell).toContain('shouldAutoEnd');
    expect(shell).toContain('call.end');
    expect(shell).not.toContain('style={{');
  });
  it('both locales define aiInterview.timeUp', () => {
    expect(en.aiInterview.timeUp).toBeTruthy();
    expect(es.aiInterview.timeUp).toBeTruthy();
  });
});
```

- [ ] **Step 9: Run tests + web tsc**

Run: `npx vitest run tests/access/ai-interview-should-auto-end.test.ts tests/access/ai-interview-addon-gate.test.ts`
Expected: PASS.
Run: `cd apps/web && npx tsc --noEmit && cd ../..`
Expected: exit 0.

- [ ] **Step 10: Commit**

```bash
git add "apps/web/app/(portal)/ai-interview/[token]/should-auto-end.ts" "apps/web/app/(portal)/ai-interview/[token]/use-interview-call.ts" "apps/web/app/(portal)/ai-interview/[token]/call-shell.tsx" apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json tests/access/ai-interview-should-auto-end.test.ts tests/access/ai-interview-addon-gate.test.ts
git commit -m "feat(ai-interview): client auto-end at per-session duration cap"
```

---

### Slice 1 gate (run before declaring the slice done)

- [ ] `pnpm --filter @tims/api exec tsc --noEmit` → exit 0
- [ ] `cd apps/web && npx tsc --noEmit` → exit 0
- [ ] `npx vitest run` → all pass (full suite, no regressions)
- [ ] `cd apps/web && pnpm build` (or `pnpm --filter @tims/web build`) → exit 0

---

# Slice 2 — Billing + Platform UI

> **Reality check (from codebase audit):** TIMS has NO automated invoice generator, NO billing cron/Trigger.dev job (`workers/` is an empty stub), and NO usage metering wired to billing. Invoices are created **manually** via `platform.createInvoice` (admin supplies `lineItems[]`; server only sums them). `addonMonthlyFeeUsd`/add-on/usage-charge concepts do **not** exist anywhere today. Therefore Slice 2's billing deliverable is: (1) freeze per-interview billable usage at webhook time, (2) a pure invoice-line **builder**, and (3) a platform-owner **billing-preview query** returning `createInvoice`-shaped lines, plus (4) a "load AI-interview charges" affordance in the existing invoice wizard. This wires monetization into the REAL invoicing path without inventing a generator.

> Outcome of this slice: the feature is **monetized** (per-minute usage frozen + add-on fee + a one-click way to put both on an invoice) and **platform-controllable** (admin UI for fee/rate/caps/overrides). Independently shippable on top of Slice 1.

### Task 9: Pure billable-amount calculator

**Files:**
- Create: `packages/api/src/services/ai-interview-billing.ts`
- Test: `tests/access/ai-interview-billing.test.ts`

**Interfaces:**
- Produces:
  - `export function computeInterviewBillableUsd(durationSeconds: number, billableUsdPerMinute: number | null): number` — per-second prorated, rounded UP to 2 decimals (`Math.ceil(usd * 100) / 100`). Returns `0` when rate is null/≤0 or duration ≤0.
  - `export interface InvoiceLine { description: string; quantity: number; unitPrice: number }`
  - `export function buildAiInterviewInvoiceLines(args: { addonMonthlyFeeUsd: number | null; usageUsd: number; addonLabel: string; usageLabel: string }): InvoiceLine[]`

- [ ] **Step 1: Write the failing test**

Create `tests/access/ai-interview-billing.test.ts`:

```ts
// tests/access/ai-interview-billing.test.ts
import { describe, it, expect } from 'vitest';
import {
  computeInterviewBillableUsd,
  buildAiInterviewInvoiceLines,
} from '../../packages/api/src/services/ai-interview-billing';

describe('computeInterviewBillableUsd', () => {
  it('prorates per second and rounds up to 2 decimals', () => {
    // 90s @ $0.20/min = $0.30
    expect(computeInterviewBillableUsd(90, 0.2)).toBe(0.3);
    // 61s @ $0.15/min = 0.1525 → ceil to 0.16
    expect(computeInterviewBillableUsd(61, 0.15)).toBe(0.16);
  });
  it('returns 0 for null/zero/negative rate or non-positive duration', () => {
    expect(computeInterviewBillableUsd(600, null)).toBe(0);
    expect(computeInterviewBillableUsd(600, 0)).toBe(0);
    expect(computeInterviewBillableUsd(600, -1)).toBe(0);
    expect(computeInterviewBillableUsd(0, 0.2)).toBe(0);
    expect(computeInterviewBillableUsd(-5, 0.2)).toBe(0);
  });
});

describe('buildAiInterviewInvoiceLines', () => {
  it('includes an add-on line when fee > 0', () => {
    const lines = buildAiInterviewInvoiceLines({ addonMonthlyFeeUsd: 199, usageUsd: 0, addonLabel: 'Add-on', usageLabel: 'Usage' });
    expect(lines).toEqual([{ description: 'Add-on', quantity: 1, unitPrice: 199 }]);
  });
  it('includes a usage line when usage > 0', () => {
    const lines = buildAiInterviewInvoiceLines({ addonMonthlyFeeUsd: null, usageUsd: 12.5, addonLabel: 'Add-on', usageLabel: 'Usage' });
    expect(lines).toEqual([{ description: 'Usage', quantity: 1, unitPrice: 12.5 }]);
  });
  it('includes both, add-on first', () => {
    const lines = buildAiInterviewInvoiceLines({ addonMonthlyFeeUsd: 199, usageUsd: 12.5, addonLabel: 'Add-on', usageLabel: 'Usage' });
    expect(lines.map((l) => l.description)).toEqual(['Add-on', 'Usage']);
  });
  it('is empty when neither applies', () => {
    expect(buildAiInterviewInvoiceLines({ addonMonthlyFeeUsd: 0, usageUsd: 0, addonLabel: 'Add-on', usageLabel: 'Usage' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/access/ai-interview-billing.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write the billing module**

Create `packages/api/src/services/ai-interview-billing.ts`:

```ts
// packages/api/src/services/ai-interview-billing.ts
// Pure billing math for the AI Voice Interview add-on. No db, no i18n —
// labels are passed in by callers (the platform query localizes).

/** A line shaped for platform.createInvoice's lineItems[] input. */
export interface InvoiceLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

/**
 * Billable USD for one interview: per-second prorated at the org's
 * billableUsdPerMinute, rounded UP to 2 decimals. 0 when unpriced/empty.
 */
export function computeInterviewBillableUsd(
  durationSeconds: number,
  billableUsdPerMinute: number | null,
): number {
  if (billableUsdPerMinute === null || billableUsdPerMinute <= 0) return 0;
  if (durationSeconds <= 0) return 0;
  const usd = (durationSeconds / 60) * billableUsdPerMinute;
  return Math.ceil(usd * 100) / 100;
}

/**
 * Build the invoice lines for an org's add-on fee + accrued usage in a period.
 * Add-on line first. Empty array when neither applies. Quantity is always 1
 * (unitPrice carries the amount) to satisfy createInvoice's positive-int rule.
 */
export function buildAiInterviewInvoiceLines(args: {
  addonMonthlyFeeUsd: number | null;
  usageUsd: number;
  addonLabel: string;
  usageLabel: string;
}): InvoiceLine[] {
  const lines: InvoiceLine[] = [];
  if (args.addonMonthlyFeeUsd !== null && args.addonMonthlyFeeUsd > 0) {
    lines.push({ description: args.addonLabel, quantity: 1, unitPrice: args.addonMonthlyFeeUsd });
  }
  if (args.usageUsd > 0) {
    lines.push({ description: args.usageLabel, quantity: 1, unitPrice: Math.ceil(args.usageUsd * 100) / 100 });
  }
  return lines;
}
```

- [ ] **Step 4: Run test + tsc + commit**

Run: `npx vitest run tests/access/ai-interview-billing.test.ts` → PASS.
Run: `pnpm --filter @tims/api exec tsc --noEmit` → exit 0.

```bash
git add packages/api/src/services/ai-interview-billing.ts tests/access/ai-interview-billing.test.ts
git commit -m "feat(ai-interview): pure billable-amount + invoice-line builders"
```

---

### Task 10: Freeze billable usage in the post-call webhook

**Files:**
- Modify: `packages/db/prisma/schema/ai-agent.prisma` (model `AiAgentUsageLog` — add `billableUsd`)
- Create: `packages/db/prisma/migrations/20260628010000_ai_usage_billable/migration.sql`
- Modify: `packages/api/src/services/ai-interview.service.ts` (`processPostCallWebhook`)
- Test: append to `tests/access/ai-interview-billing.test.ts` (tripwire) + `tests/access/ai-interview-addon-gate.test.ts` (schema/migration tripwire)

**Interfaces:**
- Consumes: `computeInterviewBillableUsd` from `./ai-interview-billing`; `loadAiInterviewConfig` from `./ai-interview-access.service`.
- Produces: `AiAgentUsageLog.billableUsd: Float @default(0)` (column `billable_usd`); the webhook stores the frozen billable amount on the usage row it already creates.

- [ ] **Step 1: Write the failing tripwires**

Append to `tests/access/ai-interview-addon-gate.test.ts`:

```ts
describe('schema/migration: AiAgentUsageLog.billableUsd', () => {
  const root2 = resolve(__dirname, '../..');
  const read2 = (p: string) => readFileSync(resolve(root2, p), 'utf8');
  it('schema adds billableUsd with default 0', () => {
    expect(read2('packages/db/prisma/schema/ai-agent.prisma')).toMatch(/billableUsd\s+Float\s+@default\(0\)\s+@map\("billable_usd"\)/);
  });
  it('migration adds billable_usd column idempotently', () => {
    const sql = read2('packages/db/prisma/migrations/20260628010000_ai_usage_billable/migration.sql');
    expect(sql).toContain('billable_usd');
    expect(sql).toContain('duplicate_column');
  });
});
```

Append to `tests/access/ai-interview-billing.test.ts`:

```ts
import { readFileSync } from 'fs';
import { resolve } from 'path';
describe('webhook freezes billable usage', () => {
  const src = readFileSync(resolve(__dirname, '../../packages/api/src/services/ai-interview.service.ts'), 'utf8');
  it('computes + stores billableUsd from the org config rate', () => {
    expect(src).toContain('computeInterviewBillableUsd');
    expect(src).toContain('loadAiInterviewConfig');
    expect(src).toContain('billableUsd');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/access/ai-interview-billing.test.ts tests/access/ai-interview-addon-gate.test.ts -t "billable"`
Expected: FAIL.

- [ ] **Step 3: Add the schema column + migration**

In `packages/db/prisma/schema/ai-agent.prisma`, inside `model AiAgentUsageLog`, after `costUsd`, add:

```prisma
  billableUsd    Float    @default(0) @map("billable_usd")
```

Create `packages/db/prisma/migrations/20260628010000_ai_usage_billable/migration.sql`:

```sql
-- AI usage logs: frozen per-event billable amount (org-billed; distinct from
-- internal cost_usd). Default 0 so existing rows are unaffected. Additive; no
-- RLS change (ai_agent_usage_logs already carries tenant_isolation). Apply via:
--   npx prisma db execute --file=packages/db/prisma/migrations/20260628010000_ai_usage_billable/migration.sql
DO $$ BEGIN
  ALTER TABLE "ai_agent_usage_logs" ADD COLUMN "billable_usd" DOUBLE PRECISION NOT NULL DEFAULT 0;
EXCEPTION WHEN duplicate_column THEN NULL; END $$;
```

Run: `cd packages/db && npx prisma generate && cd ../..` → exit 0.

- [ ] **Step 4: Record billable usage in `processPostCallWebhook`**

In `packages/api/src/services/ai-interview.service.ts`, add imports:

```ts
import { computeInterviewBillableUsd } from './ai-interview-billing';
import { loadAiInterviewConfig } from './ai-interview-access.service';
```

In `processPostCallWebhook`, after the `costUsd` computation (line ~154) and before the `$transaction`, load the rate and compute the frozen billable:

```ts
      const billingConfig = await loadAiInterviewConfig(session.organizationId);
      const billableUsd = computeInterviewBillableUsd(
        payload.durationSeconds,
        billingConfig?.billableUsdPerMinute ?? null,
      );
```

In the `tx.aiAgentUsageLog.create({ data: { ... } })` block, add:

```ts
            billableUsd,
```

- [ ] **Step 5: Run tests + tsc + commit**

Run: `npx vitest run tests/access/ai-interview-billing.test.ts tests/access/ai-interview-addon-gate.test.ts` → PASS.
Run: `pnpm --filter @tims/api exec tsc --noEmit` → exit 0.

```bash
git add packages/db/prisma/schema/ai-agent.prisma packages/db/prisma/migrations/20260628010000_ai_usage_billable/ packages/api/src/services/ai-interview.service.ts tests/access/ai-interview-billing.test.ts tests/access/ai-interview-addon-gate.test.ts
git commit -m "feat(ai-interview): freeze per-interview billable usage in webhook"
```

---

### Task 11: Platform billing-preview query (add-on fee + accrued usage → invoice lines)

**Files:**
- Modify: `packages/api/src/routers/platform/ai-agents.ts` (add `getAiInterviewBillingPreview`)
- Test: append to `tests/access/ai-interview-platform-admin.test.ts` (create this file)

**Interfaces:**
- Consumes: `loadAiInterviewConfig`, `AI_VOICE_INTERVIEW_SLUG` from `../../services/ai-interview-access.service`; `buildAiInterviewInvoiceLines` from `../../services/ai-interview-billing`; `platformProcedure` from `./_common`; `db as systemDb` from `@tims/db`.
- Produces: `platform.getAiInterviewBillingPreview({ organizationId, periodStart?, periodEnd? })` → `{ enabled: boolean; addonFeeUsd: number; usageUsd: number; lineItems: InvoiceLine[] }`.

> **Why systemDb:** the platform owner's tenant context is their OWN org; reading another org's usage/config requires `systemDb` + an explicit `organizationId` filter.

- [ ] **Step 1: Write the failing tripwire test**

Create `tests/access/ai-interview-platform-admin.test.ts`:

```ts
// tests/access/ai-interview-platform-admin.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const root = resolve(__dirname, '../..');
const read = (p: string) => readFileSync(resolve(root, p), 'utf8');

describe('platform billing preview query', () => {
  const src = read('packages/api/src/routers/platform/ai-agents.ts');
  it('exposes a platform-guarded getAiInterviewBillingPreview', () => {
    expect(src).toMatch(/getAiInterviewBillingPreview:\s*platformProcedure/);
    expect(src).toContain('buildAiInterviewInvoiceLines');
    expect(src).toContain('billableUsd');
  });
  it('reads the target org with an explicit organizationId filter (systemDb)', () => {
    expect(src).toContain('organizationId');
    expect(src).toContain('AI_VOICE_INTERVIEW_SLUG');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/access/ai-interview-platform-admin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add the query**

In `packages/api/src/routers/platform/ai-agents.ts`, add imports:

```ts
import { loadAiInterviewConfig, AI_VOICE_INTERVIEW_SLUG } from '../../services/ai-interview-access.service';
import { buildAiInterviewInvoiceLines } from '../../services/ai-interview-billing';
import { db as systemDb } from '@tims/db';
```

Add inside the router object:

```ts
  getAiInterviewBillingPreview: platformProcedure
    .input(z.object({
      organizationId: z.string().uuid(),
      periodStart: z.date().optional(),
      periodEnd: z.date().optional(),
    }))
    .query(async ({ input }) => {
      const config = await loadAiInterviewConfig(input.organizationId);
      const now = new Date();
      const start = input.periodStart ?? new Date(now.getFullYear(), now.getMonth(), 1);
      const end = input.periodEnd ?? now;
      const agg = await systemDb.aiAgentUsageLog.aggregate({
        where: {
          organizationId: input.organizationId,
          agent: { slug: AI_VOICE_INTERVIEW_SLUG },
          createdAt: { gte: start, lte: end },
        },
        _sum: { billableUsd: true },
      });
      const usageUsd = agg._sum.billableUsd ?? 0;
      const addonFeeUsd = config?.addonMonthlyFeeUsd ?? 0;
      const lineItems = buildAiInterviewInvoiceLines({
        addonMonthlyFeeUsd: config?.enabled ? config.addonMonthlyFeeUsd : null,
        usageUsd,
        addonLabel: 'AI Voice Interview — monthly add-on',
        usageLabel: 'AI Voice Interview — usage',
      });
      return {
        enabled: config?.enabled === true,
        addonFeeUsd: config?.enabled ? addonFeeUsd : 0,
        usageUsd,
        lineItems,
      };
    }),
```

> Note: `aiAgentUsageLog.aggregate` `where` uses the `agent: { slug }` relation filter (Prisma supports relation filters on aggregate). `billableUsd` is now a known field after Task 10's `prisma generate`.

- [ ] **Step 4: Run test + tsc + commit**

Run: `npx vitest run tests/access/ai-interview-platform-admin.test.ts` → PASS.
Run: `pnpm --filter @tims/api exec tsc --noEmit` → exit 0.

```bash
git add packages/api/src/routers/platform/ai-agents.ts tests/access/ai-interview-platform-admin.test.ts
git commit -m "feat(ai-interview): platform billing-preview query (add-on + usage lines)"
```

---

### Task 12: Platform admin UI — fee/rate/cap/override controls + billing preview

**Files:**
- Modify: `packages/api/src/routers/platform/ai-agents.ts` (`updateAiAgentOrgConfig` input + selects)
- Modify: `apps/web/app/(admin)/platform/ai-agents/agent-detail-drawer.tsx` (Orgs tab controls, gated to the ai-voice-interview agent)
- Modify: `apps/web/lib/i18n/en.json` + `es.json` (`aiAgents` labels)
- Test: append to `tests/access/ai-interview-platform-admin.test.ts`

**Interfaces:**
- Consumes: `trpc.platform.updateAiAgentOrgConfig` (extended), `trpc.platform.getAiInterviewBillingPreview`.
- Produces: extended `updateAiAgentOrgConfig` input fields: `addonMonthlyFeeUsd`, `billableUsdPerMinute`, `aiInterviewDefaultMaxMinutes`, `aiInterviewMaxMinutesByType`.

- [ ] **Step 1: Write the failing tripwire test**

Append to `tests/access/ai-interview-platform-admin.test.ts`:

```ts
describe('platform admin: config mutation + drawer controls', () => {
  const router = read('packages/api/src/routers/platform/ai-agents.ts');
  const drawer = read('apps/web/app/(admin)/platform/ai-agents/agent-detail-drawer.tsx');
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));

  it('updateAiAgentOrgConfig accepts the new add-on/cap fields', () => {
    expect(router).toContain('addonMonthlyFeeUsd');
    expect(router).toContain('billableUsdPerMinute');
    expect(router).toContain('aiInterviewDefaultMaxMinutes');
    expect(router).toContain('aiInterviewMaxMinutesByType');
    // null clears the Json field safely
    expect(router).toContain('DbNull');
  });
  it('drawer renders the add-on controls gated to the voice-interview agent', () => {
    expect(drawer).toContain('ai-voice-interview');
    expect(drawer).toContain('addonMonthlyFeeUsd');
    expect(drawer).toContain('billableUsdPerMinute');
    expect(drawer).toContain('getAiInterviewBillingPreview');
    expect(drawer).not.toContain('style={{');
    expect(drawer).not.toMatch(/:\s*any\b/);
  });
  it('both locales define the new aiAgents labels', () => {
    for (const dict of [en, es]) {
      expect(dict.aiAgents.addonFeeLabel).toBeTruthy();
      expect(dict.aiAgents.perMinuteLabel).toBeTruthy();
      expect(dict.aiAgents.defaultCapLabel).toBeTruthy();
      expect(dict.aiAgents.perTypeCapsLabel).toBeTruthy();
      expect(dict.aiAgents.accruedUsageLabel).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/access/ai-interview-platform-admin.test.ts -t "config mutation"`
Expected: FAIL.

- [ ] **Step 3: Extend `updateAiAgentOrgConfig`**

In `packages/api/src/routers/platform/ai-agents.ts`, add `Prisma` to the db import (e.g. `import { db, Prisma } from '@tims/db';` — confirm the export path; `Prisma` is re-exported from `@tims/db`). Extend the input schema:

```ts
      addonMonthlyFeeUsd: z.number().min(0).max(100000).nullable().optional(),
      billableUsdPerMinute: z.number().min(0).max(1000).nullable().optional(),
      aiInterviewDefaultMaxMinutes: z.number().int().min(1).max(180).nullable().optional(),
      aiInterviewMaxMinutesByType: z.record(z.string().max(50), z.number().int().min(1).max(180)).nullable().optional(),
```

In the mutation body, map the nullable Json field to `Prisma.DbNull` when cleared (Prisma requires this for nullable Json), then build the data object:

```ts
      const { agentId, organizationId, aiInterviewMaxMinutesByType, ...rest } = input;
      const data = {
        ...rest,
        ...(aiInterviewMaxMinutesByType === undefined
          ? {}
          : { aiInterviewMaxMinutesByType: aiInterviewMaxMinutesByType === null ? Prisma.DbNull : aiInterviewMaxMinutesByType }),
      };
      return db.aiAgentOrgConfig.upsert({
        where: { agentId_organizationId: { agentId, organizationId } },
        create: { agentId, organizationId, ...data },
        update: data,
        select: {
          id: true,
          enabled: true,
          monthlyBudget: true,
          addonMonthlyFeeUsd: true,
          billableUsdPerMinute: true,
          aiInterviewDefaultMaxMinutes: true,
          aiInterviewMaxMinutesByType: true,
          organization: { select: { id: true, name: true } },
        },
      });
```

Also extend the `orgConfigs` select in `getAiAgent` (line ~88) and `getOrgAiConfigs` (line ~164) to include the four new fields, so the drawer can display current values.

- [ ] **Step 4: Run the mutation tripwire + tsc**

Run: `npx vitest run tests/access/ai-interview-platform-admin.test.ts -t "config mutation"` → PASS.
Run: `pnpm --filter @tims/api exec tsc --noEmit` → exit 0.

- [ ] **Step 5: Add i18n labels (both locales)**

In `apps/web/lib/i18n/en.json` `aiAgents` object, add:

```json
    "addonFeeLabel": "Monthly add-on fee (USD)",
    "perMinuteLabel": "Billable per minute (USD)",
    "defaultCapLabel": "Default duration cap (min)",
    "perTypeCapsLabel": "Per-type duration caps (JSON: { \"type\": minutes })",
    "accruedUsageLabel": "Accrued usage this month",
    "addonInvalidJson": "Invalid JSON — expected an object of type → minutes",
```

In `apps/web/lib/i18n/es.json` `aiAgents` object, add:

```json
    "addonFeeLabel": "Tarifa mensual del complemento (USD)",
    "perMinuteLabel": "Cobro por minuto (USD)",
    "defaultCapLabel": "Límite de duración predeterminado (min)",
    "perTypeCapsLabel": "Límites por tipo (JSON: { \"tipo\": minutos })",
    "accruedUsageLabel": "Uso acumulado este mes",
    "addonInvalidJson": "JSON inválido — se espera un objeto tipo → minutos",
```

- [ ] **Step 6: Add the drawer controls (gated to the voice-interview agent)**

In `apps/web/app/(admin)/platform/ai-agents/agent-detail-drawer.tsx`, in the Orgs tab, for each `config` row, when `agent.slug === 'ai-voice-interview'` render extra controls below the existing enabled toggle + monthlyBudget input:
- a number input for `addonMonthlyFeeUsd` (onBlur → `updateOrgConfig.mutate({ agentId, organizationId, addonMonthlyFeeUsd })`, mirroring the existing monthlyBudget input pattern at lines 135–151);
- a number input for `billableUsdPerMinute` (step `0.01`);
- a number input for `aiInterviewDefaultMaxMinutes` (integer);
- a text input for the per-type caps JSON: on blur, `JSON.parse` the value; on success mutate `aiInterviewMaxMinutesByType` (object) or `null` when empty; on parse failure show `t.aiAgents.addonInvalidJson` and do not mutate (keep a local error state string, no `any`);
- a read-only line showing `t.aiAgents.accruedUsageLabel` + the value from `trpc.platform.getAiInterviewBillingPreview.useQuery({ organizationId: config.organization.id })` (`data?.usageUsd`).

Keep the component under 300 lines — if it would exceed, extract the voice-interview controls into a sibling `ai-interview-org-controls.tsx` and import it. Use Tailwind classes only (no `style={{`); type all handlers (no `any`).

- [ ] **Step 7: Run tests + web tsc + commit**

Run: `npx vitest run tests/access/ai-interview-platform-admin.test.ts` → PASS.
Run: `cd apps/web && npx tsc --noEmit && cd ../..` → exit 0.

```bash
git add packages/api/src/routers/platform/ai-agents.ts "apps/web/app/(admin)/platform/ai-agents/agent-detail-drawer.tsx" apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json tests/access/ai-interview-platform-admin.test.ts
git commit -m "feat(ai-interview): platform admin controls for add-on fee, rate, caps + usage preview"
```

---

### Task 13: Invoice wizard — load AI-interview charges for the selected org

**Files:**
- Modify: `apps/web/app/(admin)/platform/invoices/invoice-wizard.tsx`
- Modify: `apps/web/lib/i18n/en.json` + `es.json` (`invoices` namespace)
- Test: append to `tests/access/ai-interview-platform-admin.test.ts`

**Interfaces:**
- Consumes: `trpc.platform.getAiInterviewBillingPreview` → `lineItems[]` (already `{ description, quantity, unitPrice }` — the wizard's `LineItem` shape).

- [ ] **Step 1: Write the failing tripwire**

Append to `tests/access/ai-interview-platform-admin.test.ts`:

```ts
describe('invoice wizard: load AI-interview charges', () => {
  const wiz = read('apps/web/app/(admin)/platform/invoices/invoice-wizard.tsx');
  const en = JSON.parse(read('apps/web/lib/i18n/en.json'));
  const es = JSON.parse(read('apps/web/lib/i18n/es.json'));
  it('offers a button that appends preview line items', () => {
    expect(wiz).toContain('getAiInterviewBillingPreview');
    expect(wiz).toContain('loadAiInterviewCharges');
    expect(wiz).not.toContain('style={{');
  });
  it('both locales define the button label', () => {
    expect(en.invoices.loadAiInterviewCharges).toBeTruthy();
    expect(es.invoices.loadAiInterviewCharges).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/access/ai-interview-platform-admin.test.ts -t "invoice wizard"`
Expected: FAIL.

- [ ] **Step 3: Add i18n keys (both locales)**

In `apps/web/lib/i18n/en.json` `invoices` object: `"loadAiInterviewCharges": "Load AI interview charges",`
In `apps/web/lib/i18n/es.json` `invoices` object: `"loadAiInterviewCharges": "Cargar cargos de entrevista IA",`

- [ ] **Step 4: Add the affordance**

In `apps/web/app/(admin)/platform/invoices/invoice-wizard.tsx`, on the line-items step, add a button `loadAiInterviewCharges` shown when an org is selected. Use a lazy query: `const previewQuery = trpc.platform.getAiInterviewBillingPreview.useQuery({ organizationId: selectedOrgId }, { enabled: false })`. The handler `loadAiInterviewCharges` calls `previewQuery.refetch()` and on success appends the returned `lineItems` to the wizard's `lines` state (replacing the empty placeholder row if present). Map each preview line to the wizard `LineItem` shape (identical fields). Tailwind only; type the mapped data (no `any`).

- [ ] **Step 5: Run tests + web tsc + commit**

Run: `npx vitest run tests/access/ai-interview-platform-admin.test.ts` → PASS.
Run: `cd apps/web && npx tsc --noEmit && cd ../..` → exit 0.

```bash
git add "apps/web/app/(admin)/platform/invoices/invoice-wizard.tsx" apps/web/lib/i18n/en.json apps/web/lib/i18n/es.json tests/access/ai-interview-platform-admin.test.ts
git commit -m "feat(ai-interview): invoice wizard loads add-on + usage charges"
```

---

### Slice 2 gate (run before declaring the slice done)

- [ ] `pnpm --filter @tims/api exec tsc --noEmit` → exit 0
- [ ] `cd apps/web && npx tsc --noEmit` → exit 0
- [ ] `npx vitest run` → all pass (full suite)
- [ ] `cd apps/web && pnpm build` → exit 0

---

## Deploy notes (after both slices merge)

- **Migrations** (prod is NOT migrate-managed — apply manually, in order):
  ```bash
  npx prisma db execute --file=packages/db/prisma/migrations/20260628000000_ai_interview_addon_caps/migration.sql
  npx prisma db execute --file=packages/db/prisma/migrations/20260628010000_ai_usage_billable/migration.sql
  ```
  Both are additive nullable/defaulted columns on tables that already carry the `tenant_isolation` RLS policy → no policy/grant changes needed.
- **No re-seed required** (no new agent; reuses the existing `ai-voice-interview` agent row).
- **Frontend:** Vercel git auto-deploy on merge to `main` (NOT `vercel deploy --prod`).
- **Activation:** the feature stays OFF for every org until a platform owner enables the `ai-voice-interview` `AiAgentOrgConfig` row (`enabled = true`) and sets the fee/rate/caps in the platform AI-agents admin. Existing orgs that had it on under the old behavior: set their config row's `enabled = true` + `billableUsdPerMinute`/`addonMonthlyFeeUsd` to avoid a silent feature-off.

## Spec coverage self-check

- Locked decision 1 (flat fee + usage): `addonMonthlyFeeUsd` + `billableUsdPerMinute` columns (T1), frozen usage (T10), invoice lines (T9/T11/T13). ✅
- Locked decision 2 (platform-owner-only toggle; org sees upsell): `enabled` gate (T3–T5), recruiter upsell (T7), platform-only admin (T12 via `platformProcedure`); no org self-serve. ✅
- Locked decision 3 (per-type cap + 15-min default, app-side auto-end): cap resolver (T2), stored at create (T4), enforced/returned at start (T5), client auto-end (T8). ✅
- Spec A (assertAiInterviewEnabled at top of create/start, returns config): T3–T5. ✅
- Spec B (maxDurationSeconds column, start returns it, CallShell auto-end, pure shouldAutoEnd unit-tested): T1/T5/T8. ✅
- Spec C (computeInterviewBillableUsd pure+unit-tested; webhook records billable; addon fee → invoicing; monthlyBudget stays the cap): T9/T10/T11/T13; monthlyBudget gate untouched. ✅
- Spec D (platform admin controls for enabled/fee/rate/budget/default cap/overrides): T12. ✅
- Spec E (recruiter hide/upsell gated on lightweight isEnabled query): T6/T7. ✅
- Non-goals respected: no org self-serve, no new Stripe SKUs, no change to other agents' gating/default, no call-UI redesign. ✅
