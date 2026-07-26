using Tims.Application.AccessReview;
using Tims.Domain.AccessReview;
using Xunit;

namespace Tims.UnitTests.AccessReview;

/// <summary>In-memory fake — AccessReviewService's orchestration logic (org-exists check, truncation
/// refusal, summary computation) doesn't need a real database to verify; reserve Testcontainers for
/// genuine DB-behavior proofs (Tasks 4/7/8).</summary>
public sealed class FakeAccessReviewRepository : IAccessReviewRepository
{
    public List<AccessReviewUserRecord> Users { get; } = [];
    public HashSet<Guid> ExistingOrgs { get; } = [];
    public List<AccessReviewAttestationInsert> Inserted { get; } = [];

    public Task<IReadOnlyList<AccessReviewUserRecord>> FetchUsersForReviewAsync(Guid organizationId, int cap, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<AccessReviewUserRecord>>(Users.Take(cap + 1).ToList());

    public Task<bool> OrgExistsAsync(Guid organizationId, CancellationToken cancellationToken) =>
        Task.FromResult(ExistingOrgs.Contains(organizationId));

    public Task<AccessReviewAttestation> InsertAttestationAsync(AccessReviewAttestationInsert data, CancellationToken cancellationToken)
    {
        Inserted.Add(data);
        return Task.FromResult(new AccessReviewAttestation(
            Guid.NewGuid(), data.OrganizationId, data.ReviewerId, DateTime.UtcNow,
            data.UserCount, data.PrivilegedCount, data.StaleCount, data.DeprovisionGapCount, data.ExpiredGapCount, data.Notes));
    }

    public Task<IReadOnlyList<AccessReviewAttestationHistoryItem>> ListAttestationsAsync(Guid organizationId, int limit, CancellationToken cancellationToken) =>
        Task.FromResult<IReadOnlyList<AccessReviewAttestationHistoryItem>>([]);
}

public sealed class AccessReviewServiceTests
{
    private static readonly Guid Org = Guid.NewGuid();
    private static readonly DateTime Now = new(2026, 7, 26, 0, 0, 0, DateTimeKind.Utc);

    private static AccessReviewUserRecord HealthyUser(Guid id) =>
        new(id, "Hana", "Healthy", "hana@tims.test", Org, true, null, Now.AddDays(-1), false, "Acme", []);

    [Fact]
    public async Task BuildReportAsync_ComputesSummaryFromFlaggedRows()
    {
        var repo = new FakeAccessReviewRepository();
        repo.Users.Add(HealthyUser(Guid.NewGuid()));
        repo.Users.Add(new AccessReviewUserRecord(Guid.NewGuid(), "Nate", "Never", "nate@tims.test", Org, true, null, null, false, "Acme", []));
        var service = new AccessReviewService(repo);

        var report = await service.BuildReportAsync(Org, Now, CancellationToken.None);

        Assert.Equal(2, report.Summary.UserCount);
        Assert.True(report.Rows.Single(r => r.Name == "Nate Never").Flags.NeverLoggedIn);
        Assert.False(report.Truncated);
    }

    [Fact]
    public async Task BuildReportAsync_ReportsTruncation_WhenMoreThanCapRowsExist()
    {
        var repo = new FakeAccessReviewRepository();
        for (var i = 0; i < 3; i++)
        {
            repo.Users.Add(HealthyUser(Guid.NewGuid()));
        }
        var service = new AccessReviewService(repo);

        var report = await service.BuildReportAsync(Org, Now, CancellationToken.None, cap: 2);

        Assert.True(report.Truncated);
        Assert.Equal(2, report.Rows.Count); // truncated to cap
    }

    [Fact]
    public async Task AttestAsync_ReturnsOrgNotFound_WhenOrgDoesNotExist()
    {
        var repo = new FakeAccessReviewRepository();
        var service = new AccessReviewService(repo);

        var outcome = await service.AttestAsync(Org, Guid.NewGuid(), null, Now, CancellationToken.None);

        Assert.IsType<AccessReviewAttestOutcome.OrgNotFound>(outcome);
        Assert.Empty(repo.Inserted);
    }

    [Fact]
    public async Task AttestAsync_RefusesToInsert_WhenReportIsTruncated()
    {
        var repo = new FakeAccessReviewRepository();
        repo.ExistingOrgs.Add(Org);
        for (var i = 0; i < 3; i++)
        {
            repo.Users.Add(HealthyUser(Guid.NewGuid()));
        }
        var service = new AccessReviewService(repo);

        var outcome = await service.AttestAsync(Org, Guid.NewGuid(), null, Now, CancellationToken.None, cap: 2);

        Assert.IsType<AccessReviewAttestOutcome.Truncated>(outcome);
        Assert.Empty(repo.Inserted);
    }

    [Fact]
    public async Task AttestAsync_InsertsTheComputedSummary_WhenNotTruncated()
    {
        var repo = new FakeAccessReviewRepository();
        repo.ExistingOrgs.Add(Org);
        repo.Users.Add(HealthyUser(Guid.NewGuid()));
        var reviewerId = Guid.NewGuid();
        var service = new AccessReviewService(repo);

        var outcome = await service.AttestAsync(Org, reviewerId, "quarterly", Now, CancellationToken.None);

        var success = Assert.IsType<AccessReviewAttestOutcome.Success>(outcome);
        Assert.Equal(1, success.Summary.UserCount);
        Assert.Equal(reviewerId, repo.Inserted.Single().ReviewerId);
        Assert.Equal("quarterly", repo.Inserted.Single().Notes);
    }
}
