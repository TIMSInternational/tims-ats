using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Audit;
using Tims.Api.Configuration;
using Tims.Application.Assessments.Providers;
using Tims.Application.Identity;

namespace Tims.Api.Assessments;

/// <summary>
/// Round 12: the platform owner's binding tools (the runbook found none). Platform owner only, dark behind
/// <c>Platform:AssessmentProvidersEnabled</c>; the org is a path parameter (a platform owner acts across orgs).
/// <list type="bullet">
///   <item><description><c>GET .../organizations/{organizationId}/binding</c> — the binding (in force or not), its provider
///   tenant, instruments and default locale, and the open work an unbind would strand. 404 for an unknown or inactive
///   org. <c>no-store</c>.</description></item>
///   <item><description><c>POST .../organizations/{organizationId}/binding/unbind</c> — body
///   <c>{ "cancelOpenAttempts": bool }</c>. Refused (409 <c>binding_has_open_work</c>, nothing changed) while open work
///   remains; with <c>cancelOpenAttempts</c> (the console's confirmation) it first cancels every sitting that has not
///   finished, at the provider first, and unbinds only if nothing is left. 200 when unbound; 404 not bound.</description></item>
/// </list>
/// Binding itself is <c>POST /platform/assessment-providers/bindings</c>; DSAR export and erasure are
/// <see cref="ProviderSubjectRightsEndpoints"/>. Every write is audited by its repository in the same transaction.
/// </summary>
public static class ProviderBindingAdminEndpoints
{
    public const string BindingPath = "/platform/assessment-providers/organizations/{organizationId:guid}/binding";

    public static void MapProviderBindingAdminEndpoints(this WebApplication app)
    {
        app.MapGet(BindingPath, async (
                Guid organizationId, ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions, ProviderBindingAdminUseCase useCase,
                CancellationToken cancellationToken) =>
            {
                httpContext.Response.Headers.CacheControl = "no-store";
                var gate = await PlatformOwnerGate.AuthorizeAsync(
                    user, httpContext, principalResolver, platformOptions.Value, cancellationToken);
                if (gate.Failure is not null)
                {
                    return gate.Failure;
                }

                var state = await useCase.GetStateAsync(organizationId, cancellationToken);
                return state is null ? Results.NotFound() : Results.Ok(ProviderBindingStateView.From(state));
            })
            .RequireAuthorization()
            .Produces<ProviderBindingStateView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces(StatusCodes.Status404NotFound)
            .WithName("AssessmentProviderBindingState")
            .WithTags("AssessmentProviders");

        app.MapPost(BindingPath + "/unbind", async (
                Guid organizationId, ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
                IOptions<PlatformOptions> platformOptions, ProviderBindingAdminUseCase useCase, TimeProvider timeProvider,
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
                if (!node.Ok || !ProviderBindingAdminUseCase.TryParseUnbindBody(node.Node, out var cancelOpenAttempts))
                {
                    return Results.BadRequest(new { error = "invalid_input" });
                }

                var result = await useCase.UnbindAsync(
                    organizationId, actorId, cancelOpenAttempts, timeProvider.GetUtcNow(), cancellationToken);
                var view = new ProviderUnbindView(
                    result.Outcome == ProviderUnbindOutcome.Unbound, ProviderOpenWorkView.From(result.OpenWork),
                    result.Cancelled, result.CancelFailed);
                return result.Outcome switch
                {
                    ProviderUnbindOutcome.Unbound => Results.Ok(view),
                    ProviderUnbindOutcome.Blocked => Results.Json(
                        new ProviderUnbindBlockedView("binding_has_open_work", view.OpenWork, view.Cancelled, view.CancelFailed),
                        statusCode: StatusCodes.Status409Conflict),
                    ProviderUnbindOutcome.NotBound => Results.NotFound(new { error = "not_bound" }),
                    _ => Results.NotFound(),
                };
            })
            .RequireAuthorization()
            .Accepts<ProviderUnbindBody>("application/json")
            .Produces<ProviderUnbindView>(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest).Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden).Produces(StatusCodes.Status404NotFound)
            .Produces<ProviderUnbindBlockedView>(StatusCodes.Status409Conflict)
            .WithName("AssessmentProviderUnbind")
            .WithTags("AssessmentProviders");
    }
}

/// <summary>The open work an unbind would strand (see <see cref="ProviderOpenWork"/>).</summary>
public sealed record ProviderOpenWorkView(
    int Cancellable, int AwaitingResult, int PendingWithdrawals, int CancelPending, int CreatesInFlight)
{
    public static ProviderOpenWorkView From(ProviderOpenWork work) =>
        new(work.Cancellable, work.AwaitingResult, work.PendingWithdrawals, work.CancelPending, work.CreatesInFlight);
}

/// <summary>An org's binding for the platform owner: <c>Bound</c> (a row exists) and <c>Active</c> (in force).</summary>
public sealed record ProviderBindingStateView(
    bool Bound,
    bool Active,
    string? ProviderTenantId,
    IReadOnlyList<string> EnabledInstruments,
    string? DefaultLocale,
    DateTimeOffset? UpdatedAt,
    ProviderOpenWorkView OpenWork)
{
    public static ProviderBindingStateView From(ProviderBindingState state) =>
        new(state.Bound, state.Active, state.ProviderTenantId?.ToString(), state.EnabledInstruments, state.DefaultLocale,
            state.UpdatedAt, ProviderOpenWorkView.From(state.OpenWork));
}

/// <summary>OpenAPI request schema for an unbind.</summary>
public sealed class ProviderUnbindBody
{
    /// <summary>Cancel every sitting that has not finished first (the console's confirmation). Default false.</summary>
    public bool? CancelOpenAttempts { get; init; }
}

/// <param name="Cancelled">Sittings this request cancelled.</param>
/// <param name="CancelFailed">Sittings this request could not cancel (they still block).</param>
public sealed record ProviderUnbindView(bool Unbound, ProviderOpenWorkView OpenWork, int Cancelled, int CancelFailed);

public sealed record ProviderUnbindBlockedView(string Error, ProviderOpenWorkView OpenWork, int Cancelled, int CancelFailed);
