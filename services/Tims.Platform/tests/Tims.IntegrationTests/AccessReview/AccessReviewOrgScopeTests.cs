using Tims.Application.AccessReview;
using Tims.Infrastructure.AccessReview;
using Xunit;

namespace Tims.IntegrationTests.AccessReview;

/// <summary>
/// Proves the `organizationId` filter actually filters — NOT an RLS-isolation proof (there is none on
/// this privileged path; see the Slice-18 design doc's "Why this is a new pattern" section). A
/// platform owner CAN query any org; this test proves that when they query org A, org B's data never
/// leaks in, and vice versa.
/// </summary>
[Collection("AccessReview")]
public sealed class AccessReviewOrgScopeTests(AccessReviewFixture fixture)
{
    private readonly AccessReviewFixture _fixture = fixture;

    [Fact]
    public async Task FetchUsersForReviewAsync_OrgA_NeverReturnsOrgBUsers()
    {
        var repo = new AccessReviewRepository(_fixture.NewContext());

        var orgAUsers = await repo.FetchUsersForReviewAsync(AccessReviewFixture.OrgA, cap: 10000, CancellationToken.None);
        var orgBUsers = await repo.FetchUsersForReviewAsync(AccessReviewFixture.OrgB, cap: 10000, CancellationToken.None);

        Assert.DoesNotContain(orgAUsers, u => u.Id == AccessReviewFixture.OrgBUserId);
        Assert.Contains(orgBUsers, u => u.Id == AccessReviewFixture.OrgBUserId);
        Assert.DoesNotContain(orgBUsers, u => u.Id == AccessReviewFixture.HealthyUserId);
    }

    [Fact]
    public async Task BuildReportAsync_OrgAReport_OrgNameIsAcme_NotGlobex()
    {
        var service = new AccessReviewService(new AccessReviewRepository(_fixture.NewContext()));

        var report = await service.BuildReportAsync(AccessReviewFixture.OrgA, DateTime.UtcNow, CancellationToken.None);

        Assert.All(report.Rows, r => Assert.Equal("Acme Corp", r.OrgName));
    }

    [Fact]
    public async Task BuildReportAsync_OrgAReport_ExercisesPrivilegedAndCrossOrgRolePaths()
    {
        // Regression coverage for the fixture gap: without a privileged-role holder and a
        // cross-org-corrupted grant, privilegedCount/crossOrgRoleCount are structurally always 0 and a
        // positional-argument slip in the `roles.organization_id` -> RoleAssignment.OrganizationId ->
        // crossOrgRole wiring (repository -> service) would go undetected.
        var service = new AccessReviewService(new AccessReviewRepository(_fixture.NewContext()));

        var report = await service.BuildReportAsync(AccessReviewFixture.OrgA, DateTime.UtcNow, CancellationToken.None);

        Assert.True(report.Summary.PrivilegedCount > 0);
        Assert.True(report.CrossOrgRoleCount > 0);
        Assert.Contains(report.Rows, r => r.UserId == AccessReviewFixture.PrivilegedUserId && r.Flags.Privileged);
        Assert.Contains(report.Rows, r => r.UserId == AccessReviewFixture.CrossOrgGrantUserId && r.Flags.CrossOrgRole);
    }

    [Fact]
    public async Task AttestAsync_OrgAAttestation_DoesNotAppearInOrgBsHistory()
    {
        var service = new AccessReviewService(new AccessReviewRepository(_fixture.NewContext()));

        await service.AttestAsync(AccessReviewFixture.OrgA, AccessReviewFixture.PlatformOwnerId, "org-a-only", DateTime.UtcNow, CancellationToken.None);

        var orgBHistory = await service.ListAttestationsAsync(AccessReviewFixture.OrgB, limit: 20, CancellationToken.None);

        Assert.DoesNotContain(orgBHistory, a => a.Notes == "org-a-only");
    }
}
