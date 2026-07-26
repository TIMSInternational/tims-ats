using Tims.Application.Audit;
using Tims.Infrastructure.Audit;
using Xunit;

namespace Tims.IntegrationTests.Audit;

[Collection("AuditRead")]
public sealed class AuditReadRepositoryTests(AuditReadFixture fixture)
{
    private readonly AuditReadFixture _fixture = fixture;

    [Fact]
    public async Task ListAsync_ReturnsRowsAcrossBothOrgs_NoOrgFilter()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var (logs, _, total) = await repo.ListAsync(new AuditLogFilter(null, null, null, null, null, null), take: 25, cursor: null, CancellationToken.None);

        Assert.Equal(3, total); // 2 OrgA rows + 1 OrgB row (seeded in AuditReadFixture)
        // AuditLogListItem carries no OrganizationId (the real TS select never returns one) —
        // assert by the known per-org log ids instead.
        var ids = logs.Select(l => l.Id).ToHashSet();
        Assert.Contains(AuditReadFixture.LogOrgA1, ids);
        Assert.Contains(AuditReadFixture.LogOrgB1, ids);
    }

    [Fact]
    public async Task ListAsync_OrganizationIdFilter_NarrowsToOneOrg()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var (logs, _, total) = await repo.ListAsync(
            new AuditLogFilter(null, AuditReadFixture.OrgA, null, null, null, null), take: 25, cursor: null, CancellationToken.None);

        Assert.Equal(2, total);
        var ids = logs.Select(l => l.Id).ToHashSet();
        Assert.Equal(new HashSet<Guid> { AuditReadFixture.LogOrgA1, AuditReadFixture.LogOrgA2 }, ids);
    }

    [Fact]
    public async Task ListAsync_CursorPagination_TakePlusOneOverflow()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var (logs, nextCursor, total) = await repo.ListAsync(new AuditLogFilter(null, null, null, null, null, null), take: 2, cursor: null, CancellationToken.None);

        Assert.Equal(2, logs.Count);
        Assert.NotNull(nextCursor);
        Assert.Equal(3, total);
    }

    [Fact]
    public async Task ListAsync_ActorJoin_PopulatesNestedActor_NullWhenActorIdIsNull()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var (logs, _, _) = await repo.ListAsync(new AuditLogFilter(null, null, null, null, null, null), take: 25, cursor: null, CancellationToken.None);

        var orgARow = logs.Single(l => l.Id == AuditReadFixture.LogOrgA1);
        Assert.NotNull(orgARow.Actor);
        Assert.Equal("Rick", orgARow.Actor!.FirstName);
        Assert.Equal("Recruiter", orgARow.Actor.LastName);

        var orgBRow = logs.Single(l => l.Id == AuditReadFixture.LogOrgB1);
        Assert.Null(orgBRow.Actor); // actor_id is NULL on this seeded row
    }

    [Fact]
    public async Task ListAsync_UnknownCursor_ReturnsEmptyPage_NotPageOne()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var (logs, nextCursor, total) = await repo.ListAsync(
            new AuditLogFilter(null, null, null, null, null, null), take: 25, cursor: Guid.NewGuid(), CancellationToken.None);

        Assert.Empty(logs); // NOT page 1 — matches Prisma's real "cursor not found -> empty" behavior
        Assert.Null(nextCursor);
        Assert.Equal(3, total); // total still reflects the true count, independent of the stale cursor
    }

    [Fact]
    public async Task ExportAsync_BoundsAt1000_MatchingTsTakeLimit()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var rows = await repo.ExportAsync(new AuditLogFilter(null, null, null, null, null, null), CancellationToken.None);

        Assert.True(rows.Count <= 1000);
    }

    [Fact]
    public async Task ExportAsync_JoinsOrganizationNameAndActorName()
    {
        var repo = new AuditReadRepository(_fixture.NewReadContext());

        var rows = await repo.ExportAsync(new AuditLogFilter(null, AuditReadFixture.OrgA, null, null, null, null), CancellationToken.None);

        var row = rows.Single(r => r.EntityId == null && r.Action == "login_failed");
        Assert.Equal("Acme Corp", row.OrganizationName);
        Assert.Equal("Rick", row.ActorFirstName);
        Assert.Equal("Recruiter", row.ActorLastName);
    }
}
