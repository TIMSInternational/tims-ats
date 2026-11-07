using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Audit;
using Tims.Api.AssessmentTypes;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Assessments.Providers;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Infrastructure.Access;

namespace Tims.Api.Assessments;

/// <summary>
/// AS-5 staff surfaces of the TIMS Assessments provider connector, dark behind
/// <see cref="PlatformOptions.AssessmentProvidersEnabled"/>:
/// <list type="bullet">
///   <item><description><c>POST /assessments/provider-assignments</c> — <c>assessment:create</c> (TS
///   <c>assessment.assign</c> parity) + the vacancy IDOR probe. Assigns 1..6 provider instruments to a candidate for a
///   vacancy, each with its job-relatedness reason, optional accommodations (time multiplier 1..3, aids) and expiry.
///   Idempotent while an attempt is open. 200 / 400 / 401 / 403 / 404 / 409 / 422 / 502 (some provider creates still
///   pending — re-send the same request) / 503.</description></item>
///   <item><description><c>POST /platform/assessment-providers/bindings</c> — platform owner only. Binds an org to its
///   provider tenant and sets the instruments it may assign (catalog-checked: selection-allowed only).</description></item>
/// </list>
/// Order: auth (401/403) → body validation (400) → vacancy scope (404) → use case. Bodies are parsed AFTER the gate
/// (TRAP 9). The org is always the caller's resolved org, never input.
/// </summary>
public static class ProviderAssignmentEndpoints
{
    public const string AssignPath = "/assessments/provider-assignments";
    public const string BindingPath = "/platform/assessment-providers/bindings";

