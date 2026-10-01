using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.CandidateConsent;
using Tims.Application.Identity;
using Tims.Domain.Access;

namespace Tims.Api.CandidateConsent;

/// <summary>
/// <c>GET /tenant/data-subject-requests?status=pending|completed|rejected</c> — the staff list of the org's data
/// subject requests (#312), dark behind <see cref="PlatformOptions.CandidateConsentEnabled"/> (mapped with the rest
/// of the consent surface). Gate: <c>candidate:update</c> (the permission that files and will resolve them) + org
/// scope. Oldest first, at most 200 rows, each with the candidate's name and <c>dueAt</c> = createdAt + 15 business
/// days (<see cref="BusinessDays.DueAt"/>, holidays NOT excluded — conservative). Order: auth (401/403) → status
/// parse (400, TRAP 9: bound as <c>string?</c>, parsed after the gate) → org scope (403).
/// </summary>
public static class DataSubjectRequestEndpoints
{
    public const string ListPath = "/tenant/data-subject-requests";

    public static void MapDataSubjectRequestEndpoints(this WebApplication app)
    {
        app.MapGet(ListPath, async (
                string? status,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                CandidateConsentUseCase useCase, CancellationToken cancellationToken) =>
            {
                var gate = await CandidateConsentStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, "update",
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!CandidateConsentUseCase.TryParseStatusFilter(status, out var filter))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                return Results.Ok(await useCase.ListRequestsAsync(gate.OrganizationId, filter, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<DataSubjectRequestListView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("DataSubjectRequestsList");
    }
}
