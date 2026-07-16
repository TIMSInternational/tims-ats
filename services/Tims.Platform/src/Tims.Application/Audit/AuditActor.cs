using Tims.Domain.Identity;

namespace Tims.Application.Audit;

/// <summary>
/// Resolves the audit actor from the tenant context — a port of the TS
/// <c>ctx.user.impersonatorId ?? ctx.user.id</c> rule. Under impersonation the row is attributed to
/// the REAL owner (<see cref="TenantContext.ImpersonatedBy"/>), never the impersonated target, so the
/// audit trail always names the human who actually performed the access.
/// </summary>
public static class AuditActor
{
    public static string ActorFor(TenantContext context) =>
        context.ImpersonatedBy ?? context.UserId;
}
