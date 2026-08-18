using Tims.Infrastructure.FitEngine;

namespace Tims.IntegrationTests.FitEngine;

/// <summary>
/// Repository-level parity pins against the real Postgres — the data behaviors the endpoint matrix cannot see
/// in isolation:
///   getLatestAssessmentScore — plain <c>ORDER BY completed_at DESC</c> is NULLS FIRST in Postgres (exactly
///     what Prisma emits), so a NULL-completed assignment WITH a result beats an older completed one; and the
///     newest assignment WITHOUT a result row is excluded by the result-exists join, not by ordering;
///   getLatestInterviewFitScore — the newest NULL-fitScore session is excluded by the filter, not ordering;
///   getCandidateForFit — soft-deleted → null (deletedAt guard) and cross-org → null (explicit filter + RLS);
///   getVacancyForFit — LEFT JOIN job_profiles (a profile-less vacancy still resolves, requirements null);
///     soft-deleted vacancy → null;
///   getPipelineCandidateIds — status = 'active' only (the ghost candidate IS included; rejected is not);
///   read repo — ranking rows DESC with candidate names joined; explain joins names + vacancy title;
///     cross-tenant reads return EMPTY under the wrong org (RLS + filter).
/// </summary>
[Collection("FitEngine")]
public sealed class FitEngineRepositoryTests(FitEngineFixture fixture)
{
    private readonly FitEngineFixture _fixture = fixture;

