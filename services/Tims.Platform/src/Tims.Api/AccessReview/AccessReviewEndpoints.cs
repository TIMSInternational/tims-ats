using Tims.Api.Http;
using System.Security.Claims;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Audit; // PlatformOwnerGate
using Tims.Api.Configuration;
using Tims.Application.AccessReview;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Domain.Csv;

namespace Tims.Api.AccessReview;

/// <summary>
/// The 4 access-review endpoints (Phase-5 Slice 18) — the C# port of `platform.getAccessReview` /
/// `exportAccessReviewCsv` / `attestAccessReview` / `listAccessReviewAttestations`. All gated by
/// <see cref="PlatformOwnerGate"/> (reused verbatim). Read endpoints behind
/// <see cref="PlatformOptions.AccessReviewReadEnabled"/>; the attest write behind
/// <see cref="PlatformOptions.AccessReviewWriteEnabled"/> — split so Federico can canary them
/// independently, matching every other Phase-5 read/write-flag-split domain.
/// </summary>
public static class AccessReviewEndpoints
{
    private const int DefaultAttestationLimit = 20;
    private const int MaxAttestationLimit = 100;
    private const int MaxNotesLength = 2000;

    // A user with zero role grants still needs ONE CSV line (matches TS's `roles.length ? roles : [null]`) —
    // a single nullable-element sentinel row, typed up front so the ternary below doesn't have to unify
    // IReadOnlyList<RoleGrantView> (row.Roles) with a fresh nullable array literal at each call site.
    private static readonly IReadOnlyList<Domain.AccessReview.RoleGrantView?> NoRole = [null];

