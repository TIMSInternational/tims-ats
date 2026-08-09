using System.Security.Claims;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Audit;
using Tims.Application.Compensation;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Audit;
using Tims.Domain.Compensation;
using Tims.Domain.Identity;
using Tims.Infrastructure.Access;

namespace Tims.Api.Compensation;

/// <summary>
/// The FX-free compensation READ endpoints (Phase-5 Slice 9) — the C# port of the SEVEN FX-free read
/// procedures of the TS <c>compensation</c> router (the five FX reads + the two writes are NOT ported). All
/// seven are <c>permissionProcedure('compensation','read')</c>, gated by <see cref="CompensationStaffGate"/>,
/// which returns the resolved scope + roles so each endpoint applies its OWN mechanic:
/// <list type="bullet">
///   <item><description>getSalaryBands / getMarketComparison: grant only (NO org-gate; org-level catalog).</description></item>
///   <item><description>getBenefitsUtilization / getCompaRatioDistribution: + <c>requireOrgScope</c>
///     (org-rollup, narrow → 403, Codex F3). getCompaRatioDistribution is the meaty min-5 kernel.</description></item>
///   <item><description>listPendingAdjustments: + <c>scopeWhereFor('salaryAdjustment')</c> row filter +
///     <c>selectFor</c> field-auth + fail-closed audit per exposed row.</description></item>
///   <item><description>getEmployeeComp: + <c>assertSubjectInScope(userId)</c> (out-of-set → 403) +
///     <c>selectFor('employeeCompensation')</c> + fail-closed audit.</description></item>
///   <item><description>myCompensation: own-pinned (subject = caller; NO client id, NO org-gate) +
///     <c>selectFor</c> + fail-closed audit; missing row → null body (not an error).</description></item>
/// </list>
/// INTERNAL reads = raw model / kernel shape, NO <c>schemaVersion</c>. Input validation runs AFTER auth (tRPC
/// parity). Dark-by-default behind <see cref="PlatformOptions.CompensationReadEnabled"/> (mapped only when on,
/// or at build-time OpenAPI generation).
/// </summary>
public static class CompensationReadEndpoints
{
    private const string SalaryAdjustmentEntity = "salaryAdjustment";
    private const string EmployeeCompensationEntity = "employeeCompensation";
    private const string CompNotFoundMessage = "Compensacion no encontrada";
    private const string SubjectForbiddenMessage = "No puedes ver la compensacion de este usuario";

