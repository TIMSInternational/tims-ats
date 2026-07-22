using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.Evaluation360;
using Tims.Application.Identity;
using Tims.Domain.Evaluation360;

namespace Tims.Api.Evaluation360;

/// <summary>
/// The evaluation360 READ endpoints (Phase-5 Slice 7) — the C# port of the FIVE read procedures of the TS
/// <c>evaluation360</c> router (the six writes are NOT ported). Two auth patterns, deliberately NOT crossed:
/// <list type="bullet">
///   <item><description>STAFF (<c>listCycles</c>, <c>getCycleProgress</c>): <see cref="Evaluation360StaffGate"/> —
///     <c>evaluation360:read</c> grant + organization/company org-gate (narrow → 403, Codex F3).</description></item>
///   <item><description>SELF-SERVICE (<c>myRaterTasks</c>, <c>myReport</c>, <c>myReportCycles</c>):
///     <see cref="Evaluation360SelfServiceGate"/> — IDENTITY only (any resolved principal; NO grant, NO scope) →
///     queries HARD-FILTER on the caller's own user id. There is no subject/rater id param — it is the caller.</description></item>
/// </list>
/// INTERNAL reads = raw model / kernel shape, NO <c>schemaVersion</c>. Dark-by-default behind
/// <see cref="PlatformOptions.Evaluation360ReadEnabled"/> (mapped only when on, or at build-time OpenAPI gen).
/// </summary>
public static class Evaluation360ReadEndpoints
{
    private const string CycleNotFoundMessage = "Ciclo no encontrado";
    // Deliberately the SAME message for BOTH myReport gates (not-published vs not-a-subject) — never let the
    // caller distinguish "this report doesn't exist" from "this report isn't yours to see" (matches TS).
    private const string ReportNotFoundMessage = "Reporte no encontrado";

    public static void MapEvaluation360ReadEndpoints(this WebApplication app)
    {
        // ---- STAFF: listCycles — evaluation360:read + org-gate → the org's review cycles (newest first). ----
        app.MapGet("/evaluation360/cycles", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                Evaluation360ReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await Evaluation360StaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var cycles = await useCase.ListCyclesAsync(gate.Context!.OrganizationId, cancellationToken);
                return Results.Ok(cycles);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<CycleSummaryV1>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("Evaluation360ListCycles");

        // ---- STAFF: getCycleProgress — same gate → per-relationship progress; unknown cycle → 404. ----
        app.MapGet("/evaluation360/cycles/{cycleId:guid}/progress", async (
                Guid cycleId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                PermissionService permissionService,
                IOptions<PlatformOptions> platformOptions,
                Evaluation360ReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await Evaluation360StaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                // callerUserId excludes the caller's OWN subject-assignments from the counts (min-3 anti-differencing).
                var progress = await useCase.GetCycleProgressAsync(
                    gate.Context!.OrganizationId, cycleId.ToString(), gate.Context.UserId, cancellationToken);
                return progress is null
                    ? Results.NotFound(new { message = CycleNotFoundMessage })
                    : Results.Ok(progress);
            })
            .RequireAuthorization()
            .Produces<CycleProgressView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("Evaluation360GetCycleProgress");

        // ---- SELF-SERVICE: myRaterTasks — identity only, hard-filtered on the caller as RATER. ----
        app.MapGet("/evaluation360/my/rater-tasks", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                Evaluation360ReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await Evaluation360SelfServiceGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var tasks = await useCase.MyRaterTasksAsync(
                    gate.Context!.OrganizationId, gate.Context.UserId, cancellationToken);
                return Results.Ok(tasks);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<RaterTaskV1>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .WithName("Evaluation360MyRaterTasks");

        // ---- SELF-SERVICE: myReport — identity only, hard-filtered on the caller as SUBJECT. Two gates
        //      (published + subject) both surface the SAME 404 so they are indistinguishable. ----
        app.MapGet("/evaluation360/my/reports/{cycleId:guid}", async (
                Guid cycleId,
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                Evaluation360ReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await Evaluation360SelfServiceGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var report = await useCase.MyReportAsync(
                    gate.Context!.OrganizationId, gate.Context.UserId, cycleId.ToString(), cancellationToken);
                return report is null
                    ? Results.NotFound(new { message = ReportNotFoundMessage })
                    : Results.Ok(report);
            })
            .RequireAuthorization()
            .Produces<MyReportView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("Evaluation360MyReport");

        // ---- SELF-SERVICE: myReportCycles — identity only, hard-filtered on the caller as SUBJECT. ----
        app.MapGet("/evaluation360/my/report-cycles", async (
                ClaimsPrincipal user,
                HttpContext httpContext,
                PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions,
                Evaluation360ReadUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                var gate = await Evaluation360SelfServiceGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var cycles = await useCase.MyReportCyclesAsync(
                    gate.Context!.OrganizationId, gate.Context.UserId, cancellationToken);
                return Results.Ok(cycles);
            })
            .RequireAuthorization()
            .Produces<IReadOnlyList<ReportCycleV1>>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .WithName("Evaluation360MyReportCycles");
    }
}
