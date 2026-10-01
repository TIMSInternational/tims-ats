using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Access;
using Tims.Application.Identity;
using Tims.Application.People;
using Tims.Domain.Access;
using Tims.Domain.Identity;
using Tims.Domain.People;

namespace Tims.Api.People;

/// <summary>
/// Tenant "assignable people" directory for pickers (interview evaluators, vacancy approvers, offer
/// approvers). Replaces the pickers' dependency on tRPC <c>user.list</c>, which requires <c>user:read</c>
/// — a grant recruiters deliberately do not hold. Authorization follows the action the picker serves, and
/// the response is the minimal projection a picker renders. Dark unless TenantPeopleDirectoryEnabled.
/// </summary>
public static class TenantPeopleEndpoints
{
    public static void MapTenantPeopleEndpoints(this WebApplication app)
    {
        app.MapGet("/tenant/people/assignable", async (
            string? purpose, string? search, int? limit, string? vacancyId,
            ClaimsPrincipal user, HttpContext httpContext,
            PrincipalResolver principalResolver, PermissionService permissionService,
            IOptions<PlatformOptions> options, AssignablePeopleUseCase useCase,
            IAnchorLoaderFactory anchorLoaderFactory,
            CancellationToken cancellationToken) =>
        {
            // Bind as raw values and validate here: bounds are enforced before any identity or DB work.
            if (!AssignablePurposes.TryParse(purpose, out var parsedPurpose)
                || search is { Length: > AssignablePurposes.MaxSearchLength }
                || limit is < 1 or > AssignablePurposes.MaxLimit)
            {
                return Results.BadRequest(new { error = "invalid_input" });
            }

            // ?vacancyId narrows the vacancy approver picker to approvers whose scope covers that vacancy. It is
            // meaningless for the other purposes, so it is rejected there rather than silently ignored.
            Guid? parsedVacancyId = null;
            if (vacancyId is not null)
            {
                if (parsedPurpose != AssignablePurpose.VacancyApprover || !Guid.TryParseExact(vacancyId, "D", out var id))
                    return Results.BadRequest(new { error = "invalid_input" });
                parsedVacancyId = id;
            }

            var rule = AssignablePurposes.RuleFor(parsedPurpose);
            AccessScope callerScope;
            var context = await ResolveAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
            if (context is null) return Results.Unauthorized();
            if (rule.CallerModule is null || rule.CallerAction is null)
            {
                // No caller permission (colleague): any resolved staff member of an organization. An org-less
                // principal (platform owner) has no directory; a non-staff principal (external) is refused.
                if (string.IsNullOrEmpty(context.OrganizationId))
                    return Results.BadRequest(new { error = "organization_required" });
                if (context.PrincipalType != PrincipalType.OrgUser || !AssignablePurposes.IsAnyStaffMember(context.Roles))
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                callerScope = AccessScope.Organization;
            }
            else try
            {
                var decision = await permissionService.CheckAsync(
                    context, rule.CallerModule, rule.CallerAction, cancellationToken);
                if (!decision.Allowed || decision.Scope is not { } scope || decision.Roles is null)
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                // The unfiltered directory needs org-wide scope (AssignablePurposes.CallerScopeAllows).
                if (!AssignablePurposes.CallerScopeAllows(rule, scope))
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                callerScope = scope;
            }
            catch (TenantOrgRequiredException)
            {
                return Results.BadRequest(new { error = "organization_required" });
            }
            if (!Guid.TryParse(context.OrganizationId, out var organizationId))
                return Results.BadRequest(new { error = "organization_required" });

            // The caller's own vacancy:update scope must cover ?vacancyId (as submitForApproval requires first).
            VacancyApproverFilter? vacancyFilter = null;
            if (parsedVacancyId is { } requestedVacancy)
            {
                if (!Guid.TryParse(context.UserId, out var callerId))
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                vacancyFilter = new VacancyApproverFilter(requestedVacancy, callerId, callerScope);
            }

            // A subject-scoped purpose held below org scope lists only the caller's subject set — exactly the people
            // the mutation's assertSubjectInScope accepts (own → self, team → led teams' members, unit → unit members).
            IReadOnlyCollection<Guid>? subjects = null;
            if (AssignablePurposes.NeedsSubjectFilter(rule, callerScope))
            {
                if (!Guid.TryParse(context.UserId, out var subjectCaller))
                    return Results.StatusCode(StatusCodes.Status403Forbidden);
                subjects = await SubjectIdsAsync(anchorLoaderFactory, organizationId, subjectCaller, callerScope, cancellationToken);
            }

            var result = await useCase.ListAsync(organizationId, parsedPurpose, search,
                limit ?? AssignablePurposes.DefaultLimit, vacancyFilter, subjects, cancellationToken);
            // Unknown, soft-deleted, other-tenant and out-of-caller-scope vacancies are indistinguishable.
            return result is null ? Results.NotFound(new { error = "vacancy_not_found" }) : Results.Ok(result);
        })
        .RequireAuthorization()
        .Produces<AssignablePeopleResult>(StatusCodes.Status200OK)
        .Produces(StatusCodes.Status400BadRequest)
        .Produces(StatusCodes.Status401Unauthorized)
        .Produces(StatusCodes.Status403Forbidden)
        .Produces(StatusCodes.Status404NotFound)
        .WithName("TenantPeopleListAssignable");
    }

    /// <summary>The caller's subject set for a narrow scope, resolved with the same anchors SubjectInScope reads.</summary>
    private static async Task<IReadOnlyCollection<Guid>> SubjectIdsAsync(
        IAnchorLoaderFactory anchorLoaderFactory, Guid organizationId, Guid callerId, AccessScope scope,
        CancellationToken cancellationToken)
    {
        if (scope == AccessScope.Own) return [callerId];
        var anchors = anchorLoaderFactory.Create(organizationId, callerId);
        try
        {
            var ids = scope == AccessScope.Team
                ? await anchors.TeamMemberIdsAsync(cancellationToken)
                : await anchors.UnitMemberIdsAsync(cancellationToken);
            return ids.Select(Guid.Parse).ToHashSet();
        }
        finally
        {
            if (anchors is IAsyncDisposable disposable) await disposable.DisposeAsync();
        }
    }

    private static async Task<TenantContext?> ResolveAsync(
        ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
        PlatformOptions options, CancellationToken cancellationToken)
    {
        if (httpContext.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var value)
            && value is ResolvedPrincipal resolved)
        {
            return resolved.Context;
        }
        var sub = user.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(sub)) return null;
        var resolution = await principalResolver.ResolveStaffAsync(sub,
            httpContext.Request.Headers.Cookie.ToString(), options.ImpersonationSecret,
            DateTime.UtcNow, cancellationToken);
        return resolution is { Resolved: true } ? resolution.Context : null;
    }
}
