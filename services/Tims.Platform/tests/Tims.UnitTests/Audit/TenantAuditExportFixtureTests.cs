using System.Text.Json;
using Tims.Application.Audit;
using Tims.Domain.Audit;

namespace Tims.UnitTests.Audit;

public sealed class TenantAuditExportFixtureTests
{
    public static IEnumerable<object[]> Cases()
    {
        var root = JsonSerializer.Deserialize<Fixture>(File.ReadAllText(
            Path.Combine(AppContext.BaseDirectory, "audit-fixtures", "tenant-export.json")),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true })!;
        return root.Cases.Select(row => new object[] { row.Name, row });
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public async Task RealUseCaseMatchesSharedTypeScriptFixture(string name, ExportCase fixture)
    {
        Assert.Equal(name, fixture.Name);
        var repository = new FixtureRepository(fixture.Rows);
        var result = await new TenantAuditReadUseCase(repository).ExportAsync(
            Guid.Parse("11111111-1111-1111-1111-111111111111"), new(), fixture.Format, CancellationToken.None);
        Assert.Equal(fixture.Expected, result);
    }

    public sealed record Fixture(IReadOnlyList<ExportCase> Cases);
    public sealed record ExportCase(string Name, string Format, IReadOnlyList<FixtureRow> Rows, TenantAuditExport Expected);
    public sealed record Person(string FirstName, string LastName, string Email);
    public sealed record FixtureRow(DateTime CreatedAt, Person? Actor, string Action, string Entity,
        string? EntityId, string? IpAddress, string? UserAgent);

    private sealed class FixtureRepository(IReadOnlyList<FixtureRow> rows) : ITenantAuditRepository
    {
        public Task<IReadOnlyList<TenantAuditExportRow>> ExportAsync(Guid organizationId,
            TenantAuditFilter filter, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<TenantAuditExportRow>>(rows.Select(row => new TenantAuditExportRow(
                row.CreatedAt, row.Actor is null ? "" : $"{row.Actor.FirstName} {row.Actor.LastName}".Trim(),
                row.Actor?.Email ?? "", row.Action, row.Entity, row.EntityId, row.IpAddress, row.UserAgent)).ToList());

        public Task<TenantAuditDetail?> GetDetailAsync(Guid organizationId, Guid id, CancellationToken cancellationToken) =>
            throw new NotSupportedException();
        public Task<IReadOnlyList<TenantAccessReportRow>> GetAccessReportAsync(Guid organizationId,
            DateTimeOffset? dateFrom, DateTimeOffset? dateTo, CancellationToken cancellationToken) => throw new NotSupportedException();
        public Task<IReadOnlyList<TenantAuditItem<TenantAuditListActor>>> ListAsync(Guid organizationId,
            TenantAuditFilter filter, int take, Guid? cursor, CancellationToken cancellationToken) => throw new NotSupportedException();
    }
}
