using System.Security.Claims;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.AssessmentTypes;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Assessments.Providers;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.FitEngine;
using Tims.Infrastructure.Access;

namespace Tims.Api.Assessments;

/// <summary>
/// AS-7 / AS-14 staff reads of the TIMS Assessments provider connector, dark behind
/// <see cref="PlatformOptions.AssessmentProvidersEnabled"/>, both <c>assessment:read</c>:
/// <list type="bullet">
///   <item><description><c>GET /assessments/provider-catalog?vacancyId=</c> — the instruments this org may assign
///   (enabled on its binding AND offered by the provider for selection), with each one's delivery, locales, consent
///   purposes and versions; with <c>vacancyId</c> (vacancy scope probe: 404) also the version the vacancy is pinned to.
///   <c>connected: false</c> when the org has no binding. 503 when the provider is unconfigured or down.</description></item>
///   <item><description><c>GET /assessments/provider-attempts?candidateId=</c> — the candidate's attempts with a status
///   chip each, how the vacancy counts the instrument (D3: English in languages; D20: LIA as a threshold) and the result
///   (validity, reviewPending, the minimum met or not). Owner default D6: a reader below company scope never gets the
///   level, the validity reasons or the accommodation. An attempt of an out-of-scope vacancy is omitted; an unknown
///   candidate is an empty list (no oracle); a #312-withdrawn candidate is <c>consentWithdrawn: true</c> with no
///   attempts.</description></item>
///   <item><description><c>GET /assessments/provider-attempts/{attemptId}/reports</c> — the PDF reports HR may download
///   for the attempt's latest result (the native report, <c>variant: null</c>, and the provider variants its <c>full</c>
///   projection lists, PCA's included), read live from the provider.</description></item>
///   <item><description><c>GET /assessments/provider-attempts/{attemptId}/report?variant=&amp;locale=</c> — one report as
///   <c>application/pdf</c> (<c>Cache-Control: private, no-store</c>), audited. Both report routes are refused (403) to a
///   reader below company scope (owner default D6: a report is the full interpretation), run the vacancy scope probe
///   (404), answer 404 <c>report_unavailable</c> when the result has no report to give (none stored, voided, erased or
///   withdrawn, or the provider refuses it) and 503 when the provider is unconfigured or down.</description></item>
/// </list>
/// Query values are bound as strings and parsed after the gate (TRAP 9): 401/403 before 400.
/// </summary>
public static class ProviderStaffReadEndpoints
{
    public const string CatalogPath = "/assessments/provider-catalog";
    public const string AttemptsPath = "/assessments/provider-attempts";
    public const string ReportsPath = "/assessments/provider-attempts/{attemptId:guid}/reports";
    public const string ReportPath = "/assessments/provider-attempts/{attemptId:guid}/report";

    public static void MapProviderStaffReadEndpoints(this WebApplication app)
    {
        app.MapGet(CatalogPath, async (
                [FromQuery(Name = "vacancyId")] string? vacancyIdRaw, ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions, IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
                ProviderStaffReadUseCase useCase, CancellationToken cancellationToken) =>
            {
                var gate = await AssessmentStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, "read", cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                Guid? vacancyId = null;
                if (vacancyIdRaw is not null)
                {
                    if (!Guid.TryParseExact(vacancyIdRaw, "D", out var parsed) || parsed == Guid.Empty)
                    {
                        return Results.BadRequest(new { error = "invalid_input" });
                    }

                    if (!await InScopeAsync(parsed, gate, anchorLoaderFactory, scopedProbe, cancellationToken))
                    {
                        return Results.NotFound(new { message = "Vacante no encontrada" });
                    }

                    vacancyId = parsed;
                }

                var result = await useCase.GetCatalogAsync(gate.OrganizationId, vacancyId, cancellationToken);
                return result.Outcome switch
                {
                    StaffReadOutcome.Ok => Results.Ok(result.Catalog),
                    StaffReadOutcome.ProviderUnconfigured => Unavailable("provider_unconfigured"),
                    _ => Unavailable("provider_unavailable"),
                };
            })
            .RequireAuthorization()
            .Produces<StaffCatalog>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("AssessmentProviderStaffCatalog")
            .WithTags("AssessmentProviders");

        app.MapGet(AttemptsPath, async (
                [FromQuery(Name = "candidateId")] string? candidateIdRaw, ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions, IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
                ProviderStaffReadUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await AssessmentStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, "read", cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (candidateIdRaw is null || !Guid.TryParseExact(candidateIdRaw, "D", out var candidateId)
                    || candidateId == Guid.Empty)
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var list = await useCase.ListCandidateAttemptsAsync(
                    gate.OrganizationId, candidateId, FitV2Visibility.HidesBelowMinimum(gate.Scope!.Value),
                    platformOptions.Value.FitEngineLiaScoredEnabled,
                    vacancyId => InScopeAsync(vacancyId, gate, anchorLoaderFactory, scopedProbe, cancellationToken),
                    timeProvider.GetUtcNow(), cancellationToken);
                return Results.Ok(list);
            })
            .RequireAuthorization()
            .Produces<StaffCandidateAttemptList>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("AssessmentProviderStaffAttempts")
            .WithTags("AssessmentProviders");

        app.MapGet(ReportsPath, async (
                Guid attemptId, ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe, ProviderReportUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await ReportGateAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var listed = await useCase.ListAsync(
                    gate.OrganizationId, attemptId,
                    vacancyId => InScopeAsync(vacancyId, gate, anchorLoaderFactory, scopedProbe, cancellationToken),
                    cancellationToken);
                return listed.Outcome == ProviderReportOutcome.Ok
                    ? Results.Ok(new ProviderReportList(listed.Reports))
                    : ReportFailure(listed.Outcome);
            })
            .RequireAuthorization()
            .Produces<ProviderReportList>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound).Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("AssessmentProviderStaffReports")
            .WithTags("AssessmentProviders");

