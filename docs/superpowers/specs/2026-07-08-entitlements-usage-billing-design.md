# Company Entitlements — Slice 2b: Usage Metering + Invoicing

> Status: approved design | Date: 2026-07-08 | Depends on: Slice 1 (resolver, prod) + Slice 2a (admin console, prod `632ab5c`)

## Goal

Turn metered per-module usage into billable **draft** invoice line items, priced from the
entitlement layer (the 2a admin console's per-company unit price). A platform owner picks an
org + billing period, previews the per-module usage/charges, and generates a draft invoice to
review before sending.

## Decisions (locked in brainstorming)

1. **Scope:** meter `ai_voice_interview` (minutes) + `ai_screening` (screenings). `video_interviews`
   and `proctoring` have NO usage source today (no model/agent) → explicitly deferred.
2. **Price source of truth = the entitlement layer.** Billing uses `OrgEntitlement.effectiveUnitPrice`
   (`unitPrice` override ?? `Module.defaultUnitPrice`) — the exact value the 2a console edits. Billing
   NO LONGER reads `AiAgentOrgConfig.billableUsdPerMinute` (left in place as legacy/internal-cost; not
   the billing source). NET CHANGE: INVU voice now bills at its entitlement $0.15/min (was $0 because
   its `AiAgentOrgConfig` is unseeded).
3. **Flow:** preview → confirm → **draft** invoice. No cron.
4. **Overage model:** `limit` = included allowance. `billableQty = (limit == null) ? qty : max(0, qty − limit)`.
   So `ai_screening` (limit 5000) bills only screenings beyond 5000; `ai_voice_interview` (no limit)
   bills every minute. (This billing rule is 2b's own; it deliberately differs from `checkLimit`'s
   `null = unlimited` gating meaning.)

## Architecture

Clean layering (router → service → repository), extending the Slice-1/2a entitlement stack and
generalizing the existing `ai-interview-billing.ts` + `getAiInterviewBillingPreview` precedent.

### 1. Module → usage mapping (code config, in the metering service)

A small explicit descriptor per metered-with-source module:

```
METERED_MODULE_USAGE = {
  ai_voice_interview: { agentSlugs: ['ai-voice-interview'], unit: 'minutes',
                        aggregate: 'durationMinutes' },   // Σ(latencyMs)/60000
  ai_screening:       { agentSlugs: ['candidate-screener'], unit: 'screenings',
                        aggregate: 'count' },             // 1 screening = 1 candidate-screener call
}
```

- `ai_voice_interview` minutes: the ElevenLabs webhook stores duration in `AiAgentUsageLog.latencyMs`
  (`= durationSeconds * 1000`). Minutes = `Σ(latencyMs) / 60000`.
- `ai_screening` screenings: one screening = one `candidate-screener` invocation. `cv-parser` (CV
  parsing) is intentionally EXCLUDED to avoid double-counting.
- Modules absent from this map (video_interviews, proctoring, non-metered modules) produce no usage
  and no line.

### 2. Metering aggregator (repository + service)

- Repository `getModuleUsageQuantity(orgId, agentSlugs, aggregate, periodStart, periodEnd): Promise<number>`
  — `aiAgentUsageLog` query filtered by `agent: { slug: { in: agentSlugs } }` + `organizationId` +
  `createdAt: { gte: periodStart, lte: periodEnd }`. For `'count'` → `db.aiAgentUsageLog.count(...)`;
  for `'durationMinutes'` → `aggregate({ _sum: { latencyMs } })` then `/60000`. Explicit `select`/
  minimal fields.
- Service `getModuleUsage(orgId, moduleCode, periodStart, periodEnd): Promise<{ quantity: number; unit: string } | null>`
  — looks up the module in `METERED_MODULE_USAGE`; returns `null` for unmapped modules; else calls the
  repository with the descriptor.

### 3. Billing computation (service, reuses `ceilUsd` from `ai-interview-billing.ts`)

`computeUsageBilling(orgId, periodStart, periodEnd): Promise<UsageBillingPreview>` where
`UsageBillingPreview = { lines: UsageLine[]; subtotalUsd: number }` and
`UsageLine = { moduleCode; name; unit; quantity; includedQty; billableQty; unitPrice; amountUsd }`:

1. Load the org's enabled entitlements via the 2a admin merge (`getOrgEntitlementsAdmin(orgId)`) — gives
   per module: `enabled`, `metered`, `limit`, `effectiveUnitPrice`, `name`, `unit`.
2. For each module that is `enabled && metered && METERED_MODULE_USAGE[moduleCode]`:
   - `qty = getModuleUsage(...).quantity`
   - `includedQty = limit ?? 0`; `billableQty = (limit == null) ? qty : Math.max(0, qty − limit)`
   - `unitPrice = effectiveUnitPrice ?? 0`
   - `amountUsd = ceilUsd(billableQty * unitPrice)`
   - push a `UsageLine` (include even zero-amount rows in the PREVIEW for transparency).
3. `subtotalUsd = Σ amountUsd`.

### 4. Invoice line shaping (service)

`buildUsageInvoiceLines(preview): InvoiceLine[]` — for each `UsageLine` with `amountUsd > 0`, emit
`{ description: "<name>: <billableQty> <unit> × $<unitPrice> (<includedQty> incl.)", quantity: 1, unitPrice: amountUsd }`.
Quantity is always `1` with the dollar amount in `unitPrice` (matches `buildAiInterviewInvoiceLines` +
`createInvoice`'s positive-int quantity rule). `InvoiceLine = { description; quantity; unitPrice }`.

### 5. Draft-invoice creation (billing service)

`createUsageInvoice(orgId, periodStart, periodEnd, lines): Promise<{ invoiceId; invoiceNumber }>` in a
small `usage-billing.service.ts` (do NOT bloat the layering-violating `invoices.ts` router). Creates an
`Invoice` with `status: 'draft'`, `periodStart`, `periodEnd`, `subtotal`, `amount` (no tax by default),
`currency: 'USD'`, nested `lineItems` (with computed `total = quantity*unitPrice`, `sortOrder`). No email
send. Idempotency: if a `draft` invoice already exists for the same `(organizationId, periodStart,
periodEnd)`, the router returns a conflict rather than creating a duplicate (see §6).

### 6. tRPC (new `platform/usage-billing.ts` router, all `platformProcedure`, mounted in `platform/index.ts`)

- `getUsageBillingPreview({ orgId: uuid, periodStart?: Date, periodEnd?: Date })` → `UsageBillingPreview`.
  Defaults: `periodStart = firstOfCurrentMonth`, `periodEnd = now`. IDOR `assertOrg`.
- `generateUsageInvoice({ orgId: uuid, periodStart: Date, periodEnd: Date })` → `{ invoiceId; invoiceNumber }`.
  IDOR `assertOrg`; **re-derives** the preview server-side (never trusts client amounts); if the preview
  has zero billable lines → `BAD_REQUEST` (nothing to bill); if a draft for the same org+period exists →
  `CONFLICT`; else `createUsageInvoice`. Best-effort `auditLog` (`entitlement_usage_invoiced`).

### 7. UI (org-detail billing section)

Extend `apps/web/app/(admin)/platform/organizations/[id]/sections/billing-section.tsx` with a "Usage
billing" panel: a month/period picker (default current month) → `getUsageBillingPreview` table (module,
usage qty+unit, included, billable, unit price, amount, subtotal) → "Generate draft invoice" button
(confirm-gated) that calls `generateUsageInvoice`, then `utils.platform.getOrgInvoices.invalidate()` +
toast + link to the draft. Loading/error/empty states. New `usageBilling` i18n namespace in BOTH
`en.json` + `es.json` (identical key sets, no hardcoded strings).

## Testing (mock-based — CI has no Postgres)

- **Aggregator**: `durationMinutes` (ΣlatencyMs/60000) and `count` math; period + slug filter shape.
- **Billing computation**: overage (`ai_screening` qty 6000, limit 5000 → 1000 billable) vs all-usage
  (`ai_voice_interview` no limit → all minutes); `ceilUsd` rounding; zero usage → no invoice line;
  disabled/non-metered/unmapped modules skipped; uses `effectiveUnitPrice` (NOT `AiAgentOrgConfig`).
- **Line shaping**: `amount > 0` filter; quantity always 1; description format.
- **Router**: `platformProcedure` FORBIDDEN for non-owner; IDOR NOT_FOUND; `generateUsageInvoice`
  re-derives server-side; zero-billable → BAD_REQUEST; duplicate draft → CONFLICT.
- **Draft creation**: status `draft`, `periodStart/End` set, line totals computed.
- **i18n**: `usageBilling` keys identical en/es.

## Out of scope (2b)

- `video_interviews` / `proctoring` metering (no usage source — need those features first).
- Monthly cron auto-generation (manual preview→confirm first; cron once proven).
- CRC / multi-currency (stays USD; `Organization` has no currency field; INVU has no `Company` row).
- Wiring `checkLimit` hard-enforcement / gating on limits (billing only; never block).
- PDF invoices (HTML email + CSV only exist today).
- Retiring `AiAgentOrgConfig.billableUsdPerMinute` / the webhook's stored `billableUsd` — left as legacy;
  a follow-up cleanup, not 2b.

## Build order (for the plan)

1. Module→usage mapping + repository aggregator (`getModuleUsageQuantity`) + service `getModuleUsage` + tests.
2. Billing computation (`computeUsageBilling`) + line shaping (`buildUsageInvoiceLines`, reuse `ceilUsd`) + tests.
3. Draft-invoice creation service (`createUsageInvoice`, draft + period) + tests.
4. Platform router (`usage-billing.ts`: preview + generate, IDOR, re-derive, conflict) + mount + tests.
5. UI usage-billing panel in `billing-section.tsx` + `usageBilling` i18n.
6. Whole-branch review (opus) + Codex adversarial + merge-gate → PR → squash-merge. No prod DDL (no schema change).
