# Phase-5 Slice 19 — platform organizations READ (#76)

**Status:** steps 1–4 done, shipping DARK behind `Platform:PlatformOrganizationsReadEnabled`.
Steps 5 (verify in prod) and 6 (flip ownership) are Federico-gated and NOT in this slice.

Ports the three READ procedures of `packages/api/src/routers/platform/organizations.ts`:
`getOrganizationKpis`, `listOrganizations`, `getOrganization`.

## Why this is a read slice, not "#76"

#76 names all six procedures. Every domain in this repo splits read from write — external-vendor 1/2,
billing 3/4, compensation 9/12, evaluation360 7/13, succession 8/14, ninebox 10/15, engagement 11/16 —
and the strangler recipe says "Route reads first". The three WRITES (`createOrganization`,
`updateOrganization`, `suspendOrganization`) are a later slice, because they would move `organizations`
and `subscriptions` into `efcoreStranglerWrite` and need their own one-active-writer flag discipline
rather than riding a read flag.

**No table MOVES between ledger arrays** — every table stays Prisma-owned and is mapped read-only. But
the slice does amend the ledger: mapping a table in an EF `DbContext` at all requires it to be listed,
so `feature_flags`, `billing_profiles` and `platform_invitations` are added to `efcoreReadOnly[]`.

> An earlier draft of this doc said "this slice moves nothing in the ownership ledger". That was wrong,
> and `tests/governance/table-ownership.test.ts` caught it on the first full-suite run: three tables were
> mapped by the new context and unregistered. Registration is required for a read-only map, not just for
> a flip. The other eight tables the context maps were already listed.

| Concern | Disposition                                                    |
| ------- | -------------------------------------------------------------- |
| Gate    | `PlatformOwnerGate` — **reused**, not re-implemented           |
| Tenancy | **Never** wrapped in `TenantScope` — cross-org by design       |
| Ledger  | +3 to `efcoreReadOnly[]`; no array-to-array move               |
| Flag    | `Platform:PlatformOrganizationsReadEnabled`, default **false** |

## The authorization boundary is the gate, and only the gate

`routers/platform/organizations.ts` imports the **unscoped `db`**, never `tenantDb`. The C# side matches:
`PlatformOrganizationsReadDbContext` is never wrapped in `TenantScope`, the same disposition as
`AuditReadDbContext` (`Program.cs:448`).

So RLS restricts nothing on this path — and per the measured prod-roles reference the connecting role is
BYPASSRLS regardless. `PlatformOwnerGate` is the **entire** authorization boundary. There is no second
line of defence, which is why it is applied per-endpoint and runs **before** input validation (tRPC runs
middleware before Zod; a non-owner sending bad input must get 403, not 400).

`PlatformOwnerGate` was reused deliberately. It already handles the case a fresh gate gets wrong: an
**impersonated** platform owner resolves to `PrincipalType.OrgUser`, so it is denied with no
special-case code — matching TS's `ctx.user.isPlatformOwner` check against the real, non-impersonated
row.

> One wrinkle for review: `PlatformOwnerGate` lives in the `Tims.Api.Audit` namespace despite being
> generic, so this slice does `using Tims.Api.Audit;` to reach it. Relocating it to a neutral namespace
> is the tidier fix but touches a shipped surface, so it is raised rather than done silently here.

## Parity notes — where the TS is reproduced rather than improved

**Field set is reproduced exactly, via explicit projections.** The TS uses bare Prisma `include`
(`subscription: true`, `featureFlags: true`, `billingProfile: true`, and a
`companies → businessUnits → teams` tree), which returns every column of those relations — including
`billing_profiles.tax_id`, the full postal address and `billing_phone`. CLAUDE.md forbids unselected
reads for exactly this reason.

Measured against the only two consumers, most of it is unused: `org-detail.tsx` reads `id`, `name`,
`slug`, `plan`, `isActive`, `subscription`; `invoice-wizard.tsx:41` reads `id`, `name` and
`billingProfile?.billingEmail`. The `companies` tree, the `users` array and `featureFlags` appear
entirely unconsumed.

**It is still reproduced.** Narrowing during a port would conflate two changes and make step-5 parity
uninterpretable — a diff could no longer distinguish "the port is wrong" from "the port is deliberately
better". The C# projections are explicit, so the exposure is recorded in the type instead of implied by
the ORM. Narrowing is a separate follow-up against the FE and the read contract together.

**`status` is a tri-state that ignores unknown values.** Only the literals `active` and `suspended`
filter (`organizations.ts:48-49`); anything else is silently ignored. Reproduced, not tightened.

**Validation rejects rather than clamps.** Out-of-range `page`/`limit`/`sortBy`/`sortDir` return 400,
because tRPC would throw `BAD_REQUEST`. Clamping would silently accept input the TS refuses, and no
parity fixture would catch it — the TS never produces such a response to diff against.

**Cursor pagination is implemented but unexercised.** `page.tsx:33-40` sends `page`/`limit` only. The
Zod schema accepts `cursor`, so dropping it would be a silent contract narrowing; it is implemented as
an ordered seek (`skip: cursor ? 1 : page * limit`), and an unknown cursor yields an empty page, as
Prisma does.

**Sorting by `users` and cursor seek are resolved in memory.** Prisma's `orderBy: { users: { _count } }`
cannot be expressed against a context with no navigation properties. Bounded by design: this lists
ORGANIZATIONS (15 in production today), not a tenant-scale table.

## Latent trap, reproduced deliberately

Neither read filters `deleted_at IS NULL`, and `organizations.deleted_at` exists. **Nothing writes it** —
`suspendOrganization` uses `is_active` — so this is harmless today. The moment anything starts
soft-deleting organizations, both stacks list them as live. Recorded so the absence is a known choice.

## Verification

- `dotnet build` — succeeded, 0 errors
- `dotnet test` (unit) — **892 passed** (874 before this slice)
- The input-handling rules are **mutation-proved**: neutering `IsValidSortBy` to `=> true` turns three
  assertions red, with a green control either side

Parity fixtures and the `scripts/parity/surfaces.ts` registration are **not** in this slice — see #195,
which tracked that the registry covered 4 of ~15 C# domains and that `verify` was unrunnable for most of
them. Registering this surface belongs with that work.
