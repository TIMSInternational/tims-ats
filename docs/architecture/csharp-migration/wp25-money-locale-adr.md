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

| id      | decision                                                                                                                                                                         |
| ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D-25-1  | Store money as `bigint` minor units at the ISO 4217 exponent, next to a `char(3)` currency.                                                                                      |
| D-25-2  | Costa Rica defaults to 13 salary payments a year (aguinaldo). The value is editable per offer.                                                                                   |
| D-25-3  | ExchangeRate-API stays the FX provider of record. The fallback starts as `none`.                                                                                                 |
| D-25-3b | Reports fail soft on missing FX. Issuing an invoice fails closed. Recording a payment never fails on FX.                                                                         |
| D-25-4  | The locale profile is four typed `organizations` columns. The billing currency is **not** one of them: it belongs on a subscription contract currency that WP-22 must add first. |
| D-25-5  | The platform owner edits all four profile fields. Tenant admins edit timezone and locale only.                                                                                   |
| D-25-6  | Round half-even at the ISO exponent wherever a stored amount is produced. The legacy read kernels are the one documented exception.                                              |
| D-25-7  | Tenant reports convert into the tenant base currency, or show per-currency totals when none is set. Platform reports use USD.                                                    |
| D-25-8  | An invoice is "issued" when it leaves draft. The FX rate is frozen then, and again when a payment is recorded.                                                                   |
| D-25-9  | Invoice documents show the ISO exponent. Summaries follow the display rule.                                                                                                      |
| D-25-10 | Legacy offers without salary terms are left as they are and labelled as older than the model. There is no backfill.                                                              |

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

Conversions between the two periods:

- A **yearly** amount is the full annual figure and **includes** every payment, aguinaldo too. The monthly
  equivalent is `yearly ÷ paymentsPerYear`, rounded once, half-even at the ISO exponent (D-25-6).
- A **monthly** amount is one regular payment. The annual equivalent is `monthly × paymentsPerYear`, which is exact.
- The legacy `offers.salary` column keeps its meaning, `12 × monthly`, where `monthly` is the entered amount or the
  derived monthly equivalent above. It is dual-written so that existing readers and KPIs stay stable until the C#
  offer port. It cannot hold a yearly figure that includes aguinaldo, or the basis, so terms that differ from the
  legacy shape are not creatable until the candidate-facing readers render `SalaryTerms` (Phase B gate, §5).

Worked example: a yearly CRC 13 000 000 with 13 payments gives a monthly equivalent of CRC 1 000 000 and a legacy
`salary` of CRC 12 000 000. The annual equivalent shown to the user stays CRC 13 000 000. The shared
`salary-terms` fixture (planned, `contracts/money-fixtures/`) pins both periods: this case, a monthly case with 13
payments, and a yearly case whose division needs rounding (CRC 15 000 001 with 12 payments gives a monthly minor
amount of 125000008).

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
  `MaxPinAgeDays` (default 7) is not used at all, once expiry is enabled (see D-25-3b for when).
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
change it per offer. The annual equivalent is labelled "incluye aguinaldo". This default takes effect only once
the candidate-facing readers render `SalaryTerms`; before that, offers are created with 12 payments (Phase B gate).

**Why.** The aguinaldo, a thirteenth monthly payment, is mandatory for employees in Costa Rica. An annual figure of
`12 × monthly` understates it.

**Open item.** The public-sector _salario escolar_ is a deferred part of the monthly salary, not an extra payment, so
it must not be added to `paymentsPerYear`. Whether the tenant wants it disclosed is a question for the tenant's HR
team. If yes, it is a note on the offer, tracked as a follow-up.

### D-25-3 FX provider of record and fallback

**Decision.** ExchangeRate-API stays primary, because it is already pinned, fresh and documents CRC and COP (see
[the provider swap record](fx-provider-swap-2026-07-28.md)). The fallback is `none` at first. Two fallbacks are
**planned, not implemented**: the Banco Central de Costa Rica reference rate (recommended, needs a registered token)
and Frankfurter v2 (keyless). Today `IFxRateGateway` is bound directly to `ExchangeRateApiGateway`
(`FxServiceCollectionExtensions.cs`), so there is no recovery path yet. Prerequisites before either is usable: a
fallback adapter and a composite gateway with tests, the provider added to the subprocessor register, and (for BCCR)
the token provisioned as a secret.