    public static void MapCompensationReadEndpoints(this WebApplication app)
    {
        // 1. getSalaryBands — gate only (NO org-gate; org-level catalog). companyId accepted but not a filter.
        app.MapGet("/compensation/salary-bands", async (
                [FromQuery(Name = "companyId")] string? companyId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                CompensationReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await CompensationStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!IsOptionalUuidValid(companyId))
                {
                    return Results.BadRequest(new { error = "invalid_companyId" });
                }

                var rows = await useCase.GetSalaryBandsAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(rows);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<SalaryBandRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("CompensationGetSalaryBands");

        // 2. getMarketComparison — gate only. jobLevel optional (≤ 100), used as a level filter.
        app.MapGet("/compensation/market-comparison", async (
                [FromQuery(Name = "jobLevel")] string? jobLevel,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                CompensationReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await CompensationStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (jobLevel is { Length: > 100 })
                {
                    return Results.BadRequest(new { error = "invalid_jobLevel" });
                }

                var rows = await useCase.GetMarketComparisonAsync(
                    gate.Context!.OrganizationId, string.IsNullOrEmpty(jobLevel) ? null : jobLevel, cancellationToken);
                return Results.Ok(rows);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<MarketComparisonRow>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("CompensationGetMarketComparison");

        // 3. getBenefitsUtilization — gate → org-rollup gate (narrow → 403, F3) → pure utilization kernel.
        app.MapGet("/compensation/benefits-utilization", async (
                [FromQuery(Name = "companyId")] string? companyId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                CompensationReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!IsOptionalUuidValid(companyId))
                {
                    return Results.BadRequest(new { error = "invalid_companyId" });
                }

                var rows = await useCase.GetBenefitsUtilizationAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(rows);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<BenefitUtilizationItem>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("CompensationGetBenefitsUtilization");

        // 4. getCompaRatioDistribution — gate → org-rollup gate → the min-5 compa-ratio kernel.
        app.MapGet("/compensation/compa-ratio-distribution", async (
                [FromQuery(Name = "companyId")] string? companyId,
                [FromQuery(Name = "businessUnitId")] string? businessUnitId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                CompensationReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await AuthorizeOrgRollupAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!IsOptionalUuidValid(companyId) || !IsOptionalUuidValid(businessUnitId))
                {
                    return Results.BadRequest(new { error = "invalid_filters" });
                }

                var view = await useCase.GetCompaRatioDistributionAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(view);
            })
            .RequireAuthorization()
            .Produces<CompaRatioDistribution>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("CompensationGetCompaRatioDistribution");

        // 5. listPendingAdjustments — gate → scopeWhereFor('salaryAdjustment') + selectFor + fail-closed audit.
        app.MapGet("/compensation/pending-adjustments", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                CompensationReadUseCase useCase,
                IDataAccessAuditor auditor,
                CancellationToken cancellationToken) =>
            {
                var gate = await CompensationStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var userId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, userId);
                PendingAdjustmentsResult result;
                try
                {
                    var scope = await ScopeWhereFor.BuildAsync(
                        ScopedEntity.SalaryAdjustment, gate.Scope!.Value, anchors, userId.ToString(), cancellationToken);
                    var adjustmentFields = FieldClassification.SelectFor(gate.Roles!, SalaryAdjustmentEntity);
                    result = await useCase.ListPendingAdjustmentsAsync(
                        gate.Context!.OrganizationId, adjustmentFields, scope, cancellationToken);
                }
                catch (ScopeAnchorMissingException)
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }

                // §21 audit: one data_access_logs row per EXPOSED salary_adjustment, fail-closed (restricted)
                // BEFORE serializing — a failed audit-write aborts pre-response.
                await AuditRecordsAsync(
                    auditor, gate.Context!, httpContext, SalaryAdjustmentEntity, result.RecordIds, cancellationToken);

                return Results.Ok(result.Rows);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<JsonObject>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("CompensationListPendingAdjustments");

        // 6. getEmployeeComp — gate → assertSubjectInScope(userId) (out-of-set → 403) + selectFor + audit.
        app.MapGet("/compensation/employee/{userId:guid}", async (
                Guid userId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                CompensationReadUseCase useCase,
                IDataAccessAuditor auditor,
                CancellationToken cancellationToken) =>
            {
                var gate = await CompensationStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var callerId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, callerId);
                try
                {
                    // §21 subject scope: the caller must be authorized for this subject (own/team/unit/org).
                    // An out-of-subject-set userId → 403 (never the comp row) — the C# assertSubjectInScope.
                    var satisfied = await SubjectInScope.IsSatisfiedAsync(
                        gate.Scope!.Value, anchors, callerId.ToString(), userId.ToString(), cancellationToken);
                    if (!satisfied)
                    {
                        return Results.Json(new { message = SubjectForbiddenMessage }, statusCode: StatusCodes.Status403Forbidden);
                    }
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }

                var compFields = FieldClassification.SelectFor(gate.Roles!, EmployeeCompensationEntity);
                var result = await useCase.GetEmployeeCompAsync(
                    gate.Context!.OrganizationId, userId, compFields, cancellationToken);

                // Missing row → 404 (the not-found semantic; TS throws a generic "Compensacion no encontrada").
                if (result is null)
                {
                    return Results.NotFound(new { message = CompNotFoundMessage });
                }

                await AuditRecordsAsync(
                    auditor, gate.Context!, httpContext, EmployeeCompensationEntity, [result.RecordId], cancellationToken);
                return Results.Ok(result.Dto);
            })
            .RequireAuthorization()
            .Produces<JsonObject>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("CompensationGetEmployeeComp");

        // 7. myCompensation — gate → own-pinned subject = caller (NO client id, NO org-gate) + selectFor + audit.
        app.MapGet("/compensation/my-compensation", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory,
                CompensationReadUseCase useCase,
                IDataAccessAuditor auditor,
                CancellationToken cancellationToken) =>
            {
                var gate = await CompensationStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                // Subject is HARD-PINNED to the caller (no client id can widen it). Byte-faithful to TS
                // myCompensation, which STILL runs assertSubjectInScope(caller, caller) via the shared service:
                // for own/team/org/company scope it passes trivially, but for a unit-scoped caller whose own id is
                // NOT in unitMemberIds() the TS path 403s — so run the SAME assertion here rather than assume it
                // always passes (review/Codex F1: 3-reviewer consensus). No org-gate.
                var orgId = Guid.Parse(gate.Context!.OrganizationId);
                var callerId = Guid.Parse(gate.Context!.UserId);
                var anchors = anchorLoaderFactory.Create(orgId, callerId);
                bool satisfied;
                try
                {
                    satisfied = await SubjectInScope.IsSatisfiedAsync(
                        gate.Scope!.Value, anchors, callerId.ToString(), callerId.ToString(), cancellationToken);
                }
                finally
                {
                    await DisposeAnchorsAsync(anchors);
                }
                if (!satisfied)
                {
                    return Results.Json(new { message = SubjectForbiddenMessage }, statusCode: StatusCodes.Status403Forbidden);
                }

                var compFields = FieldClassification.SelectFor(gate.Roles!, EmployeeCompensationEntity);
                var result = await useCase.GetEmployeeCompAsync(
                    gate.Context!.OrganizationId, callerId, compFields, cancellationToken);

                // Missing comp row → literal JSON `null` body (graceful, NOT an error), matching the TS
                // myCompensation's `null` return. Both Results.Ok(null) and Results.Json(null) emit an EMPTY
                // body, so write the literal "null" JSON token explicitly.
                if (result is null)
                {
                    return Results.Content("null", "application/json", statusCode: StatusCodes.Status200OK);
                }

                await AuditRecordsAsync(
                    auditor, gate.Context!, httpContext, EmployeeCompensationEntity, [result.RecordId], cancellationToken);
                return Results.Ok(result.Dto);
            })
            .RequireAuthorization()
            .Produces<JsonObject>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("CompensationMyCompensation");
    }

