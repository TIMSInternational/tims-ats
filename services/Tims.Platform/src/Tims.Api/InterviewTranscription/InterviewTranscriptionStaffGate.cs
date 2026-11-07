using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;
using Tims.Infrastructure.Access;

namespace Tims.Api.InterviewTranscription;

/// <summary>
/// Staff-JWT gate for the interview transcription surface — the C# analog of <c>permissionProcedure('interview', action)</c>
/// followed by <c>assertScoped('interview', id)</c> (the same pair interview.getVideoToken / createVideoRoom run):
/// unresolvable principal → 401; denied grant or null scope → 403; org-less caller → 400; out-of-scope or foreign
/// interview → 404 (never confirms the id exists).
/// </summary>
public static class InterviewTranscriptionStaffGate
{
    private const string InterviewModule = "interview";

    public static async Task<InterviewTranscriptionGateResult> AuthorizeAsync(
        Guid interviewId,
        string action,
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        IAnchorLoaderFactory anchorLoaderFactory,
        ScopedProbe scopedProbe,
        CancellationToken cancellationToken)
    {
        var context = await ResolvePrincipalAsync(user, httpContext, principalResolver, options, cancellationToken);
        if (context is null) return InterviewTranscriptionGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));

        AccessDecision decision;
        try
        {
            decision = await permissionService.CheckAsync(context, InterviewModule, action, cancellationToken);
        }
        catch (TenantOrgRequiredException)
        {
            return InterviewTranscriptionGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        if (!decision.Allowed || decision.Scope is not { } scope)
            return InterviewTranscriptionGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));

        if (!Guid.TryParse(context.OrganizationId, out var organizationId) || organizationId == Guid.Empty
            || !Guid.TryParse(context.UserId, out var userId))
            return InterviewTranscriptionGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));

        var anchors = anchorLoaderFactory.Create(organizationId, userId);
        try
        {
            await scopedProbe.AssertScopedAsync(ScopedEntity.Interview, interviewId, scope, anchors, organizationId,
                userId, cancellationToken);
        }
        catch (ScopedNotFoundException)
        {
            return InterviewTranscriptionGateResult.Fail(Results.NotFound(new
            {
                code = "not_found",
                message = Tims.Application.InterviewTranscription.InterviewTranscriptionUseCase.NotFoundMessage,
            }));
        }
        finally
        {
            if (anchors is IAsyncDisposable disposable) await disposable.DisposeAsync();
        }

        return InterviewTranscriptionGateResult.Ok(organizationId, userId);
    }

    private static async Task<TenantContext?> ResolvePrincipalAsync(ClaimsPrincipal user, HttpContext httpContext,
        PrincipalResolver principalResolver, PlatformOptions options, CancellationToken cancellationToken)
    {
        if (httpContext.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var stashed)
            && stashed is ResolvedPrincipal resolvedPrincipal)
            return resolvedPrincipal.Context;

        var sub = user.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(sub)) return null;

        var resolution = await principalResolver.ResolveStaffAsync(sub, httpContext.Request.Headers.Cookie.ToString(),
            options.ImpersonationSecret, DateTime.UtcNow, cancellationToken);
        return resolution is { Resolved: true, Context: { } context } ? context : null;
    }
}

/// <summary>The resolved organization + user, or the failure to return.</summary>
public readonly struct InterviewTranscriptionGateResult
{
    private InterviewTranscriptionGateResult(Guid organizationId, Guid userId, IResult? failure)
    {
        OrganizationId = organizationId;
        UserId = userId;
        Failure = failure;
    }

    public Guid OrganizationId { get; }

    public Guid UserId { get; }

    public IResult? Failure { get; }

    public static InterviewTranscriptionGateResult Ok(Guid organizationId, Guid userId) => new(organizationId, userId, null);

    public static InterviewTranscriptionGateResult Fail(IResult failure) => new(Guid.Empty, Guid.Empty, failure);
}
