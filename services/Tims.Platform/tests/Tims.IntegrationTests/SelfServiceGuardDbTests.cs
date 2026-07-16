using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Tims.Domain.Access;
using Tims.Infrastructure;
using Tims.Infrastructure.Access;

namespace Tims.IntegrationTests;

/// <summary>
/// WP2.5b Part C: proves the identity-anchored self-service pattern over real SQL. A hard
/// <c>AND subject_user_id = @ctxUser</c> filter returns NOTHING for a cross-user row even when the
/// organization matches — i.e. it is identity-anchored, NOT scope-aware (the exact bug class 1.7
/// caught). Paired with the pure <see cref="SelfServiceGuard.RequireSelf"/> guard.
/// </summary>
[Collection("AnchorProbe")]
public sealed class SelfServiceGuardDbTests(AnchorProbeFixture fixture)
{
    private async Task<object?> ProbeSelfServiceAsync(Guid rowId, Guid contextUserId, bool withSubjectFilter)
    {
        await using var db = new AnchorDbContext(AnchorProbeFixture.BuildOptions(fixture.ConnectionString));
        await using var tenant = await TenantScope.BeginAsync(db, AnchorProbeFixture.OrgA);

        var connection = (NpgsqlConnection)db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)db.Database.CurrentTransaction!.GetDbTransaction();

        var subjectClause = withSubjectFilter ? " AND subject_user_id = @ctx" : string.Empty;
        await using var command = new NpgsqlCommand(
            $"SELECT 1 FROM self_service_rows WHERE id = @id AND organization_id = @org{subjectClause} LIMIT 1",
            connection,
            transaction);
        command.Parameters.AddWithValue("id", rowId);
        command.Parameters.AddWithValue("org", AnchorProbeFixture.OrgA);
        if (withSubjectFilter)
        {
            command.Parameters.AddWithValue("ctx", contextUserId);
        }

        var result = await command.ExecuteScalarAsync();
        await tenant.CommitAsync();
        return result;
    }

    [Fact]
    public void RequireSelf_throws_for_cross_user()
    {
        Assert.Throws<SelfServiceForbiddenException>(() =>
            SelfServiceGuard.RequireSelf(AnchorProbeFixture.U1, AnchorProbeFixture.U2));
    }

    [Fact]
    public async Task Cross_user_row_is_hidden_by_the_subject_filter_even_when_org_matches()
    {
        // OtherRow is owned by U2 and DOES live in Org A. Without the subject filter, U1's Org A
        // context can see it — so the null result below is caused ONLY by the identity anchor.
        Assert.NotNull(await ProbeSelfServiceAsync(
            AnchorProbeFixture.OtherRow, AnchorProbeFixture.U1, withSubjectFilter: false));

        Assert.Null(await ProbeSelfServiceAsync(
            AnchorProbeFixture.OtherRow, AnchorProbeFixture.U1, withSubjectFilter: true));
    }

    [Fact]
    public async Task Own_row_passes_the_subject_filter()
    {
        Assert.NotNull(await ProbeSelfServiceAsync(
            AnchorProbeFixture.SelfRow, AnchorProbeFixture.U1, withSubjectFilter: true));
    }
}
