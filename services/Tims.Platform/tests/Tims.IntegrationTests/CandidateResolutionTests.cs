using Tims.Application.Identity;
using Tims.Domain.Identity;
using Tims.Infrastructure.Identity;

namespace Tims.IntegrationTests;

/// <summary>
/// Candidate-resolution WP (Phase-2 G2 criterion 3): end-to-end (real Postgres) proof that the
/// EF-backed <see cref="CandidateRepository"/> + <see cref="CandidateResolver"/> resolve the FOURTH
/// principal type — a portal Supabase session with NO staff User row → a
/// <see cref="PrincipalType.Candidate"/> <see cref="TenantContext"/> with EMPTY roles, keyed on
/// email within a request-supplied org (faithful to candidate-portal.repository.ts:
/// <c>{ organizationId, email, isActive: true, deletedAt: null }</c>).
///
/// Also proves the staff/candidate boundary via the combined <see cref="PrincipalResolver.ResolveAsync"/>:
/// staff first (keyed on supabase id), candidate fallback only on NeedsFallback + an org context.
/// Read-only over the Prisma-owned tables; no writes, no RLS scope (privileged pre-tenant path).
/// </summary>
[Collection("Identity")]
public sealed class CandidateResolutionTests(IdentitySchemaFixture fixture)
{
    private static readonly DateTime Now = new(2026, 7, 16, 12, 0, 0, DateTimeKind.Utc);

    private static IdentityDbContext NewDb(IdentitySchemaFixture fixture) =>
        new(IdentityFixture.BuildOptions(fixture.IdentityConnectionString));

    private static CandidateResolver NewCandidateResolver(IdentityDbContext db) =>
        new(new CandidateRepository(db));

    // A PrincipalResolver WITH the candidate fallback wired (staff-first / candidate-fallback).
    private static PrincipalResolver NewCombinedResolver(IdentityDbContext db) =>
        new(new IdentityRepository(db), NewCandidateResolver(db));

    // ---- Candidate resolves as the 4th principal type, EMPTY roles ------------------
    [Fact]
    public async Task CandidateEmail_ResolvesToCandidate_WithEmptyRoles()
    {
        await using var db = NewDb(fixture);
        var resolver = NewCandidateResolver(db);

        var ctx = await resolver.ResolveAsync(
            IdentityFixture.CandidateEmail, IdentityFixture.OrgA.ToString(), CancellationToken.None);

        Assert.NotNull(ctx);
        Assert.Equal(PrincipalType.Candidate, ctx.PrincipalType);
        Assert.Equal(IdentityFixture.OrgA.ToString(), ctx.OrganizationId);
        Assert.Equal(IdentityFixture.CandidateOrgAId.ToString(), ctx.UserId); // candidate.id, not a user id
        Assert.Empty(ctx.Roles);
        Assert.Null(ctx.ImpersonatedBy);
        Assert.Null(ctx.ApiKeyScopes);
    }

    // ---- Unknown email → null (anonymous) -------------------------------------------
    [Fact]
    public async Task UnknownEmail_ResolvesToNull()
    {
        await using var db = NewDb(fixture);
        var resolver = NewCandidateResolver(db);

        var ctx = await resolver.ResolveAsync(
            IdentityFixture.UnknownEmail, IdentityFixture.OrgA.ToString(), CancellationToken.None);

        Assert.Null(ctx);
    }

    // ---- Org-scoping: a candidate in OrgA is NOT resolved for OrgB ------------------
    [Fact]
    public async Task CandidateInOrgA_NotResolvedForOrgB()
    {
        await using var db = NewDb(fixture);
        var resolver = NewCandidateResolver(db);

        var ctx = await resolver.ResolveAsync(
            IdentityFixture.CandidateEmail, IdentityFixture.OrgB.ToString(), CancellationToken.None);

        Assert.Null(ctx);
    }

