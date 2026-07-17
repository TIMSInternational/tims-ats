# CB-1c — Security-Event Audit Coverage (design + build)

## Build status (2026-07-17) — BUILT, gate-green, pre-review
Increments 1–3 built on `feat/compliance-cb1c-security-event-coverage`. Local gate green: `@tims/api` tsc 0,
`apps/web` tsc 0, vitest **2154/2154** (+18 new in `tests/security/security-event-coverage.test.ts`).
Two design corrections + one scope decision were made during Explore/build (authoritative over the original
plan below):

1. **`metadata` is a RAW Prisma `Json` OBJECT, not `JSON.stringify`'d.** The original plan (increment-1 snippet)
   said stringify "to match convention" — that is WRONG for this schema. Every real writer (`recordBillingAudit`,
   the ~20 platform `db.auditLog.create` sites, the old `withAudit`) stores a jsonb OBJECT, and the health
   dashboard reads it back as an object (`platform/system.ts` `meta?.message`). Stringifying would silently break
   that read. `logSecurityEvent` passes the object; a regression test pins it. (`changes` is a separate field the
   security events don't use.)
2. **`login_failed` (#4) is DEFERRED to CB-2 (Federico decision 2026-07-17).** Password login runs entirely
   client-side via the Supabase SDK (`login/page.tsx:37 signInWithPassword`) — NO server code observes a
   wrong-password attempt. The `auth/callback` route only sees OAuth/magic-link code-exchange failures, which
   have no resolvable email/org (and `audit_logs.organizationId` is NOT-NULL FK, no sentinel org exists). The
   architecturally-correct source is the IdP itself: a **Supabase Auth Hook / GoTrue webhook**, which needs
   Supabase config (Federico's infra) → lands in CB-2. Until then the health dashboard's `login_failed` count
   stays 0 (it already renders 0 gracefully). We did NOT build a client-report endpoint (client-triggered
   security events are low-trust + add public attack surface).
3. **Scope built = #5 authz-denial + #6 roles + #7 flags + #8 platform exports** (the four server-observable,
   fully-trustworthy event classes). `withAudit`/`auditedProcedure` left dead; the dead `auditedProcedure` import
   in `user.ts` was removed.

### Review gate (fresh reviewer + Codex adversarial + opus whole-branch) — findings & resolutions
Fresh reviewer: SHIP-ABLE, no Crit/High. Codex: NO-GO with a High + coverage gaps. Converged fixes applied
in-branch (all bite-proven; gate re-green vitest 2161/2161, api/web tsc 0):
- **Transparency hardening (fresh L3 / opus H1):** `observeDenial`/`logPlatformExport`/`observeExternalDenial`
  bodies now run inside a `safe()` wrapper → structurally cannot throw into the tRPC hot path (a throwing
  `ctx.headers` can no longer turn a 403 into a 500). Bite test: a hostile headers object → observer does not throw.
- **External API-key denial coverage (fresh M1 / Codex Med#4):** added `observeExternalDenial` at BOTH
  `requireExternalPermission` throw sites (scope + grant) — the org is known from the key there. Completes
  authz-denial coverage for the paid external surface. (Invalid-key UNAUTHORIZED has no org → skip; that + the
  anonymous-staff-authN gap land with #4 in CB-2.)
- **Empty-org FK guard centralized (fresh L5):** `logSecurityEvent` now early-returns on a falsy org, so every
  inline writer is FK-safe in one place.
- **DSAR double-audit removed (Codex High#1 context):** the DSAR export already writes `data_subject_export`
  per affected SUBJECT org — strictly better than a generic `platform_export` under the actor org — so the
  redundant `logPlatformExport` I added there was REMOVED. CB-1c no longer touches the DSAR path.
- **Platform single-org flag deletion (Codex Med#5, valid half):** `deleteFeatureFlag` now logs
  `feature_flag_changed`. (Platform role changes were ALREADY audited as `user_role_changed` — Codex's role half
  was a false finding.)

### Residual gaps (documented, NOT blockers — tracked to later CBs)
- **Global cross-org platform actions** (all-org flag create/delete/seed; aggregate exports of
  subscriptions/invitations/ai_agents by an org-less platform owner) have no single org to satisfy the NOT-NULL
  FK, so they are SKIPPED. Faithful per-tenant attribution needs **`audit_logs` to become FK-less** — the CB-1b
  recommended follow-up. Tracked there.
- **Pre-existing DSAR subject-email in `audit_logs`** (`data_subject_export` writes `entityId=email` +
  `metadata.email`) — Codex flagged it as a PII exposure. NOT introduced by CB-1c. It is NOT a cross-tenant leak
  (both the platform audit reads and the tenant `auditRouter` filter by `organizationId`), but — correcting an
  earlier "platform-owner-only" framing — the tenant `auditRouter` (root.ts) means a SAME-ORG user with
  `audit:read` can also see it. So it's a SAME-TENANT data-minimization concern (a data subject's email visible
  to org staff holding `audit:read`). Whether a DSAR audit may/should carry the subject identifier is a
  compliance-POLICY call (accountability vs minimization) → surfaced to Federico as a CB-6 (retention/
  minimization) item, not silently rewritten here.
- **Double-log on a mixed-auth request (Codex recheck, Low):** a request carrying BOTH a staff session AND a
  denied API key logs the external denial twice — once via `observeExternalDenial` (key org) and once via the
  outer `observeDenial` (staff org) — because the outermost observer's base ctx can't see the downstream-injected
  `ctx.externalAuth`. Normal API-only clients (no staff session → `ctx.user` null → outer observer skips) are
  unaffected. This is over-logging on a contrived edge, not a security/transparency issue → documented; a clean
  suppression would need the base context to carry the external-principal flag (small follow-up if ever wanted).
- **Anonymous / unauthenticated authN failures** (UNAUTHORIZED, no session/org) → CB-2 (Supabase auth-hook, with #4).
- **`audit_logs` append-only** is enforced by CB-1b (PR #144, awaiting Federico merge + prod SQL) — Codex correctly
  noted no in-repo trigger on `main` yet; that's CB-1b's deliverable, not CB-1c's.

**Implementation notes (as built):**
- `packages/api/src/access/security-audit.ts` — `logSecurityEvent` (fail-soft, privileged `db`, raw-object
  metadata), `observeDenial` (fail-soft, fire-and-forget, resolve-or-skip on the org FK), `logPlatformExport`.
- `trpc.ts` — `withSecurityAudit` is a TRANSPARENT observer placed OUTERMOST
  (`t.procedure.use(withSecurityAudit).use(withRateLimit)`). ⚠️ tRPC does NOT reject `next()` on a downstream
  error — it resolves to a `MiddlewareResult` with `ok:false`. So the observer inspects `!result.ok` and returns
  the result UNCHANGED (a try/catch would never fire — this was caught by the transparency test during build).
  It cannot alter a 403/401 or convert a denial to 500.
- Inline writers: `user.ts` (`create` + `assignRole` → `role_assigned`), `featureFlag.ts` (`update` →
  `feature_flag_changed`), and the 7 platform exports (`ai-agents`/`invoices`/`data-requests`/`invitations`/
  `system`/`subscriptions`/`users` → `platform_export`, via `logPlatformExport`). DSAR export logs counts only,
  never the subject's email (PII stays out of the audit trail).

---

Date: 2026-07-17 · Status: **Designed (superseded by the build-status block above).** Track:
[[tims-soc2-iso27001-compliance]] · Roadmap `docs/architecture/compliance/00-compliance-by-design-roadmap.md`.
Follows CB-1 (data_access_logs immutability, #143) + CB-1b (audit_logs immutability, PR #144). This is the
COVERAGE control: log the security events that are currently UNLOGGED. **Touches the LIVE TS app (auth + the
tRPC hot path) — it deploys with prod, so evidence accrues immediately. NOT dark-gated. Own gate + care.**

## The load-bearing finding: `withAudit` is DEAD
`packages/api/src/trpc.ts:155-178` defines a `withAudit` middleware (post-success `action:'access'`, `entity=path`,
impersonation-attributed, fail-soft) and `auditedProcedure = protectedProcedure.use(withAudit)` at :183. It is
imported once (`routers/user.ts:3`) and **never used** — it runs for ZERO procedures. Options: (a) delete it, or
(b) DON'T resurrect it as-is (logging every successful access = huge volume + it's post-success, not the security
signal we need). CB-1c wants **failure/denial + privileged-action** events, not access-logging. Decision: leave
`withAudit`/`auditedProcedure` out (or delete the dead import) and build a focused security-event writer instead.

## The reusable primitive to build (increment 1)
No general audit helper exists today (only `logDataAccess` for sensitive READs [fail-CLOSED for restricted] and
`recordBillingAudit` for billing). Build a thin, FAIL-SOFT `logSecurityEvent` over `db.auditLog.create(...).catch()`:

```ts
// packages/api/src/access/security-audit.ts  (new)
export interface SecurityEvent {
  organizationId: string;      // '' / a sentinel for pre-tenant events (login) — see note
  actorId?: string | null;     // the acting user (impersonator ?? user); null for anonymous authN failures
  action: string;              // 'login_failed' | 'authz_denied' | 'role_assigned' | ...
  entity: string;              // 'auth' | 'trpc:'+path | 'user_role' | 'feature_flag' | ...
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}
export async function logSecurityEvent(e: SecurityEvent): Promise<void> {
  // Privileged db (like the platform writers) — security events can be pre-tenant / cross-org.
  await db.auditLog.create({ data: { ...e, changes: undefined, metadata: e.metadata ? JSON.stringify(e.metadata) : undefined } })
    .catch(() => { /* fail-SOFT: a lost security-audit row must NEVER block auth / change a 403 / fail a mutation */ });
}
```
Match the existing convention: `changes`/`metadata` are JSON-STRINGIFIED (all ~20 call sites do this). Use the
privileged `db` (not tenantDb) — login + platform cross-org events have no tenant GUC. ⚠️ `audit_logs.organizationId`
is NOT-NULL with an FK to organizations (ON DELETE CASCADE, per CB-1b): a `login_failed` before org resolution has
no org — either resolve the org from the email's user row first, or (cleaner) write login events only when the
email maps to a known user+org, else skip (a failed login for an unknown email → skip the row, or use a dedicated
"platform" sentinel org if one exists). RESOLVE THIS in build (it gates the login writer). The C# `audit_logs`
writer from Slice 4b (`BillingAuditWriter`/`AuditLogDbContext`) is the eventual home once auth migrates; CB-1c
ships in TS now because auth is still TS.

## The events to instrument (increment 2 — mine the exact sites)
| # | Event | Site (file:line) | action / entity | fail policy |
|---|---|---|---|---|
| 4 | **authN failure** | server side of login — `apps/web/app/auth/callback/route.ts` (client `login/page.tsx:42` can't be trusted). Health dashboard already QUERIES `action:'login_failed'` (`platform/system.ts:41,45`). | `login_failed` / `auth`, metadata `{ emailMasked, reason, provider }` | fail-soft, non-blocking (never delay/deny login) |
| 5 | **authZ denial** (the big one) | `trpc.ts` FORBIDDEN/UNAUTHORIZED throws: `:57,78,110,117,133,138,201,233,235,239`. Hot = `:138` (permission-grant denial). | `authz_denied` (or `authn_failed` for the UNAUTHORIZED set) / `trpc:{path}`, metadata `{ module, action, code, userId, reason }` | **fail-soft, MUST NOT convert 403→500 or grant access** |
| 6 | **role assignment** | `routers/user.ts:175 assignRole` (userRole upsert), `:107 create` | `role_assigned`/`role_revoked` / `user_role`, entityId=userId, `{ targetUserId, roleSlug, previousRole }` | fail-soft inline |
| 7 | **feature-flag change** | `routers/featureFlag.ts:24 update` (:34) | `feature_flag_changed` / `feature_flag`, entityId=flag, `{ flag, enabled, previous }` | fail-soft inline |
| 8 | **platform cross-org read/export** | platform routers' list/export queries (mutations already audited; reads/exports not): `platform/organizations.ts`, `data-requests.ts`, `usage-billing.ts`, `invoices.ts`, `ai-agents.ts` | `platform_cross_org_read`/`export` / per-resource, `{ targetOrgId, recordCount, exportFormat }` | fail-soft inline |

## The authZ-denial approach (#5) — the delicate one
Denials happen INSIDE middlewares that `throw`, so "log after next()" won't see them. Cleanest: a **top-level
error-observing middleware on `publicProcedure`** (outermost) that catches the rejection, and if it's a
`TRPCError` with code FORBIDDEN or UNAUTHORIZED, fires `logSecurityEvent(...)` (fail-soft, not awaited on the
throw path) then RE-THROWS the original error unchanged. This captures every denial site without touching each
throw, and structurally cannot alter the 403/401 (it re-throws the same error; the log is best-effort). Capture
`path`, the resolved `ctx.user?.id` (may be null), ip/ua. Do NOT log successful calls (volume). Add a
regression-corpus test: a denied `permissionProcedure` call writes exactly one `authz_denied` row AND still
returns 403 (the row write failing must still 403, never 500).

## Build order + gate
1. `logSecurityEvent` primitive + unit test (fail-soft: a throwing `create` is swallowed). Resolve the login-org
   FK question. 2. The tRPC error-observing middleware (#5) — the hot path; test that a denial logs + still 403s,
   and a logging failure never 500s. 3. Inline writers for #6/#7/#8 (+ the login writer #4 in the callback route).
   4. Verify the health dashboard's `login_failed` count now populates.
LOCAL GATE (TS): `packages/db` prisma generate → `@tims/api` tsc → `apps/web` tsc → `npx vitest run` (+ a new
`tests/security/security-event-coverage.test.ts`). Then the 3-way review (fresh reviewer + Codex + opus), fix
Crit/High/Med, PR, admin-merge. **⚠️ This changes LIVE behavior on deploy** — extra care on the tRPC middleware
(it wraps EVERY request): the error-observing middleware must be provably transparent (re-throws unchanged) and
must never add latency on the success path (only acts on rejection). Consider a canary/verify after deploy.

## Compliance mapping
SOC 2 CC7.2 (security event monitoring) + CC6.1/6.8 (authN/authZ), ISO 27001 A.8.15/A.8.16 (logging + monitoring).
Pairs with CB-1/CB-1b immutability (the events land in the now-append-only `audit_logs`) → tamper-evident
security-event trail. Next compliance after CB-1c = CB-2 (MFA enforcement + access-review tooling).
