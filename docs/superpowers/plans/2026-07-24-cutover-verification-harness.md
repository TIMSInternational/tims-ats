# Cutover Verification Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a repeatable TypeScript CLI (`scripts/parity/`) that proves a live C# strangler surface is output-identical to TS (parity), tenant-isolated (RLS), and correctly permissioned (RBAC) against the real Supabase prod DB — team-intel read first.

**Architecture:** A small `tsx`-run CLI. `seed`/`auth` set up 2 test orgs + real Supabase-signed tokens; per-surface `parity`/`rls`/`rbac` call the live TS (`tims-ats.vercel.app`) and C# (`w7kk5w3si4…awsapprunner.com`) endpoints, normalize + diff, and emit a red/green report. Pure logic (normalize, diff, superjson-strip) is unit-tested; live checks run pre-flip (structural, no flag) and at canary (full).

**Tech Stack:** TypeScript, `tsx`, `@supabase/supabase-js ^2.49.0` (already a repo dep), native `fetch`, `vitest` (repo test runner).

## Global Constraints

- Language: TypeScript strict. No `any` (repo CLAUDE.md). Files ≤300 lines; split by responsibility.
- Secrets ONLY from git-ignored `scripts/parity/.env` (root `.gitignore` line 14 `.env` covers it — verified). Never hardcode keys; never log token/key values.
- Run commands: `npx tsx scripts/parity/cli.ts <cmd>`; tests `npx vitest run scripts/parity`.
- Live bases (from `.env`): `TIMS_CSHARP_BASE=https://w7kk5w3si4.us-west-2.awsapprunner.com`, `TIMS_TS_BASE=https://tims-ats.vercel.app`. Supabase project ref `lzhfnjfsdwdywwnlqgqq`.
- First surface: team-intel read. Flag `Platform__TeamIntelReadEnabled`. C# KPIs route `GET /team-intel/dashboard-kpis` (OrgGate; narrow scope → 403). C# validates ES256 via Supabase JWKS — tokens MUST be obtained via `signInWithPassword` (no self-signing).
- Test orgs named `__parity_a` / `__parity_b`; all seed artifacts idempotent + removable.
- DO NOT flip any feature flag from the harness. Flag flips are Federico-only, at canary.

---

### Task 1: Scaffolding + config loader

**Files:**
- Create: `scripts/parity/config.ts`
- Create: `scripts/parity/.env.example`
- Create: `scripts/parity/README.md`
- Test: `scripts/parity/config.test.ts`

**Interfaces:**
- Produces: `loadConfig(): HarnessConfig` where
  `HarnessConfig = { supabaseUrl: string; projectRef: string; serviceRoleKey: string; anonKey: string; csharpBase: string; tsBase: string }`. Throws `ConfigError` listing every missing var.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/parity/config.test.ts
import { describe, it, expect } from 'vitest';
import { parseConfig, ConfigError } from './config';

