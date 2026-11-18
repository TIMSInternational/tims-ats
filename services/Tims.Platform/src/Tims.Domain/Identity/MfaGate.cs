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
    /// The only role slugs <c>Platform:MfaExtraPrivilegedRoles</c> can add — the port of
    /// <c>MFA_EXTRA_PRIVILEGED_ROLE_CHOICES</c> in <c>packages/shared/src/mfa.ts</c>. super_admin /
    /// platform_owner are always privileged; candidate / external are not staff sessions.
    /// </summary>
    public static readonly IReadOnlyList<string> ExtraPrivilegedRoleChoices =
        ["hr_admin", "hrbp", "recruiter", "leader", "committee", "employee"];

    /// <summary>
    /// Parse the owner-controlled widening of the privileged set (comma- or space-separated slugs,
    /// case-insensitive, de-duplicated, in input order). Unknown tokens are ignored — fail OPEN, like
    /// <see cref="IsEnforced"/>: a garbled value adds nothing and can never lock anyone out. Pinned to
    /// the TS <c>parseMfaExtraPrivilegedRoles</c> by the shared goldens (<c>extraRolesParse</c>).
    /// </summary>
    public static IReadOnlyList<string> ParseExtraPrivilegedRoles(string? raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return [];
        }

        var result = new List<string>();
        foreach (var token in Tokens(raw))
        {
            var slug = token.ToLowerInvariant();
            if (ExtraPrivilegedRoleChoices.Contains(slug) && !result.Contains(slug))
            {
                result.Add(slug);
            }
        }

        return result;
    }

    // Separators mirror the TS `/[\s,]+/`: a comma or any whitespace; empty tokens are dropped.
    private static IEnumerable<string> Tokens(string raw)
    {
        var start = -1;
        for (var i = 0; i <= raw.Length; i++)
        {
            var isSeparator = i == raw.Length || raw[i] == ',' || char.IsWhiteSpace(raw[i]);
            if (!isSeparator)
            {
                if (start < 0)
                {
                    start = i;
                }

                continue;
            }

            if (start >= 0)
            {
                yield return raw[start..i];
                start = -1;
            }
        }
    }

    /// <summary>
    /// WHO must step up: platform owners + super_admins — exactly the set that bypasses permission
    /// checks. Delegates to the existing port so the two cannot drift; a role one treated as
    /// privileged and the other did not would silently escape enforcement.
    /// </summary>
    public static bool IsPrivileged(IEnumerable<string> roleSlugs, bool isPlatformOwner) =>
        AccessReview.AccessRiskKernel.IsMfaPrivileged(roleSlugs, isPlatformOwner);

    /// <summary>
    /// The base set above PLUS any role in <paramref name="extraRoles"/> (the parsed
    /// <c>Platform:MfaExtraPrivilegedRoles</c>; empty = the base set, i.e. unchanged behaviour). Port of
    /// TS <c>isMfaPrivileged</c> with <c>MFA_EXTRA_PRIVILEGED_ROLES</c>; pinned by
    /// <c>privilegedWithExtra</c> in the shared goldens.
    /// </summary>
    public static bool IsPrivileged(IEnumerable<string> roleSlugs, bool isPlatformOwner, IReadOnlyCollection<string> extraRoles)
    {
        var slugs = roleSlugs as IReadOnlyCollection<string> ?? roleSlugs.ToList();
        return IsPrivileged(slugs, isPlatformOwner) || slugs.Any(extraRoles.Contains);
    }

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
