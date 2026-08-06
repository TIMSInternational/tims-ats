import { z } from 'zod';
import { router, permissionProcedure } from '../trpc';
import { deiService } from '../services/dei.service';

// ---------------------------------------------------------------------------
// DEI router — thin controller. Demographic metrics are backed by the
// EmployeeDemographics table via deiService (aggregates only, never individual
// self-ID rows — CLAUDE.md §7).
//
// TS-DELETION (2026-07-31): NEXT_PUBLIC_DEI_READ_VIA_CSHARP was confirmed live in prod, so 9 of
// the original 11 procedures here (getDashboardKpis, getGenderRepresentation,
// getAgeDistribution, getNationalityDiversity, getPayEquity, getLeadershipDiversity,
// getHiringFunnel, getPromotionEquity, getInclusionIndex) were dead code — every FE call site
// went through apps/web/lib/platform-api/dei.ts's wrapper hooks, which now call the C# service
// unconditionally — and have been deleted.
//
// TS-DELETION (2026-08-06, #60) — the two residual reads. getEthnicityDistribution and
// getDisabilityDistribution are now DELETED from this router too. Both were ported in Slice 11b
// and both had ZERO consumers of the TS path (no wrapper hook in apps/web/lib/platform-api/dei.ts,
// no FE call site). Their C# replacements are live and carry BOTH of this router's guards —
// verified at file:line BEFORE deleting, not inferred:
//   - authz: services/Tims.Platform/src/Tims.Api/Dei/DeiReadEndpoints.cs:110 (ethnicity) and :131
//     (disability) each call DeiStaffGate.AuthorizeAsync, which enforces the `dei:read` grant
//     through the same PermissionService kernel (DeiStaffGate.cs:42) and fails closed on a denied
//     or null-scope decision (DeiStaffGate.cs:50) — the C# analog of
//     permissionProcedure('dei','read').
//   - k-anonymity: DeiReadUseCase.cs:160 (ethnicity) / :171 (disability) run
//     DeiKernels.BuildDistribution, whose min-5 floor is DeiKernels.cs:80 →
//     KAnonymity.SuppressBelowMin5 — golden-fixtured byte-for-byte against @tims/shared's
//     buildDistribution (contracts/dei-fixtures/*.json).
// The two deiService methods themselves STAY: they are no longer router-exposed, but they are
// generateReport's only data source (see below), so this is a surface deletion, not a capability
// deletion.
//
// generateReport — KEPT DELIBERATELY (#60 decision: permanent-for-now TypeScript surface).
// It is NOT a zero-consumer leftover of the cutover: it was never ported to C# at all
// (DeiReadEndpoints.cs:14, DeiReadUseCase.cs:10 and PlatformOptions.cs:249 each record the
// exclusion), so there is no replacement guard to delete it in favour of — removing it would
// delete capability, not dead code. It stopped being a `{status:'pending'}` stub in PR #19
// (de6d2a29): it renders the two retained aggregate distributions into a real xlsx/pdf document
// via dei-report-builder.ts, aggregate-only, and a sub-floor section is written out as a
// k-anonymity note rather than rows (tests/dei/report-generation.test.ts:151).
// Why the port is DEFERRED rather than scheduled: closed #1 parked this export on five
// legal/compliance questions with no safe engineering default — jurisdiction/taxonomy scope,
// whether pay-equity-by-gender belongs in v1, whether min-5 is a sufficient floor in every
// jurisdiction served, post-export retention/re-sharing of the generated file, and the legal basis
// for collecting the underlying self-ID data. A port would additionally need .NET equivalents of
// ExcelJS/PDFKit. None of that is unblocked, so the mutation stays here.
// Known gap, tracked not hidden: this mutation has no FE consumer either — the "Generate report"
// button at apps/web/app/(admin)/engagement/dei/page.tsx:27 fires a `comingSoon` toast and never
// calls it. That is pending wiring work on a working generator, not grounds for deletion.
// ---------------------------------------------------------------------------

export const deiRouter = router({
  // ── Report (real — aggregate-only xlsx/pdf export; the domain's ONLY TS-served surface) ──
  generateReport: permissionProcedure('dei', 'export')
    .input(
      z.object({
        format: z.enum(['pdf', 'xlsx']).default('pdf'),
        sections: z.array(z.string().max(100)).max(100).optional(),
      }),
    )
    .mutation(({ ctx, input }) => deiService.generateReport(ctx.user.organizationId, input)),
});