    // ---- Soft-deleted candidate → null (deletedAt filter is faithful) ---------------
    [Fact]
    public async Task DeletedCandidate_ResolvesToNull()
    {
        await using var db = NewDb(fixture);
        var resolver = NewCandidateResolver(db);

        var ctx = await resolver.ResolveAsync(
            IdentityFixture.DeletedCandidateEmail, IdentityFixture.OrgA.ToString(), CancellationToken.None);

        Assert.Null(ctx);
    }

    // ---- Inactive candidate → null (isActive filter is faithful) --------------------
    [Fact]
    public async Task InactiveCandidate_ResolvesToNull()
    {
        await using var db = NewDb(fixture);
        var resolver = NewCandidateResolver(db);

        var ctx = await resolver.ResolveAsync(
            IdentityFixture.InactiveCandidateEmail, IdentityFixture.OrgA.ToString(), CancellationToken.None);

        Assert.Null(ctx);
    }

    // ---- REQUIRED regression: candidate in a SUSPENDED org → null (owning-org lockout) ------
    // The candidate is itself active + not-deleted, so ONLY the owning-org gate blocks it. Without
    // the JOIN to organizations (org.is_active AND deleted_at IS NULL) this test goes RED — the
    // suspended org's candidate would resolve to a PrincipalType.Candidate context. Mirrors the
    // API-key suspended-org lockout (ExternalApiKeyAuthTests.KeyOnSuspendedOrg_FailsClosed).
    [Fact]
    public async Task CandidateInSuspendedOrg_ResolvesToNull()
    {
        await using var db = NewDb(fixture);
        var resolver = NewCandidateResolver(db);

        var ctx = await resolver.ResolveAsync(
            IdentityFixture.SuspendedOrgCandidateEmail, IdentityFixture.SuspendedOrg.ToString(), CancellationToken.None);

        Assert.Null(ctx);
    }

    // ---- REQUIRED regression: candidate in a SOFT-DELETED org → null (owning-org lockout) ---
    // Same as above for a soft-deleted (deleted_at set) org — the STRICTER-than-TS deletedAt guard.
    [Fact]
    public async Task CandidateInSoftDeletedOrg_ResolvesToNull()
    {
        await using var db = NewDb(fixture);
        var resolver = NewCandidateResolver(db);

        var ctx = await resolver.ResolveAsync(
            IdentityFixture.DeletedOrgCandidateEmail, IdentityFixture.SoftDeletedOrg.ToString(), CancellationToken.None);

        Assert.Null(ctx);
    }

    // ---- The owning-org gate does NOT over-block: an active-org candidate still resolves -----
    [Fact]
    public async Task CandidateInActiveOrg_StillResolves_OrgGateDoesNotOverBlock()
    {
        await using var db = NewDb(fixture);
        var resolver = NewCandidateResolver(db);

        var ctx = await resolver.ResolveAsync(
            IdentityFixture.CandidateEmail, IdentityFixture.OrgA.ToString(), CancellationToken.None);

        Assert.NotNull(ctx);
        Assert.Equal(PrincipalType.Candidate, ctx.PrincipalType);
        Assert.Equal(IdentityFixture.CandidateOrgAId.ToString(), ctx.UserId);
    }

    // ---- Combined: an active staff Supabase session resolves as STAFF; candidate fallback
    //      is NEVER reached even though a candidate shares the staff email in the same org. ----
    [Fact]
    public async Task StaffSession_SharedEmail_ResolvesAsStaff_CandidateFallbackNotReached()
    {
        await using var db = NewDb(fixture);
        var resolver = NewCombinedResolver(db);

        var ctx = await resolver.ResolveAsync(
            IdentityFixture.ActiveStaffSub,
            IdentityFixture.StaffEmail,
            IdentityFixture.OrgA.ToString(),
            cookieHeader: null,
            impersonationSecret: null,
            Now,
            CancellationToken.None);

        Assert.NotNull(ctx);
        Assert.Equal(PrincipalType.OrgUser, ctx.PrincipalType); // staff, NOT candidate
        Assert.Equal(IdentityFixture.ActiveStaffUserId.ToString(), ctx.UserId); // staff user id, not candidate id
        Assert.Equal(new[] { "recruiter" }, ctx.Roles); // real staff roles, non-empty
    }

