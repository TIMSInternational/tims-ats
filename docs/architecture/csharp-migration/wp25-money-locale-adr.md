# ADR: Money, salary terms, tenant locale profile and FX (WP-25)

- **Status:** Proposed. It needs owner approval before any WP-25 implementation PR (PR-2 onwards) merges.
- **Date:** 2026-10-29
- **Base:** `origin/main` at `30018323`. Every `file:line` below was checked at that commit.
- **Scope:** decisions D-25-1 to D-25-10 for the WP-25 money and locale foundation. This document changes no code.
  The implementation PRs cite the decision they implement.

## 1. Context

Money in TIMS ATS is a binary `double` with a free-form currency string. Foreign-exchange conversion happens live, when a
report is read. Locale and timezone come from Colombian defaults. Each of these is a defect for a tenant that does not
work in Colombia, and the one most visible is a Costa Rican tenant (CRC, `es-CR`, `America/Costa_Rica`).

What the code does today, at `30018323`:

| Fact                                                                                                                                                                                | Evidence                                                                                                                                  |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| C# provisioning hard-codes the company country `"CO"`. `CompanyWriteEntity` maps no currency, timezone or language, so the database defaults (USD, `America/Bogota`, `es`) apply.   | `services/Tims.Platform/src/Tims.Infrastructure/OrgProvisioning/OrgProvisioningWriter.cs:49`; `OrgProvisioningEntities.cs:18`             |
| `organizations` has no typed locale columns. `companies.currency/timezone/language` default to `USD`, `America/Bogota` and `es`.                                                    | `packages/db/prisma/schema/organization.prisma:71-73`                                                                                     |
| The FX provider uses the latest pin of any age. `FxPin(double Rate, DateOnly? AsOf, bool Identity)` carries no source.                                                              | `Tims.Infrastructure/Fx/FxRateProvider.cs:58`; `Tims.Application/Fx/FxModels.cs:14`                                                       |
| `FxMoneyConverter` normalises an invalid currency code to USD instead of refusing it.                                                                                               | `Tims.Application/Fx/FxMoneyConverter.cs:22-23`                                                                                           |
| `fx_rates` allows one row per `(base_currency, quote_currency, as_of)`, and the refresh upsert overwrites that row. The refresh writes `source = "exchangerate-api"` as a constant. | `Tims.Infrastructure/Fx/FxRateDbContext.cs:36-38`; `Tims.Infrastructure/Fx/FxRateWriteRepository.cs:94-97`; `RefreshFxRatesUseCase.cs:19` |
| A second FX provider (Frankfurter) is still called live from TypeScript.                                                                                                            | `packages/api/src/lib/currency.ts:10`                                                                                                     |
| Compensation and DEI convert into the currency of the oldest company, falling back to USD.                                                                                          | `Tims.Infrastructure/Compensation/CompensationReadRepository.cs:418,445,575`                                                              |
| The DEI and compensation tables format every salary as `$…K` with the `es-CO` locale.                                                                                               | `apps/web/app/(admin)/engagement/dei/dei-left-column.tsx:25`; `apps/web/app/(admin)/compensation/comp-right-column.tsx:12`                |
| `Offer.salary` is an annual `Float` with `currency` defaulting to `USD`. There is no period, payments-per-year or gross/net field.                                                  | `packages/db/prisma/schema/offer.prisma:8-9`                                                                                              |
| The invoice wizard formats every currency with 2 decimals, whatever its ISO 4217 exponent.                                                                                          | `apps/web/app/(admin)/platform/invoices/invoice-wizard.helpers.ts:3`                                                                      |
| The money kernels used by the FX reads round half-up with an `EPSILON` bias. They are golden-pinned on both stacks. This ADR does not change them (see D-25-6).                     | `packages/shared/src/compensation.ts:139`; `Tims.Domain/Compensation/CompensationKernels.cs:73`; `contracts/compensation-fixtures/*.json` |

Paths that start with `Tims.` are under `services/Tims.Platform/src/`.

## 2. Decision summary

| id      | decision                                                                                                                                      |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| D-25-1  | Store money as `bigint` minor units at the ISO 4217 exponent, next to a `char(3)` currency.                                                   |
| D-25-2  | Costa Rica defaults to 13 salary payments a year (aguinaldo). The value is editable per offer.                                                |
| D-25-3  | ExchangeRate-API stays the FX provider of record. The fallback starts as `none`.                                                              |
| D-25-3b | Reports fail soft on missing FX. Issuing an invoice fails closed. Recording a payment never fails on FX.                                      |
| D-25-4  | The locale profile is four typed `organizations` columns. The billing currency is **not** one of them: it stays on the subscription contract. |
| D-25-5  | The platform owner edits all four profile fields. Tenant admins edit timezone and locale only.                                                |
| D-25-6  | Round half-even at the ISO exponent wherever a stored amount is produced. The legacy read kernels are the one documented exception.           |
| D-25-7  | Tenant reports convert into the tenant base currency, or show per-currency totals when none is set. Platform reports use USD.                 |
| D-25-8  | An invoice is "issued" when it leaves draft. The FX rate is frozen then, and again when a payment is recorded.                                |
| D-25-9  | Invoice documents show the ISO exponent. Summaries follow the display rule.                                                                   |
| D-25-10 | Legacy offers without salary terms are left as they are and labelled as older than the model. There is no backfill.                           |

