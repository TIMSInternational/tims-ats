# billing-invoices(read) — FE consumer

**Date**: 2026-07-28 · **Status**: design approved, awaiting implementation plan · **Builds on**: S4 backend verification (billing-invoices/read parity-verified 5/5 against live prod), S5 investigation (this domain confirmed as the only genuinely consumer-less surface — see `project-csharp-s5-investigation-2026-07-28` memory).

## Problem

`packages/api/src/routers/billing.ts`'s `listInvoices`/`getInvoice` procedures (and their parity-verified C# port) have zero FE consumers, TS or C# — confirmed via triple-check (no `_CSHARP` flag references invoices in `billing.ts`, zero grep hits for `trpc.billing.listInvoices`/`getInvoice` in `apps/web`, `docs/REMAINING-WORK.md` independently documents the gap). The only existing invoice UI (`app/(admin)/platform/invoices/page.tsx`) is a platform-owner admin view of an unrelated router (`trpc.platform.listInvoices`) — not to be conflated. Federico decided (2026-07-28) to build a real consumer rather than leave this as an intentional gap.

## Scope

Tenant-scoped invoice history, surfaced on the org's own Settings > Billing page. Read-only — no create/edit invoice UI (invoices are Stripe-driven, immutable from the tenant's perspective).

## Architecture

New hooks in `apps/web/lib/platform-api/billing.ts`, following the exact dark-launch pattern every other domain in this codebase uses (mirrors `team-intel.ts`/`compensation.ts`):

- `useBillingInvoices()` — cursor-paginated, `useInfiniteQuery`-shaped (mirrors `trpc.notification.list.useInfiniteQuery` already used on the notifications page). Gate: `isPlatformApiEnabled() && NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP === 'true'`.
  - `false` (default) → `trpc.billing.listInvoices.useInfiniteQuery({ take: 20 }, { getNextPageParam: (last) => last.nextCursor })`.
  - `true` → C# `GET /billing/invoices?take=&cursor=`. **Uses `platformGetRaw`, not `platformGet`** — verified in `schema.d.ts` that this endpoint's 200 response has `content?: never` (no `.Produces<T>()` annotation), same gap the self-serve mutations hit. Hand-map the raw JSON to the tRPC output shape (`{ items: Invoice[], nextCursor?: string }`), reconstructing `Date` objects for `invoiceDate`/`dueDate`/`paidAt`/`periodStart`/`periodEnd`/`createdAt` (same ISO-string-to-Date rule every other hook in this file follows) and narrowing `status` to the `InvoiceStatus` enum union.
- `useBillingInvoice(id: string)` — single-invoice fetch for the drawer. Same gate.
  - `false` → `trpc.billing.getInvoice.useQuery({ id })`.
  - `true` → C# `GET /billing/invoices/{id}`, **typed** via `platformGet` (schema.d.ts confirms `InvoiceDetailV1` IS annotated) with `pathParams: { id }`.

`NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP` ships **dark** (unset in Vercel) — flipping it live is a separate follow-up decision after this merges and is verified, same as every other flag this session.

## UI

- New file `apps/web/app/(admin)/settings/billing/billing-invoices.tsx` (mirrors the existing `billing-plans.tsx` split — keeps `page.tsx` from growing past the file-size guideline). Rendered as a new card in `settings/billing/page.tsx`, appended after the existing `<BillingPlans />` section. No new tab/nav component — matches the page's existing stacked-card layout.
- List: shared `DataTable` component (built-in loading/skeleton), columns Date / Amount+currency / Status (shared `StatusBadge`, map keyed off `InvoiceStatus`: draft/pending/paid/void). No built-in offset pagination (cursor API has no total count) — a "Load more" button below the table, exact pattern from `apps/web/app/(admin)/platform/notifications/page.tsx:176-182`.
- Row click opens the shared `Drawer` with the full `InvoiceDetailV1`: amount/subtotal/tax breakdown, invoice/due/paid/period dates, PO number, notes/memo when non-null, and a "Download" link (`invoiceUrl`) opening in a new tab when present.
- Empty state via shared `EmptyState`. Errors via shared `ErrorState` with retry — matches every other section on this page (`config.isError`/`plan.isError`/`usage.isError` already follow this exact pattern in `page.tsx`).

## i18n

New keys under `billing.*` in both `apps/web/lib/i18n/en.json` and `es.json`: `invoicesTitle`, `invoicesEmpty`, `invoicesEmptyDesc`, `invoiceColDate`, `invoiceColAmount`, `invoiceColStatus`, `invoiceStatusDraft`/`Pending`/`Paid`/`Void`, `loadMoreInvoices`/`loadingMoreInvoices`, and drawer field labels (`invoiceSubtotal`, `invoiceTax`, `invoicePoNumber`, `invoiceNotes`, `invoicePeriod`, `invoiceDownload`, `invoiceNumber`).

## Testing

No backend changes — `billing.ts` router/service/repository are untouched (already parity-verified 5/5 live). This is FE-only:

- Vitest smoke test for the two new hooks' dark/live branching (mirrors existing hook tests for `team-intel.ts`/`compensation.ts` — assert the tRPC path is used when the flag is unset, and that the C# path maps the raw JSON to the correct shape when it's set).
- `tsc --noEmit` on `@tims/web` (no `@tims/api` changes, so no API-side type check needed).
- Manual smoke: log in as a tenant user, confirm the Invoices card renders (empty state if the org has zero invoices — likely true for most test orgs), confirm no console errors, confirm the flag stays dark by default (no behavior change for existing users until Federico explicitly flips it later).

## Out of scope (explicitly)

- Flipping `NEXT_PUBLIC_BILLING_INVOICES_VIA_CSHARP` to `true` in Vercel — separate decision, after this merges.
- Any write/create/edit invoice capability — the domain is read-only by design (Stripe is the source of truth for invoice creation, via the existing webhook).
- Changes to the unrelated platform-owner admin invoices page (`app/(admin)/platform/invoices/`).
