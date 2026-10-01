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
///   consent guard (#312/#313) — withdrawn = self OR same-org lower(btrim(email)) alias (soft-deleted rows
///     count); never cross-org, never LIKE, never a blank email, never another consent type or a granted row;
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

    // ── #312/#313 consent guard ──
    private static readonly Guid[] ConsentPipeline =
    [
        FitEngineFixture.CandWdSelf, FitEngineFixture.CandWdAlias, FitEngineFixture.CandCrossOrgTwin,
        FitEngineFixture.CandWildcard, FitEngineFixture.CandGranted, FitEngineFixture.CandOtherType,
        FitEngineFixture.CandBlankA,
    ];

    [Fact]
    public async Task ConsentWithdrawn_ExactlySelfAndSameOrgNormalizedEmailAlias()
    {
        await using var db = _fixture.NewWriteContext();
        var repo = new FitEngineWriteRepository(db);

        var withdrawn = await repo.GetConsentWithdrawnCandidateIdsAsync(
            FitEngineFixture.OrgA, ConsentPipeline, CancellationToken.None);

        // Count the SET, not membership: WdSelf (own withdrawn row) + WdAlias (its soft-deleted same-org row
        // '  DUP@Fit.TEST ' is withdrawn; lower(btrim) equality). NOT: CrossOrgTwin (the withdrawn twin is in
        // OrgB), Wildcard ('axb' vs withdrawn 'a_b' — equality, never LIKE), Granted (withdrawn_at NULL),
        // OtherType (withdrawn consent of another type), BlankA ('' vs withdrawn '   ' — blank groups nobody).
        Assert.Equal(
            new HashSet<Guid> { FitEngineFixture.CandWdSelf, FitEngineFixture.CandWdAlias },
            withdrawn.ToHashSet());
    }

    [Fact]
    public async Task ConsentWithdrawn_IsOrgScoped_BothDirections()
    {
        await using var db = _fixture.NewWriteContext();
        var repo = new FitEngineWriteRepository(db);

        // OrgB's own withdrawn candidate IS found under OrgB (positive control for the next assertion)…
        var orgB = await repo.GetConsentWithdrawnCandidateIdsAsync(
            FitEngineFixture.OrgB, [FitEngineFixture.CandOrgBCross], CancellationToken.None);
        Assert.Equal(new HashSet<Guid> { FitEngineFixture.CandOrgBCross }, orgB.ToHashSet());

        // …and is invisible under OrgA, as are OrgA's withdrawn candidates under OrgB.
        var wrongOrgA = await repo.GetConsentWithdrawnCandidateIdsAsync(
            FitEngineFixture.OrgA, [FitEngineFixture.CandOrgBCross], CancellationToken.None);
        Assert.Empty(wrongOrgA);
        var wrongOrgB = await repo.GetConsentWithdrawnCandidateIdsAsync(
            FitEngineFixture.OrgB, ConsentPipeline, CancellationToken.None);
        Assert.Empty(wrongOrgB);
    }

    [Fact]
    public async Task ConsentWithdrawn_EmptyInput_IsEmpty()
    {
        await using var db = _fixture.NewWriteContext();
        var repo = new FitEngineWriteRepository(db);

        Assert.Empty(await repo.GetConsentWithdrawnCandidateIdsAsync(
            FitEngineFixture.OrgA, [], CancellationToken.None));
    }

    // ── #312 mid-run withdrawal: the per-candidate re-check under the withdrawal's lock ──
    [Fact]
    public async Task Upsert_WithdrawalCommittedAfterPreLoopCheck_IsRefused_NoRowWritten()
    {
        await using var db = _fixture.NewWriteContext();
        var repo = new FitEngineWriteRepository(db);

        // The pre-loop check passes…
        Assert.Empty(await repo.GetConsentWithdrawnCandidateIdsAsync(
            FitEngineFixture.OrgA, [FitEngineFixture.CandLate], CancellationToken.None));
        // …then a withdrawal commits before the write.
        await _fixture.WithdrawConsentAsync(FitEngineFixture.OrgA, FitEngineFixture.CandLate);

        var written = await Upsert(repo, FitEngineFixture.CandLate);

        Assert.False(written);
        Assert.Null(await _fixture.GetFitScoreAsync(FitEngineFixture.CandLate, FitEngineFixture.VacLate));
    }

    [Fact]
    public async Task Upsert_WithdrawalOnCaseVariantRowCommittedMidRun_IsRefused_NoRowWritten()
    {
        await using var db = _fixture.NewWriteContext();
        var repo = new FitEngineWriteRepository(db);

        Assert.Empty(await repo.GetConsentWithdrawnCandidateIdsAsync(
            FitEngineFixture.OrgA, [FitEngineFixture.CandLateAlias], CancellationToken.None));
        // ' LATE2@Fit.Test ' withdraws — the same person as 'late2@fit.test' after btrim + lower.
        await _fixture.WithdrawConsentAsync(FitEngineFixture.OrgA, FitEngineFixture.CandLateAliasSource);

        var written = await Upsert(repo, FitEngineFixture.CandLateAlias);

        Assert.False(written);
        Assert.Null(await _fixture.GetFitScoreAsync(FitEngineFixture.CandLateAlias, FitEngineFixture.VacLate));
    }

    [Fact]
    public async Task Upsert_ActiveConsent_IsWritten_PositiveControl()
    {
        await using var db = _fixture.NewWriteContext();
        var repo = new FitEngineWriteRepository(db);

        var written = await Upsert(repo, FitEngineFixture.CandGranted);

        Assert.True(written);
        Assert.NotNull(await _fixture.GetFitScoreAsync(FitEngineFixture.CandGranted, FitEngineFixture.VacLate));
    }

    private static Task<bool> Upsert(FitEngineWriteRepository repo, Guid candidateId) =>
        repo.UpsertFitScoreUnlessWithdrawnAsync(
            FitEngineFixture.OrgA, candidateId, FitEngineFixture.VacLate, 50,
            """{"assessment":50,"interview":null,"experience":null,"education":null,"languages":null,"llmJudgment":null}""",
            """{"assessment":1}""", true, new DateTimeOffset(2026, 3, 2, 0, 0, 0, TimeSpan.Zero), CancellationToken.None);

    // ── #312 read repository hides withdrawn candidates' existing scores (rows are NOT deleted) ──
    [Fact]
    public async Task RankingRows_HideWithdrawnSelfAndCaseVariant_KeepTheRest()
    {
        await using var db = _fixture.NewReadContext();
        var repo = new FitEngineReadRepository(db);

        var rows = await repo.GetFitScoresForVacancyAsync(
            FitEngineFixture.OrgA, FitEngineFixture.VacConsentRead, CancellationToken.None);

        // Count the set: WdSelf (95) and WdAlias (90, withdrawn via '  DUP@Fit.TEST ') are hidden; Wildcard (a LIKE
        // neighbour, not equal) and Granted stay, in score order.
        Assert.Equal(
            [FitEngineFixture.CandWildcard, FitEngineFixture.CandGranted], rows.Select(r => r.CandidateId).ToList());
        // Hidden, not deleted.
        Assert.NotNull(await _fixture.GetFitScoreAsync(FitEngineFixture.CandWdSelf, FitEngineFixture.VacConsentRead));
        Assert.NotNull(await _fixture.GetFitScoreAsync(FitEngineFixture.CandWdAlias, FitEngineFixture.VacConsentRead));
    }

    [Fact]
    public async Task ExplainRow_WithdrawnSelfOrCaseVariant_IsNull_ActiveIsReturned()
    {
        await using var db = _fixture.NewReadContext();
        var repo = new FitEngineReadRepository(db);

        Assert.Null(await repo.GetFitScoreForExplainAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandWdSelf, FitEngineFixture.VacConsentRead, CancellationToken.None));
        Assert.Null(await repo.GetFitScoreForExplainAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandWdAlias, FitEngineFixture.VacConsentRead, CancellationToken.None));
        var active = await repo.GetFitScoreForExplainAsync(
            FitEngineFixture.OrgA, FitEngineFixture.CandGranted, FitEngineFixture.VacConsentRead, CancellationToken.None);
        Assert.NotNull(active);
        Assert.Equal(60, active.OverallScore);
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