**Why.** It avoids adding a third provider before the subprocessor register is updated. A fallback provider receives
currency codes only, never tenant data, but it is still registered before use.

### D-25-3b Fail modes

**Decision.**

- **Reports fail soft.** With no usable rate they show per-currency totals and say so.
- **Per-currency totals are new cohorts, and are suppressed like any other.** On compensation and DEI surfaces each
  currency partition is a group: it is published only when it passes the same contributor floor and complement
  (differencing) checks that the surface already applies to its converted aggregate (for example
  `Tims.Application/Compensation/CompensationFxReadUseCase.cs:112-113`). A partition below the floor is not shown on
  its own, and the remaining partitions are suppressed too when publishing them would let the hidden one be derived
  from the converted or headcount totals. Fixtures cover a single employee paid in a currency nobody else uses, and a
  differencing case where the other partitions plus the total would reveal it. The fallback is not enabled on a
  surface until those fixtures pass.
- **Issuing an invoice fails closed.** Leaving draft without a rate returns `409 fx_unavailable`. The quote runs before
  any email is sent, so a refusal never follows a delivered email.
- **Recording a payment never fails on FX.** The payment is stored, the settlement snapshot stays empty, and the KPI
  discloses the count of payments without one.

**Why.** A frozen issue rate must be a real rate. An email must never precede a refusal. Money received must always
be recordable.

**Note on live behaviour.** The compensation and DEI FX reads already run on C#, and today they do not fail soft in
the way described above: when a conversion is unavailable, `CompensationFxReadUseCase` drops the FX-derived surface
entirely (for example, `GetBandDistributionAsync` returns an empty list,
`Tims.Application/Compensation/CompensationFxReadUseCase.cs:44-48`) instead of showing per-currency totals with an
explanation. Enforcing a maximum pin age before those consumers change would turn any later refresh outage into blank
reports, and a freshness check at merge time cannot prevent that. So the age policy ships in two steps:

- **Stale marking** ships with the FX service (Phase A). It only adds provenance; every pin that is used today is still
  used.
- **Expiry** (refusing a pin older than `MaxPinAgeDays`) ships disabled, and is enabled only after every consumer of the
  converter renders the per-currency fallback above. That is a Phase B exit criterion. Until then an expired pin is
  used and marked stale. Rolling back is a configuration change that disables expiry again.

### D-25-4 Where the profile lives, and the billing currency

**Decision.**

- Four typed `organizations` columns are canonical for locale and reporting.
- The legacy `settings` JSON is read only as a fallback, and C# stops reading `settings.currency` once a typed value is
  set.
- **The billing currency is not an organization column.** Its intended single source is a subscription contract
  currency, limited to the billable currencies USD and CRC. **That field does not exist yet**: `Subscription` has no
  currency (`packages/db/prisma/schema/billing.prisma:8`), and `createInvoice` stores the caller's currency as given
  (`packages/api/src/routers/platform/invoices.ts:123`). Adding it is a prerequisite owned by the platform-billing
  work package (WP-22). WP-25 adds no competing field.
- **Migration policy until then.** Existing invoices keep their stored `currency`; nothing is rewritten. Once the
  contract currency exists, a new invoice for an organization with a contract defaults to that currency, and a
  different currency needs an explicit, audited override. An invoice for an organization **without** a subscription
  (or with no contract currency set) has no default: the currency is required and must be billable. Nothing falls back
  to the organization's `base_currency`, which is a reporting currency.
- The base currency is validated only as a known ISO 4217 code, not against the billable list, because it is a
  reporting currency. A Colombian tenant reports in COP, for example.

**Why.** Two fields for one fact would let one of them drift. Reporting needs an organization-level currency, and
billing needs the contract.