    // ---- REQUIRED historical-fix regression: `staff-linked-by-supabase-id-only`. -----
    // A candidate portal session presents an UNLINKED Supabase id (no `users` row) but its email
    // collides with a STAFF user's email. Staff resolution keys on supabase id → NeedsFallback, and
    // the candidate fallback (email+org keyed) yields Candidate with EMPTY roles — NEVER staff roles,
    // NEVER PlatformOwner. This test BITES: a hypothetical email-join in staff resolution would find
    // the staff user by 'staff@tims.test' and return OrgUser/['recruiter'] (or, for an owner-shared
    // email, PlatformOwner), turning every assertion below red.
    [Fact]
    public async Task CandidateSession_SharingStaffEmail_ResolvesCandidate_NeverStaff()
    {
        await using var db = NewDb(fixture);
        var resolver = NewCombinedResolver(db);

        var ctx = await resolver.ResolveAsync(
            IdentityFixture.CandidatePortalSub, // NOT in `users` → staff lookup misses (NeedsFallback)
            IdentityFixture.StaffEmail, // shares the ActiveStaff user's email
            IdentityFixture.OrgA.ToString(),
            cookieHeader: null,
            impersonationSecret: null,
            Now,
            CancellationToken.None);

        Assert.NotNull(ctx);
        Assert.Equal(PrincipalType.Candidate, ctx.PrincipalType); // never promoted to staff
        Assert.NotEqual(PrincipalType.PlatformOwner, ctx.PrincipalType);
        Assert.Empty(ctx.Roles); // never staff roles, never 'platform_owner'
        Assert.DoesNotContain("platform_owner", ctx.Roles);
        Assert.DoesNotContain("recruiter", ctx.Roles);
        // Identity is the candidate row that matches (org+email), NOT the colliding staff user.
        Assert.Equal(IdentityFixture.CandidateStaffEmailId.ToString(), ctx.UserId);
        Assert.NotEqual(IdentityFixture.ActiveStaffUserId.ToString(), ctx.UserId);
        Assert.Equal(IdentityFixture.OrgA.ToString(), ctx.OrganizationId);
    }

    // ---- Combined resolves the PlatformOwner principal type too (staff path) ---------
    // Names the 4 principal types across the plane: PlatformOwner + OrgUser (here + above via
    // PrincipalResolver), Candidate (above), and ExternalApiKey (ApiKeyResolver plane —
    // ExternalApiKeyAuthTests). This asserts a candidate email never leaks owner authority.
    [Fact]
    public async Task PlatformOwnerSession_ResolvesToPlatformOwner_ViaCombined()
    {
        await using var db = NewDb(fixture);
        var resolver = NewCombinedResolver(db);

        var ctx = await resolver.ResolveAsync(
            IdentityFixture.PlatformOwnerSub,
            IdentityFixture.CandidateEmail, // an email that IS a candidate — must be ignored for staff
            IdentityFixture.OrgA.ToString(),
            cookieHeader: null,
            impersonationSecret: null,
            Now,
            CancellationToken.None);

        Assert.NotNull(ctx);
        Assert.Equal(PrincipalType.PlatformOwner, ctx.PrincipalType);
        Assert.Equal(new[] { "platform_owner" }, ctx.Roles);
    }

    // ---- Standalone repository faithfulness: returns the minimal CandidateRow --------
    [Fact]
    public async Task Repository_FindByEmail_ReturnsMinimalRow_ForActiveCandidate()
    {
        await using var db = NewDb(fixture);
        var repository = new CandidateRepository(db);

        var row = await repository.FindByEmailAsync(
            IdentityFixture.CandidateEmail, IdentityFixture.OrgA.ToString(), CancellationToken.None);

        Assert.NotNull(row);
        Assert.Equal(IdentityFixture.CandidateOrgAId.ToString(), row.Id);
        Assert.Equal(IdentityFixture.OrgA.ToString(), row.OrganizationId);
        Assert.Equal(IdentityFixture.CandidateEmail, row.Email);
    }
}