## 3. The target model

### 3.1 `Money`

`Money` is `{ amountMinor: long, currency: ISO-4217 }`.

- **C#.** A value object in `Tims.Domain/Money/` (planned). It has no fallback to USD: an unknown code is an error.
- **TypeScript.** A zod twin in `packages/shared/src/money/` (planned).
- **One contract.** Both stacks assert the same golden fixtures in `contracts/money-fixtures/` (planned): exponents,
  conversion to minor units, invoice totals, salary terms and formatting.
- **Exponents.** ISO 4217: 0 for currencies such as JPY, KRW and CLP; 3 for BHD, KWD, OMR and similar; 2 otherwise.
  **CRC and COP have exponent 2.** The set of known codes comes from the existing `CurrencyCodes.IsCurrencyCode`
  (`Tims.Domain/Compensation/CurrencyCodes.cs:46`), so there is one list.
- **Range.** `|amountMinor| <= 9 007 199 254 740 991`, the largest safe JavaScript integer, so the wire value survives
  a JSON number.
- **Arithmetic.** Adding or subtracting across currencies is an error. Multiplying by a factor rounds once.

### 3.2 `SalaryTerms`

`SalaryTerms` records a salary the way it was entered:

- `amount`: a `Money`, as typed by the user;
- `period`: `monthly` or `yearly`;
- `paymentsPerYear`: 12, 13 or 14;
- `basis`: `gross` or `net`;
- `band`: a snapshot of the vacancy salary band when the offer was created, built on the server and never supplied by
  the client.

The annual equivalent is `monthly × paymentsPerYear`. The legacy `offers.salary` column keeps its meaning,
`12 × monthly`, and is dual-written so that existing readers and KPIs stay stable until the C# offer port.

### 3.3 Tenant locale profile

The profile is four nullable columns on `organizations`: `country` (ISO 3166-1 alpha-2), `locale` (BCP 47, such as
`es-CR`), `timezone` (IANA) and `base_currency` (ISO 4217). C# owns their writes.

- Values are set at provisioning from a country preset. For example, `CR` gives `es-CR`, `America/Costa_Rica` and
  `CRC`.
- The read order is: typed columns, then the legacy `settings` JSON, then the organization's sole active company.
- A write also updates the default company when the organization has exactly one active company, in the same
  transaction.
- A backfill copies values only from a sole active company, and only when each value passes the same pattern as its
  `CHECK` constraint.

### 3.4 One FX service

C# is the only FX source. The TypeScript Frankfurter path is deleted once its C# replacements are live and verified.

- **Age policy.** A pin older than `StaleAfterDays` (default 3) is used, but marked stale. A pin older than
  `MaxPinAgeDays` (default 7) is not used at all.
- **Provenance.** Every conversion returns `{ rate, rateDate, source, stale }`. The source comes from a closed set.
- **Fallback.** A composite gateway can add a fallback provider. The primary provider's pin always wins for a given
  day. A fallback write never overwrites a primary row, and a primary write replaces a fallback row. So a reader sees
  exactly one row per day.
- **Point-in-time quotes.** A quote can ask for the latest pin on or before a date. Settlement snapshots and
  backfills use this.

### 3.5 Reporting disclosure

Every converted figure says that it was converted, into which currency, at which rate date and from which source.
The Spanish copy is "Convertido a CRC con tasas al {fecha} ({fuente})". A stale rate is flagged. With no usable rate,
the report shows per-currency totals instead of a guessed conversion.

## 4. Decisions

### D-25-1 Storage in minor units

**Decision.** New money columns are `bigint *_minor` at the ISO exponent, next to a `char(3)` currency. CRC is stored
with 2 decimal places, even though summaries display it with none (D-25-9).

**Why.** Integer arithmetic is exact. A minor-unit integer within the JS safe range survives the wire as a number.

**Alternatives.**

- `numeric(19,4)`. Rejected: it keeps decimal places most currencies never use, and the TypeScript side would still
  need a decimal library or a string format to avoid floats.
- Keep `double`. Rejected: it is the defect.

### D-25-2 Aguinaldo default for Costa Rica

