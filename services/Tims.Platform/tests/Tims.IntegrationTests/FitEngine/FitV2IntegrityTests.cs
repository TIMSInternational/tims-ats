using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using Tims.Application.FitEngine;
using Tims.Domain.FitEngine;
using Tims.Infrastructure.FitEngine;

namespace Tims.IntegrationTests.FitEngine;

/// <summary>
/// The FIT v2 flag-on preconditions of release slice "fit", against real Postgres with the SHIPPED migration
/// 20261109100000_fit_v2_integrity applied verbatim by <see cref="FitEngineFixture"/>:
///   the v2 guard — a writer that does not mark itself FIT v2-aware (the TS computeFitScore) cannot replace a v2 row,
///     only its llmJudgment lands; the C# writer marks itself and may write v1;
///   the recompute queue — a status, result or proctoring change on a FIT v2 vacancy enqueues in the same
///     transaction (also under RLS as app_tenant), each change bumps the sequence, a v1 vacancy enqueues nothing;
///     the drain recomputes the stored row from the change, never creates a row, and keeps a newer change queued;
///   the review signal — only a 'clear' review releases a high-severity session; the CHECK refuses other values;
///   several quizzes — the adapter reports each quiz as its own variant;
///   grading norms — grading the last essay writes the local percentile, band and sample size;
///   the candidate fit-scores read — authorization, vacancy scope, D6 redaction, dark by default;
///   the recompute loop is registered only with the FIT v2 compute live.
/// Each test owns its rows (fresh ids), so the shared "FitEngine" collection's other tests see nothing new.
/// </summary>
[Collection("FitEngine")]
public sealed class FitV2IntegrityTests(FitEngineFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "fit-integrity-test-key" };
    private static readonly Guid Org = FitEngineFixture.OrgA;
    private static readonly Guid TeamT1 = Guid.Parse("7ea00000-0000-0000-0000-000000000001");
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

    private const string V2Breakdown =
        """{"assessment":50,"interview":80,"experience":100,"education":null,"languages":100,"llmJudgment":null,"fitVersion":2,"reviewPending":false,"assessments":[{"instrument":"lia","use":"scored","status":"completed","score":50,"gate":null,"weight":null,"assessmentShare":1,"effectiveWeight":0.4,"min":{"globalPercentile":40},"reason":null,"resultId":"r1","source":"provider","contentVersion":null,"normVersion":null,"languagesEvidence":null}]}""";

    private const string Weights = """{"assessment":0.4,"interview":0.2,"experience":0.2,"education":0.1,"languages":0.1}""";

    private readonly FitEngineFixture _fixture = fixture;

    // ── the v2 guard ──
    [Fact]
    public async Task A_writer_that_does_not_know_v2_cannot_replace_a_v2_row_only_its_judgment_lands()
    {
        var (candidate, vacancy) = (Guid.NewGuid(), Guid.NewGuid());
        await InsertFitScoreAsync(candidate, vacancy, 73, V2Breakdown, partial: true);
        await SqlAsync("UPDATE fit_scores SET restricted_overall_score = 92 WHERE candidate_id = @c", ("c", candidate));

        // The TS computeFitScore upsert, as Prisma sends it: a v1 breakdown carrying a screening judgment.
        await TsUpsertAsync(candidate, vacancy, 99, """{"assessment":10,"interview":null,"experience":null,"education":null,"languages":null,"llmJudgment":{"score":70,"recommendation":"advance","reasoning":"x","strengths":[],"gaps":[]}}""");
        var row = (await _fixture.GetFitScoreAsync(candidate, vacancy))!;
        var breakdown = JsonNode.Parse(row.Breakdown)!;
        Assert.Equal(73, row.OverallScore);
        Assert.True(row.IsPartial);
        Assert.Equal(2, breakdown["fitVersion"]!.GetValue<int>());
        Assert.Equal(50, breakdown["assessment"]!.GetValue<double>());
        Assert.Equal("advance", breakdown["llmJudgment"]!["recommendation"]!.GetValue<string>());
        Assert.True(JsonNode.DeepEquals(JsonNode.Parse(Weights), JsonNode.Parse(row.Weights)), row.Weights);
        Assert.Equal(92d, await _fixture.ExecuteScalarAsync(
            "SELECT restricted_overall_score FROM fit_scores WHERE candidate_id = @c", ("c", candidate)));

        // computeForVacancy's TS recompute (llmJudgment null) changes nothing, not even the judgment.
        await TsUpsertAsync(candidate, vacancy, 12, """{"assessment":12,"interview":null,"experience":null,"education":null,"languages":null,"llmJudgment":null}""");
        var again = JsonNode.Parse((await _fixture.GetFitScoreAsync(candidate, vacancy))!.Breakdown)!;
        Assert.Equal("advance", again["llmJudgment"]!["recommendation"]!.GetValue<string>());
        Assert.Equal(50, again["assessment"]!.GetValue<double>());
    }

    [Fact]
    public async Task The_csharp_writer_marks_itself_fit_v2_aware_so_its_v1_compute_may_replace_a_v2_row()
    {
        var (candidate, vacancy) = (Guid.NewGuid(), Guid.NewGuid());
        await InsertFitScoreAsync(candidate, vacancy, 73, V2Breakdown, partial: true);

        await using var db = _fixture.NewWriteContext();
        var written = await new FitEngineWriteRepository(db).UpsertFitScoreUnlessWithdrawnAsync(
            Org, candidate, vacancy, 64, """{"assessment":64,"llmJudgment":null}""", Weights, false, Now,
            CancellationToken.None);

        Assert.True(written);
        var row = (await _fixture.GetFitScoreAsync(candidate, vacancy))!;
        Assert.Equal(64, row.OverallScore);
        Assert.Null(JsonNode.Parse(row.Breakdown)!["fitVersion"]);
        Assert.Equal(DBNull.Value, await _fixture.ExecuteScalarAsync(
            "SELECT restricted_overall_score FROM fit_scores WHERE candidate_id = @c", ("c", candidate))); // v1: none
    }

    // ── the recompute queue ──
    [Fact]
    public async Task Changes_on_a_v2_vacancy_enqueue_in_the_same_transaction_and_each_bumps_the_sequence()
    {
        var seed = await SeedQuizAsync(v2: true, normalized: 80);

        await SqlAsync("UPDATE assessment_assignments SET status = 'cancelled' WHERE id = @a", ("a", seed.Assignment));
        Assert.Equal(1, (await _fixture.GetRecomputeRequestAsync(seed.Candidate, seed.Vacancy))!.Value.Seq);

        await SqlAsync("UPDATE assessment_results SET breakdown = '{\"autoScored\":2,\"pendingManual\":[]}' WHERE assignment_id = @a", ("a", seed.Assignment));
        await SqlAsync(
            "INSERT INTO proctoring_sessions (id, organization_id, assignment_id, started_at, severity) VALUES (@id, @o, @a, now(), 'low')",
            ("id", Guid.NewGuid()), ("o", Org), ("a", seed.Assignment));
        await SqlAsync("UPDATE proctoring_sessions SET severity = 'high' WHERE assignment_id = @a", ("a", seed.Assignment));
        await SqlAsync("UPDATE proctoring_sessions SET review_status = 'clear' WHERE assignment_id = @a", ("a", seed.Assignment));
        Assert.Equal(5, (await _fixture.GetRecomputeRequestAsync(seed.Candidate, seed.Vacancy))!.Value.Seq);

        // A change that touches none of the watched columns enqueues nothing more.
        await SqlAsync("UPDATE proctoring_sessions SET flag_count = flag_count + 1 WHERE assignment_id = @a", ("a", seed.Assignment));
        await SqlAsync("UPDATE assessment_assignments SET completed_at = now() WHERE id = @a", ("a", seed.Assignment));
        Assert.Equal(5, (await _fixture.GetRecomputeRequestAsync(seed.Candidate, seed.Vacancy))!.Value.Seq);
    }

    [Fact]
    public async Task A_v1_vacancy_enqueues_nothing()
    {
        var seed = await SeedQuizAsync(v2: false, normalized: 80);

        await SqlAsync("UPDATE assessment_assignments SET status = 'cancelled' WHERE id = @a", ("a", seed.Assignment));

        Assert.Null(await _fixture.GetRecomputeRequestAsync(seed.Candidate, seed.Vacancy));
    }

    [Fact]
    public async Task The_triggers_enqueue_under_rls_as_the_tenant_role_but_nobody_may_call_the_function_directly()
    {
        var seed = await SeedQuizAsync(v2: true, normalized: 80);

        await using (var connection = new NpgsqlConnection(_fixture.ConnectionString))
        {
            await connection.OpenAsync();
            await using var tx = await connection.BeginTransactionAsync();
            await using (var command = new NpgsqlCommand(
                "SET LOCAL ROLE app_tenant; SELECT set_config('app.current_org_id', @o, true); "
                + "UPDATE assessment_results SET normalized_score = 70 WHERE assignment_id = @a",
                connection, tx))
            {
                command.Parameters.AddWithValue("o", Org.ToString());
                command.Parameters.AddWithValue("a", seed.Assignment);
                await command.ExecuteNonQueryAsync();
            }

            await tx.CommitAsync();
        }

        Assert.Equal(1, (await _fixture.GetRecomputeRequestAsync(seed.Candidate, seed.Vacancy))!.Value.Seq);
        Assert.False((bool)(await _fixture.ExecuteScalarAsync(
            "SELECT has_function_privilege('public', 'public.fit_v2_request_recompute(uuid,uuid,uuid)', 'execute')"))!);
        Assert.False((bool)(await _fixture.ExecuteScalarAsync(
            "SELECT has_function_privilege('app_tenant', 'public.fit_v2_request_recompute(uuid,uuid,uuid)', 'execute')"))!);
        Assert.False((bool)(await _fixture.ExecuteScalarAsync(
            "SELECT has_table_privilege('app_tenant', 'fit_recompute_requests', 'insert')"))!);
    }

    // Codex release round 1 [P1]: the SECURITY DEFINER enqueue must not be a way around RLS. A tenant-scoped session
    // cannot call it at all, and even its owner is refused another organization while a tenant is set.
    [Fact]
    public async Task A_tenant_scoped_session_cannot_enqueue_for_another_organization()
    {
        var seed = await SeedQuizAsync(v2: true, normalized: 80);
        var other = FitEngineFixture.OrgB;

        async Task<PostgresException> CallAsync(string role)
        {
            await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
            await connection.OpenAsync();
            await using var tx = await connection.BeginTransactionAsync();
            await using var command = new NpgsqlCommand(
                role + "SELECT set_config('app.current_org_id', @o, true); "
                + "SELECT public.fit_v2_request_recompute(@other, @c, @v)", connection, tx);
            command.Parameters.AddWithValue("o", Org.ToString());
            command.Parameters.AddWithValue("other", other);
            command.Parameters.AddWithValue("c", seed.Candidate);
            command.Parameters.AddWithValue("v", seed.Vacancy);
            return await Assert.ThrowsAsync<PostgresException>(() => command.ExecuteNonQueryAsync());
        }

        Assert.Equal("42501", (await CallAsync("SET LOCAL ROLE app_tenant; ")).SqlState); // no EXECUTE
        var owner = await CallAsync(string.Empty);                                           // the owner, tenant set
        Assert.Equal("42501", owner.SqlState);
        Assert.Contains("is not the current tenant", owner.MessageText, StringComparison.Ordinal);
        Assert.Null(await _fixture.GetRecomputeRequestAsync(seed.Candidate, seed.Vacancy));
    }

    [Fact]
    public async Task The_drain_recomputes_the_stored_row_after_a_cancel_and_deletes_the_request()
    {
        var seed = await SeedQuizAsync(v2: true, normalized: 80);
        Assert.True(await RecomputeAsync(seed, onlyIfRowExists: false)); // the first compute: a clean 80
        var before = JsonNode.Parse((await _fixture.GetFitScoreAsync(seed.Candidate, seed.Vacancy))!.Breakdown)!;
        Assert.Equal("completed", before["assessments"]![0]!["status"]!.GetValue<string>());
        Assert.False(before["reviewPending"]!.GetValue<bool>());

        await SqlAsync("UPDATE assessment_assignments SET status = 'cancelled' WHERE id = @a", ("a", seed.Assignment));
        var outcome = await DrainOnlyAsync(seed);

        Assert.Equal(1, outcome.Recomputed);
        var after = JsonNode.Parse((await _fixture.GetFitScoreAsync(seed.Candidate, seed.Vacancy))!.Breakdown)!;
        Assert.Equal("needs_review", after["assessments"]![0]!["status"]!.GetValue<string>());
        Assert.True(after["reviewPending"]!.GetValue<bool>());
        Assert.Null(await _fixture.GetRecomputeRequestAsync(seed.Candidate, seed.Vacancy));

        // A person clears the flag: the next drain makes the result count again.
        await SqlAsync("UPDATE assessment_assignments SET status = 'completed' WHERE id = @a", ("a", seed.Assignment));
        await DrainOnlyAsync(seed);
        var cleared = JsonNode.Parse((await _fixture.GetFitScoreAsync(seed.Candidate, seed.Vacancy))!.Breakdown)!;
        Assert.Equal(80, cleared["assessments"]![0]!["score"]!.GetValue<double>());
    }

    [Fact]
    public async Task The_drain_never_creates_a_row_and_a_change_during_the_recompute_stays_queued()
    {
        var seed = await SeedQuizAsync(v2: true, normalized: 80);
        await SqlAsync("UPDATE assessment_assignments SET status = 'cancelled' WHERE id = @a", ("a", seed.Assignment));

        var outcome = await DrainOnlyAsync(seed);
        Assert.Equal((0, 1), (outcome.Recomputed, outcome.Skipped));
        Assert.Null(await _fixture.GetFitScoreAsync(seed.Candidate, seed.Vacancy)); // nobody computed it: still none
        Assert.Null(await _fixture.GetRecomputeRequestAsync(seed.Candidate, seed.Vacancy));

        // Claimed at seq 1, a new change lands (seq 2), the completion at seq 1 leaves it for the next pass.
        await SqlAsync("UPDATE assessment_assignments SET status = 'completed' WHERE id = @a", ("a", seed.Assignment));
        await using var db = _fixture.NewWriteContext();
        var queue = new FitRecomputeQueueRepository(db);
        var claimed = Assert.Single(await queue.ClaimAsync(Org, 100, CancellationToken.None), r => r.CandidateId == seed.Candidate);
        Assert.Equal(1, claimed.RequestSeq);
        await SqlAsync("UPDATE assessment_assignments SET status = 'cancelled' WHERE id = @a", ("a", seed.Assignment));

        Assert.False(await queue.CompleteAsync(Org, claimed, CancellationToken.None));
        var left = (await _fixture.GetRecomputeRequestAsync(seed.Candidate, seed.Vacancy))!.Value;
        Assert.Equal((2L, 0), (left.Seq, left.Attempts)); // re-armed: available again, attempts reset
    }

    [Fact]
    public async Task A_claimed_request_is_leased_and_a_failure_is_recorded_at_its_sequence()
    {
        var seed = await SeedQuizAsync(v2: true, normalized: 80);
        await SqlAsync("UPDATE assessment_assignments SET status = 'cancelled' WHERE id = @a", ("a", seed.Assignment));
        await using var db = _fixture.NewWriteContext();
        var queue = new FitRecomputeQueueRepository(db);

        var claimed = Assert.Single(await queue.ClaimAsync(Org, 100, CancellationToken.None), r => r.CandidateId == seed.Candidate);
        Assert.DoesNotContain(await queue.ClaimAsync(Org, 100, CancellationToken.None), r => r.CandidateId == seed.Candidate);
        await queue.RecordFailureAsync(Org, claimed, "TimeoutException", CancellationToken.None);

        var request = (await _fixture.GetRecomputeRequestAsync(seed.Candidate, seed.Vacancy))!.Value;
        Assert.Equal((1, "TimeoutException"), (request.Attempts, request.LastError));
        Assert.True((bool)(await _fixture.ExecuteScalarAsync(
            "SELECT available_at > clock_timestamp() + interval '50 seconds' FROM fit_recompute_requests WHERE candidate_id = @c",
            ("c", seed.Candidate)))!);
    }

    // ── the review signal ──
    [Theory]
    [InlineData("high", "unreviewed", ResultIntegrity.NeedsReview)]
    [InlineData("high", "clear", ResultIntegrity.Valid)]
    [InlineData("low", "concern", ResultIntegrity.NeedsReview)]
    [InlineData("low", "inconclusive", ResultIntegrity.NeedsReview)]
    [InlineData("medium", "unreviewed", ResultIntegrity.Valid)]
    public async Task Only_a_clear_review_releases_a_flagged_session(string severity, string review, ResultIntegrity expected)
    {
        var seed = await SeedQuizAsync(v2: true, normalized: 80);
        await SqlAsync(
            "INSERT INTO proctoring_sessions (id, organization_id, assignment_id, started_at, severity, review_status) VALUES (@id, @o, @a, now(), @s, @r)",
            ("id", Guid.NewGuid()), ("o", Org), ("a", seed.Assignment), ("s", severity), ("r", review));

        await using var db = _fixture.NewWriteContext();
        var result = Assert.Single(await new AtsAssessmentResultSource(db).GetResultsAsync(
            Org, seed.Candidate, seed.Vacancy, CancellationToken.None));

        Assert.Equal(expected, result.Integrity);
    }

    [Fact]
    public async Task The_review_status_check_refuses_an_unknown_value()
    {
        var seed = await SeedQuizAsync(v2: false, normalized: 80);
        var error = await Assert.ThrowsAsync<PostgresException>(() => SqlAsync(
            "INSERT INTO proctoring_sessions (id, organization_id, assignment_id, started_at, review_status) VALUES (@id, @o, @a, now(), 'approved')",
            ("id", Guid.NewGuid()), ("o", Org), ("a", seed.Assignment)));
        Assert.Equal("proctoring_sessions_review_status_check", error.ConstraintName);
    }

    [Theory]
    [InlineData(null, "high", ResultIntegrity.NeedsReview)]
    [InlineData("unreviewed", "high", ResultIntegrity.NeedsReview)]
    [InlineData("clear", "critical", ResultIntegrity.Valid)]
    [InlineData("concern", "low", ResultIntegrity.NeedsReview)]
    [InlineData("inconclusive", null, ResultIntegrity.NeedsReview)]
    [InlineData("something-new", "low", ResultIntegrity.NeedsReview)]
    [InlineData("unreviewed", "medium", ResultIntegrity.Valid)]
    [InlineData(null, null, ResultIntegrity.Valid)]
    public void The_integrity_rule_reads_the_review_before_the_severity(string? review, string? severity, ResultIntegrity expected)
    {
        Assert.Equal(expected, AtsAssessmentResultSource.IntegrityOf("completed", severity, review, false));
        // A clear review never releases what it is not about: a cancelled assignment or an ungraded essay.
        Assert.Equal(ResultIntegrity.NeedsReview, AtsAssessmentResultSource.IntegrityOf("cancelled", severity, "clear", false));
        Assert.Equal(ResultIntegrity.NeedsReview, AtsAssessmentResultSource.IntegrityOf("completed", severity, "clear", true));
    }

    // ── several quizzes ──
    // Codex release round 1 [P2]: a row bound applied before the per-quiz pick could drop an older quiz that needs
    // review behind another quiz's newer attempts. The latest result of EACH quiz is picked in SQL first.
    [Fact]
    public async Task An_older_quiz_awaiting_review_is_never_hidden_by_many_newer_attempts_of_another_quiz()
    {
        var seed = await SeedQuizAsync(v2: true, normalized: 70);
        await SqlAsync("UPDATE assessment_assignments SET status = 'cancelled', completed_at = now() - interval '30 days' WHERE id = @a", ("a", seed.Assignment));
        var quizA = Guid.NewGuid();
        await SqlAsync(
            "WITH a AS (INSERT INTO assessment_assignments (id, organization_id, candidate_id, vacancy_id, status, completed_at, assessment_type_id) "
            + "SELECT gen_random_uuid(), @o, @c, @v, 'completed', now() - (g || ' minutes')::interval, @t FROM generate_series(1, 60) g RETURNING id) "
            + "INSERT INTO assessment_results (id, organization_id, assignment_id, normalized_score, breakdown) "
            + "SELECT gen_random_uuid(), @o, a.id, 95, '{\"pendingManual\":[]}' FROM a",
            ("o", Org), ("c", seed.Candidate), ("v", seed.Vacancy), ("t", quizA));

        await using var db = _fixture.NewWriteContext();
        var results = await new AtsAssessmentResultSource(db).GetResultsAsync(Org, seed.Candidate, seed.Vacancy, CancellationToken.None);

        Assert.Equal(2, results.Count); // one per quiz
        Assert.Contains(results, r => r.ResultId == seed.Assignment.ToString() && r.Integrity == ResultIntegrity.NeedsReview);
        Assert.True(await RecomputeAsync(seed, onlyIfRowExists: false));
        var breakdown = JsonNode.Parse((await _fixture.GetFitScoreAsync(seed.Candidate, seed.Vacancy))!.Breakdown)!;
        Assert.Equal("needs_review", breakdown["assessments"]![0]!["status"]!.GetValue<string>());
        Assert.True(breakdown["reviewPending"]!.GetValue<bool>());
    }

    [Fact]
    public async Task More_quizzes_than_the_bound_fail_closed_as_needs_review()
    {
        var seed = await SeedQuizAsync(v2: true, normalized: 70);
        await SqlAsync(
            "WITH a AS (INSERT INTO assessment_assignments (id, organization_id, candidate_id, vacancy_id, status, completed_at, assessment_type_id) "
            + "SELECT gen_random_uuid(), @o, @c, @v, 'completed', now(), gen_random_uuid() FROM generate_series(1, @n) RETURNING id) "
            + "INSERT INTO assessment_results (id, organization_id, assignment_id, normalized_score, breakdown) "
            + "SELECT gen_random_uuid(), @o, a.id, 95, '{\"pendingManual\":[]}' FROM a",
            ("o", Org), ("c", seed.Candidate), ("v", seed.Vacancy), ("n", AtsAssessmentResultSource.MaxQuizzes));

        await using var db = _fixture.NewWriteContext();
        var results = await new AtsAssessmentResultSource(db).GetResultsAsync(Org, seed.Candidate, seed.Vacancy, CancellationToken.None);

        Assert.Equal(AtsAssessmentResultSource.MaxQuizzes + 1, results.Count);
        Assert.All(results, r => Assert.Equal(ResultIntegrity.NeedsReview, r.Integrity));
    }
    [Fact]
    public async Task Each_quiz_is_its_own_variant_so_the_latest_of_one_never_hides_another()
    {
        var seed = await SeedQuizAsync(v2: true, normalized: 60);
        var second = Guid.NewGuid();
        await SqlAsync(
            "INSERT INTO assessment_assignments (id, organization_id, candidate_id, vacancy_id, status, completed_at, assessment_type_id) VALUES (@id, @o, @c, @v, 'completed', now() + interval '1 day', @t)",
            ("id", second), ("o", Org), ("c", seed.Candidate), ("v", seed.Vacancy), ("t", Guid.NewGuid()));
        await SqlAsync(
            "INSERT INTO assessment_results (id, organization_id, assignment_id, normalized_score, breakdown) VALUES (@id, @o, @a, 90, '{\"pendingManual\":[]}')",
            ("id", Guid.NewGuid()), ("o", Org), ("a", second));

        Assert.True(await RecomputeAsync(seed, onlyIfRowExists: false));

        var entry = JsonNode.Parse((await _fixture.GetFitScoreAsync(seed.Candidate, seed.Vacancy))!.Breakdown)!["assessments"]![0]!;
        Assert.Equal(75, entry["score"]!.GetValue<double>()); // (60 + 90) / 2, not the later quiz's 90 alone
        Assert.Equal(DBNull.Value, await _fixture.ExecuteScalarAsync(
            "SELECT restricted_overall_score FROM fit_scores WHERE candidate_id = @c", ("c", seed.Candidate))); // no minimum: nothing hidden
        Assert.Equal(
            [second.ToString(), seed.Assignment.ToString()],
            entry["resultIds"]!.AsArray().Select(n => n!.GetValue<string>()).ToArray());
    }

    // ── grading norms ──
    [Fact]
    public async Task Grading_the_last_essay_writes_the_local_percentile_band_and_sample_size()
    {
        var quiz = Guid.NewGuid();
        foreach (var score in new[] { 10d, 20, 30, 50, 60 })
        {
            await SeedGradedPopulationAsync(quiz, score);
        }

        var (assignment, essay) = await SeedEssayAsync(quiz);
        await using var db = _fixture.NewWriteContext();
        var outcome = await new EssayGradingRepository(db).GradeEssayAsync(
            Org, assignment, essay, 1, FitEngineFixture.OrgAdminId, Now, CancellationToken.None);

        Assert.Equal((EssayGradeStatus.Graded, 0), (outcome.Status, outcome.RemainingPending));
        Assert.Equal(50, outcome.NormalizedScore); // the choice 0/1 + the essay 1/1 → 1/2
        // Below 50: 10, 20, 30 (3); equal: 50 (1); n = 5 → (3 + 0.5) / 5 = 70 → above average.
        Assert.Equal(70d, await _fixture.ExecuteScalarAsync("SELECT percentile FROM assessment_results WHERE assignment_id = @a", ("a", assignment)));
        Assert.Equal("above_average", await _fixture.ExecuteScalarAsync("SELECT band::text FROM assessment_results WHERE assignment_id = @a", ("a", assignment)));
        Assert.Equal(5, await _fixture.ExecuteScalarAsync("SELECT norm_sample_size FROM assessment_results WHERE assignment_id = @a", ("a", assignment)));
    }

    [Fact]
    public async Task Below_the_minimum_sample_grading_writes_no_percentile_but_the_sample_size()
    {
        var quiz = Guid.NewGuid();
        await SeedGradedPopulationAsync(quiz, 10);
        await SeedGradedPopulationAsync(quiz, 90);
        // An essay still pending elsewhere is not in the population.
        await SeedGradedPopulationAsync(quiz, 40, pendingManual: true);

        var (assignment, essay) = await SeedEssayAsync(quiz);
        await using var db = _fixture.NewWriteContext();
        await new EssayGradingRepository(db).GradeEssayAsync(Org, assignment, essay, 1, FitEngineFixture.OrgAdminId, Now, CancellationToken.None);

        Assert.Equal(DBNull.Value, await _fixture.ExecuteScalarAsync("SELECT percentile FROM assessment_results WHERE assignment_id = @a", ("a", assignment)));
        Assert.Equal(DBNull.Value, await _fixture.ExecuteScalarAsync("SELECT band::text FROM assessment_results WHERE assignment_id = @a", ("a", assignment)));
        Assert.Equal(2, await _fixture.ExecuteScalarAsync("SELECT norm_sample_size FROM assessment_results WHERE assignment_id = @a", ("a", assignment)));
    }

    // ── the candidate fit-scores read ──
    [Fact]
    public async Task Candidate_fit_scores_hr_sees_the_stored_row_a_team_lead_sees_d6_and_only_in_scope_vacancies()
    {
        var candidate = Guid.NewGuid();
        var inTeam = await SeedVacancyAsync(TeamT1);
        var outOfTeam = await SeedVacancyAsync(team: null);
        await InsertFitScoreAsync(candidate, inTeam, 73, V2Breakdown, partial: true);
        await InsertFitScoreAsync(candidate, outOfTeam, 55, """{"assessment":55,"llmJudgment":null}""", partial: false);

        await using var factory = Factory(readEnabled: true);
        using var client = factory.CreateClient();

        var hr = await GetItemsAsync(client, candidate, FitEngineFixture.OrgAdminSub);
        Assert.Equal(2, hr.Count);
        var hrRow = hr.Single(r => r!["vacancyId"]!.GetValue<string>() == inTeam.ToString())!;
        Assert.Equal(73, hrRow["overallScore"]!.GetValue<double>());
        Assert.Equal(50, hrRow["breakdown"]!["assessments"]![0]!["score"]!.GetValue<double>());

        var lead = await GetItemsAsync(client, candidate, FitEngineFixture.TeamLeadSub);
        var leadRow = Assert.Single(lead)!; // the out-of-team vacancy's row is simply not there
        Assert.Equal(inTeam.ToString(), leadRow["vacancyId"]!.GetValue<string>());
        Assert.Equal(92, leadRow["overallScore"]!.GetValue<double>()); // (16 + 20 + 10) / 0.5, not the invertible 73
        Assert.True(leadRow["isPartial"]!.GetValue<bool>());
        Assert.Null(leadRow["breakdown"]!["assessment"]);
        Assert.Null(leadRow["breakdown"]!["assessments"]![0]!["score"]);
        Assert.True(leadRow["breakdown"]!["assessments"]![0]!["belowMinimum"]!.GetValue<bool>());
        Assert.DoesNotContain("\"weights\"", leadRow.ToJsonString(), StringComparison.Ordinal);

        Assert.Empty(await GetItemsAsync(client, Guid.NewGuid(), FitEngineFixture.OrgAdminSub)); // unknown: empty, not 404
        Assert.Equal(HttpStatusCode.Forbidden, (await GetAsync(client, candidate, FitEngineFixture.NoGrantSub)).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await GetAsync(client, candidate, token: null)).StatusCode);
    }

    [Fact]
    public async Task Candidate_fit_scores_are_dark_by_default()
    {
        await using var factory = Factory(readEnabled: false);
        using var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.NotFound, (await GetAsync(client, Guid.NewGuid(), FitEngineFixture.OrgAdminSub)).StatusCode);
    }

    [Theory]
    [InlineData(true, true, true)]
    [InlineData(true, false, false)]
    [InlineData(false, true, false)]
    public async Task The_recompute_loop_runs_only_with_the_fit_v2_compute_live(bool write, bool v2, bool expected)
    {
        await using var factory = Factory(readEnabled: false, writeEnabled: write, v2Enabled: v2);
        var hosted = factory.Services.GetServices<IHostedService>();
        Assert.Equal(expected, hosted.Any(h => h is Tims.Api.FitEngine.FitRecomputeHostedService));
    }

    // ── helpers ──
    private sealed record QuizSeed(Guid Candidate, Guid Vacancy, Guid Assignment);

    private async Task<QuizSeed> SeedQuizAsync(bool v2, double normalized)
    {
        var vacancy = await SeedVacancyAsync(team: null, v2 ? """{"assessments":[{"instrument":"native_quiz","use":"scored"}]}""" : """{"minYearsExperience":1}""");
        var candidate = Guid.NewGuid();
        await SqlAsync(
            "INSERT INTO candidates (id, organization_id, email, first_name, last_name, created_at, updated_at) VALUES (@id, @o, @e, 'Int', 'Egrity', now(), now())",
            ("id", candidate), ("o", Org), ("e", $"{candidate:N}@fit.test"));
        var assignment = Guid.NewGuid();
        await SqlAsync(
            "INSERT INTO assessment_assignments (id, organization_id, candidate_id, vacancy_id, status, completed_at, assessment_type_id) VALUES (@id, @o, @c, @v, 'completed', now(), @t)",
            ("id", assignment), ("o", Org), ("c", candidate), ("v", vacancy), ("t", Guid.NewGuid()));
        await SqlAsync(
            "INSERT INTO assessment_results (id, organization_id, assignment_id, normalized_score, breakdown) VALUES (@id, @o, @a, @s, '{\"pendingManual\":[]}')",
            ("id", Guid.NewGuid()), ("o", Org), ("a", assignment), ("s", normalized));
        // The seed itself enqueued (a result insert); each test starts from an empty queue for this pair.
        await SqlAsync("DELETE FROM fit_recompute_requests WHERE candidate_id = @c", ("c", candidate));
        return new QuizSeed(candidate, vacancy, assignment);
    }

    private async Task<Guid> SeedVacancyAsync(Guid? team, string fitRequirements = """{"assessments":[{"instrument":"native_quiz","use":"scored"}]}""")
    {
        var vacancy = Guid.NewGuid();
        await SqlAsync(
            "INSERT INTO vacancies (id, organization_id, title, team_id, created_by, status, created_at, updated_at) VALUES (@id, @o, 'Integrity', @t, @by, 'open', now(), now())",
            ("id", vacancy), ("o", Org), ("t", team is { } t ? t : DBNull.Value), ("by", FitEngineFixture.OrgAdminId));
        await SqlAsync(
            "INSERT INTO job_profiles (id, organization_id, vacancy_id, fit_requirements) VALUES (@id, @o, @v, @f::jsonb)",
            ("id", Guid.NewGuid()), ("o", Org), ("v", vacancy), ("f", fitRequirements));
        return vacancy;
    }

    private async Task SeedGradedPopulationAsync(Guid quiz, double score, bool pendingManual = false)
    {
        var assignment = (await SeedQuizAsync(v2: false, normalized: score)).Assignment;
        await SqlAsync("UPDATE assessment_assignments SET assessment_type_id = @t WHERE id = @a", ("t", quiz), ("a", assignment));
        if (pendingManual)
        {
            await SqlAsync("UPDATE assessment_results SET breakdown = '{\"pendingManual\":[\"q\"]}' WHERE assignment_id = @a", ("a", assignment));
        }
    }

    // One choice answered wrong (0/1) and one essay pending (1 point), on the given quiz.
    private async Task<(Guid Assignment, Guid Essay)> SeedEssayAsync(Guid quiz)
    {
        var assignment = (await SeedQuizAsync(v2: false, normalized: 0)).Assignment;
        var (choice, essay) = (Guid.NewGuid(), Guid.NewGuid());
        await SqlAsync("UPDATE assessment_assignments SET assessment_type_id = @t WHERE id = @a", ("t", quiz), ("a", assignment));
        await SqlAsync(
            "INSERT INTO assessment_questions (id, organization_id, \"order\", prompt, points) VALUES (@c, @o, 1, 'Pick', 1), (@e, @o, 2, 'Explain', 1)",
            ("c", choice), ("e", essay), ("o", Org));
        await SqlAsync(
            "INSERT INTO assessment_responses (id, organization_id, assignment_id, question_id, free_text, is_correct, points_awarded) VALUES (@r1, @o, @a, @c, NULL, false, 0), (@r2, @o, @a, @e, 'Answer', NULL, NULL)",
            ("r1", Guid.NewGuid()), ("r2", Guid.NewGuid()), ("o", Org), ("a", assignment), ("c", choice), ("e", essay));
        await SqlAsync(
            "UPDATE assessment_results SET raw_score = 0, normalized_score = 0, breakdown = jsonb_build_object('autoScored', 1, 'pendingManual', jsonb_build_array(@e::text)) WHERE assignment_id = @a",
            ("e", essay), ("a", assignment));
        return (assignment, essay);
    }

    private async Task InsertFitScoreAsync(Guid candidate, Guid vacancy, double overall, string breakdown, bool partial) =>
        await SqlAsync(
            "INSERT INTO fit_scores (id, organization_id, candidate_id, vacancy_id, overall_score, breakdown, weights, is_partial, calculated_at, created_at, updated_at) "
            + "VALUES (@id, @o, @c, @v, @s, @b::jsonb, @w::jsonb, @p, now(), now(), now())",
            ("id", Guid.NewGuid()), ("o", Org), ("c", candidate), ("v", vacancy), ("s", overall), ("b", breakdown),
            ("w", Weights), ("p", partial));

    // What Prisma's upsert sends for the TS computeFitScore: no fit_v2_aware marker.
    private async Task TsUpsertAsync(Guid candidate, Guid vacancy, double overall, string breakdown) =>
        await SqlAsync(
            "INSERT INTO fit_scores (id, organization_id, candidate_id, vacancy_id, overall_score, breakdown, weights, is_partial, calculated_at, created_at, updated_at) "
            + "VALUES (@id, @o, @c, @v, @s, @b::jsonb, '{\"assessment\":1}'::jsonb, false, now(), now(), now()) "
            + "ON CONFLICT (candidate_id, vacancy_id) DO UPDATE SET overall_score = EXCLUDED.overall_score, breakdown = EXCLUDED.breakdown, "
            + "weights = EXCLUDED.weights, is_partial = EXCLUDED.is_partial, calculated_at = EXCLUDED.calculated_at, updated_at = EXCLUDED.updated_at",
            ("id", Guid.NewGuid()), ("o", Org), ("c", candidate), ("v", vacancy), ("s", overall), ("b", breakdown));

    private async Task<bool> RecomputeAsync(QuizSeed seed, bool onlyIfRowExists)
    {
        await using var db = _fixture.NewWriteContext();
        var useCase = new FitEngineWriteUseCase(new FitEngineWriteRepository(db), new AtsAssessmentResultSource(db));
        if (onlyIfRowExists)
        {
            return await useCase.RecomputeExistingAsync(Org, seed.Candidate, seed.Vacancy, Now, true, false, CancellationToken.None);
        }

        // The vacancy has no applications: write this one candidate through the same v2 path as computeForVacancy.
        await SqlAsync(
            "INSERT INTO applications (id, organization_id, candidate_id, vacancy_id, status) VALUES (@id, @o, @c, @v, 'active') ON CONFLICT DO NOTHING",
            ("id", Guid.NewGuid()), ("o", Org), ("c", seed.Candidate), ("v", seed.Vacancy));
        var result = await useCase.ComputeForVacancyAsync(Org, seed.Vacancy, Now, fitV2Enabled: true, CancellationToken.None);
        return result.Computed == 1;
    }

    // Drains the queue holding only this test's request (other tests' requests are not this test's to process).
    private async Task<FitRecomputeOutcome> DrainOnlyAsync(QuizSeed seed)
    {
        await SqlAsync("DELETE FROM fit_recompute_requests WHERE NOT (candidate_id = @c AND vacancy_id = @v)", ("c", seed.Candidate), ("v", seed.Vacancy));
        await using var queueDb = _fixture.NewWriteContext();
        await using var computeDb = _fixture.NewWriteContext();
        var compute = new FitEngineWriteUseCase(new FitEngineWriteRepository(computeDb), new AtsAssessmentResultSource(computeDb));
        return await new FitRecomputeUseCase(new FitRecomputeQueueRepository(queueDb), compute)
            .RunAsync(Now, fitV2Enabled: true, liaScoredAllowed: false, CancellationToken.None);
    }

    private async Task SqlAsync(string sql, params (string Name, object Value)[] parameters) =>
        await _fixture.ExecuteScalarAsync(sql, parameters);

    private WebApplicationFactory<Program> Factory(bool readEnabled, bool writeEnabled = false, bool v2Enabled = false) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:FitEngineReadEnabled", readEnabled ? "true" : "false");
            builder.UseSetting("Platform:FitEngineWriteEnabled", writeEnabled ? "true" : "false");
            builder.UseSetting("Platform:FitEngineV2Enabled", v2Enabled ? "true" : "false");
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);
            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                }));
        });

    private static async Task<HttpResponseMessage> GetAsync(HttpClient client, Guid candidate, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, $"/fit-engine/candidates/{candidate}/fit-scores");
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {Mint(token)}");
        }

        return await client.SendAsync(request);
    }

    private static async Task<JsonArray> GetItemsAsync(HttpClient client, Guid candidate, string sub)
    {
        var response = await GetAsync(client, candidate, sub);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        return JsonNode.Parse(await response.Content.ReadAsStringAsync())!["items"]!.AsArray();
    }

    private static string Mint(string sub)
    {
        var descriptor = new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Subject = new ClaimsIdentity([new Claim("sub", sub)]),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(PrivateKey, SecurityAlgorithms.RsaSha256),
        };
        return new JsonWebTokenHandler().CreateToken(descriptor);
    }
}
