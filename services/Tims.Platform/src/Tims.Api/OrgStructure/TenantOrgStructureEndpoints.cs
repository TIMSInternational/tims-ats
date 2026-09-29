using System.Security.Claims;
using Microsoft.Extensions.Options;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Application.Identity;
using Tims.Application.OrgStructure;
using Tims.Domain.OrgStructure;

namespace Tims.Api.OrgStructure;

/// <summary>
/// Tenant org structure (business units, teams, leaders, members, unit assignees, home units) — the data
/// leader- and unit-scoped approvals anchor on, which no UI could previously create. Reads/writes run under
/// TenantScope with explicit org predicates; ids from another tenant are 404; every write is audited in its
/// own transaction. Management requires <c>organization:*</c> at organization/company scope; the vacancy
/// picker options accept organization:read OR vacancy:create OR vacancy:update and expose no people data.
/// Dark unless <see cref="PlatformOptions.TenantOrgStructureEnabled"/>.
/// </summary>
public static class TenantOrgStructureEndpoints
{
    private const string Base = "/tenant/org-structure";

    public static void MapTenantOrgStructureEndpoints(this WebApplication app)
    {
        app.MapGet(Base, async ([AsParameters] Deps deps, CancellationToken ct) =>
            {
                var (actor, failure) = await deps.GateAsync("read", ct);
                return failure ?? Results.Ok(await deps.UseCase.ReadStructureAsync(actor!.OrganizationId, ct));
            })
            .Describe<OrgStructureView>("TenantOrgStructureRead", StatusCodes.Status200OK);

        app.MapGet(Base + "/options", async ([AsParameters] Deps deps, CancellationToken ct) =>
            {
                var (actor, failure) = await deps.GateAsync(ct, requireOrgScope: false,
                    ("organization", "read"), ("vacancy", "create"), ("vacancy", "update"));
                return failure ?? Results.Ok(await deps.UseCase.ReadOptionsAsync(actor!.OrganizationId, ct));
            })
            .Describe<OrgStructureOptions>("TenantOrgStructureOptions", StatusCodes.Status200OK);

        app.MapPost(Base + "/business-units", async ([AsParameters] Deps deps, TimeProvider clock, CancellationToken ct) =>
            {
                var (actor, failure) = await deps.GateAsync("create", ct);
                if (failure is not null) return failure;
                var body = await OrgStructureGate.ReadObjectAsync(deps.Http, false, ct);
                if (body is null || !OrgStructureBodies.TryCreateBusinessUnit(body, out var input)) return Invalid();
                return OrgStructureGate.ToResult(await deps.UseCase.CreateBusinessUnitAsync(actor!, input, Now(clock), ct));
            })
            .Accepts<CreateBusinessUnitBody>("application/json")
            .Describe<BusinessUnitRow>("TenantOrgStructureCreateBusinessUnit", StatusCodes.Status201Created);

        app.MapPatch(Base + "/business-units/{id:guid}", async (Guid id, [AsParameters] Deps deps, TimeProvider clock, CancellationToken ct) =>
            {
                var (actor, failure) = await deps.GateAsync("update", ct);
                if (failure is not null) return failure;
                var body = await OrgStructureGate.ReadObjectAsync(deps.Http, false, ct);
                if (body is null || !OrgStructureBodies.TryUpdateBusinessUnit(body, out var input)) return Invalid();
                return OrgStructureGate.ToResult(await deps.UseCase.UpdateBusinessUnitAsync(actor!, id, input, Now(clock), ct));
            })
            .Accepts<UpdateBusinessUnitBody>("application/json")
            .Describe<BusinessUnitRow>("TenantOrgStructureUpdateBusinessUnit", StatusCodes.Status200OK, conflict: true);

        app.MapPost(Base + "/teams", async ([AsParameters] Deps deps, TimeProvider clock, CancellationToken ct) =>
            {
                var (actor, failure) = await deps.GateAsync("create", ct);
                if (failure is not null) return failure;
                var body = await OrgStructureGate.ReadObjectAsync(deps.Http, false, ct);
                if (body is null || !OrgStructureBodies.TryCreateTeam(body, out var input)) return Invalid();
                return OrgStructureGate.ToResult(await deps.UseCase.CreateTeamAsync(actor!, input, Now(clock), ct));
            })
            .Accepts<CreateTeamBody>("application/json")
            .Describe<TeamRow>("TenantOrgStructureCreateTeam", StatusCodes.Status201Created, conflict: true);

        app.MapPatch(Base + "/teams/{id:guid}", async (Guid id, [AsParameters] Deps deps, TimeProvider clock, CancellationToken ct) =>
            {
                var (actor, failure) = await deps.GateAsync("update", ct);
                if (failure is not null) return failure;
                var body = await OrgStructureGate.ReadObjectAsync(deps.Http, false, ct);
                if (body is null || !OrgStructureBodies.TryUpdateTeam(body, out var input)) return Invalid();
                return OrgStructureGate.ToResult(await deps.UseCase.UpdateTeamAsync(actor!, id, input, Now(clock), ct));
            })
            .Accepts<UpdateTeamBody>("application/json")
            .Describe<TeamRow>("TenantOrgStructureUpdateTeam", StatusCodes.Status200OK, conflict: true);

        app.MapPut(Base + "/teams/{id:guid}/members/{userId:guid}", async (Guid id, Guid userId, [AsParameters] Deps deps, CancellationToken ct) =>
            {
                var (actor, failure) = await deps.GateAsync("update", ct);
                if (failure is not null) return failure;
                var body = await OrgStructureGate.ReadObjectAsync(deps.Http, true, ct);
                if (body is null || !OrgStructureBodies.TryMemberRole(body, out var role)) return Invalid();
                return OrgStructureGate.ToResult(await deps.UseCase.PutTeamMemberAsync(actor!, id, userId, role, ct));
            })
            .Accepts<PutTeamMemberBody>("application/json")
            .Describe<TeamMembershipRow>("TenantOrgStructurePutTeamMember", StatusCodes.Status200OK, conflict: true);

        app.MapDelete(Base + "/teams/{id:guid}/members/{userId:guid}", async (Guid id, Guid userId, [AsParameters] Deps deps, CancellationToken ct) =>
            {
                var (actor, failure) = await deps.GateAsync("update", ct);
                return failure ?? OrgStructureGate.ToResult(await deps.UseCase.DeleteTeamMemberAsync(actor!, id, userId, ct));
            })
            .Describe<object>("TenantOrgStructureDeleteTeamMember", StatusCodes.Status204NoContent);

        app.MapPut(Base + "/business-units/{id:guid}/assignees/{userId:guid}", async (Guid id, Guid userId, [AsParameters] Deps deps, TimeProvider clock, CancellationToken ct) =>
            {
                var (actor, failure) = await deps.GateAsync("update", ct);
                return failure ?? OrgStructureGate.ToResult(await deps.UseCase.PutUnitAssigneeAsync(actor!, id, userId, Now(clock), ct));
            })
            .Describe<UnitAssignmentRow>("TenantOrgStructurePutUnitAssignee", StatusCodes.Status200OK, conflict: true);

        app.MapDelete(Base + "/business-units/{id:guid}/assignees/{userId:guid}", async (Guid id, Guid userId, [AsParameters] Deps deps, CancellationToken ct) =>
            {
                var (actor, failure) = await deps.GateAsync("update", ct);
                return failure ?? OrgStructureGate.ToResult(await deps.UseCase.DeleteUnitAssigneeAsync(actor!, id, userId, ct));
            })
            .Describe<object>("TenantOrgStructureDeleteUnitAssignee", StatusCodes.Status204NoContent);

        app.MapPut(Base + "/users/{userId:guid}/business-unit", async (Guid userId, [AsParameters] Deps deps, TimeProvider clock, CancellationToken ct) =>
            {
                var (actor, failure) = await deps.GateAsync("update", ct);
                if (failure is not null) return failure;
                var body = await OrgStructureGate.ReadObjectAsync(deps.Http, false, ct);
                if (body is null || !OrgStructureBodies.TryUserBusinessUnit(body, out var unitId)) return Invalid();
                return OrgStructureGate.ToResult(await deps.UseCase.SetUserBusinessUnitAsync(actor!, userId, unitId, Now(clock), ct));
            })
            .Accepts<SetUserBusinessUnitBody>("application/json")
            .Describe<UserBusinessUnitRow>("TenantOrgStructureSetUserBusinessUnit", StatusCodes.Status200OK, conflict: true);
    }