**Alternative rejected.** An `organizations.billing_currency` column, from the first draft of the plan. It would have
competed with the planned contract currency, leaving two candidate sources for one fact.

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
- **This is a dependency, not an existing contract.** Today no invoice-totals fixture exists:
  `contracts/billing-fixtures/invoice-v1.json` pins wire serialization only, and `createInvoice` computes totals in
  unrounded floating point (`packages/api/src/routers/platform/invoices.ts:113`). The platform-billing work package
  (WP-22) plans the C# invoice-totals kernel with this same rule, so the two work packages share one rule from the
  start. Whichever lands first adds the shared fixture; the other reuses it unchanged.
- The fixture must pin the tie-breaking cases, not only a happy path: an exact case (3 × 250000 minor at 13% gives
  subtotal 750000, tax 97500, total 847500), a tax that lands on .5 minor at an even digit (rounds down), and one at
  an odd digit (rounds up). A half-up mutation must turn at least one case red.
- PostgreSQL `round()` on `numeric` rounds half away from zero, so the backfills use an explicit half-even expression.
- **Legacy invoices are not recomputed.** Today's inputs allow sub-minor unit prices
  (`invoices.schemas.ts`), so a stored line can be internally consistent in floats but not in minor units (quantity 2
  × 0.015 stored as total 0.03 becomes unit price 2 minor, while the stored total is 3 minor). For any invoice that
  left draft before the minor-unit columns existed, the **stored totals are authoritative**: the backfill converts each
  stored amount (unit price, line total, subtotal, tax, total) independently, half-even, and never derives one from
  another. Such rows carry a `legacyRounding` marker, are exempt from the `quantity × unitPriceMinor` invariant (which
  applies only to invoices created after the switch, whose inputs are validated to the ISO exponent), and the coverage
  report counts rows where the invariant would not hold. The backfill fixture includes this sub-minor case and asserts
  the stored total is preserved.

**The one exception.** The existing `roundMoney` / `CompensationKernels.RoundMoney` (half-up with an `EPSILON` bias)
stays as it is. Its golden fixtures (`contracts/compensation-fixtures/convert-money.json`, `sum-money.json`) are the
contract for the live FX read surfaces. It is a read-side display kernel and never produces a stored amount.

**Why.** One rule across both work packages. Half-even has no upward bias when many rounded values are summed.

**Alternative rejected.** Half-up everywhere, to match the legacy kernel. It would split the stored-amount rule from
the one planned for the invoice-totals kernel.

### D-25-7 Reporting base currency

**Decision.** Tenant views convert into the tenant `base_currency`. When none is set, they show per-currency totals
and say that the base currency is not configured. Platform views use USD.