**Decision.** `paymentsPerYear` defaults to 13 when the tenant country is `CR`, and 12 elsewhere. The recruiter can
change it per offer. The annual equivalent is labelled "incluye aguinaldo".

**Why.** The aguinaldo, a thirteenth monthly payment, is mandatory for employees in Costa Rica. An annual figure of
`12 × monthly` understates it.

**Open item.** The public-sector _salario escolar_ is a deferred part of the monthly salary, not an extra payment, so
it must not be added to `paymentsPerYear`. Whether the tenant wants it disclosed is a question for the tenant's HR
team. If yes, it is a note on the offer, tracked as a follow-up.

### D-25-3 FX provider of record and fallback

**Decision.** ExchangeRate-API stays primary, because it is already pinned, fresh and documents CRC and COP (see
[the provider swap record](fx-provider-swap-2026-07-28.md)). The fallback is `none` at first. The code supports two
optional fallbacks: the Banco Central de Costa Rica reference rate (recommended, needs a registered token) and
Frankfurter v2 (keyless).

**Why.** It avoids adding a third provider before the subprocessor register is updated. A fallback provider receives
currency codes only, never tenant data, but it is still registered before use.

### D-25-3b Fail modes

**Decision.**

- **Reports fail soft.** With no usable rate they show per-currency totals and say so.
- **Issuing an invoice fails closed.** Leaving draft without a rate returns `409 fx_unavailable`. The quote runs before
  any email is sent, so a refusal never follows a delivered email.
- **Recording a payment never fails on FX.** The payment is stored, the settlement snapshot stays empty, and the KPI
  discloses the count of payments without one.

**Why.** A frozen issue rate must be a real rate. An email must never precede a refusal. Money received must always
be recordable.

**Note on live behaviour.** The age policy is not behind a feature flag. The compensation and DEI FX reads already run
on C#, so the age policy changes them on deploy. The FX PR therefore needs a read-only freshness check before merge
and documents the configuration rollback (raise `Fx__MaxPinAgeDays`).

### D-25-4 Where the profile lives, and the billing currency

**Decision.**

- Four typed `organizations` columns are canonical for locale and reporting.
- The legacy `settings` JSON is read only as a fallback, and C# stops reading `settings.currency` once a typed value is
  set.
- **The billing currency is not an organization column.** Its single source is the subscription's contract currency,
  limited to the billable currencies USD and CRC. This decision is recorded against the platform-billing work package
  (WP-22), which already defines that field as the one source of truth. WP-25 adds no competing field.
- The base currency is validated only as a known ISO 4217 code, not against the billable list, because it is a
  reporting currency. A Colombian tenant reports in COP, for example.

**Why.** Two fields for one fact would let one of them drift. Reporting needs an organization-level currency, and
billing needs the contract.

**Alternative rejected.** An `organizations.billing_currency` column, from the first draft of the plan. It would have
competed with the contract currency that the invoice flow actually uses.

### D-25-5 Who edits the profile

**Decision.** The platform owner edits all four fields. Tenant users with `organization:update` edit timezone and
locale only. They see country and base currency read-only, labelled "Lo configura soporte TIMS". A tenant request
that sets either field gets `403 field_platform_managed`.

**Deviation from the audit recommendations.** Two audit findings recommended that the tenant edit the base currency
(one of them, the country as well). This decision deviates from that on purpose. The defect those findings describe, wrong values with no way to fix
them, is closed. Only the editor role differs. A re-audit should grade the defect, not the role.

**Why.** The base currency changes how every compensation and DEI figure is converted, and the country drives the
aguinaldo default. Keeping both support-managed stops a tenant from silently changing the denomination of its reports.

### D-25-6 Rounding

**Decision.** Round **half-even** at the ISO exponent wherever a stored amount is produced: `Money`, the TypeScript
`toMinor`, the invoice totals kernel and the DDL backfills.

- Invoice line totals are exact (`quantity × unitPriceMinor`). Tax is rounded once.
- This is recorded against WP-22. It is the rule WP-22 already pins for invoice totals, so both work packages share
  one rule and none of WP-22's tests change. The shared invoice-totals fixture copies WP-22's case.
- PostgreSQL `round()` on `numeric` rounds half away from zero, so the backfills use an explicit half-even expression.

**The one exception.** The existing `roundMoney` / `CompensationKernels.RoundMoney` (half-up with an `EPSILON` bias)
stays as it is. Its golden fixtures (`contracts/compensation-fixtures/convert-money.json`, `sum-money.json`) are the
contract for the live FX read surfaces. It is a read-side display kernel and never produces a stored amount.

**Why.** One rule across both work packages. Half-even has no upward bias when many rounded values are summed.

**Alternative rejected.** Half-up everywhere, to match the legacy kernel. It would contradict WP-22's pinned totals.

