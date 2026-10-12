using System.Security.Claims;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Api.CandidateConsent;

/// <summary>
/// Staff-JWT gate for the candidate consent surface — the C# analog of <c>permissionProcedure('candidate', action)</c>.
/// Same mechanics as <c>AssessmentStaffGate</c>: resolve the TIMS staff principal (the
/// <see cref="PrincipalResolutionMiddleware"/> stash, else <see cref="PrincipalResolver"/>), then enforce
/// <c>candidate:&lt;action&gt;</c> through the shared <see cref="PermissionService"/> kernel.
///   unresolvable principal → 401; denied grant OR null scope → 403; privileged org-less caller → 400.
/// The endpoints additionally require org/company scope: consent status and withdrawal are an organization-level
/// privacy duty, not a per-team view.
/// </summary>
public static class CandidateConsentStaffGate
{
    private const string CandidateModule = "candidate";

    public static async Task<CandidateConsentGateResult> AuthorizeAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PermissionService permissionService,
        PlatformOptions options,
        string action,
        CancellationToken cancellationToken)
    {
        var context = await ResolvePrincipalAsync(user, httpContext, principalResolver, options, cancellationToken);
        if (context is null)
        {
            return CandidateConsentGateResult.Fail(Results.StatusCode(StatusCodes.Status401Unauthorized));
        }

        AccessDecision decision;
        try
        {
            decision = await permissionService.CheckAsync(context, CandidateModule, action, cancellationToken);
        }
        catch (TenantOrgRequiredException)
        {
            return CandidateConsentGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        if (!decision.Allowed || decision.Scope is not { } scope)
        {
            return CandidateConsentGateResult.Fail(Results.StatusCode(StatusCodes.Status403Forbidden));
        }

        // The org is the tenant boundary for every write: an org-less caller (non-impersonating platform owner) or a
        // malformed id never reaches the repository.
        if (!Guid.TryParse(context.OrganizationId, out var organizationId) || organizationId == Guid.Empty
            || !Guid.TryParse(context.UserId, out var userId))
        {
            return CandidateConsentGateResult.Fail(Results.BadRequest(new { error = "organization_required" }));
        }

        return CandidateConsentGateResult.Ok(organizationId, userId, scope);
    }

    private static async Task<TenantContext?> ResolvePrincipalAsync(
        ClaimsPrincipal user,
        HttpContext httpContext,
        PrincipalResolver principalResolver,
        PlatformOptions options,
        CancellationToken cancellationToken)
    {
        if (httpContext.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var stashed)
            && stashed is ResolvedPrincipal resolvedPrincipal)
        {
            return resolvedPrincipal.Context;
        }

        var sub = user.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(sub))
        {
            return null;
        }

        var resolution = await principalResolver.ResolveStaffAsync(
            sub,
            httpContext.Request.Headers.Cookie.ToString(),
            options.ImpersonationSecret,
            DateTime.UtcNow,
            cancellationToken);

        return resolution is { Resolved: true, Context: { } context } ? context : null;
    }
}

/// <summary>Outcome of <see cref="CandidateConsentStaffGate"/>: the resolved principal + scope, or the failure to return.</summary>
public readonly struct CandidateConsentGateResult
{
    private CandidateConsentGateResult(Guid organizationId, Guid userId, AccessScope? scope, IResult? failure)
    {
        OrganizationId = organizationId;
        UserId = userId;
        Scope = scope;
        Failure = failure;
    }

    public Guid OrganizationId { get; }

    public Guid UserId { get; }

    public AccessScope? Scope { get; }

    public IResult? Failure { get; }

    public static CandidateConsentGateResult Ok(Guid organizationId, Guid userId, AccessScope scope) =>
        new(organizationId, userId, scope, null);

    public static CandidateConsentGateResult Fail(IResult failure) => new(Guid.Empty, Guid.Empty, null, failure);
}