**Why.** Converting into "the currency of the oldest company" (today's rule) is arbitrary and, for a tenant with no
company currency, silently USD.

### D-25-8 When an invoice is issued

**Decision.**

- Creating an invoice always creates a draft, with no FX snapshot.
- The issue snapshot (`fx_rate`, `fx_rate_date`, `fx_source`, `amount_base_minor`, plus a write identifier) is frozen
  when the invoice leaves draft, through an accepted send or a manual issue. A resend or reminder does not re-quote.
- Recording a payment takes a settlement snapshot, with its own write identifier, at the operator-entered payment
  date. Reverting the payment clears it. Every snapshot write generates a new identifier (§5, invoice snapshot
  backfill).
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

Every phase is additive until the last one. Each step is behind a flag or a dual-write, so a revert is safe,
with one boundary: **once an offer with non-legacy `SalaryTerms` exists** (yearly with aguinaldo, 13/14 payments, or
net), its legacy `salary` column no longer states the agreement (the worked example in §3.2 stores CRC 12 000 000 for
a CRC 13 000 000 agreement). From that point the candidate-facing readers that render `SalaryTerms` are not
revertible; a rollback may only disable _creating_ such terms. Enabling the Phase B flag therefore requires (1) the
upgraded readers (the full inventory below) shipped and declared a no-revert boundary in the enabling PR, and (2) a check that lists non-legacy
offers, so that any emergency revert of the readers is preceded by withdrawing or re-issuing those offers in legacy
shape.

### Phase A: foundations (no behaviour change for users)

- The `Money`, `SalaryTerms` and locale-default value objects, with fixtures shared by both stacks.
- The FX service with provenance, stale marking and the fallback gateway, and two new read endpoints behind a flag.
  Stale marking is live on deploy; pin expiry ships disabled (D-25-3b).
- A disclosure on the invoice KPI cards. **Prerequisite:** the current `getInvoiceKpis` payload cannot support §3.5. It
  returns one `converted` flag and one `ratesAsOf`, the older of the collected and outstanding dates, with no source and
  no stale flag (`packages/api/src/routers/platform/invoices.ts:64-71`). The disclosure PR first extends the payload with
  a rate date, source and stale flag for each converted figure. Because that payload is served by `packages/api`, the
  extension is either a minimal, labelled change under the narrow `packages/api` exception for launch fixes, or waits for the C# invoice KPI read in
  Phase C; the disclosure does not ship on the current fields.

### Phase B: typed columns, dual-write and snapshots

- Reviewed, additive DDL under `packages/db/prisma/manual/`, applied by the owner **before** each PR merges, following
  [DDL governance](../ddl-governance.md). Tables whose ownership has moved to C# get their flip DDL regenerated from
  the recaptured baseline, never edited by hand (see [the flip-DDL README](../../../services/Tims.Platform/db/flip-ddl/README.md)
  and [table ownership](../table-ownership.md)).
- The locale profile columns, their editors and provisioning presets.
- `SalaryTerms` on offers and typed salary columns on vacancies, dual-written next to the legacy `Float` and JSON.
  **Gate on candidate-facing readers.** The legacy column cannot carry the new agreement: a yearly CRC 13 000 000
  with 13 payments is written as `salary = 12 000 000` (§3.2), and `basis` has no legacy field. The offer letter
  (`apps/web/app/(admin)/recruitment/offers/_components/offer-letter.tsx`), the candidate dashboard
  (`apps/web/app/(portal)/careers/[orgSlug]/dashboard/dashboard-offer.tsx`) and the public signing page
  (`apps/web/app/offers/sign/[token]/page.tsx`) all render only that legacy value. So the columns and the
  dual-write may ship, but the offer form keeps creating terms equivalent to the legacy shape (`monthly`, 12
  payments, `gross`) until **every** reader of `offers.salary` that a candidate, an approver or a model sees renders
  `SalaryTerms`, not just those three. The inventory at the time of writing (`offer.salary` /
  `formatAnnualOfferSalary` outside tests) also includes the offer table, detail view and KPI data in
  `apps/web/app/(admin)/recruitment/offers/_components/`, `apps/web/lib/offer-salary.ts`, the candidate FAQ context
  (`packages/api/src/services/candidate-portal.service.ts`, which passes `salary` and `salary / 12` to the model whose
  prompt in `packages/ai/src/agents/candidate-faq.ts` reads them as annual and monthly pay) and the data-request
  export (`packages/api/src/routers/platform/data-requests.ts`). The enabling PR must re-run that search, list every
  hit with how it now consumes `SalaryTerms` (FAQ: context, prompt and fixtures; export: period, payments and basis),
  and add a test that fails if a new `offer.salary` reader appears outside an allowlist. Entering a yearly amount,
  13 or 14 payments, or a `net` basis stays disabled behind a flag until then. The reader switch is the exit
  criterion for that flag, and it can land in Phase B ahead of the rest of Phase C.
- Minor-unit columns on compensation tables, plus a pay period.
- Minor-unit columns and FX snapshots (each with its write identifier) on invoices, written by the invoice
  transitions. Invoices that already left draft before this PR never transition again, so they get a one-off snapshot
  backfill (below).
- Compensation and DEI read the tenant base currency and disclose their rates. **Prerequisite:** FX discovery pins
  only the currencies it finds in `employee_compensations`, `salary_bands`, `companies` and `invoices`
  (`Tims.Infrastructure/Fx/FxRateWriteRepository.cs:27`), and a profile write reaches `companies` only for an
  organization with exactly one active company (§3.3). So `organizations.base_currency` is added to the discovery
  set, with a test that a base currency used by no other table gets a pin, before any reader converts into it.

During this phase, readers stay on the legacy columns unless a PR says otherwise.

### Phase C: switch and retire

- Callers of the interim `formatMoney` move onto `Money`, `SalaryTerms` and the typed profile. Public pages (offer
  signing, careers) get the tenant locale from their own payloads.
- **Every** read that converts invoice or payment amounts sums the frozen snapshots, with no FX call at read time.
  That is not only the new C# reads for invoice KPIs, export and organization outstanding: at the time of writing the
  platform dashboard revenue in `PlatformDashboardFxUseCase.cs` and the TypeScript `routers/platform/dashboard.ts`,
  `dashboard-churn.ts` and `invoices.ts` (via `packages/api/src/lib/currency.ts`) also convert paid invoices at current
  pins. The switching PR re-runs the search for FX consumers (`IFxRateProvider` / `FxMoneyConverter` in C#,
  `lib/currency` in TypeScript), classifies each hit as historical money (must read snapshots) or current money (may
  convert live, e.g. compensation bands and DEI pay views), and adds a fixture per historical reader proving that a
  rate refresh cannot change already-settled revenue. They switch only after the invoice snapshot backfill below has
  run and its coverage has been reported.
- The TypeScript FX path is deleted after the C# dashboard and invoice reads have been live and verified for at least
  one billing cycle. This deletion is the one step that is hard to undo, so it ships last.
- Dropping the legacy `Float` columns happens in a later wave, after every reader has switched.

### Invoice snapshot backfill (existing invoices)

The snapshot-only reads in Phase C would otherwise leave every invoice issued or paid before Phase B without a
snapshot, and its treatment in totals undefined. The rule:

- **Eligibility.** Invoices with status other than `draft`. Void invoices are backfilled too, for history, but stay
  excluded from KPIs (D-25-8). Drafts get no snapshot; they are quoted when they leave draft.
- **Missing snapshots only.** The issue and settlement snapshots are backfilled separately. An invoice issued or paid
  after Phase B deployed already has its live snapshot, and the backfill never replaces it.
- **Snapshot write identifier.** Each snapshot carries a write identifier, a fresh UUID generated by whichever write
  set it: a live transition or the backfill. Every live write, including a reverted and re-recorded payment that
  produces identical values, replaces it with a new one. Clearing a snapshot on revert clears the identifier too.
- **Atomic write guard.** The backfill reads the invoice, fetches the quote, then writes with a single conditional
  update. The issue write requires the issue snapshot to still be empty and `invoice_date` to still equal the value it
  read. The settlement write requires the settlement snapshot to still be empty, the status to still be `paid`, and
  `paid_at` and the payment amount to still equal the values it read. If any check fails, nothing is written and the
  invoice is counted as skipped in the coverage report. A payment reverted, or re-recorded on a different date, between
  the read and the write therefore never receives the old payment's quote. Concurrency fixtures cover both cases
  before the backfill runs: a revert between read and write, and a re-record with a different date between read and
  write, each asserting that no snapshot is written.
- **Issue snapshot.** The point-in-time quote (§3.4) for the latest pin on or before `invoice_date`, recorded with that
  pin's own date and source, so the snapshot never claims a rate it did not use.
- **Settlement snapshot.** For paid invoices, the same quote on or before `paid_at`.
- **Unavailable historical rate.** When no pin exists on or before the date, the snapshot stays empty. Nothing is
  guessed from a later rate.
- **Visible accounting.** A read that sums snapshots never drops an invoice silently. Invoices without a snapshot are
  reported as a separate per-currency total with their count, and the KPI says they are not converted. The same rule
  covers payments recorded without a settlement snapshot (D-25-3b).
- **Mechanics.** An idempotent, owner-run backfill with check, apply and rollback modes. It records the write
  identifier of every snapshot it wrote. Rollback clears a snapshot with a conditional update that matches on that
  identifier, so a snapshot that a live transition has since rewritten carries a different identifier and is kept,
  even when its values are identical (a payment reverted and re-recorded for the same amount, date and pin). A fixture
  covers that identical re-record before rollback is enabled. Its coverage report (backfilled, already snapshotted,
  skipped by the write guard, without rate, by currency) is attached to the Phase C switch PR.

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
