namespace Tims.Domain.Identity;

/// <summary>
/// Pure MFA step-up gate — the C# port of <c>packages/shared/src/mfa.ts</c>, pinned to it by the
/// shared goldens in <c>contracts/mfa-fixtures/cases.json</c>.
///
/// WHY (#173). TS composes <c>withMfaEnforcement</c> into <c>protectedProcedure</c>, so with
/// <c>MFA_ENFORCED=true</c> a privileged principal on an <c>aal1</c> session is refused by every
/// tRPC procedure. NO C# endpoint enforced this: <c>grep -rE "aal|Mfa|MFA" src/</c> returned only
/// <see cref="Tims.Domain.AccessReview.AccessRiskKernel.IsMfaPrivileged"/>, a risk-scoring
/// predicate, never a gate. So the same token that tRPC refused was served a 200 by the platform
/// service — API-level defence-in-depth against direct token replay, absent.
///
/// Supabase encodes the session's Authenticator Assurance Level in the JWT: <c>aal1</c> = password
/// only, <c>aal2</c> = password + a verified second factor used THIS session. Only
/// <c>currentLevel</c> is ever gated on.
///
/// TWO ASYMMETRIC FAILURE DIRECTIONS, both preserved verbatim from the TS original:
///   • The FLAG fails OPEN. An unset or garbled value means "not enforced yet", so a misconfigured
///     environment can never lock privileged users out of production.
///   • The LEVEL fails CLOSED. Once enforcement is on, an unknown or absent level is never treated
///     as good enough.
/// Getting either backwards is a production incident in one direction or a silent hole in the other.
/// </summary>
public static class MfaGate
{
    /// <summary>The stable machine sentinel TS carries as the TRPCError message (`MFA_REQUIRED`).</summary>
    public const string MfaRequired = "MFA_REQUIRED";

    /// <summary>Explicit opt-in; only the exact string "true" enables it (mirrors RLS_ENFORCED).</summary>
    public static bool IsEnforced(string? flag) => flag == "true";

    /// <summary>A session satisfies MFA only at aal2. Unknown/aal1 is fail-CLOSED.</summary>
    public static bool IsSatisfied(string? currentLevel) => currentLevel == "aal2";

    /// <summary>
    /// WHO must step up: platform owners + super_admins — exactly the set that bypasses permission
    /// checks. Delegates to the existing port so the two cannot drift; a role one treated as
    /// privileged and the other did not would silently escape enforcement.
    /// </summary>
    public static bool IsPrivileged(IEnumerable<string> roleSlugs, bool isPlatformOwner) =>
        AccessReview.AccessRiskKernel.IsMfaPrivileged(roleSlugs, isPlatformOwner);

    /// <summary>Block iff enforcement is on AND the principal is privileged AND the session is not aal2.</summary>
    public static bool IsBlocking(bool enforced, bool isPrivileged, string? currentLevel)
    {
        if (!enforced)
        {
            return false;
        }

        if (!isPrivileged)
        {
            return false;
        }

        return !IsSatisfied(currentLevel);
    }
}
