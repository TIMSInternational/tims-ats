using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Infrastructure.Identity;

namespace Tims.IntegrationTests;

/// <summary>
/// Owns the MINIMAL hand-authored schema for the identity plane (`users`, `roles`, `user_roles` —
/// only the columns <see cref="IdentityDbContext"/> maps plus required NOT NULLs) and the seed for
/// the scenarios exercised by <see cref="IdentityResolutionTests"/> and
/// <see cref="ImpersonationResolutionTests"/>. The container itself is now shared via
/// <see cref="IdentitySchemaFixture"/>, which calls <see cref="SeedAsync"/> against the
/// <c>tims_identity</c> database.
///
/// This is the PRE-TENANT / privileged path, so — unlike <c>RlsFixture</c> — there is no
/// app_tenant role, no RLS, and no TenantScope: the container's superuser connection is exactly
/// the owner connection the resolver runs on in prod.
/// </summary>
public static class IdentityFixture
{
    public static readonly Guid OrgA = Guid.Parse("11111111-1111-1111-1111-111111111111");

    // A SECOND org, seeded for the candidate org-scoping proof (a candidate in OrgA must NOT resolve
    // when asked for OrgB) and for the cross-tenant email-collision row.
    public static readonly Guid OrgB = Guid.Parse("22222222-2222-2222-2222-222222222222");

    // A SUSPENDED org (is_active=false) and a SOFT-DELETED org (deleted_at set), seeded for the
    // candidate suspended/deleted-org lockout proof — each owns an otherwise-valid (active,
    // not-deleted) candidate that must still resolve to NULL because the OWNING ORG is locked out.
    public static readonly Guid SuspendedOrg = Guid.Parse("33333333-3333-3333-3333-333333333333");
    public static readonly Guid SoftDeletedOrg = Guid.Parse("44444444-4444-4444-4444-444444444444");

    // Users
    public static readonly Guid ActiveStaffUserId = Guid.Parse("a0000000-0000-0000-0000-000000000001");
    public static readonly Guid PlatformOwnerUserId = Guid.Parse("a0000000-0000-0000-0000-000000000002");
    public static readonly Guid InactiveUserId = Guid.Parse("a0000000-0000-0000-0000-000000000003");
    public static readonly Guid OrglessOwnerUserId = Guid.Parse("a0000000-0000-0000-0000-000000000004");

    public const string ActiveStaffSub = "sub-active-staff";
    public const string PlatformOwnerSub = "sub-platform-owner";
    public const string InactiveSub = "sub-inactive";
    public const string OrglessOwnerSub = "sub-orgless-owner";
    public const string UnknownSub = "sub-does-not-exist";

    // A portal candidate's Supabase session id — deliberately NOT present in `users` (candidates have
    // a Supabase session but no staff User row), so the staff lookup misses it (→ NeedsFallback) and
    // the candidate fallback keys on email+org.
    public const string CandidatePortalSub = "sub-candidate-portal";

    // Candidate emails. The staff email is shared on purpose to prove the staff/candidate boundary.
    public const string CandidateEmail = "candidate@tims.test";
    public const string StaffEmail = "staff@tims.test"; // == ActiveStaff user's email (collision)
    public const string DeletedCandidateEmail = "deleted-candidate@tims.test";
    public const string InactiveCandidateEmail = "inactive-candidate@tims.test";
    public const string UnknownEmail = "nobody@tims.test";

    // Candidates that are themselves active + not-deleted but whose OWNING ORG is locked out.
    public const string SuspendedOrgCandidateEmail = "suspended-org-candidate@tims.test";
    public const string DeletedOrgCandidateEmail = "deleted-org-candidate@tims.test";

    // Roles
    private static readonly Guid RecruiterRoleId = Guid.Parse("b0000000-0000-0000-0000-000000000001");
    private static readonly Guid ExternalRoleId = Guid.Parse("b0000000-0000-0000-0000-000000000002");