    private static IResult Invalid() =>
        OrgStructureGate.Error(StatusCodes.Status400BadRequest, OrgStructureErrorCodes.InvalidInput);

    private static DateTime Now(TimeProvider clock) => clock.GetUtcNow().UtcDateTime;

    private static RouteHandlerBuilder Describe<T>(this RouteHandlerBuilder builder, string name, int success, bool conflict = false)
    {
        builder.RequireAuthorization().WithName(name)
            .Produces(StatusCodes.Status401Unauthorized).Produces(StatusCodes.Status403Forbidden)
            .Produces<OrgStructureError>(StatusCodes.Status400BadRequest)
            .Produces<OrgStructureError>(StatusCodes.Status404NotFound);
        if (success == StatusCodes.Status204NoContent) builder.Produces(success);
        else builder.Produces<T>(success);
        if (conflict) builder.Produces<OrgStructureError>(StatusCodes.Status409Conflict);
        return builder;
    }

    /// <summary>
    /// Per-request dependencies, bound with [AsParameters] (a record: each constructor parameter matches a
    /// property, which is what the binder requires) to keep each handler signature short.
    /// </summary>
    internal sealed record Deps(
        ClaimsPrincipal User, HttpContext Http, PrincipalResolver PrincipalResolver,
        PermissionService PermissionService, IOptions<PlatformOptions> Options, OrgStructureUseCase UseCase)
    {
        public Task<(OrgActor? Actor, IResult? Failure)> GateAsync(string organizationAction, CancellationToken ct) =>
            GateAsync(ct, requireOrgScope: true, (OrgStructureGate.OrganizationModule, organizationAction));

        public Task<(OrgActor? Actor, IResult? Failure)> GateAsync(
            CancellationToken ct, bool requireOrgScope, params (string Module, string Action)[] anyOf) =>
            OrgStructureGate.AuthorizeAsync(User, Http, PrincipalResolver, PermissionService, Options.Value,
                requireOrgScope, anyOf, ct);
    }
}