    public static void MapProviderAssignmentEndpoints(this WebApplication app)
    {
        app.MapPost(AssignPath, async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                IAnchorLoaderFactory anchorLoaderFactory, ScopedProbe scopedProbe,
                AssignProviderInstrumentsUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await AssessmentStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, "create",
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var node = await ProviderEndpointJson.TryReadAsync(httpContext, cancellationToken);
                if (!node.Ok || !AssignProviderInstrumentsUseCase.TryParseBody(node.Node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                // A narrow-scoped caller must not reach an out-of-scope vacancy by id (TS assertScoped('vacancy')).
                var anchors = anchorLoaderFactory.Create(gate.OrganizationId, gate.UserId);
                try
                {
                    await scopedProbe.AssertScopedAsync(ScopedEntity.Vacancy, input.VacancyId, gate.Scope!.Value, anchors,
                        gate.OrganizationId, gate.UserId, cancellationToken);
                }
                catch (ScopedNotFoundException ex)
                {
                    return Results.NotFound(new { message = ex.Message });
                }
                finally
                {
                    if (anchors is IAsyncDisposable disposable)
                    {
                        await disposable.DisposeAsync();
                    }
                }

                var result = await useCase.AssignAsync(
                    gate.OrganizationId, gate.UserId, input, timeProvider.GetUtcNow(), cancellationToken);
                return ToResult(result);
            })
            .RequireAuthorization()
            .Accepts<ProviderAssignBody>("application/json")
            .Produces<ProviderAssignResponse>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status409Conflict).Produces(StatusCodes.Status422UnprocessableEntity)
            .Produces<ProviderAssignResponse>(StatusCodes.Status502BadGateway)
            .Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("AssessmentProviderAssign")
            .WithTags("AssessmentProviders");

        app.MapPost(BindingPath, async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions, ProviderBindingUseCase useCase, TimeProvider timeProvider,
                CancellationToken cancellationToken) =>
            {
                var gate = await PlatformOwnerGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!Guid.TryParse(gate.Context!.UserId, out var actorId))
                {
                    return Results.StatusCode(StatusCodes.Status401Unauthorized);
                }

                var node = await ProviderEndpointJson.TryReadAsync(httpContext, cancellationToken);
                if (!node.Ok || !ProviderBindingUseCase.TryParseBody(node.Node, out var input))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var result = await useCase.BindOrganizationAsync(actorId, input, timeProvider.GetUtcNow(), cancellationToken);
                return result.Outcome switch
                {
                    ProviderBindingOutcome.Bound => Results.Ok(result.Binding),
                    ProviderBindingOutcome.OrganizationNotFound => Results.NotFound(new { message = "Organización no encontrada" }),
                    ProviderBindingOutcome.InstrumentNotOffered => Results.UnprocessableEntity(
                        new { error = "instrument_not_offered_for_selection", instrument = result.Detail }),
                    ProviderBindingOutcome.ProviderRefused => Results.Json(
                        new { error = "provider_refused", code = result.Detail }, statusCode: StatusCodes.Status502BadGateway),
                    ProviderBindingOutcome.ProviderUnconfigured => Unavailable("provider_unconfigured"),
                    _ => Unavailable("provider_unavailable"),
                };
            })
            .RequireAuthorization()
            .Accepts<ProviderBindingBody>("application/json")
            .Produces<ProviderBindingView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces(StatusCodes.Status422UnprocessableEntity).Produces(StatusCodes.Status502BadGateway)
            .Produces(StatusCodes.Status503ServiceUnavailable)
            .WithName("AssessmentProviderBind")
            .WithTags("AssessmentProviders");
    }

    private static IResult ToResult(ProviderAssignResult result) => result.Outcome switch
    {
        ProviderAssignOutcome.Ok => Results.Ok(result.Response),
        ProviderAssignOutcome.Incomplete => Results.Json(result.Response, statusCode: StatusCodes.Status502BadGateway),
        ProviderAssignOutcome.InvalidInput => Results.BadRequest(new { error = result.Detail ?? "invalid_input" }),
        ProviderAssignOutcome.ProviderUnconfigured => Unavailable("provider_unconfigured"),
        ProviderAssignOutcome.NotEnabled => Results.Conflict(new { error = "assessment_provider_not_enabled" }),
        ProviderAssignOutcome.InstrumentNotEnabled => Results.UnprocessableEntity(
            new { error = "instrument_not_enabled", instrument = result.Detail }),
        ProviderAssignOutcome.CandidateNotFound => Results.NotFound(new { message = "Candidato no encontrado" }),
        ProviderAssignOutcome.VacancyNotFound => Results.NotFound(new { message = "Vacante no encontrada" }),
        ProviderAssignOutcome.NoActiveApplication => Results.BadRequest(
            new { error = "no_active_application", message = "El candidato no tiene una postulación activa para esta vacante" }),
        ProviderAssignOutcome.ConsentWithdrawn => Results.Conflict(new { error = "consent_withdrawn" }),
        ProviderAssignOutcome.InstrumentNotListedByVacancy => Results.UnprocessableEntity(
            new { error = "instrument_not_listed_by_vacancy", instrument = result.Detail }),
        ProviderAssignOutcome.ReasonRequired => Results.UnprocessableEntity(
            new { error = "job_relatedness_reason_required", instrument = result.Detail }),
        _ => Unavailable("provider_unavailable"),
    };

    private static IResult Unavailable(string error) =>
        Results.Json(new { error }, statusCode: StatusCodes.Status503ServiceUnavailable);
}

/// <summary>Reads an optional JSON body after the gate; malformed JSON is a 400, an empty body is a null node.</summary>
internal static class ProviderEndpointJson
{
    public static async Task<(bool Ok, JsonNode? Node)> TryReadAsync(HttpContext httpContext, CancellationToken cancellationToken)
    {
        if (httpContext.Request.ContentLength == 0)
        {
            return (true, null);
        }

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

/// <summary>OpenAPI request schema for an assignment. The handler parses the raw JSON strictly.</summary>
public sealed class ProviderAssignBody
{
    public Guid CandidateId { get; init; }

    public Guid VacancyId { get; init; }

    public IReadOnlyList<ProviderAssignInstrumentBody> Instruments { get; init; } = [];

    public string? Locale { get; init; }

    public decimal? TimeMultiplier { get; init; }

    public IReadOnlyList<string>? Aids { get; init; }

    public DateTimeOffset? ExpiresAt { get; init; }
}

public sealed class ProviderAssignInstrumentBody
{
    public string Instrument { get; init; } = string.Empty;

    public string? Reason { get; init; }
}

/// <summary>OpenAPI request schema for a binding.</summary>
public sealed class ProviderBindingBody
{
    public Guid OrganizationId { get; init; }

    public IReadOnlyList<string> Instruments { get; init; } = [];

    public string DefaultLocale { get; init; } = string.Empty;
}