    public static void MapAccessReviewReadEndpoints(this WebApplication app)
    {
        app.MapGet("/access-review", async (
                Guid organizationId,
                ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                AccessReviewService service, ISecurityEventWriter securityEventWriter,
                CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var report = await service.BuildReportAsync(organizationId, DateTime.UtcNow, cancellationToken);

                await securityEventWriter.WriteAsync(
                    new SecurityEvent(organizationId, Guid.Parse(gate.Context!.UserId), "access_review_viewed", "access_review", null,
                        new JsonObject { ["targetOrgId"] = organizationId.ToString(), ["userCount"] = report.Summary.UserCount }),
                    cancellationToken);

                return Results.Ok(report);
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("GetAccessReview");

        app.MapGet("/access-review/export", async (
                Guid organizationId,
                ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                AccessReviewService service, ISecurityEventWriter securityEventWriter,
                CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var report = await service.BuildReportAsync(organizationId, DateTime.UtcNow, cancellationToken);

                var metadata = new JsonObject
                {
                    ["resource"] = "access_review",
                    ["count"] = report.Rows.Count,
                    ["format"] = "csv",
                    ["targetOrgId"] = organizationId.ToString(),
                };
                // Matches TS's `...(info.truncated ? { truncated: true } : {})` — only present when true.
                if (report.Truncated)
                {
                    metadata["truncated"] = true;
                }

                await securityEventWriter.WriteAsync(
                    new SecurityEvent(organizationId, Guid.Parse(gate.Context!.UserId), "platform_export", "export:access_review", null,
                        metadata, IpAddress: httpContext.ClientIpFor(), UserAgent: UserAgentOf(httpContext)),
                    cancellationToken);

                return Results.Ok(new { format = "csv", data = BuildCsv(report), count = report.Rows.Count, truncated = report.Truncated });
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("ExportAccessReviewCsv");

        app.MapGet("/access-review/attestations", async (
                Guid organizationId, int? limit,
                ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                AccessReviewService service, CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var resolvedLimit = Math.Clamp(limit ?? DefaultAttestationLimit, 1, MaxAttestationLimit);
                var history = await service.ListAttestationsAsync(organizationId, resolvedLimit, cancellationToken);
                return Results.Ok(history);
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("ListAccessReviewAttestations");
    }

    public static void MapAccessReviewWriteEndpoints(this WebApplication app)
    {
        app.MapPost("/access-review/attest", async (
                AttestAccessReviewRequest body,
                ClaimsPrincipal user, HttpContext httpContext,
                PrincipalResolver principalResolver, IOptions<PlatformOptions> platformOptions,
                AccessReviewService service, ISecurityEventWriter securityEventWriter,
                CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (body.Notes is { Length: > MaxNotesLength })
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var reviewerId = Guid.Parse(gate.Context!.UserId);
                var outcome = await service.AttestAsync(body.OrganizationId, reviewerId, body.Notes, DateTime.UtcNow, cancellationToken);

                switch (outcome)
                {
                    case AccessReviewAttestOutcome.OrgNotFound:
                        return Results.NotFound(new { error = "org_not_found" });
                    case AccessReviewAttestOutcome.Truncated:
                        return Results.StatusCode(StatusCodes.Status412PreconditionFailed);
                    case AccessReviewAttestOutcome.Success success:
                        await securityEventWriter.WriteAsync(
                            new SecurityEvent(body.OrganizationId, reviewerId, "access_recertified", "access_review", success.Attestation.Id.ToString(),
                                new JsonObject
                                {
                                    ["userCount"] = success.Summary.UserCount,
                                    ["privilegedCount"] = success.Summary.PrivilegedCount,
                                    ["staleCount"] = success.Summary.StaleCount,
                                    ["deprovisionGapCount"] = success.Summary.DeprovisionGapCount,
                                    ["expiredGapCount"] = success.Summary.ExpiredGapCount,
                                }),
                            cancellationToken);
                        return Results.Ok(success.Attestation);
                    default:
                        throw new InvalidOperationException($"Unhandled outcome: {outcome.GetType()}");
                }
            })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status412PreconditionFailed)
            .WithName("AttestAccessReview");
    }

    private static string BuildCsv(Domain.AccessReview.AccessReviewReport report)
    {
        var header = CsvCell.Row([
            "Usuario", "Email", "Organizacion", "Estado", "Rol", "Alcance", "AsignadoPor",
            "Privilegiado", "Inactivo", "SinAcceso", "BrechaBaja", "Expirado", "RolCruzado",
        ]);

        var lines = new List<string>();
        foreach (var row in report.Rows)
        {
            IReadOnlyList<Domain.AccessReview.RoleGrantView?> roleList = row.Roles.Count > 0
                ? row.Roles
                : NoRole;
            foreach (var role in roleList)
            {
                lines.Add(CsvCell.Row([
                    row.Name,
                    row.Email,
                    row.OrgName,
                    row.Status,
                    role?.Slug ?? "-",
                    ScopeOf(role),
                    role?.AssignedBy?.ToString() ?? "-",
                    row.Flags.Privileged ? "Y" : "N",
                    row.Flags.Stale ? "Y" : "N",
                    row.Flags.NeverLoggedIn ? "Y" : "N",
                    row.Flags.DeprovisionGap ? "Y" : "N",
                    row.Flags.ExpiredGrant ? "Y" : "N",
                    row.Flags.CrossOrgRole ? "Y" : "N",
                ]));
            }
        }

        return string.Join('\n', new[] { header }.Concat(lines));
    }

    private static string? UserAgentOf(HttpContext httpContext)
    {
        var userAgent = httpContext.Request.Headers.UserAgent.ToString();
        return string.IsNullOrEmpty(userAgent) ? null : userAgent;
    }

    // Matches TS: [companyScope, unitScope].filter(Boolean).join('|') || '-'.
    private static string ScopeOf(Domain.AccessReview.RoleGrantView? role)
    {
        if (role is null)
        {
            return "-";
        }

        var parts = new[] { role.CompanyScope?.ToString(), role.UnitScope?.ToString() }.Where(p => p is not null);
        var joined = string.Join('|', parts);
        return joined.Length > 0 ? joined : "-";
    }
}

public sealed record AttestAccessReviewRequest(Guid OrganizationId, string? Notes);
