using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Application.AssessmentTypes;
using Tims.Application.Identity;
using Tims.Domain.Access;

namespace Tims.Api.AssessmentTypes;

/// <summary>
/// F13 — tenant authoring of assessment types (greenfield C#; the TS side only had <c>assessment.listTypes</c>):
/// <list type="bullet">
///   <item><description><c>POST /assessments/types</c> — <c>assessment:create</c> + org scope. 200 / 400 / 401 / 403 / 409.</description></item>
///   <item><description><c>PATCH /assessments/types/{id}</c> — <c>assessment:update</c> + org scope. 200 / 400 / 401 / 403 / 404 / 409.</description></item>
///   <item><description><c>POST /assessments/types/{id}/deactivate</c> — <c>assessment:update</c> + org scope; soft (is_active=false). 200 / 401 / 403 / 404.</description></item>
/// </list>
/// Order: auth (401/403) → body validation (400) → org-scope (403) → write. Bodies are read as raw JSON and parsed
/// AFTER the gate (TRAP 9: minimal-API binding would otherwise 400 an anonymous caller before the 401). The org is
/// ALWAYS the caller's resolved org, never input. Every write runs under TenantScope with an explicit org filter, so a
/// type id from another org is a 404. Dark by default behind <see cref="PlatformOptions.AssessmentTypeWriteEnabled"/>.
/// </summary>
public static class AssessmentTypeWriteEndpoints
{
    private const string CreateAction = "create";
    private const string UpdateAction = "update";
    private const string NotFoundMessage = "Tipo de evaluacion no encontrado";
    private const string ConflictMessage = "Ya existe un tipo de evaluacion con ese nombre";

    public static void MapAssessmentTypeWriteEndpoints(this WebApplication app)
    {
        app.MapPost("/assessments/types", async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                AssessmentTypeWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await AssessmentStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, CreateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !AssessmentTypeWriteUseCase.TryParseCreate(node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                var result = await useCase.CreateAsync(
                    gate.OrganizationId, gate.UserId, input,
                    timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
                return ToResult(result);
            })
            .RequireAuthorization()
            .Accepts<CreateAssessmentTypeBody>("application/json")
            .Produces<AssessmentTypeRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status409Conflict)
            .WithName("AssessmentTypeCreate");

        app.MapPatch("/assessments/types/{id:guid}", async (
                Guid id,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                AssessmentTypeWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await AssessmentStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, UpdateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var (ok, node) = await TryReadJsonAsync(httpContext, cancellationToken);
                if (!ok || !AssessmentTypeWriteUseCase.TryParseUpdate(node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                var result = await useCase.UpdateAsync(
                    gate.OrganizationId, gate.UserId, id, input,
                    timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
                return ToResult(result);
            })
            .RequireAuthorization()
            .Accepts<UpdateAssessmentTypeBody>("application/json")
            .Produces<AssessmentTypeRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status409Conflict)
            .WithName("AssessmentTypeUpdate");

        app.MapPost("/assessments/types/{id:guid}/deactivate", async (
                Guid id,
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                AssessmentTypeWriteUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await AssessmentStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, UpdateAction,
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                var result = await useCase.DeactivateAsync(
                    gate.OrganizationId, gate.UserId, id,
                    timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
                return ToResult(result);
            })
            .RequireAuthorization()
            .Produces<AssessmentTypeRow>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("AssessmentTypeDeactivate");
    }

    private static IResult ToResult(AssessmentTypeWriteResult result) => result.Outcome switch
    {
        AssessmentTypeWriteOutcome.NotFound => Results.NotFound(new { message = NotFoundMessage }),
        AssessmentTypeWriteOutcome.Conflict => Results.Conflict(new { error = "duplicate_name", message = ConflictMessage }),
        _ => Results.Ok(result.Row),
    };

    private static async Task<(bool Ok, JsonNode? Node)> TryReadJsonAsync(HttpContext httpContext, CancellationToken cancellationToken)
    {
        try
        {
            var node = await httpContext.Request.ReadFromJsonAsync<JsonNode>(cancellationToken);
            return (true, node);
        }
        catch (JsonException)
        {
            return (false, null);
        }
        catch (InvalidOperationException)
        {
            return (false, null);
        }
    }
}

/// <summary>OpenAPI request schema for create. The handler parses the raw JSON defensively (strict keys).</summary>
public sealed class CreateAssessmentTypeBody
{
    [Required]
    [MaxLength(AssessmentTypeWriteUseCase.MaxNameLength)]
    public string Name { get; init; } = string.Empty;

    [MaxLength(AssessmentTypeWriteUseCase.MaxDescriptionLength)]
    public string? Description { get; init; }

    [Range(AssessmentTypeWriteUseCase.MinDuration, AssessmentTypeWriteUseCase.MaxDuration)]
    public int? Duration { get; init; }
}

/// <summary>
/// OpenAPI request schema for the partial update: every field optional; absent = unchanged. An explicit null
/// description/duration clears it; name cannot be null.
/// </summary>
public sealed class UpdateAssessmentTypeBody
{
    [MaxLength(AssessmentTypeWriteUseCase.MaxNameLength)]
    public string Name { get; init; } = string.Empty;

    [MaxLength(AssessmentTypeWriteUseCase.MaxDescriptionLength)]
    public string? Description { get; init; }

    [Range(AssessmentTypeWriteUseCase.MinDuration, AssessmentTypeWriteUseCase.MaxDuration)]
    public int? Duration { get; init; }
}