        app.MapGet(ReportPath, async (
                Guid attemptId, [FromQuery(Name = "variant")] string? variant, [FromQuery(Name = "locale")] string? locale,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe, ProviderReportUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await ReportGateAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var got = await useCase.DownloadAsync(
                    gate.OrganizationId, gate.UserId, attemptId, variant, locale,
                    vacancyId => InScopeAsync(vacancyId, gate, anchorLoaderFactory, scopedProbe, cancellationToken),
                    cancellationToken);
                if (got.Outcome != ProviderReportOutcome.Ok)
                {
                    return ReportFailure(got.Outcome);
                }

                httpContext.Response.Headers.CacheControl = "private, no-store";
                httpContext.Response.Headers.XContentTypeOptions = "nosniff";
                return Results.File(
                    got.File!.Content, "application/pdf",
                    $"tims-{got.Instrument}{(variant is null ? string.Empty : "-" + variant)}.pdf");
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK, contentType: "application/pdf")
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("AssessmentProviderStaffReport")
            .WithTags("AssessmentProviders");
    }

    // assessment:read, and company scope or wider (owner default D6): a report is the full interpretation, which a
    // narrower reader (a team leader, a unit HRBP) never sees.
    private static async Task<AssessmentGateResult> ReportGateAsync(
        ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver, PermissionService permissionService,
        PlatformOptions options, CancellationToken cancellationToken)
    {
        var gate = await AssessmentStaffGate.AuthorizeAsync(
            user, httpContext, principalResolver, permissionService, options, "read", cancellationToken);
        return gate.Failure is null && FitV2Visibility.HidesBelowMinimum(gate.Scope!.Value)
            ? AssessmentGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden))
            : gate;
    }

    private static IResult ReportFailure(ProviderReportOutcome outcome) => outcome switch
    {
        ProviderReportOutcome.InvalidInput => Results.BadRequest(new { error = "invalid_input" }),
        ProviderReportOutcome.NotFound => Results.NotFound(new { error = "not_found" }),
        ProviderReportOutcome.NoReport => Results.NotFound(new { error = "report_unavailable" }),
        ProviderReportOutcome.ProviderUnconfigured => Unavailable("provider_unconfigured"),
        _ => Unavailable("provider_unavailable"),
    };

    private static async Task<bool> InScopeAsync(
        Guid vacancyId, AssessmentGateResult gate, IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
        CancellationToken cancellationToken)
    {
        var anchors = anchorLoaderFactory.Create(gate.OrganizationId, gate.UserId);
        try
        {
            await scopedProbe.AssertScopedAsync(ScopedEntity.Vacancy, vacancyId, gate.Scope!.Value, anchors,
                gate.OrganizationId, gate.UserId, cancellationToken);
            return true;
        }
        catch (ScopedNotFoundException)
        {
            return false;
        }
        finally
        {
            if (anchors is IAsyncDisposable disposable)
            {
                await disposable.DisposeAsync();
            }
        }
    }

    private static IResult Unavailable(string error) =>
        Results.Json(new { error }, statusCode: StatusCodes.Status503ServiceUnavailable);
}

/// <summary>The reports HR may download for one attempt's latest result.</summary>
public sealed record ProviderReportList(IReadOnlyList<ProviderReportOption> Reports);