describe('parseConfig', () => {
  it('returns a typed config when all vars present', () => {
    const cfg = parseConfig({
      SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PROJECT_REF: 'x',
      SUPABASE_SERVICE_ROLE_KEY: 's', SUPABASE_ANON_KEY: 'a',
      TIMS_CSHARP_BASE: 'https://c', TIMS_TS_BASE: 'https://t',
    });
    expect(cfg.projectRef).toBe('x');
    expect(cfg.tsBase).toBe('https://t');
  });
  it('throws ConfigError listing ALL missing vars', () => {
    try { parseConfig({}); throw new Error('did not throw'); }
    catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      expect((e as ConfigError).message).toContain('SUPABASE_SERVICE_ROLE_KEY');
      expect((e as ConfigError).message).toContain('TIMS_TS_BASE');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/parity/config.test.ts`
Expected: FAIL (`Cannot find module './config'`).

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/parity/config.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export class ConfigError extends Error {}

export interface HarnessConfig {
  supabaseUrl: string; projectRef: string; serviceRoleKey: string;
  anonKey: string; csharpBase: string; tsBase: string;
}

const REQUIRED = {
  supabaseUrl: 'SUPABASE_URL', projectRef: 'SUPABASE_PROJECT_REF',
  serviceRoleKey: 'SUPABASE_SERVICE_ROLE_KEY', anonKey: 'SUPABASE_ANON_KEY',
  csharpBase: 'TIMS_CSHARP_BASE', tsBase: 'TIMS_TS_BASE',
} as const;

export function parseConfig(env: Record<string, string | undefined>): HarnessConfig {
  const missing: string[] = [];
  const out = {} as Record<keyof typeof REQUIRED, string>;
  for (const [key, varName] of Object.entries(REQUIRED) as [keyof typeof REQUIRED, string][]) {
    const v = env[varName];
    if (!v) missing.push(varName); else out[key] = v;
  }
  if (missing.length) throw new ConfigError(`Missing env vars: ${missing.join(', ')}`);
  return out as HarnessConfig;
}

/** Loads scripts/parity/.env (KEY=VALUE lines) merged over process.env, then parses. */
export function loadConfig(): HarnessConfig {
  const env: Record<string, string | undefined> = { ...process.env };
  try {
    const raw = readFileSync(join(__dirname, '.env'), 'utf8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
    }
  } catch { /* .env optional if vars already in process.env */ }
  return parseConfig(env);
}
```

- [ ] **Step 4: Create `.env.example` and README (no secrets)**

```bash
# scripts/parity/.env.example
SUPABASE_URL=https://lzhfnjfsdwdywwnlqgqq.supabase.co
SUPABASE_PROJECT_REF=lzhfnjfsdwdywwnlqgqq
SUPABASE_SERVICE_ROLE_KEY=  # from Supabase dashboard (seed only) — DO NOT COMMIT
SUPABASE_ANON_KEY=          # from Supabase dashboard (public)
TIMS_CSHARP_BASE=https://w7kk5w3si4.us-west-2.awsapprunner.com
TIMS_TS_BASE=https://tims-ats.vercel.app
```
README: one paragraph on purpose + `cp .env.example .env`, fill secrets, `npx tsx scripts/parity/cli.ts verify team-intel`.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run scripts/parity/config.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add scripts/parity/config.ts scripts/parity/config.test.ts scripts/parity/.env.example scripts/parity/README.md
git commit -m "feat(parity): config loader + scaffolding for cutover verification harness"
```

---

### Task 2: Normalizers + deep-diff (parity core, pure)

**Files:**
- Create: `scripts/parity/normalize.ts`
- Test: `scripts/parity/normalize.test.ts`

**Interfaces:**
- Produces: `normalize(value: unknown, opts?: NormalizeOpts): unknown` (sorts arrays by a stable key when `opts.sortArraysBy` given; drops keys whose value is `null|undefined` when `opts.dropNullish`; leaves dates as ISO strings untouched). `diff(a: unknown, b: unknown, path?: string): DiffEntry[]` where `DiffEntry = { path: string; a: unknown; b: unknown }`. Empty array = identical.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/parity/normalize.test.ts
import { describe, it, expect } from 'vitest';
import { normalize, diff } from './normalize';

describe('diff', () => {
  it('returns [] for deep-equal objects regardless of key order', () => {
    expect(diff({ a: 1, b: { c: 2 } }, { b: { c: 2 }, a: 1 })).toEqual([]);
  });
  it('reports a path + both values on mismatch', () => {
    expect(diff({ a: 1 }, { a: 2 })).toEqual([{ path: 'a', a: 1, b: 2 }]);
  });
  it('nested + array index paths', () => {
    expect(diff({ x: [1, 2] }, { x: [1, 3] })).toEqual([{ path: 'x[1]', a: 2, b: 3 }]);
  });
});

describe('normalize', () => {
  it('dropNullish removes null/undefined keys (tRPC omit vs C# null)', () => {
    expect(normalize({ a: 1, b: null }, { dropNullish: true })).toEqual({ a: 1 });
  });
  it('sortArraysBy makes unordered arrays comparable', () => {
    const a = normalize({ rows: [{ id: 'b' }, { id: 'a' }] }, { sortArraysBy: 'id' });
    expect(a).toEqual({ rows: [{ id: 'a' }, { id: 'b' }] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/parity/normalize.test.ts`
Expected: FAIL (`Cannot find module './normalize'`).

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/parity/normalize.ts
export interface NormalizeOpts { dropNullish?: boolean; sortArraysBy?: string }
export interface DiffEntry { path: string; a: unknown; b: unknown }

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function normalize(value: unknown, opts: NormalizeOpts = {}): unknown {
  if (Array.isArray(value)) {
    const arr = value.map((v) => normalize(v, opts));
    if (opts.sortArraysBy) {
      const k = opts.sortArraysBy;
      arr.sort((x, y) => JSON.stringify(isObj(x) ? x[k] : x) < JSON.stringify(isObj(y) ? y[k] : y) ? -1 : 1);
    }
    return arr;
  }
  if (isObj(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (opts.dropNullish && (v === null || v === undefined)) continue;
      out[k] = normalize(v, opts);
    }
    return out;
  }
  return value;
}

export function diff(a: unknown, b: unknown, path = ''): DiffEntry[] {
  if (Array.isArray(a) && Array.isArray(b)) {
    const out: DiffEntry[] = [];
    const len = Math.max(a.length, b.length);
    for (let i = 0; i < len; i++) out.push(...diff(a[i], b[i], `${path}[${i}]`));
    return out;
  }
  if (isObj(a) && isObj(b)) {
    const out: DiffEntry[] = [];
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      out.push(...diff(a[k], b[k], path ? `${path}.${k}` : k));
    }
    return out;
  }
  return a === b || JSON.stringify(a) === JSON.stringify(b) ? [] : [{ path, a, b }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/parity/normalize.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/parity/normalize.ts scripts/parity/normalize.test.ts
git commit -m "feat(parity): normalizers + deep-diff engine"
```

---

### Task 3: tRPC/superjson response stripper (pure)

**Files:**
- Create: `scripts/parity/trpc.ts`
- Test: `scripts/parity/trpc.test.ts`

**Interfaces:**
- Produces: `stripTrpcJson(body: unknown): unknown` — given a tRPC httpBatchLink response array `[{result:{data:{json:PAYLOAD}}}]`, returns `PAYLOAD`; throws `TrpcError` if the body is a tRPC error envelope (surfacing `error.json.message`). `buildTrpcQueryUrl(base, procedure, input): string`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/parity/trpc.test.ts
import { describe, it, expect } from 'vitest';
import { stripTrpcJson, buildTrpcQueryUrl, TrpcError } from './trpc';

describe('stripTrpcJson', () => {
  it('unwraps the batch/superjson envelope', () => {
    const body = [{ result: { data: { json: { kpis: { headcount: 5 } } } } }];
    expect(stripTrpcJson(body)).toEqual({ kpis: { headcount: 5 } });
  });
  it('throws TrpcError on an error envelope', () => {
    const body = [{ error: { json: { message: 'FORBIDDEN', code: -32003 } } }];
    expect(() => stripTrpcJson(body)).toThrow(TrpcError);
  });
});

describe('buildTrpcQueryUrl', () => {
  it('encodes batch + input', () => {
    const u = buildTrpcQueryUrl('https://t', 'teamIntel.getDashboardKpis', { teamId: null });
    expect(u).toContain('/api/trpc/teamIntel.getDashboardKpis?batch=1');
    expect(decodeURIComponent(u)).toContain('"json":{"teamId":null}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/parity/trpc.test.ts` — Expected: FAIL (missing module).

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/parity/trpc.ts
export class TrpcError extends Error { constructor(msg: string, readonly code?: number) { super(msg); } }

export function stripTrpcJson(body: unknown): unknown {
  const first = Array.isArray(body) ? body[0] : body;
  if (first && typeof first === 'object') {
    const f = first as Record<string, any>;
    if (f.error) throw new TrpcError(f.error?.json?.message ?? 'tRPC error', f.error?.json?.code);
    if (f.result?.data && 'json' in f.result.data) return f.result.data.json;
  }
  throw new TrpcError('Unrecognized tRPC response shape');
}

export function buildTrpcQueryUrl(base: string, procedure: string, input: unknown): string {
  const payload = encodeURIComponent(JSON.stringify({ 0: { json: input } }));
  return `${base}/api/trpc/${procedure}?batch=1&input=${payload}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/parity/trpc.test.ts` — Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/parity/trpc.ts scripts/parity/trpc.test.ts
git commit -m "feat(parity): tRPC/superjson response stripper + query URL builder"
```

---

### Task 4: Supabase client + token minting

**Files:**
- Create: `scripts/parity/supabase.ts`
- Test: `scripts/parity/supabase.test.ts`

**Interfaces:**
- Consumes: `HarnessConfig` (Task 1).
- Produces: `makeAdminClient(cfg): SupabaseClient` (service_role, autoRefresh off). `getToken(cfg, email, password, cache?): Promise<string>` — `signInWithPassword` → `access_token`; memoizes per email in `cache` (a `Map`). `TokenCache = Map<string, string>`.

- [ ] **Step 1: Write the failing test (cache logic with a fake signIn)**

```ts
// scripts/parity/supabase.test.ts
import { describe, it, expect, vi } from 'vitest';
import { getTokenWith, type SignIn } from './supabase';

describe('getTokenWith', () => {
  it('calls signIn once per email then serves cache', async () => {
    const signIn: SignIn = vi.fn(async (e) => `tok-${e}`);
    const cache = new Map<string, string>();
    expect(await getTokenWith(signIn, 'a@x', 'p', cache)).toBe('tok-a@x');
    expect(await getTokenWith(signIn, 'a@x', 'p', cache)).toBe('tok-a@x');
    expect(signIn).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/parity/supabase.test.ts` — Expected: FAIL (missing module).

- [ ] **Step 3: Write minimal implementation**

```ts
// scripts/parity/supabase.ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { HarnessConfig } from './config';

export type TokenCache = Map<string, string>;
export type SignIn = (email: string, password: string) => Promise<string>;

export function makeAdminClient(cfg: HarnessConfig): SupabaseClient {
  return createClient(cfg.supabaseUrl, cfg.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function getTokenWith(signIn: SignIn, email: string, password: string, cache: TokenCache): Promise<string> {
  const hit = cache.get(email);
  if (hit) return hit;
  const tok = await signIn(email, password);
  cache.set(email, tok);
  return tok;
}

export async function getToken(cfg: HarnessConfig, email: string, password: string, cache: TokenCache): Promise<string> {
  const anon = createClient(cfg.supabaseUrl, cfg.anonKey, { auth: { persistSession: false } });
  return getTokenWith(async (e, p) => {
    const { data, error } = await anon.auth.signInWithPassword({ email: e, password: p });
    if (error || !data.session) throw new Error(`signIn failed for ${e}: ${error?.message}`);
    return data.session.access_token;
  }, email, password, cache);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/parity/supabase.test.ts` — Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add scripts/parity/supabase.ts scripts/parity/supabase.test.ts
git commit -m "feat(parity): supabase admin client + signInWithPassword token cache"
```

---

### Task 5: Seed / teardown test orgs + users

**Files:**
- Create: `scripts/parity/seed.ts`
- Modify: `scripts/parity/surfaces.ts` is NOT needed yet (roles list lives here temporarily, moved in Task 7).

**Interfaces:**
- Consumes: `makeAdminClient` (Task 4), `HarnessConfig`.
- Produces: `seed(cfg): Promise<SeedResult>` and `teardown(cfg): Promise<void>`. `SeedResult = { orgs: { a: string; b: string }; users: SeededUser[] }`, `SeededUser = { email: string; password: string; orgKey: 'a'|'b'; role: string }`. Idempotent.

- [ ] **Step 1: Investigate the real user/org/role schema (no code yet)**

Run:
```bash
grep -rnE "model (organizations|users|user_roles|roles|teams)" packages/db/prisma/schema/ | head
```
Read those models to confirm table/column names + how membership + role grants are represented, and whether an org has required non-null fields the seed must supply. Record the exact insert shape in a comment at the top of `seed.ts`.

- [ ] **Step 2: Write the failing test (idempotency contract via a fake admin)**

```ts
// scripts/parity/seed.test.ts
import { describe, it, expect, vi } from 'vitest';
import { planSeed } from './seed';

describe('planSeed', () => {
  it('produces 2 orgs and a user per configured role, deterministic emails', () => {
    const plan = planSeed(['org_admin', 'manager']);
    expect(plan.orgs).toEqual(['__parity_a', '__parity_b']);
    expect(plan.users).toHaveLength(4); // 2 orgs x 2 roles
    expect(plan.users.map((u) => u.email)).toContain('parity+a-org_admin@tims.test');
    expect(new Set(plan.users.map((u) => u.email)).size).toBe(4); // unique
  });
});
```

- [ ] **Step 3: Run test to verify it fails** — `npx vitest run scripts/parity/seed.test.ts` → FAIL.

- [ ] **Step 4: Implement `planSeed` (pure) + `seed`/`teardown` (admin calls)**

```ts
// scripts/parity/seed.ts  (schema-accurate inserts filled in per Step 1)
import type { HarnessConfig } from './config';
import { makeAdminClient } from './supabase';

export interface SeededUser { email: string; password: string; orgKey: 'a' | 'b'; role: string }
export interface SeedPlan { orgs: string[]; users: SeededUser[] }
const PASSWORD = 'Parity!Test-2026'; // known, test-only

export function planSeed(roles: string[]): SeedPlan {
  const users: SeededUser[] = [];
  for (const orgKey of ['a', 'b'] as const)
    for (const role of roles)
      users.push({ email: `parity+${orgKey}-${role}@tims.test`, password: PASSWORD, orgKey, role });
  return { orgs: ['__parity_a', '__parity_b'], users };
}

// seed(): upsert orgs by slug (idempotent), admin.createUser (ignore "already registered"),
// upsert users row (supabase_user_id link) + user_roles grant, minimal team-intel seed data.
// teardown(): delete in FK-safe order, then admin.deleteUser for each seeded auth user.
// Use the exact table/column names recorded in Step 1. Wrap each entity create in try/catch
// that swallows unique-violation (idempotency) but rethrows anything else.
export async function seed(cfg: HarnessConfig, roles: string[]): Promise<SeedPlan> {
  const admin = makeAdminClient(cfg);
  const plan = planSeed(roles);
  // ... upserts using `admin.from('organizations').upsert(...)`, `admin.auth.admin.createUser(...)`, etc.
  return plan;
}
```

- [ ] **Step 5: Run test to verify it passes** — `npx vitest run scripts/parity/seed.test.ts` → PASS.

- [ ] **Step 6: Live smoke (manual, one-time)** — after `.env` is filled:
```bash
npx tsx scripts/parity/cli.ts seed      # (cli wired in Task 11; run after that)
```
Expected: 2 orgs + N users created; re-run = no error (idempotent).

- [ ] **Step 7: Commit**

```bash
git add scripts/parity/seed.ts scripts/parity/seed.test.ts
git commit -m "feat(parity): idempotent seed/teardown of test orgs + role users"
```

---

### Task 6: Live callers (C# REST + TS tRPC)

**Files:**
- Create: `scripts/parity/callers.ts`
- Test: `scripts/parity/callers.test.ts`

**Interfaces:**
- Consumes: `stripTrpcJson`, `buildTrpcQueryUrl` (Task 3).
- Produces: `callCsharp(base, path, token): Promise<{ status: number; body: unknown }>`; `callTs(base, procedure, input, auth): Promise<unknown>` (throws `TrpcError` on error envelope). `auth` shape resolved in Step 1.

- [ ] **Step 1: Confirm the TS app's programmatic auth mechanism (no code yet)**

Read `packages/auth/` middleware + the tRPC context creator (`grep -rnE "createServerClient|getUser|Authorization|cookies\(\)" packages/auth apps/web/app/api/trpc`). Determine whether the Next app authenticates a request via **Authorization: Bearer** or the **`sb-<ref>-auth-token` cookie**. Record the answer; implement `callTs` auth accordingly (if cookie: set `Cookie: sb-${ref}-auth-token=<session json>`; if bearer: `Authorization: Bearer <token>`).

- [ ] **Step 2: Write the failing test (URL + header assembly, fetch faked)**

```ts
// scripts/parity/callers.test.ts
import { describe, it, expect, vi } from 'vitest';
import { callCsharp } from './callers';

describe('callCsharp', () => {
  it('GETs base+path with Bearer and returns {status, body}', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ok: 1 }), { status: 200 }));
    const res = await callCsharp('https://c', '/team-intel/dashboard-kpis', 'TOK', fetchFn);
    expect(fetchFn).toHaveBeenCalledWith('https://c/team-intel/dashboard-kpis',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer TOK' }) }));
    expect(res).toEqual({ status: 200, body: { ok: 1 } });
  });
});
```

- [ ] **Step 3: Run test to verify it fails** — FAIL (missing module).

- [ ] **Step 4: Implement**

```ts
// scripts/parity/callers.ts
import { stripTrpcJson, buildTrpcQueryUrl } from './trpc';
type Fetch = typeof fetch;

export async function callCsharp(base: string, path: string, token: string, fetchFn: Fetch = fetch) {
  const res = await fetchFn(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// callTs: auth header/cookie per Step 1 finding; GET buildTrpcQueryUrl; stripTrpcJson(body).
export async function callTs(base: string, procedure: string, input: unknown, token: string, fetchFn: Fetch = fetch) {
  const url = buildTrpcQueryUrl(base, procedure, input);
  const res = await fetchFn(url, { headers: { Authorization: `Bearer ${token}` } }); // adjust per Step 1
  return stripTrpcJson(await res.json());
}
```

- [ ] **Step 5: Run test to verify it passes** — PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/parity/callers.ts scripts/parity/callers.test.ts
git commit -m "feat(parity): live C# REST + TS tRPC callers"
```

---

### Task 7: Surface registry + team-intel definition

**Files:**
- Create: `scripts/parity/surfaces.ts`
- Test: `scripts/parity/surfaces.test.ts`

**Interfaces:**
- Produces: `SURFACES: Record<string, Surface>` where
  `Surface = { key: string; flag: string; roles: string[]; endpoints: EndpointDef[] }`,
  `EndpointDef = { name: string; csharpPath: string; tsProcedure: string; input: unknown; idScopeKey?: string; expectedByRole: Record<string, 200 | 403>; normalize?: NormalizeOpts }`.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/parity/surfaces.test.ts
import { describe, it, expect } from 'vitest';
import { SURFACES } from './surfaces';

describe('SURFACES', () => {
  it('team-intel has the dashboard-kpis endpoint + flag', () => {
    const s = SURFACES['team-intel'];
    expect(s.flag).toBe('Platform__TeamIntelReadEnabled');
    const kpi = s.endpoints.find((e) => e.name === 'dashboard-kpis');
    expect(kpi?.csharpPath).toBe('/team-intel/dashboard-kpis');
    expect(kpi?.expectedByRole['org_admin']).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement (confirm tRPC procedure name + role matrix from code first)**

Run `grep -rnE "getDashboardKpis|teamIntel" packages/api/src/**/team-intel*` to confirm the exact tRPC procedure path + which of the 9 roles get `team_intel:read`. Then:

```ts
// scripts/parity/surfaces.ts
import type { NormalizeOpts } from './normalize';
export interface EndpointDef {
  name: string; csharpPath: string; tsProcedure: string; input: unknown;
  idScopeKey?: string; expectedByRole: Record<string, 200 | 403>; normalize?: NormalizeOpts;
}
export interface Surface { key: string; flag: string; roles: string[]; endpoints: EndpointDef[] }

export const SURFACES: Record<string, Surface> = {
  'team-intel': {
    key: 'team-intel', flag: 'Platform__TeamIntelReadEnabled',
    roles: ['org_admin', 'manager', 'recruiter'], // confirmed grant-holders
    endpoints: [{
      name: 'dashboard-kpis', csharpPath: '/team-intel/dashboard-kpis',
      tsProcedure: 'teamIntel.getDashboardKpis', input: {},
      expectedByRole: { org_admin: 200, manager: 200, recruiter: 403 }, // per team_intel:read + OrgGate
      normalize: { dropNullish: true },
    }],
  },
};
```

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/parity/surfaces.ts scripts/parity/surfaces.test.ts
git commit -m "feat(parity): surface registry + team-intel read definition"
```

---

### Task 8: Parity check runner

**Files:**
- Create: `scripts/parity/checks/parity.ts`
- Test: `scripts/parity/checks/parity.test.ts`

**Interfaces:**
- Consumes: callers (Task 6), `normalize`/`diff` (Task 2), `Surface`/`EndpointDef` (Task 7).
- Produces: `runParity(deps): Promise<CheckResult[]>`, `CheckResult = { check: 'parity'; endpoint: string; ok: boolean; detail?: string }`. `deps` injects `callCsharp`/`callTs`/token so it is unit-testable.

- [ ] **Step 1: Write the failing test (fakes return divergent payloads)**

```ts
// scripts/parity/checks/parity.test.ts
import { describe, it, expect } from 'vitest';
import { runParityEndpoint } from './parity';

const ep = { name: 'k', csharpPath: '/k', tsProcedure: 't.k', input: {},
  expectedByRole: { org_admin: 200 as const }, normalize: { dropNullish: true } };

describe('runParityEndpoint', () => {
  it('ok when C# == TS after normalize', async () => {
    const r = await runParityEndpoint(ep,
      async () => ({ status: 200, body: { a: 1, b: null } }),
      async () => ({ a: 1 }));
    expect(r.ok).toBe(true);
  });
  it('red + diff detail on mismatch', async () => {
    const r = await runParityEndpoint(ep,
      async () => ({ status: 200, body: { a: 2 } }),
      async () => ({ a: 1 }));
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('a');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement**

```ts
// scripts/parity/checks/parity.ts
import { normalize, diff } from '../normalize';
import type { EndpointDef } from '../surfaces';
export interface CheckResult { check: string; endpoint: string; ok: boolean; detail?: string }

export async function runParityEndpoint(
  ep: EndpointDef,
  csharp: (path: string, input: unknown) => Promise<{ status: number; body: unknown }>,
  ts: (proc: string, input: unknown) => Promise<unknown>,
): Promise<CheckResult> {
  const [c, t] = await Promise.all([csharp(ep.csharpPath, ep.input), ts(ep.tsProcedure, ep.input)]);
  const cn = normalize(c.body, ep.normalize);
  const tn = normalize(t, ep.normalize);
  const d = diff(tn, cn);
  return { check: 'parity', endpoint: ep.name, ok: d.length === 0,
    detail: d.length ? JSON.stringify(d.slice(0, 10)) : undefined };
}
```

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/parity/checks/parity.ts scripts/parity/checks/parity.test.ts
git commit -m "feat(parity): parity check runner (C# vs TS diff)"
```

---

### Task 9: RLS cross-tenant probe

**Files:**
- Create: `scripts/parity/checks/rls.ts`
- Test: `scripts/parity/checks/rls.test.ts`

**Interfaces:**
- Produces: `runRlsEndpoint(ep, orgAToken, orgBResourceId, callCsharp): Promise<CheckResult>` — for endpoints with `idScopeKey`: call C# with org-A token for an org-B resource id → assert `404`/empty (isolation holds). For list endpoints: assert every returned row's org id ≠ org-B. Red if org-B data is reachable.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/parity/checks/rls.test.ts
import { describe, it, expect } from 'vitest';
import { assertIsolated } from './rls';

describe('assertIsolated', () => {
  it('ok when cross-tenant fetch returns 404', () => {
    expect(assertIsolated({ status: 404, body: null }).ok).toBe(true);
  });
  it('RED when cross-tenant fetch returns 200 with data', () => {
    const r = assertIsolated({ status: 200, body: { id: 'orgB-thing' } });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('cross-tenant');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** `assertIsolated` (pure verdict) + `runRlsEndpoint` (does the live org-A→org-B call, delegates to `assertIsolated`). Red unless status ∈ {403,404} or body empty.

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/parity/checks/rls.ts scripts/parity/checks/rls.test.ts
git commit -m "feat(parity): RLS cross-tenant isolation probe"
```

---

### Task 10: RBAC matrix runner

**Files:**
- Create: `scripts/parity/checks/rbac.ts`
- Test: `scripts/parity/checks/rbac.test.ts`

**Interfaces:**
- Produces: `runRbacEndpoint(ep, tokensByRole, callCsharp): Promise<CheckResult[]>` — for each role in `ep.expectedByRole`, call C# with that role's token and assert the status matches (200 allow / 403 deny). One `CheckResult` per role.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/parity/checks/rbac.test.ts
import { describe, it, expect } from 'vitest';
import { verdictForRole } from './rbac';

describe('verdictForRole', () => {
  it('ok when actual status matches expected', () => {
    expect(verdictForRole('recruiter', 403, 403).ok).toBe(true);
  });
  it('RED when a denied role gets 200 (privilege escalation)', () => {
    const r = verdictForRole('recruiter', 403, 200);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('recruiter');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement** `verdictForRole(role, expected, actual)` (pure) + `runRbacEndpoint` looping roles → live calls → `verdictForRole`.

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/parity/checks/rbac.ts scripts/parity/checks/rbac.test.ts
git commit -m "feat(parity): RBAC role-matrix runner"
```

---

### Task 11: Report + CLI dispatch

**Files:**
- Create: `scripts/parity/report.ts`
- Create: `scripts/parity/cli.ts`
- Test: `scripts/parity/report.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces: `renderReport(results: CheckResult[]): { text: string; allGreen: boolean }`. CLI commands: `seed [--teardown]`, `auth`, `parity <surface>`, `rls <surface>`, `rbac <surface>`, `verify <surface>`, exit code 1 if any red.

- [ ] **Step 1: Write the failing test**

```ts
// scripts/parity/report.test.ts
import { describe, it, expect } from 'vitest';
import { renderReport } from './report';

describe('renderReport', () => {
  it('allGreen true when every result ok', () => {
    const r = renderReport([{ check: 'parity', endpoint: 'k', ok: true }]);
    expect(r.allGreen).toBe(true);
    expect(r.text).toContain('PASS');
  });
  it('allGreen false + shows the failing endpoint', () => {
    const r = renderReport([{ check: 'rls', endpoint: 'k', ok: false, detail: 'cross-tenant leak' }]);
    expect(r.allGreen).toBe(false);
    expect(r.text).toContain('cross-tenant leak');
  });
});
```

- [ ] **Step 2: Run test to verify it fails** — FAIL.

- [ ] **Step 3: Implement `renderReport` + `cli.ts`**

`cli.ts` parses `process.argv[2]` (command) + `[3]` (surface), `loadConfig()`, builds a token cache via `getToken` for each seeded (org,role), dispatches to the check runners, prints `renderReport`, `process.exit(allGreen ? 0 : 1)`. `verify` = parity + rls + rbac. `--teardown` routes `seed` → `teardown`.

- [ ] **Step 4: Run test to verify it passes** — PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/parity/report.ts scripts/parity/cli.ts scripts/parity/report.test.ts
git commit -m "feat(parity): report renderer + CLI dispatch"
```

---

### Task 12: Self-test (prove the harness can go red)

**Files:**
- Create: `scripts/parity/selftest.test.ts`

**Interfaces:** Consumes the pure verdict fns (`runParityEndpoint`, `assertIsolated`, `verdictForRole`).

- [ ] **Step 1: Write the self-test**

```ts
// scripts/parity/selftest.test.ts
import { describe, it, expect } from 'vitest';
import { runParityEndpoint } from './checks/parity';
import { assertIsolated } from './checks/rls';
import { verdictForRole } from './checks/rbac';

const ep = { name: 'k', csharpPath: '/k', tsProcedure: 't', input: {}, expectedByRole: { a: 200 as const } };

describe('harness self-test (green must mean something)', () => {
  it('parity goes RED on an injected field mismatch', async () => {
    const r = await runParityEndpoint(ep, async () => ({ status: 200, body: { x: 'WRONG' } }), async () => ({ x: 'right' }));
    expect(r.ok).toBe(false);
  });
  it('rls goes RED when cross-tenant data is returned', () => {
    expect(assertIsolated({ status: 200, body: { id: 'leak' } }).ok).toBe(false);
  });
  it('rbac goes RED on privilege escalation', () => {
    expect(verdictForRole('denied', 403, 200).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run + confirm all three RED-detections pass**

Run: `npx vitest run scripts/parity/selftest.test.ts` — Expected: PASS (3).

- [ ] **Step 3: Full harness test run**

Run: `npx vitest run scripts/parity` — Expected: ALL pass. Then `cd apps/web && npx tsc --noEmit` and the api tsc to confirm no type breakage (harness is outside those projects, but run to be safe).

- [ ] **Step 4: Commit**

```bash
git add scripts/parity/selftest.test.ts
git commit -m "test(parity): self-test proving parity/rls/rbac detect regressions"
```

---

## Post-plan: live pre-flip run (manual, after `.env` filled)

Not a code task — the first real use. After secrets are in `scripts/parity/.env`:
1. `npx tsx scripts/parity/cli.ts seed` → creates test orgs/users (idempotent).
2. `npx tsx scripts/parity/cli.ts auth` → confirms tokens mint.
3. Pre-flip structural: hit C# `/team-intel/dashboard-kpis` (dark) → expect 404, and unauth → 401. Capture TS golden output.
4. At canary (Federico flips `Platform__TeamIntelReadEnabled`): `npx tsx scripts/parity/cli.ts verify team-intel` → expect all-green (parity + rls + rbac), else Federico flips back.
