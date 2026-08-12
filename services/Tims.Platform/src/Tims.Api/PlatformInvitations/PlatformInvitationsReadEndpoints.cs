using System.Security.Claims;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Tims.Api.Audit;
using Tims.Api.Configuration;
using Tims.Api.Http;
using Tims.Application.Audit;
using Tims.Application.Identity;
using Tims.Application.PlatformInvitations;
using Tims.Domain.Audit;

namespace Tims.Api.PlatformInvitations;

/// <summary>
/// The platform-owner invitations READ endpoints (Phase-5 slice 22, issue #75) — the C# port of the THREE
/// read procedures in <c>routers/platform/invitations.ts</c>: <c>getInvitationKpis</c>,
/// <c>listInvitations</c> and <c>exportInvitationsCsv</c>.
///
/// <para><b>Gate: <see cref="PlatformOwnerGate"/>, reused not re-implemented.</b> It is the documented C#
/// analog of TS <c>platformProcedure</c> and already handles the case a fresh gate gets wrong — an
/// impersonated platform-owner session resolves to <c>PrincipalType.OrgUser</c>, so it is denied with no
/// special-case code, matching TS's <c>ctx.user.isPlatformOwner</c> check against the real, non-impersonated
/// row.</para>
///
/// <para><b>There is no second line of defence, and that is deliberate.</b> This surface is cross-org by
/// design and is never wrapped in <c>TenantScope</c>, so RLS restricts nothing here (and the prod login role
/// is BYPASSRLS regardless). The gate IS the authorization boundary — which is why it runs FIRST on every
/// endpoint, before any input validation, mirroring tRPC's middleware-before-Zod order. A non-owner sending
/// malformed input must get 403, not 400; the reverse leaks the existence of validation rules to callers who
/// are not allowed to know the endpoint exists.</para>
///
/// <para><b>The other SEVEN procedures in that router are NOT here, and four of them cannot be yet.</b>
/// <c>revokeInvitation</c> and <c>bulkInviteUsers</c> are writes that need their own one-active-writer flag
/// discipline rather than riding a read flag. <c>getInvitationByToken</c> and <c>acceptInvitation</c> are
/// <c>publicProcedure</c> — UNAUTHENTICATED, token-credentialed — which is a new auth shape for this service
/// and gets its own slice and its own threat model. <c>createOrgInvitation</c>,
/// <c>createUserInvitation</c> and <c>resendInvitation</c> all send email through
/// <c>packages/api/src/lib/ses.ts</c>, and this service has NO email capability at all (no AWS SDK, no SMTP,
/// no sender abstraction — measured, not assumed), so porting them today would produce endpoints that write
/// the row and silently never deliver the invitation. See the slice doc for the full split.</para>
///
/// <para>INTERNAL staff read ⇒ RAW procedure shape, NO <c>schemaVersion</c> envelope. Dark-by-default
/// behind <see cref="PlatformOptions.PlatformInvitationsReadEnabled"/>.</para>
/// </summary>
public static class PlatformInvitationsReadEndpoints
{
    public static void MapPlatformInvitationsReadEndpoints(this WebApplication app)
    {
        app.MapGet(
                "/platform/invitations/kpis",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformInvitationsReadUseCase useCase,
                    CancellationToken cancellationToken) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    return Results.Ok(await useCase.GetKpisAsync(cancellationToken));
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("GetPlatformInvitationKpis")
            .WithTags("PlatformInvitations");

        app.MapGet(
                "/platform/invitations",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformInvitationsReadUseCase useCase,
                    CancellationToken cancellationToken,
                    [FromQuery] int page = PlatformInvitationsReadUseCase.DefaultPage,
                    [FromQuery] int limit = PlatformInvitationsReadUseCase.DefaultLimit,
                    [FromQuery] string? type = null,
                    [FromQuery] string? status = null,
                    [FromQuery] string? search = null) =>
                {
                    // AUTH BEFORE VALIDATION — see the class docblock.
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    // The Zod bounds from `listInvitations`' input object. REJECTING rather than clamping is
                    // the parity behaviour: tRPC would throw BAD_REQUEST. Note `limit` maxes at 50 here, not
                    // the 100 that listOrganizations allows, and an unknown `type`/`status` is a 400 rather
                    // than an ignored filter (z.enum().optional(), not a tri-state).
                    if (page < 0
                        || limit < PlatformInvitationsReadUseCase.MinLimit
                        || limit > PlatformInvitationsReadUseCase.MaxLimit
                        || !PlatformInvitationsReadUseCase.IsValidSearch(search)
                        || !PlatformInvitationsReadUseCase.IsValidType(type)
                        || !PlatformInvitationsReadUseCase.IsValidStatus(status))
                    {
                        return Results.BadRequest();
                    }

                    // NormalizeSearch reproduces `if (search?.trim())` — trim first, then treat
                    // whitespace-only as no filter, and query with the TRIMMED value.
                    var query = new PlatformInvitationListQuery(
                        page,
                        limit,
                        type,
                        status,
                        PlatformInvitationsReadUseCase.NormalizeSearch(search));

                    return Results.Ok(await useCase.ListAsync(query, cancellationToken));
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("ListPlatformInvitations")
            .WithTags("PlatformInvitations");

        app.MapGet(
                "/platform/invitations/export",
                async (
                    ClaimsPrincipal user,
                    HttpContext httpContext,
                    PrincipalResolver principalResolver,
                    IOptions<PlatformOptions> options,
                    PlatformInvitationsReadUseCase useCase,
                    ISecurityEventWriter securityEventWriter,
                    CancellationToken cancellationToken,
                    [FromQuery] string? type = null,
                    [FromQuery] string? status = null) =>
                {
                    var gate = await PlatformOwnerGate.AuthorizeAsync(user, httpContext, principalResolver, options.Value, cancellationToken);
                    if (gate.Failure is not null)
                    {
                        return gate.Failure;
                    }

                    // The export takes ONLY these two filters — no page, no limit, no search.
                    if (!PlatformInvitationsReadUseCase.IsValidType(type)
                        || !PlatformInvitationsReadUseCase.IsValidStatus(status))
                    {
                        return Results.BadRequest();
                    }

                    var result = await useCase.ExportAsync(new PlatformInvitationExportQuery(type, status), cancellationToken);

                    await WriteExportAuditAsync(gate, httpContext, securityEventWriter, result.Count, cancellationToken);

                    return Results.Ok(result);
                })
            .RequireAuthorization()
            .Produces(StatusCodes.Status200OK)
            .Produces(StatusCodes.Status400BadRequest)
            .Produces(StatusCodes.Status401Unauthorized)
            .Produces(StatusCodes.Status403Forbidden)
            .WithName("ExportPlatformInvitationsCsv")
            .WithTags("PlatformInvitations");
    }

    /// <summary>
    /// The C# analog of <c>logPlatformExport(ctx, { resource: 'invitations', count, format: 'csv' })</c>.
    ///
    /// <para><b>RESOLVE-OR-SKIP, and the skip is the COMMON case — this is the whole reason the method
    /// exists instead of an inline write.</b> TS resolves the audit row's org as
    /// <c>info.targetOrgId || ctx.user?.organizationId</c> and then <c>if (!organizationId) return;</c>.
    /// <c>exportInvitationsCsv</c> passes NO <c>targetOrgId</c> (unlike the invoices, users and
    /// access-review exports, which all do), so the org can only come from the caller's own row — and a
    /// platform owner is normally ORG-LESS (<c>seed.ts</c> seeds exactly such an identity). So for the
    /// typical caller TS writes NO audit row at all, and this port must write none either. An unconditional
    /// write here would be a C#-only audit row: invisible while the flag is dark, then a permanent
    /// divergence in the audit trail after a flip, and it would 500 on <c>Guid.Parse("")</c> for the
    /// org-less owner it was supposed to record.</para>
    ///
    /// <para>An empty-string <c>OrganizationId</c> is how this codebase represents "org-less" on a resolved
    /// principal — <c>PermissionService</c> coalesces exactly that to <c>null</c> before a permission
    /// lookup. So <c>IsNullOrEmpty</c> is the faithful spelling of TS's falsy check, not a defensive
    /// guess.</para>
    ///
    /// <para>TS also swallows any failure here (<c>logPlatformExport</c> wraps its body in <c>safe()</c> and
    /// the <c>logSecurityEvent</c> call is a bare <c>void</c> promise), so the export succeeds even when the
    /// audit write does not. <c>ISecurityEventWriter</c> is already fail-soft for the same reason, which is
    /// why this is awaited plainly rather than wrapped again.</para>
    /// </summary>
    private static async Task WriteExportAuditAsync(
        Tims.Api.Reporting.StaffGateResult gate,
        HttpContext httpContext,
        ISecurityEventWriter securityEventWriter,
        int count,
        CancellationToken cancellationToken)
    {
        var organizationId = gate.Context?.OrganizationId;
        if (string.IsNullOrEmpty(organizationId))
        {
            return;
        }

        var metadata = new JsonObject
        {
            ["resource"] = "invitations",
            ["count"] = count,
            ["format"] = "csv",
        };

        await securityEventWriter.WriteAsync(
            new SecurityEvent(
                Guid.Parse(organizationId),
                Guid.Parse(gate.Context!.UserId),
                "platform_export",
                "export:invitations",
                null,
                metadata,
                IpAddress: httpContext.ClientIpFor(),
                UserAgent: UserAgentOf(httpContext)),
            cancellationToken);
    }

    private static string? UserAgentOf(HttpContext httpContext)
    {
        var userAgent = httpContext.Request.Headers.UserAgent.ToString();
        return string.IsNullOrEmpty(userAgent) ? null : userAgent;
    }
}