    // ── assessment latest: NULLS FIRST parity ──
    [Fact]
    public async Task LatestAssessmentScore_PlainDescOrdering_NullCompletedAtWins_NullsFirstParity()
    {
        await using var db = _fixture.NewWriteContext();
        var repo = new FitEngineWriteRepository(db);

        // CandOrder: completed 2026-01-01 → 70 vs completed NULL → 55. Prisma's plain `orderBy completedAt
        // desc` renders ORDER BY completed_at DESC → Postgres NULLS FIRST → the NULL row wins → 55.
        var score = await repo.GetLatestAssessmentScoreAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandOrder, FitEngineFixture.VacNoProfile, CancellationToken.None);
        Assert.Equal(55, score);
    }

    [Fact]
    public async Task LatestAssessmentScore_ResultlessNewestExcluded_LatestCompletedWithResultWins()
    {
        await using var db = _fixture.NewWriteContext();
        var repo = new FitEngineWriteRepository(db);

        var score = await repo.GetLatestAssessmentScoreAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandFull, FitEngineFixture.VacInTeam, CancellationToken.None);
        Assert.Equal(90, score);
    }

    [Fact]
    public async Task LatestInterviewFitScore_NullScoreNewestExcludedByFilter()
    {
        await using var db = _fixture.NewWriteContext();
        var repo = new FitEngineWriteRepository(db);

        var score = await repo.GetLatestInterviewFitScoreAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandFull, FitEngineFixture.VacInTeam, CancellationToken.None);
        Assert.Equal(88, score);
    }

    // ── candidate / vacancy guards ──
    [Fact]
    public async Task CandidateForFit_SoftDeleted_IsNull()
    {
        await using var db = _fixture.NewWriteContext();
        var repo = new FitEngineWriteRepository(db);

        var ghost = await repo.GetCandidateForFitAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandGhost, CancellationToken.None);
        Assert.Null(ghost);
    }

    [Fact]
    public async Task CandidateForFit_CrossOrg_IsNull()
    {
        await using var db = _fixture.NewWriteContext();
        var repo = new FitEngineWriteRepository(db);

        var crossOrg = await repo.GetCandidateForFitAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandOrgB, CancellationToken.None);
        Assert.Null(crossOrg);
    }

    [Fact]
    public async Task VacancyForFit_LeftJoinsProfile_AndGuardsSoftDelete()
    {
        await using var db = _fixture.NewWriteContext();
        var repo = new FitEngineWriteRepository(db);

        var withProfile = await repo.GetVacancyForFitAsync(
            FitEngineFixture.OrgA, FitEngineFixture.VacInTeam, CancellationToken.None);
        Assert.NotNull(withProfile);
        Assert.Equal("Engineering", withProfile.RoleFamily);
        Assert.Contains("minYearsExperience", withProfile.FitRequirements);

        var noProfile = await repo.GetVacancyForFitAsync(
            FitEngineFixture.OrgA, FitEngineFixture.VacNoProfile, CancellationToken.None);
        Assert.NotNull(noProfile);
        Assert.Null(noProfile.RoleFamily);
        Assert.Null(noProfile.FitRequirements);

        var deleted = await repo.GetVacancyForFitAsync(
            FitEngineFixture.OrgA, FitEngineFixture.VacDeleted, CancellationToken.None);
        Assert.Null(deleted);
    }

    [Fact]
    public async Task PipelineCandidateIds_ActiveOnly_GhostIncluded_RejectedExcluded()
    {
        await using var db = _fixture.NewWriteContext();
        var repo = new FitEngineWriteRepository(db);

        var ids = await repo.GetPipelineCandidateIdsAsync(
            FitEngineFixture.OrgA, FitEngineFixture.VacInTeam, CancellationToken.None);

        Assert.Equal(3, ids.Count);
        Assert.Contains(FitEngineFixture.CandFull, ids);
        Assert.Contains(FitEngineFixture.CandEmpty, ids);
        Assert.Contains(FitEngineFixture.CandGhost, ids);
        Assert.DoesNotContain(FitEngineFixture.CandInactive, ids);
    }

    // ── read repository ──
    [Fact]
    public async Task RankingRows_DescWithJoinedNames()
    {
        await using var db = _fixture.NewReadContext();
        var repo = new FitEngineReadRepository(db);

        var rows = await repo.GetFitScoresForVacancyAsync(
            FitEngineFixture.OrgA, FitEngineFixture.VacRead, CancellationToken.None);

        Assert.Equal(2, rows.Count);
        Assert.Equal(85, rows[0].OverallScore);
        Assert.Equal("Carla", rows[0].FirstName);
        Assert.Equal(40, rows[1].OverallScore);
        Assert.Equal("Emil", rows[1].FirstName);
    }

    [Fact]
    public async Task RankingRows_WrongOrg_IsEmpty_TenantIsolation()
    {
        await using var db = _fixture.NewReadContext();
        var repo = new FitEngineReadRepository(db);

        var rows = await repo.GetFitScoresForVacancyAsync(
            FitEngineFixture.OrgB, FitEngineFixture.VacRead, CancellationToken.None);
        Assert.Empty(rows);
    }

    [Fact]
    public async Task WeightProfiles_AreOrgScoped_BothDirections()
    {
        await using var db = _fixture.NewReadContext();
        var repo = new FitEngineReadRepository(db);

        var orgA = await repo.ListWeightProfilesAsync(FitEngineFixture.OrgA, CancellationToken.None);
        // OrgA's seeded profiles are present…
        Assert.Contains(orgA, p => p.Name == "Engineering");
        // …and exactly one "Default" — OrgB's bootstrap (created by the write suite on this shared
        // container) must never appear here. A positive control on the same call, so a repository that
        // returned nothing at all could not pass.
        Assert.Equal(1, orgA.Count(p => p.Name == "Default"));

        // The reverse direction: OrgB never sees OrgA's Engineering/Marketing rows.
        var orgB = await repo.ListWeightProfilesAsync(FitEngineFixture.OrgB, CancellationToken.None);
        Assert.DoesNotContain(orgB, p => p.Name is "Engineering" or "Marketing");
    }

    [Fact]
    public async Task ExplainRow_CrossOrgCandidate_IsNull()
    {
        await using var db = _fixture.NewReadContext();
        var repo = new FitEngineReadRepository(db);

        var row = await repo.GetFitScoreForExplainAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandOrgB, FitEngineFixture.VacOrgB, CancellationToken.None);
        Assert.Null(row);
    }

    [Fact]
    public async Task ExplainRow_JoinsNamesAndVacancyTitle()
    {
        await using var db = _fixture.NewReadContext();
        var repo = new FitEngineReadRepository(db);

        var row = await repo.GetFitScoreForExplainAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandFull, FitEngineFixture.VacRead, CancellationToken.None);

        Assert.NotNull(row);
        Assert.Equal(85, row.OverallScore);
        Assert.Equal("Carla", row.CandidateFirstName);
        Assert.Equal("Fuentes", row.CandidateLastName);
        Assert.Equal("Read Fixture Role", row.VacancyTitle);
    }
}
