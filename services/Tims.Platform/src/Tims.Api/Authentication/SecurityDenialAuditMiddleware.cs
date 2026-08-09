using System.Text.Json.Nodes;
using Tims.Api.Http;
using Tims.Application.Audit;
using Tims.Domain.Identity;

namespace Tims.Api.Authentication;

/// <summary>
/// Writes an <c>authz_denied</c> security event for every 401/403 the platform service returns —
/// the C# port of TS <c>withSecurityAudit</c> + <c>observeDenial</c>
/// (<c>packages/api/src/trpc.ts</c>, <c>packages/api/src/access/security-audit.ts</c>).
///
/// WHY (#173). `withSecurityAudit` is the OUTERMOST middleware on every tRPC procedure, so a
/// denial anywhere below it lands an <c>authz_denied</c> row with actor, IP and UA. The C# gates
/// returned bare status codes and wrote nothing. Since several domains' read flags are already live
/// in production, that is not a latent gap: denials on those surfaces are ALREADY invisible to the
/// access-review/attestation surface that consumes these events. A low-privilege caller
/// enumerating endpoints leaves no trace beyond Serilog request lines, which carry no principal.
///
/// SHAPE — one middleware, not twelve gate edits. Every *StaffGate returns
/// <c>Results.StatusCode(401|403)</c> rather than throwing, so there is no exception to observe;
/// the response STATUS is the only signal that generalises across all 36 files that can deny. This
/// also means a gate added tomorrow is covered without being told to opt in — the same
/// derived-not-listed reasoning the TS middleware relies on.
///
/// PARITY with observeDenial, rule for rule:
///   • 401 and 403 only.
///   • RESOLVE-OR-SKIP on the org: no resolved principal ⇒ no row. An unauthenticated 401 has no
///     tenant to attribute to, and `audit_logs.organization_id` is a real FK.
///   • Actor is the REAL operator under impersonation (<see cref="AuditActor"/>).
///   • Fail-soft: the writer swallows its own failures by contract, and this never rethrows —
///     a lost audit row must not turn a 403 into a 500.
///
/// DELIBERATE DIVERGENCE: TS records <c>entity: `trpc:${path}`</c>. There is no procedure path
/// here, so this records <c>platform:{METHOD} {route}</c> using the matched ROUTE PATTERN, not the
/// raw URL — so an id in the path cannot smuggle unbounded caller-controlled text into the entity
/// column, and rows aggregate per endpoint rather than per resource.
/// </summary>
public sealed class SecurityDenialAuditMiddleware(RequestDelegate next)
{
    private readonly RequestDelegate _next = next;

    /// <summary>Mirrors observeDenial's MFA carve-out: those are audited distinctly, not as generic denials.</summary>
    internal const string MfaStepUpHeader = "x-tims-mfa-required";

    public async Task InvokeAsync(HttpContext context, ISecurityEventWriter securityEventWriter)
    {
        await _next(context).ConfigureAwait(false);

        try
        {
            var status = context.Response.StatusCode;
            if (status is not (StatusCodes.Status401Unauthorized or StatusCodes.Status403Forbidden))
            {
                return;
            }

            // CB-2a parity: an MFA step-up denial is audited distinctly by the enforcement path and
            // must not ALSO appear as a generic authz_denied.
            if (context.Response.Headers.ContainsKey(MfaStepUpHeader))
            {
                return;
            }

            if (context.Items[ResolvedPrincipal.HttpContextKey] is not ResolvedPrincipal
                { Context: { } tenant })
            {
                return; // resolve-or-skip: unauthenticated/unresolved has no org to attribute to
            }

            if (!Guid.TryParse(tenant.OrganizationId, out var organizationId))
            {
                return; // org-less platform owner ("") — no FK to write against
            }

            _ = Guid.TryParse(AuditActor.ActorFor(tenant), out var actorId);

            var route = context.GetEndpoint() is Microsoft.AspNetCore.Routing.RouteEndpoint routeEndpoint
                ? $"/{routeEndpoint.RoutePattern.RawText?.TrimStart('/')}"
                : context.Request.Path.Value ?? "/";

            await securityEventWriter.WriteAsync(
                new SecurityEvent(
                    organizationId,
                    actorId == Guid.Empty ? null : actorId,
                    Action: "authz_denied",
                    Entity: $"platform:{context.Request.Method} {route}",
                    EntityId: null,
                    Metadata: new JsonObject { ["code"] = status == StatusCodes.Status401Unauthorized ? "UNAUTHORIZED" : "FORBIDDEN" },
                    IpAddress: context.ClientIpFor(),
                    UserAgent: NullIfEmpty(context.Request.Headers.UserAgent.ToString())),
                context.RequestAborted).ConfigureAwait(false);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Fail-soft, exactly like TS's `safe()` wrapper: an audit-write problem must never
            // change the response the caller already received.
        }
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
}