    // The org-rollup gate (reads #3/#4): the staff gate THEN requireOrgScope (narrow → 403, Codex F3).
    private static async Task<CompensationGateResult> AuthorizeOrgRollupAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        var gate = await CompensationStaffGate.AuthorizeAsync(
            user, httpContext, principalResolver, permissionService, options, cancellationToken);
        if (gate.Failure is not null)
        {
            return gate;
        }

        return OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value)
            ? gate
            : CompensationGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
    }

    // One fail-closed (restricted) data_access_logs row per exposed record, BEFORE the response is serialized.
    private static async Task AuditRecordsAsync(
        IDataAccessAuditor auditor,
        TenantContext context,
        HttpContext httpContext,
        string entity,
        IReadOnlyList<string> recordIds,
        CancellationToken cancellationToken)
    {
        var actorId = AuditActor.ActorFor(context);
        var ipAddress = ClientIp(httpContext);
        var userAgent = httpContext.Request.Headers.UserAgent.ToString();
        foreach (var recordId in recordIds)
        {
            await auditor.LogAsync(
                new DataAccessEvent(
                    context.OrganizationId,
                    actorId,
                    entity,
                    recordId,
                    AuditAction.Read,
                    ipAddress,
                    string.IsNullOrEmpty(userAgent) ? null : userAgent),
                failClosed: true,
                cancellationToken: cancellationToken);
        }
    }

    // Optional-uuid Zod parity: absent/empty is valid; a present non-uuid is a bad input (→ 400).
    private static bool IsOptionalUuidValid(string? value) =>
        string.IsNullOrEmpty(value) || Guid.TryParse(value, out _);

    // Audit IP. NOTE (#158, 2026-08-09): this takes the RAW whole `x-forwarded-for` header, i.e. the
    // client-controlled left-most hop, and returns the comma-joined hop list verbatim. The TS side
    // used to do the same; it no longer does — every TS audit writer now goes through
    // `packages/api/src/lib/client-ip.ts` (`x-real-ip` first, else the LAST xff hop). So this is a
    // KNOWN CROSS-STACK DIVERGENCE, not parity, and the previous "matches the TS header order"
    // claim on this comment was made false by that change rather than being wrong when written.
    // C# already has the correct derivation in Tims.Domain/RateLimiting/RateLimitIdentity.cs
    // (`AnonymousIdentifier`); this helper should adopt it. Tracked separately — see the issue
    // as #174.
    private static string? ClientIp(HttpContext httpContext)
    {
        var forwarded = httpContext.Request.Headers["x-forwarded-for"].ToString();
        if (!string.IsNullOrEmpty(forwarded))
        {
            return forwarded;
        }

        var realIp = httpContext.Request.Headers["x-real-ip"].ToString();
        return string.IsNullOrEmpty(realIp) ? null : realIp;
    }

    private static async Task DisposeAnchorsAsync(IAnchorLoader anchors)
    {
        if (anchors is IAsyncDisposable disposable)
        {
            await disposable.DisposeAsync();
        }
    }
}
