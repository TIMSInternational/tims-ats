namespace Tims.Domain.Identity;

/// <summary>
/// The four principal types the identity plane resolves (architecture §3, phase-2 WP2.2).
/// Drives the DbContext profile selection (tenant vs privileged, Phase 1 WP1.4) and the
/// downstream authorization path.
/// </summary>
public enum PrincipalType
{
    /// <summary>Platform owner (super-admin operator). Runs on the privileged connection; org-scope decision.</summary>
    PlatformOwner,

    /// <summary>Ordinary org-scoped staff user (also the shape an IMPERSONATED session takes).</summary>
    OrgUser,

    /// <summary>Portal candidate — a Supabase session with NO staff User row; bounded to its own context.</summary>
    Candidate,

    /// <summary>External integration authenticated by a `tims_` API key (no User row; the key IS the principal).</summary>
    ExternalApiKey,
}
