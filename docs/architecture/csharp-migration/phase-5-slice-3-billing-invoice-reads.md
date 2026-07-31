# Phase 5 Slice 3 — billing invoice READ surface → C# (strangler domain #2, reads-first)

Date: 2026-07-16 · Status: **TS DELETED — flipped and live in prod (2026-07-31).**
Branch: `feat/csharp-phase5-billing-reads` off main `16efcc2`. UPDATE 2026-07-31:
`NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP` / `Platform:BillingReadEnabled` confirmed live in prod
(parity-verified fresh 5/5 PASS immediately before flipping); the TS `billing.listInvoices`/
`billing.getInvoice` procedures and their FE tRPC fallback have since been deleted
(`ts-deletion-billing-invoices-read` branch) — the C# read route is the sole implementation now.

## Objective + scope

Begin the SECOND strangler domain (billing, plan order #2) with its READ surface (recipe: "reads first").
**Scope = the invoice reads: `billing.listInvoices` + `billing.getInvoice`** (`packages/api/src/routers/billing.ts`).
This is the **FIRST staff-JWT C# product surface** (all prior C# product endpoints were external API-key);
it reuses the ported staff auth plane (JWT `sub` → `PrincipalResolver` → `PermissionService`, the
`/require-permission` pattern). **Deferred:** `getUsage`/`getCurrentPlan`/`getBillingConfig` (Slice 3b — needs
the `planLimits`/`entitledPlan` kernel + org counts) and ALL Stripe writes (checkout/portal/cancel — an
external-integration boundary, a later slice). Cutover (route→canary→flip→delete TS) deferred; the C# surface
is **dark-by-default** (standing lesson from #140: every strangled C# product surface is flag-gated).

## Characterized TS contract (source of truth — `routers/billing.ts`)

Both `permissionProcedure('billing','read')` — staff JWT + `billing:read` grant (org scope; billing is
org-level, no per-row scope narrowing).

- **listInvoices**(`take` 1..100 default 20, `cursor` uuid?) → `{ items: Invoice[], nextCursor? }`.
  `db.invoice.findMany({ where:{organizationId}, take:take+1, cursor?:{id}, skip:1?, orderBy:{createdAt:'desc'} })`;
  `hasMore = items.length > take`; `nextCursor = hasMore ? items[take-1].id : undefined`. **Returns the RAW
  invoice rows (no `select` — the wire contract is the FULL `Invoice` model).**
- **getInvoice**(`id` uuid) → `db.invoice.findFirstOrThrow({ where:{id, organizationId}, include:{subscription:true} })`
  → the full Invoice **+ nested `subscription`** (full Subscription model), or **NOT_FOUND** (findFirstOrThrow
  throws when the id isn't in the caller's org — cross-org/missing indistinguishable).

**Invariants:** billing:read grant (INV-grant); staff-JWT resolvable principal else 401 (INV-auth); tenant
isolation (org filter + RLS) → cross-org getInvoice = NOT_FOUND (INV-tenant); cursor pagination on `id`,
`orderBy createdAt desc` (INV-page); the FULL model shape faithfully reproduced (INV-shape).

## Money + wire-format (the parity cruxes)

- **Money is `Float` (double), NOT Decimal** — `Invoice.amount/subtotal/taxRate`, `InvoiceLineItem.unitPrice/total`.
  So the DTO carries `double`/`double?`; wire = a JSON number. Golden-fixture representative money values
  (e.g. `1234.56`, `100`, `0.5`, `1234.5`, `0`) and confirm STJ ⇄ JS number-serialization parity; flag any
  edge divergence (STJ vs JS double formatting) for the reviewers. (Money-as-Float is the existing model —
  reproduce faithfully; do NOT "fix" it here.)
- **Dates:** Invoice/Subscription carry many nullable `DateTime`s → REUSE the Node-ISO date wire converter.
  **PROMOTE `NodeIsoDateTimeOffsetConverter`** (currently `Tims.Domain.ExternalVendor`) to a SHARED namespace
  (`Tims.Domain.Json`) so billing + external-vendor both use it; update the external-vendor DTO `[JsonConverter]`
  references + the fixture test. `timestamp`-column reads → `DateTime.SpecifyKind(Unspecified)` (as prior slices).

## C# port — structure (`services/Tims.Platform/`)

```
src/Tims.Domain/Json/
  NodeIsoDateTimeOffsetConverter.cs → MOVED here (shared); external-vendor DTOs re-point their [JsonConverter].
src/Tims.Domain/Billing/
  InvoiceV1.cs        → full-shape versioned DTO + pure Map (all Invoice fields; money=double, dates via NodeIso).
  SubscriptionV1.cs   → full-shape DTO + pure Map (nested in getInvoice). OrgPlan/SubscriptionStatus as strings.
src/Tims.Application/Billing/
  BillingReadModels.cs, IBillingReadRepository.cs (ListInvoicesAsync(org,take,cursor) / GetInvoiceAsync(org,id)),
  BillingReadUseCase.cs (query → map v1 → paginate; getInvoice null → BillingInvoiceNotFoundException),
  BillingInvoiceNotFoundException.cs.
src/Tims.Infrastructure/Billing/
  InvoiceReadEntity.cs / SubscriptionReadEntity.cs (map invoices/subscriptions, exact @map columns),
  BillingReadDbContext.cs (efcoreReadOnly), BillingReadRepository.cs (AsNoTracking under TenantScope + explicit
  org; list = take+1 cursor on id, orderBy createdAt desc; getInvoice = by id+org, LEFT-join subscription).
src/Tims.Api/Billing/
  BillingReadEndpoints.cs → GET /billing/invoices (list, cursor) + /billing/invoices/{id} (getInvoice).
                            STAFF JWT (RequireAuthorization) + resolve principal (PrincipalResolver, reuse the
                            /require-permission ResolvePrincipalAsync helper) + PermissionService billing:read
                            (401 unresolved / 403 denied) + rate-limit as applicable; 404 NOT_FOUND. OpenAPI.
  Program.cs → DI + conditional mapping behind PlatformOptions.BillingReadEnabled (DEFAULT false, dark).
```

## Auth (first staff-JWT product surface)

Reuse the `/require-permission` machinery: `RequireAuthorization()` (JWT scheme) → resolve the TIMS principal
(`PrincipalResolutionMiddleware` stash or `PrincipalResolver.ResolveStaffAsync`), unresolved → **401**;
`PermissionService.CheckAsync(context, "billing", "read")` denied → **403**. The read runs under the resolved
principal's org `TenantScope` (RLS). No per-row scope narrowing (billing is org-level).

## Golden parity (both CIs) + regression corpus

- `contracts/billing-fixtures/invoice-v1.json` + `subscription-v1.json` — full row → v1 mapping byte-identical
  TS (real Prisma-shaped fixtures → the TS wire shape) + C#, incl. money-Float values + canonical `…fffZ` dates.
- **Testcontainers (real RLS):** seed two orgs × invoices (+ a subscription) → prove tenant isolation
  (cross-org list empty / getInvoice → NOT_FOUND), cursor pagination boundary (take+1/nextCursor, id cursor +
  createdAt-desc order), and the full-shape round-trip. Endpoint boot test: billing:read grant → 200; no-grant
  → 403; unresolved/JWT-less → 401; flag-off → 404 (dark).
- Regression corpus: tenant isolation (getInvoice cross-org NOT_FOUND), cursor pagination, honest full-shape.

## Ledger + flags

`efcoreReadOnly += invoices, subscriptions`. `PlatformOptions.BillingReadEnabled` — **UPDATE 2026-07-31:
confirmed `true` in prod** (was default `false`; Program.cs maps the endpoints only when on, or via
`GetDocument.Insider` build-time OpenAPI). Cutover DONE: TS `listInvoices`/`getInvoice` deleted.

## Deferred

Slice 3b (getUsage/getCurrentPlan/getBillingConfig + `planLimits`/`entitledPlan` kernel + counts — see the
separate `NEXT_PUBLIC_BILLING_USAGE_VIA_CSHARP` flag, also since flipped and TS-deleted); billing
writes (Stripe checkout/portal/cancel — external boundary, still dark, Federico has declined the live-Stripe
cutover); the eventual ownership flip (billing OWNS its tables → a clean flip candidate, unlike the shared
`preemployment_validations` — TS-code deletion is NOT the same as an ownership flip, see
`table-ownership.md`).

## Adjudicated review-gate fixes (2026-07-16)

A review-gate batch tightened the drop-in parity of this surface:

- **No `schemaVersion` on the billing wire (parity break fixed).** The live TS `listInvoices`/`getInvoice`
  return the RAW Prisma row (findMany/findFirstOrThrow, no `select`/mapper) — no `schemaVersion`. The field
  was dropped from the C# wire entirely (`InvoiceWireV1` base carries no such field; `SubscriptionV1` never
  did). The golden fixtures + TS/C# fixture generators now reproduce the ACTUAL raw-row shape and go RED if
  a `schemaVersion` (or any renamed/dropped field) reappears.
- **`subscription` omit-vs-include is a shape split, not a null toggle.** `listInvoices` (no include) has NO
  `subscription` key — modeled by `InvoiceListItemV1`, which has no such property. `getInvoice`
  (`include:{subscription:true}`) ALWAYS emits `subscription` — `InvoiceDetailV1.Subscription` is NOT
  `WhenWritingNull`, so an invoice with no subscription serializes `"subscription":null` (key present),
  never omitted. Shared invoice fields live once on the abstract `InvoiceWireV1`.
- **`nextCursor` is OMITTED when null.** TS returns `nextCursor: undefined` (no key) on the last page; the
  list envelope DTO uses `[JsonIgnore(WhenWritingNull)]` so the last page emits no `nextCursor` key (never
  `"nextCursor":null`).
- **Pagination order is now a SHARED cross-stack contract.** The C# port uses the unique total order
  `[createdAt desc, id asc]`. The live TS `listInvoices` used `orderBy:{createdAt:'desc'}` only — a latent
  Prisma tie bug (skip/duplicate rows on equal `createdAt`). The TS router was given the same `id asc`
  tiebreak (`orderBy: [{ createdAt:'desc' }, { id:'asc' }]`), removing the latent flaky-pagination bug AND
  pinning both stacks to one keyset.
- **Input-validation error-code parity.** The `cursor` and the `getInvoice` `id` are validated with strict
  canonical-UUID parsing (`Guid.TryParseExact(…, "D")`) → **400** on non-canonical forms (braced/hyphenless)
  that Zod `z.string().uuid()` rejects. The `getInvoice` id is taken as a string (no `:guid` route
  constraint) so a non-UUID id → **400** (matching Zod), never a route-miss 404.
- **NpgsqlDataSource isolation.** The billing `EnableUnmappedTypes` data source is registered as a WRAPPER
  (`BillingReadDataSourceHolder`), NOT the open `NpgsqlDataSource` service type — EFCore.PG's
  `UseNpgsql(connectionString)` auto-resolves an app-registered `NpgsqlDataSource`, which would otherwise
  bleed `EnableUnmappedTypes` into every other (string-based) context (Identity/Anchor/Hris/ExternalAssessment/
  ExternalValidation/Audit). The wrapper keeps it exclusive to `BillingReadDbContext`.

### DELIBERATE deviation (cutover-flag for Federico) — getInvoice not-found

The live TS `getInvoice` uses `findFirstOrThrow`, which throws Prisma **P2025** on a missing/cross-org id.
`trpc.ts` has NO P2025→`NOT_FOUND` mapping (its `errorFormatter` returns the shape unchanged, and no global
handler maps it) — so the uncaught P2025 surfaces as tRPC **INTERNAL_SERVER_ERROR (HTTP 500)**, an error
LEAK, not a clean NOT_FOUND. The C# port intentionally returns a clean **404 NOT_FOUND** for a missing/
cross-org invoice (IDOR-safe + correct — a missing/cross-org id is not-found, never a 500 leak). This is a
deliberate port IMPROVEMENT (mirrors the Slice-1 completed-only leak-fix), NOT a faithful reproduction —
**flag at cutover.**

## Local gate

From `services/Tims.Platform`: build `-c Release` 0-warn · `dotnet format` · unit + integration (Docker).
Root: `node scripts/table-ownership.mjs`. TS (shared fixtures): `prisma generate` → `@tims/api tsc` →
`apps/web tsc` → `vitest run`.
