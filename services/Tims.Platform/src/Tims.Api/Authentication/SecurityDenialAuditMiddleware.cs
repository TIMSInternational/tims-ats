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

            var code = status == StatusCodes.Status401Unauthorized ? "UNAUTHORIZED" : "FORBIDDEN";
            Guid organizationId;
            Guid? actor;
            JsonObject metadata;

            if (context.Items[ResolvedPrincipal.HttpContextKey] is ResolvedPrincipal { Context: { } tenant })
            {
                if (!Guid.TryParse(tenant.OrganizationId, out organizationId))
                {
                    return; // org-less platform owner ("") — no FK to write against
                }

                _ = Guid.TryParse(AuditActor.ActorFor(tenant), out var actorId);
                actor = actorId == Guid.Empty ? null : actorId;
                metadata = new JsonObject { ["code"] = code };
            }
            else if (TryApiKeyAttribution(context, out organizationId, out var apiKeyId))
            {
                // #180 — the API-KEY surface. PrincipalResolutionMiddleware stashes a ResolvedPrincipal
                // only for a JWT `sub`, and ApiKeyAuthenticationHandler issues org_id/api_key_id/scope and
                // never a `sub`. So without this branch EVERY denial on /external/* wrote nothing at all,
                // while #177 claimed coverage of "every 401/403". TS closes the same hole with a second
                // observer (`observeExternalDenial`); doing it here instead means an API-key endpoint added
                // later is covered without being told to opt in — the derived-not-listed reasoning the rest
                // of this middleware already relies on.
                //
                // actor is NULL by construction: the principal is a KEY, not a person. Inventing a sentinel
                // user id would make a machine denial indistinguishable from a human one in review, and
                // `api_key_id` is not a `users.id` so it would also break the FK.
                actor = null;
                metadata = new JsonObject
                {
                    ["code"] = code,
                    ["principal"] = "api_key",
                    ["apiKeyId"] = apiKeyId,
                };
            }
            else
            {
                // Resolve-or-skip. An unauthenticated 401 has no tenant to attribute to, and
                // `audit_logs.organization_id` is a real FK — auditing it would also hand any anonymous
                // caller an unbounded writer into an append-only table. TS draws the same line.
                return;
            }

            var route = context.GetEndpoint() is Microsoft.AspNetCore.Routing.RouteEndpoint routeEndpoint
                ? $"/{routeEndpoint.RoutePattern.RawText?.TrimStart('/')}"
                : context.Request.Path.Value ?? "/";

            await securityEventWriter.WriteAsync(
                new SecurityEvent(
                    organizationId,
                    actor,
                    Action: "authz_denied",
                    Entity: $"platform:{context.Request.Method} {route}",
                    EntityId: null,
                    Metadata: metadata,
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
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // Fail-soft, exactly like TS's `safe()` wrapper: an audit-write problem must never
            // change the response the caller already received.
        }
    }

    /// <summary>
    /// Attribute a denial to the API-KEY principal (#180), from the claims
    /// <see cref="ApiKeyAuthenticationHandler"/> issued.
    ///
    /// <para>Reading <c>context.User</c> works here — and only here — because this middleware does its
    /// work on the way OUT, after <c>UseAuthorization()</c> has run the endpoint's
    /// <c>.RequireAuthorization(ApiKey)</c> policy and swapped the authenticated principal onto the
    /// context. On the way IN the ApiKey scheme has not run at all (JwtBearer is the default), which is
    /// exactly why the inbound <c>PrincipalResolutionMiddleware</c> never sees these requests.</para>
    ///
    /// <para>Returns false for an invalid/revoked/expired key: authentication itself failed, so there are
    /// no claims and no authenticated org — that 401 stays unaudited, deliberately.</para>
    /// </summary>
    private static bool TryApiKeyAttribution(HttpContext context, out Guid organizationId, out string? apiKeyId)
    {
        organizationId = Guid.Empty;
        apiKeyId = context.User.FindFirst(ApiKeyAuthenticationHandler.ApiKeyIdClaimType)?.Value;
        var org = context.User.FindFirst(ApiKeyAuthenticationHandler.OrganizationIdClaimType)?.Value;
        return org is not null && Guid.TryParse(org, out organizationId);
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;
}
