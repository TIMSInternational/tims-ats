namespace Tims.Domain.Access;

/// <summary>
/// Thrown when an identity-anchored self-service guard rejects a caller reaching another
/// user's row. FORBIDDEN semantics (the 360/self-service pattern is <c>[Authenticated]</c>
/// + a hard subject filter, NOT scope-aware): an org- or company-scoped caller still cannot
/// read another user's self-service row.
/// </summary>
public sealed class SelfServiceForbiddenException : Exception
{
    public SelfServiceForbiddenException()
        : base("Acceso denegado a datos de otro usuario") { }
}

/// <summary>
/// The Sprint-1.7 self-service pattern, preserved EXACTLY: a HARD
/// <c>subjectUserId == ctx.UserId</c> identity anchor that is NOT scope-aware. This is the
/// exact bug class 1.7 caught — an org-scoped grant must never widen a self-service read to
/// another user's row, so this guard deliberately ignores <see cref="AccessScope"/> and
/// anchors. Callers pair it with an <c>AND subject_col = @ctxUser</c> query filter (proven
/// by the Testcontainers self-service test) for defense in depth.
/// </summary>
public static class SelfServiceGuard
{
    /// <summary>
    /// Passes only when the caller is acting on their OWN subject row; otherwise throws
    /// <see cref="SelfServiceForbiddenException"/>. Pure — no scope, no anchors, no DB.
    /// </summary>
    public static void RequireSelf(Guid contextUserId, Guid subjectUserId)
    {
        if (contextUserId != subjectUserId)
        {
            throw new SelfServiceForbiddenException();
        }
    }
}
