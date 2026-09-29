using System.Security.Claims;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Api.Http;
using Tims.Application.Identity;
using Tims.Application.OrgStructure;
using Tims.Domain.Access;
using Tims.Domain.Identity;
using Tims.Domain.OrgStructure;

namespace Tims.Api.OrgStructure;

/// <summary>
/// Staff-JWT gate for the tenant org-structure surface — the analog of <c>permissionProcedure</c>. The caller
/// must hold ONE of the listed (module, action) grants; management actions (<c>organization:*</c>) are
/// org governance and additionally require organization/company scope (a narrow grant → 403). The org
/// always comes from the resolved session, never from input.
///   unresolvable principal → 401; no grant / narrow scope → 403; privileged org-less → 400.
/// </summary>
public static class OrgStructureGate
{
    public const string OrganizationModule = "organization";

    public static async Task<(OrgActor? Actor, IResult? Failure)> AuthorizeAsync(
        ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
        PermissionService permissionService, PlatformOptions options, bool requireOrgScope,
        IReadOnlyList<(string Module, string Action)> anyOf, CancellationToken ct)
    {
        var context = await ResolveAsync(user, httpContext, principalResolver, options, ct);
        if (context is null) return (null, Results.StatusCode(StatusCodes.Status401Unauthorized));

        var allowed = false;
        try
        {
            foreach (var (module, action) in anyOf)
            {
                var decision = await permissionService.CheckAsync(context, module, action, ct);
                if (decision is { Allowed: true, Scope: { } scope }
                    && (!requireOrgScope || OrgGate.RequireOrgScopeSatisfied(scope)))
                {
                    allowed = true;
                    break;
                }
            }
        }
        catch (TenantOrgRequiredException)
        {
            return (null, Error(StatusCodes.Status400BadRequest, "organization_required"));
        }

        if (!allowed) return (null, Results.StatusCode(StatusCodes.Status403Forbidden));
        if (!Guid.TryParse(context.OrganizationId, out var organizationId) || !Guid.TryParse(context.UserId, out var actorId))
        {
            return (null, Error(StatusCodes.Status400BadRequest, "organization_required"));
        }

        var userAgent = httpContext.Request.Headers.UserAgent.ToString();
        return (new OrgActor(organizationId, actorId, httpContext.ClientIpFor(),
            string.IsNullOrEmpty(userAgent) ? null : userAgent[..Math.Min(userAgent.Length, 512)]), null);
    }

    public static IResult Error(int status, string code) =>
        Results.Json(new OrgStructureError(code, MessageFor(code)), statusCode: status);

    public static IResult ToResult<T>(OrgWriteResult<T> result) => result.Status switch
    {
        OrgWriteStatus.Ok => Results.Ok(result.Row),
        OrgWriteStatus.Created => Results.Json(result.Row, statusCode: StatusCodes.Status201Created),
        OrgWriteStatus.NoContent => Results.NoContent(),
        OrgWriteStatus.NotFound => Error(StatusCodes.Status404NotFound, result.Code ?? OrgStructureErrorCodes.NotFound),
        OrgWriteStatus.Conflict => Error(StatusCodes.Status409Conflict, result.Code ?? "conflict"),
        _ => Error(StatusCodes.Status400BadRequest, result.Code ?? OrgStructureErrorCodes.InvalidInput),
    };

    /// <summary>Reads the body as a JSON object; null for malformed JSON or a non-object root.</summary>
    public static async Task<JsonObject?> ReadObjectAsync(HttpContext httpContext, bool allowEmpty, CancellationToken ct)
    {
        if (allowEmpty && httpContext.Request.ContentLength is null or 0 && !httpContext.Request.HasJsonContentType())
        {
            return [];
        }

        try
        {
            return await httpContext.Request.ReadFromJsonAsync<JsonNode>(ct) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }
        catch (InvalidOperationException)
        {
            return null;
        }
    }

    private static string MessageFor(string code) => code switch
    {
        OrgStructureErrorCodes.CompanyRequired => "Selecciona la empresa de la unidad de negocio",
        OrgStructureErrorCodes.NotFound => "Recurso no encontrado",
        OrgStructureErrorCodes.BusinessUnitHasActiveTeams => "La unidad de negocio tiene equipos activos",
        OrgStructureErrorCodes.BusinessUnitInactive => "La unidad de negocio esta inactiva",
        OrgStructureErrorCodes.TeamInactive => "El equipo esta inactivo",
        OrgStructureErrorCodes.UserInactive => "El usuario esta inactivo",
        "organization_required" => "Selecciona o impersona una organizacion",
        _ => "Datos invalidos",
    };

    private static async Task<TenantContext?> ResolveAsync(
        ClaimsPrincipal user, HttpContext httpContext, PrincipalResolver principalResolver,
        PlatformOptions options, CancellationToken ct)
    {
        if (httpContext.Items.TryGetValue(ResolvedPrincipal.HttpContextKey, out var value)
            && value is ResolvedPrincipal resolved)
        {
            return resolved.Context;
        }

        var sub = user.FindFirst("sub")?.Value;
        if (string.IsNullOrEmpty(sub)) return null;
        var resolution = await principalResolver.ResolveStaffAsync(sub,
            httpContext.Request.Headers.Cookie.ToString(), options.ImpersonationSecret, DateTime.UtcNow, ct);
        return resolution is { Resolved: true } ? resolution.Context : null;
    }
}

/// <summary>Error body for every non-2xx org-structure response that carries one.</summary>
public sealed record OrgStructureError(string Code, string Message);