    // Candidates (portal principals — no User row). Distinct ids from users so a leak would be visible.
    public static readonly Guid CandidateOrgAId = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    public static readonly Guid CandidateStaffEmailId = Guid.Parse("c0000000-0000-0000-0000-000000000002");
    public static readonly Guid CandidateCrossTenantId = Guid.Parse("c0000000-0000-0000-0000-000000000003");
    public static readonly Guid CandidateDeletedId = Guid.Parse("c0000000-0000-0000-0000-000000000004");
    public static readonly Guid CandidateInactiveId = Guid.Parse("c0000000-0000-0000-0000-000000000005");
    public static readonly Guid CandidateInSuspendedOrgId = Guid.Parse("c0000000-0000-0000-0000-000000000006");
    public static readonly Guid CandidateInDeletedOrgId = Guid.Parse("c0000000-0000-0000-0000-000000000007");

    public static async Task SeedAsync(string connectionString)
    {
        await using var connection = new NpgsqlConnection(connectionString);
        await connection.OpenAsync();

        await using var setup = connection.CreateCommand();
        setup.CommandText =
            """
            CREATE TABLE organizations (
                id uuid PRIMARY KEY,
                is_active boolean NOT NULL DEFAULT true,
                deleted_at timestamptz NULL
            );

            CREATE TABLE users (
                id uuid PRIMARY KEY,
                organization_id uuid NULL REFERENCES organizations (id),
                supabase_user_id text NOT NULL UNIQUE,
                email text NOT NULL,
                is_platform_owner boolean NOT NULL DEFAULT false,
                is_active boolean NOT NULL DEFAULT true
            );

            CREATE TABLE roles (
                id uuid PRIMARY KEY,
                organization_id uuid NULL,
                slug text NOT NULL,
                name text NOT NULL
            );

            CREATE TABLE user_roles (
                id uuid PRIMARY KEY,
                user_id uuid NOT NULL REFERENCES users (id),
                role_id uuid NOT NULL REFERENCES roles (id)
            );

            -- Portal candidates (the 4th principal type). Only the columns CandidateEntity maps;
            -- org-scoped, so (organization_id, email) is unique — the same email may be a candidate
            -- in another org (mirrors Prisma's @@unique([organizationId, email])).
            CREATE TABLE candidates (
                id uuid PRIMARY KEY,
                organization_id uuid NOT NULL REFERENCES organizations (id),
                email text NOT NULL,
                is_active boolean NOT NULL DEFAULT true,
                deleted_at timestamptz NULL,
                UNIQUE (organization_id, email)
            );
            """;
        await setup.ExecuteNonQueryAsync();

        await using var seed = connection.CreateCommand();
        seed.CommandText =
            """
            INSERT INTO organizations (id, is_active, deleted_at) VALUES
                (@orgA, true, NULL),
                (@orgB, true, NULL),
                (@suspendedOrg, false, NULL),
                (@softDeletedOrg, true, now());

            INSERT INTO roles (id, organization_id, slug, name) VALUES
                (@recruiterRole, @orgA, 'recruiter', 'Recruiter'),
                (@externalRole, @orgA, 'external', 'External Integration');

            INSERT INTO users (id, organization_id, supabase_user_id, email, is_platform_owner, is_active) VALUES
                (@activeStaff, @orgA, @activeStaffSub, 'staff@tims.test', false, true),
                (@platformOwner, @orgA, @platformOwnerSub, 'owner@tims.test', true, true),
                (@inactive, @orgA, @inactiveSub, 'inactive@tims.test', false, false),
                (@orglessOwner, NULL, @orglessOwnerSub, 'root@tims.test', true, true);

            -- Active staff holds BOTH recruiter (staff) and external (non-staff, must be filtered).
            INSERT INTO user_roles (id, user_id, role_id) VALUES
                (gen_random_uuid(), @activeStaff, @recruiterRole),
                (gen_random_uuid(), @activeStaff, @externalRole),
                -- Owner carries a recruiter grant that must collapse to ['platform_owner'].
                (gen_random_uuid(), @platformOwner, @recruiterRole),
                (gen_random_uuid(), @inactive, @recruiterRole);

            -- Candidates. Note @candidateStaffEmail shares the ActiveStaff user's email in OrgA, and
            -- @candidateCrossTenant shares it in OrgB — neither may ever be promoted to staff (the
            -- staff path keys on supabase_user_id, never an email-join).
            INSERT INTO candidates (id, organization_id, email, is_active, deleted_at) VALUES
                (@candidateOrgA, @orgA, @candidateEmail, true, NULL),
                (@candidateStaffEmail, @orgA, @staffEmail, true, NULL),
                (@candidateCrossTenant, @orgB, @staffEmail, true, NULL),
                (@candidateDeleted, @orgA, @deletedCandidateEmail, true, now()),
                (@candidateInactive, @orgA, @inactiveCandidateEmail, false, NULL),
                -- Active, not-deleted candidates whose OWNING ORG is locked out (suspended /
                -- soft-deleted): they must resolve to NULL via the owning-org gate alone.
                (@candidateSuspendedOrg, @suspendedOrg, @suspendedOrgCandidateEmail, true, NULL),
                (@candidateDeletedOrg, @softDeletedOrg, @deletedOrgCandidateEmail, true, NULL);
            """;
        seed.Parameters.AddWithValue("orgA", OrgA);
        seed.Parameters.AddWithValue("orgB", OrgB);
        seed.Parameters.AddWithValue("suspendedOrg", SuspendedOrg);
        seed.Parameters.AddWithValue("softDeletedOrg", SoftDeletedOrg);
        seed.Parameters.AddWithValue("recruiterRole", RecruiterRoleId);
        seed.Parameters.AddWithValue("externalRole", ExternalRoleId);
        seed.Parameters.AddWithValue("activeStaff", ActiveStaffUserId);
        seed.Parameters.AddWithValue("platformOwner", PlatformOwnerUserId);
        seed.Parameters.AddWithValue("inactive", InactiveUserId);
        seed.Parameters.AddWithValue("orglessOwner", OrglessOwnerUserId);
        seed.Parameters.AddWithValue("activeStaffSub", ActiveStaffSub);
        seed.Parameters.AddWithValue("platformOwnerSub", PlatformOwnerSub);
        seed.Parameters.AddWithValue("inactiveSub", InactiveSub);
        seed.Parameters.AddWithValue("orglessOwnerSub", OrglessOwnerSub);
        seed.Parameters.AddWithValue("candidateOrgA", CandidateOrgAId);
        seed.Parameters.AddWithValue("candidateStaffEmail", CandidateStaffEmailId);
        seed.Parameters.AddWithValue("candidateCrossTenant", CandidateCrossTenantId);
        seed.Parameters.AddWithValue("candidateDeleted", CandidateDeletedId);
        seed.Parameters.AddWithValue("candidateInactive", CandidateInactiveId);
        seed.Parameters.AddWithValue("candidateSuspendedOrg", CandidateInSuspendedOrgId);
        seed.Parameters.AddWithValue("candidateDeletedOrg", CandidateInDeletedOrgId);
        seed.Parameters.AddWithValue("candidateEmail", CandidateEmail);
        seed.Parameters.AddWithValue("staffEmail", StaffEmail);
        seed.Parameters.AddWithValue("deletedCandidateEmail", DeletedCandidateEmail);
        seed.Parameters.AddWithValue("inactiveCandidateEmail", InactiveCandidateEmail);
        seed.Parameters.AddWithValue("suspendedOrgCandidateEmail", SuspendedOrgCandidateEmail);
        seed.Parameters.AddWithValue("deletedOrgCandidateEmail", DeletedOrgCandidateEmail);
        await seed.ExecuteNonQueryAsync();
    }

    public static DbContextOptions<IdentityDbContext> BuildOptions(string connectionString)
    {
        return new DbContextOptionsBuilder<IdentityDbContext>()
            .UseNpgsql(connectionString)
            .Options;
    }
}
