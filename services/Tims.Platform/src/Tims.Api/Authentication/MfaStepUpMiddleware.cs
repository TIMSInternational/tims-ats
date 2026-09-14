using System.Security.Claims;
using System.Text.Json.Nodes;
using Microsoft.Extensions.Options;
using Tims.Api.Configuration;
using Tims.Api.Http;
using Tims.Application.Audit;
using Tims.Domain.Identity;

namespace Tims.Api.Authentication;

/// <summary>
/// MFA step-up enforcement — the C# port of TS <c>withMfaEnforcement</c>
/// (<c>packages/api/src/trpc.ts</c>), which is composed into <c>protectedProcedure</c> and so guards
/// every authenticated tRPC procedure.
///
/// WHY (#173). No C# endpoint enforced this. With <c>MFA_ENFORCED=true</c>, a privileged principal
/// holding a valid but <c>aal1</c> token was refused by tRPC and served a 200 by the platform
/// service — the browser stayed gated by the (admin) layout, but API-level defence-in-depth against
/// direct token replay did not exist. As each domain's read flag goes live, more of the product
/// moves onto the surface that had no gate.
///
/// PLACEMENT. Registered AFTER <see cref="SecurityDenialAuditMiddleware"/>, so that middleware
/// observes this 403 on the way out and correctly SKIPS it: an MFA denial is audited distinctly as
/// <c>mfa_step_up_required</c> (below), never as a generic <c>authz_denied</c>. That carve-out is
/// keyed on <see cref="SecurityDenialAuditMiddleware.MfaStepUpHeader"/>, which this sets. Same
/// rule as observeDenial's `if (error.message === MFA_REQUIRED) return`.
///
/// RESPONSE SHAPE is load-bearing, not cosmetic. The body is <c>{ "message": "MFA_REQUIRED" }</c>
/// because <c>apps/web/lib/platform-api/client.ts</c> lifts a JSON `message` into
/// <c>PlatformApiError.message</c>, and the web client's existing
/// <c>redirectToMfaIfRequired</c> (<c>trpc-provider.tsx</c>) matches exactly that sentinel to send
/// the user to /mfa. So the FE recovery path needed NO change — it was already built and simply had
/// no backend that spoke the protocol. A bare 403 (what every other C# gate returns) could never
/// trigger it.
///
/// SCOPE. Only JWT-authenticated staff are gated. An API-key principal has no session and no `aal`;
/// TS gates on `protectedProcedure`, which external key callers do not use either.
/// </summary>
public sealed class MfaStepUpMiddleware(RequestDelegate next)
{
    private readonly RequestDelegate _next = next;

    /// <remarks>
    /// #181: the writer is resolved lazily (see SecurityDenialAuditMiddleware's note). This middleware
    /// early-returns for the overwhelming majority of requests — the flag is off, or the principal is not
    /// staff — and constructing a scoped AuditLogDbContext per request to reach that return was pure cost.
    /// <c>IOptions</c> stays a parameter: it is a singleton, so resolving it is free.
    /// </remarks>
    public async Task InvokeAsync(
        HttpContext context,
        IOptions<PlatformOptions> platformOptions)
    {
        // STAFF only. `Candidate` is a portal session with no staff row, and `ExternalApiKey` has no
        // Supabase session and therefore no `aal` at all — TS gates on protectedProcedure, which
        // neither of those uses either. Gating them would refuse callers who have no way to comply.
        if (!MfaGate.IsEnforced(platformOptions.Value.MfaEnforced)
            || context.Items[ResolvedPrincipal.HttpContextKey] is not ResolvedPrincipal { Context: { } tenant }
            || tenant.PrincipalType is not (PrincipalType.PlatformOwner or PrincipalType.OrgUser))
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        // Under impersonation the resolved context is the (possibly non-privileged) TARGET, but the
        // REAL operator is always a platform owner — only owners can impersonate — and `aal` is the
        // OPERATOR's own session level, because impersonation rides a signed cookie rather than a
        // Supabase session swap. So an active impersonation is treated as privileged, mirroring the
        // TS comment verbatim: otherwise an aal1 owner could step DOWN into a target and escape MFA.
        var isPlatformOwner = tenant.PrincipalType == PrincipalType.PlatformOwner
            || tenant.ImpersonatedBy is not null;
        if (!MfaGate.IsBlocking(
                enforced: true,
                isPrivileged: MfaGate.IsPrivileged(tenant.Roles, isPlatformOwner),
                currentLevel: context.User.FindFirstValue("aal")))
        {
            await _next(context).ConfigureAwait(false);
            return;
        }

        // Audited distinctly, exactly as TS does before throwing. Fail-soft: the refusal stands even
        // if the audit write cannot be persisted — never the other way round.
        try
        {
            if (Guid.TryParse(tenant.OrganizationId, out var organizationId))
            {
                _ = Guid.TryParse(AuditActor.ActorFor(tenant), out var actorId);
                var securityEventWriter = context.RequestServices.GetRequiredService<ISecurityEventWriter>();
                await securityEventWriter.WriteAsync(
                    new SecurityEvent(
                        organizationId,
                        actorId == Guid.Empty ? null : actorId,
                        Action: "mfa_step_up_required",
                        Entity: "mfa",
                        EntityId: null,
                        Metadata: new JsonObject { ["currentLevel"] = context.User.FindFirstValue("aal") },
                        IpAddress: context.ClientIpFor(),
                        UserAgent: NullIfEmpty(context.Request.Headers.UserAgent.ToString())),
                    // #181: CancellationToken.None, NOT context.RequestAborted. The write happens AFTER the
                    // response has gone back to the caller, so binding it to the request's token let a client
                    // that closed the socket cancel its own audit row — and SecurityEventWriter's fail-soft
                    // catch swallowed the cancellation silently. A prober that disconnects on each 403 could
                    // therefore enumerate the surface leaving no trace, which is the exact behaviour this row
                    // exists to make visible. TS is fire-and-forget and bound to no signal; this matches it.
                    CancellationToken.None).ConfigureAwait(false);
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // swallowed by design — see above
        }

        context.Response.Headers[SecurityDenialAuditMiddleware.MfaStepUpHeader] = "1";
        context.Response.StatusCode = StatusCodes.Status403Forbidden;
        await context.Response.WriteAsJsonAsync(
            new { message = MfaGate.MfaRequired }, context.RequestAborted).ConfigureAwait(false);
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
}
