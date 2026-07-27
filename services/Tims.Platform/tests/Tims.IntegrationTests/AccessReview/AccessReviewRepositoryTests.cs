using Tims.Application.AccessReview;
using Tims.Infrastructure.AccessReview;
using Xunit;

namespace Tims.IntegrationTests.AccessReview;

[Collection("AccessReview")]
public sealed class AccessReviewRepositoryTests(AccessReviewFixture fixture)
{
    private readonly AccessReviewFixture _fixture = fixture;

    private AccessReviewRepository NewRepository() => new(_fixture.NewContext());

    [Fact]
    public async Task FetchUsersForReviewAsync_ReturnsOnlyOrgAUsers_WhenOrgAQueried()
    {
        var users = await NewRepository().FetchUsersForReviewAsync(AccessReviewFixture.OrgA, cap: 10000, CancellationToken.None);

        var ids = users.Select(u => u.Id).ToHashSet();
        // OrgA seed rows in AccessReviewFixture.SeedSql's `INSERT INTO users` with
        // organization_id = '11111111-1111-1111-1111-111111111111': Rick (org user), healthy, never,
        // stale, deprovision, expired, privileged, crossorg, csv-fixture = 9 (the platform owner's
        // organization_id is NULL, not OrgA).
        Assert.Equal(9, users.Count);
        Assert.DoesNotContain(AccessReviewFixture.OrgBUserId, ids);
    }

    [Fact]
    public async Task FetchUsersForReviewAsync_PopulatesNestedRoleAndGrants()
    {
        var users = await NewRepository().FetchUsersForReviewAsync(AccessReviewFixture.OrgA, cap: 10000, CancellationToken.None);

        var healthy = users.Single(u => u.Id == AccessReviewFixture.HealthyUserId);
        Assert.Single(healthy.Roles);
        Assert.Equal("recruiter", healthy.Roles[0].Slug);
        Assert.Contains("candidate:read:own", healthy.Roles[0].Grants);
    }

    [Fact]
    public async Task FetchUsersForReviewAsync_HonestlyReportsTruncation_WhenCapExceeded()
    {
        var users = await NewRepository().FetchUsersForReviewAsync(AccessReviewFixture.OrgA, cap: 2, CancellationToken.None);

        Assert.True(users.Count > 2); // cap+1 (or more) returned — the SERVICE (Task 6) decides truncated from this
    }

    [Fact]
    public async Task OrgExistsAsync_TrueForRealOrg_FalseForUnknown()
    {
        var repo = NewRepository();
        Assert.True(await repo.OrgExistsAsync(AccessReviewFixture.OrgA, CancellationToken.None));
        Assert.False(await repo.OrgExistsAsync(Guid.NewGuid(), CancellationToken.None));
    }

    [Fact]
    public async Task InsertAttestationAsync_PersistsAndReturnsTheRow()
    {
        var attestation = await NewRepository().InsertAttestationAsync(
            new AccessReviewAttestationInsert(AccessReviewFixture.OrgA, AccessReviewFixture.PlatformOwnerId, 6, 0, 1, 1, 1, "quarterly review"),
            CancellationToken.None);

        Assert.Equal(AccessReviewFixture.OrgA, attestation.OrganizationId);
        Assert.Equal(6, attestation.UserCount);
        Assert.Equal("quarterly review", attestation.Notes);
    }

    [Fact]
    public async Task ListAttestationsAsync_ReturnsNewestFirst_WithReviewerJoin()
    {
        var repo = NewRepository();
        await repo.InsertAttestationAsync(new AccessReviewAttestationInsert(AccessReviewFixture.OrgA, AccessReviewFixture.PlatformOwnerId, 1, 0, 0, 0, 0, "first"), CancellationToken.None);
        await repo.InsertAttestationAsync(new AccessReviewAttestationInsert(AccessReviewFixture.OrgA, AccessReviewFixture.PlatformOwnerId, 2, 0, 0, 0, 0, "second"), CancellationToken.None);

        var history = await repo.ListAttestationsAsync(AccessReviewFixture.OrgA, limit: 20, CancellationToken.None);

        Assert.True(history.Count >= 2);
        Assert.Equal("second", history[0].Notes); // newest first
        Assert.Equal("Olivia", history[0].Reviewer.FirstName);
    }
}