### D-25-7 Reporting base currency

**Decision.** Tenant views convert into the tenant `base_currency`. When none is set, they show per-currency totals
and say that the base currency is not configured. Platform views use USD.

**Why.** Converting into "the currency of the oldest company" (today's rule) is arbitrary and, for a tenant with no
company currency, silently USD.

### D-25-8 When an invoice is issued

**Decision.**

- Creating an invoice always creates a draft, with no FX snapshot.
- The issue snapshot (`fx_rate`, `fx_rate_date`, `fx_source`, `amount_base_minor`) is frozen when the invoice leaves
  draft, through an accepted send or a manual issue. A resend or reminder does not re-quote.
- Recording a payment takes a settlement snapshot at the operator-entered payment date. Reverting the payment clears
  it.
- Voiding keeps the issue snapshot as history. KPIs exclude void invoices.
- The stored rate is invoice currency to USD.

**Why.** It matches the invoice lifecycle defined by WP-22. Historic revenue must not change when a new rate arrives.

### D-25-9 Invoice display precision

**Decision.** Invoice documents (wizard lines, invoice detail, email, CSV export) show the ISO exponent: `₡1 500 000,00`
for CRC, 0 decimals for JPY, 3 for BHD. Summaries (KPI cards, organization outstanding) follow the general display
rule, in which CRC and COP show no decimals.

**Why.** A 13% tax produces céntimos, so a document that hid them would not add up. Summaries are easier to read
without them.

### D-25-10 Legacy offers

**Decision.** Offers created before `SalaryTerms` are left as they are. They have no period, payments or basis, and
they are displayed from the legacy annual figure with the label "anual (12 pagos)" and a mark that they predate the
model. There is no backfill.

**Why.** A backfill would invent a period and a basis that nobody entered.

## 5. Migration phases

Every phase is additive until the last one. Each step is behind a flag or a dual-write, so a revert is safe.

### Phase A: foundations (no behaviour change for users)

- The `Money`, `SalaryTerms` and locale-default value objects, with fixtures shared by both stacks.
- The FX service with its age policy, provenance and fallback gateway, and two new read endpoints behind a flag. The
  age policy itself is live on deploy (D-25-3b).
- A disclosure on the invoice KPI cards, using the provenance the current payload already returns.

### Phase B: typed columns, dual-write and snapshots

- Reviewed, additive DDL under `packages/db/prisma/manual/`, applied by the owner **before** each PR merges, following
  [DDL governance](../ddl-governance.md). Tables whose ownership has moved to C# get their flip DDL regenerated from
  the recaptured baseline, never edited by hand (see [the flip-DDL README](../../../services/Tims.Platform/db/flip-ddl/README.md)
  and [table ownership](../table-ownership.md)).
- The locale profile columns, their editors and provisioning presets.
- `SalaryTerms` on offers and typed salary columns on vacancies, dual-written next to the legacy `Float` and JSON.
- Minor-unit columns on compensation tables, plus a pay period.
- Minor-unit columns and FX snapshots on invoices, written by the invoice transitions.
- Compensation and DEI read the tenant base currency and disclose their rates.

During this phase, readers stay on the legacy columns unless a PR says otherwise.

### Phase C: switch and retire

- Callers of the interim `formatMoney` move onto `Money`, `SalaryTerms` and the typed profile. Public pages (offer
  signing, careers) get the tenant locale from their own payloads.
- New C# reads for invoice KPIs, export and organization outstanding sum the frozen snapshots, with no FX call at read
  time.
- The TypeScript FX path is deleted after the C# dashboard and invoice reads have been live and verified for at least
  one billing cycle. This deletion is the one step that is hard to undo, so it ships last.
- Dropping the legacy `Float` columns happens in a later wave, after every reader has switched.

## 6. Consequences

- **Positive.** Exact stored amounts, one rounding rule, one FX source with an age limit, historic revenue that does not
  move, salary shown the way it was agreed, and a Costa Rican tenant that sees colones, its own timezone and its own
  number format.
- **Cost.** Five additive DDL changes, each needing an owner apply and a baseline recapture, strictly one at a time.
- **Temporary duplication.** Legacy `Float` columns and typed minor columns coexist during Phase B. `offers.salary`
  keeps meaning `12 × monthly` until the C# offer port.
- **Known divergence.** The TypeScript organization create and self-signup paths still provision Colombian defaults
  until they are ported. A separate work package turns company self-signup off by default, and the platform owner can correct any
  organization.
- **Not in scope.** AI usage cost columns have their own cost model in a separate work package. The consent legal basis
  is handled with the consent work.

## 7. Approval

The owner approves this ADR before WP-25 PR-2 merges. An override of any default above is recorded here, in the
decision it changes, before the PR that implements it is reviewed.
