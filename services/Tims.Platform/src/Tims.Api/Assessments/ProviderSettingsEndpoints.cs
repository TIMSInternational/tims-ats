using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.AssessmentTypes;
using Tims.Api.Configuration;
using Tims.Application.Assessments.Providers;
using Tims.Application.Identity;
using Tims.Domain.Access;

namespace Tims.Api.Assessments;

/// <summary>
/// The organization's assessment security settings (proctoring parity with tims-suite, owner decision 2026-11-11), dark
/// behind <see cref="PlatformOptions.AssessmentProvidersEnabled"/>:
/// <list type="bullet">
///   <item><description><c>GET /assessments/provider-settings/proctoring</c> — <c>assessment:read</c> + org scope. The
///   settings (every one off when never saved) and whether the identity check can be offered
///   (<see cref="PlatformOptions.AssessmentIdentityCheckEnabled"/>). 200 / 401 / 403.</description></item>
///   <item><description><c>PUT /assessments/provider-settings/proctoring</c> — <c>assessment:update</c> + org scope (the
///   permission and scope HR's assessment configuration uses, as the assessment-type writes). Strict body
///   <c>{ lockdown, antiCheat: { threshold 1..20, consequence warn|auto_submit|void } | null, identityCheck }</c>.
///   Audited (<c>assessment_provider_settings_updated</c>). Applies to assignments created afterwards. 200 / 400 / 401 /
///   403 / 422 <c>identity_check_unavailable</c>.</description></item>
/// </list>
/// Order: auth (401/403) → body (400) → org scope (403) → write. The org is always the caller's resolved org.
/// </summary>
public static class ProviderSettingsEndpoints
{
    public const string ProctoringPath = "/assessments/provider-settings/proctoring";

    public static void MapProviderSettingsEndpoints(this WebApplication app)
    {
        app.MapGet(ProctoringPath, async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                ProviderProctoringSettingsUseCase useCase, CancellationToken cancellationToken) =>
            {
                var gate = await AssessmentStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, "read", cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                return Results.Ok(await useCase.GetAsync(
                    gate.OrganizationId, platformOptions.Value.AssessmentIdentityCheckEnabled, cancellationToken));
            })
            .RequireAuthorization()
            .Produces<ProctoringSettingsView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .WithName("AssessmentProviderProctoringSettingsGet")
            .WithTags("AssessmentProviders");

        app.MapPut(ProctoringPath, async (
                ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                PermissionService permissionService, IOptions<PlatformOptions> platformOptions,
                ProviderProctoringSettingsUseCase useCase, TimeProvider timeProvider, CancellationToken cancellationToken) =>
            {
                var gate = await AssessmentStaffGate.AuthorizeAsync(
                    user, httpContext, principalResolver, permissionService, platformOptions.Value, "update",
                    cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var node = await ProviderEndpointJson.TryReadAsync(httpContext, cancellationToken);
                if (!node.Ok || !ProviderProctoringSettingsUseCase.TryParseBody(node.Node, out var settings))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                if (!OrgGate.RequireOrgScopeSatisfied(gate.Scope!.Value))
                {
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                }

                var result = await useCase.UpdateAsync(
                    gate.OrganizationId, gate.UserId, settings, platformOptions.Value.AssessmentIdentityCheckEnabled,
                    timeProvider.GetUtcNow(), cancellationToken);
                return result.Outcome == ProctoringSettingsOutcome.Ok
                    ? Results.Ok(result.View)
                    : Results.UnprocessableEntity(new { error = "identity_check_unavailable" });
            })
            .RequireAuthorization()
            .Accepts<ProctoringSettingsBody>("application/json")
            .Produces<ProctoringSettingsView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status422UnprocessableEntity)
            .WithName("AssessmentProviderProctoringSettingsPut")
            .WithTags("AssessmentProviders");
    }
}

/// <summary>OpenAPI request schema for the proctoring settings. The handler parses the raw JSON strictly.</summary>
public sealed class ProctoringSettingsBody
{
    public bool Lockdown { get; init; }

    public ProctoringAntiCheatBody? AntiCheat { get; init; }

    public bool IdentityCheck { get; init; }
}

public sealed class ProctoringAntiCheatBody
{
    /// <summary>Countable violations before the consequence applies, 1..20.</summary>
    public int Threshold { get; init; }

    /// <summary><c>warn</c>, <c>auto_submit</c> or <c>void</c>.</summary>
    public string Consequence { get; init; } = string.Empty;
}
