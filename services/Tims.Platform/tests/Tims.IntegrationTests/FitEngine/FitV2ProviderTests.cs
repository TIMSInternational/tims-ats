using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json.Nodes;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using Tims.Infrastructure.Assessments.Providers;
using Tims.IntegrationTests.Assessments;

namespace Tims.IntegrationTests.FitEngine;

/// <summary>
/// FIT v2 × the TIMS Assessments provider connector, end to end: the real host, real Postgres (RLS on, app_tenant),
/// the FIT-engine tables of <see cref="FitEngineFixture"/> AND the four provider tables created by the ACTUAL migration
/// <c>20261107232524_assessment_providers</c>.
/// <list type="bullet">
/// <item>Connector ON: a valid provider LIA percentile and ITC-IA level are scored against the vacancy's minimums, an
/// English gate is judged on the provider's CEFR, each entry names the provider result and its versions; a voided
/// result and a result sat at another time multiplier are needs review and held apart (reviewPending), never read as
/// low scores; another tenant's newer, higher result for the same candidate and vacancy ids is never read.</item>
/// <item>Connector OFF: the same stored provider results do not feed FIT (the adapter is not composed), so each provider
/// instrument shows as no_result.</item>
/// </list>
/// The connector-off case WITHOUT the provider tables (production before the migration) is <see cref="FitV2Tests"/>:
/// its fixture has no provider tables and every v2 compute there must still succeed.
/// </summary>
[Collection("FitV2Provider")]
public sealed class FitV2ProviderTests(FitV2ProviderFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "fit-v2-provider-test-key" };

    private readonly FitV2ProviderFixture _fixture = fixture;

    [Fact]
    public async Task ConnectorOn_ByDefault_LiaIsAThresholdGate_OnlyItciaFeedsTheNumber()
    {
        // Owner default D20: the LIA norms are unconfirmed, so the configured scored LIA is a gate on its minimum.
        await ComputeAsync(providers: true);

        var scored = await ReadBreakdownAsync(FitV2ProviderFixture.CandScored);
        Assert.Equal(40, scored.Breakdown["assessment"]!.GetValue<double>()); // ITC-IA alone; LIA ranks nobody
        var lia = Entry(scored.Breakdown, "lia");
        Assert.Equal("gate", lia["use"]!.GetValue<string>());
        Assert.Equal("not_met", lia["gate"]!.GetValue<string>()); // percentile 30 < 40: flagged, never rejected
        Assert.Null(lia["score"]);
        Assert.Equal(FitV2ProviderFixture.ResultLia.ToString(), lia["resultId"]!.GetValue<string>());
    }

    [Fact]
    public async Task ConnectorOn_ProviderResultsFeedFitV2_PerInstrument()
    {
        await ComputeAsync(providers: true, liaScored: true); // norms confirmed: the scored LIA curve

        var scored = await ReadBreakdownAsync(FitV2ProviderFixture.CandScored);
        Assert.Equal(2, scored.Breakdown["fitVersion"]!.GetValue<int>());
        Assert.Equal(58, scored.Breakdown["assessment"]!.GetValue<double>()); // (LIA 75 + ITC-IA 40) / 2 = 57.5 → 58
        Assert.False(scored.Breakdown["reviewPending"]!.GetValue<bool>());

        var lia = Entry(scored.Breakdown, "lia");
        Assert.Equal("completed", lia["status"]!.GetValue<string>());
        Assert.Equal(75, lia["score"]!.GetValue<double>()); // percentile 30 vs min 40 — NOT the other tenant's 99
        Assert.Equal("provider", lia["source"]!.GetValue<string>());
        Assert.Equal(FitV2ProviderFixture.ResultLia.ToString(), lia["resultId"]!.GetValue<string>());
        Assert.Equal("lia-2026.11.1", lia["contentVersion"]!.GetValue<string>());
        Assert.Equal("lia-norms-2026.1", lia["normVersion"]!.GetValue<string>());

        var itcia = Entry(scored.Breakdown, "itcia");
        Assert.Equal("completed", itcia["status"]!.GetValue<string>());
        Assert.Equal(40, itcia["score"]!.GetValue<double>()); // level 2 below the required 3 → round(2 / 5 × 100)

        var english = Entry(scored.Breakdown, "english");
        Assert.Equal("met", english["gate"]!.GetValue<string>()); // C1 ≥ B2
        Assert.Equal("completed", english["status"]!.GetValue<string>());

        var review = await ReadBreakdownAsync(FitV2ProviderFixture.CandReview);
        Assert.Null(review.Breakdown["assessment"]); // both scored results are held apart, never read as 0
        Assert.True(review.Breakdown["reviewPending"]!.GetValue<bool>());
        Assert.True(review.IsPartial);
        var voided = Entry(review.Breakdown, "lia");
        Assert.Equal("needs_review", voided["status"]!.GetValue<string>());
        Assert.Null(voided["score"]);
        Assert.Equal(FitV2ProviderFixture.ResultLiaVoided.ToString(), voided["resultId"]!.GetValue<string>());
        var otherMultiplier = Entry(review.Breakdown, "itcia");
        Assert.Equal("needs_review", otherMultiplier["status"]!.GetValue<string>()); // assigned at 1.5, sat at 1
        Assert.Null(otherMultiplier["score"]);
        var noEnglish = Entry(review.Breakdown, "english");
        Assert.Equal("no_result", noEnglish["status"]!.GetValue<string>());
        Assert.Equal("unknown", noEnglish["gate"]!.GetValue<string>());
    }

    // Codex atsux run 1 [P1] (D15): once an ATS-initiated erasure of the provider subject is accepted, its results stop
    // feeding FIT at once, not only when the provider confirms the erasure.
    [Fact]
    public async Task ConnectorOn_AnAttemptWhoseErasureWasAccepted_NoLongerFeedsFit()
    {
        const string Mark =
            "UPDATE assessment_provider_attempts SET provider_erasure_requested_at = {0} WHERE id = 'e0000000-0000-4000-8000-0000000000a2'";
        await _fixture.Fit.ExecuteScalarAsync(string.Format(System.Globalization.CultureInfo.InvariantCulture, Mark, "now()"));
        try
        {
            await ComputeAsync(providers: true);

            var scored = await ReadBreakdownAsync(FitV2ProviderFixture.CandScored);
            var itcia = Entry(scored.Breakdown, "itcia");
            Assert.Equal("no_result", itcia["status"]!.GetValue<string>());
            Assert.Null(itcia["resultId"]);
            Assert.Equal("completed", Entry(scored.Breakdown, "english")["status"]!.GetValue<string>()); // untouched
        }
        finally
        {
            await _fixture.Fit.ExecuteScalarAsync(string.Format(System.Globalization.CultureInfo.InvariantCulture, Mark, "NULL"));
        }
    }

    [Fact]
    public async Task ConnectorOff_TheSameStoredResultsDoNotFeedFit()
    {
        await ComputeAsync(providers: false);

        var scored = await ReadBreakdownAsync(FitV2ProviderFixture.CandScored);
        Assert.Equal(2, scored.Breakdown["fitVersion"]!.GetValue<int>());
        Assert.Null(scored.Breakdown["assessment"]);
        Assert.False(scored.Breakdown["reviewPending"]!.GetValue<bool>());
        foreach (var instrument in new[] { "lia", "itcia", "english" })
        {
            var entry = Entry(scored.Breakdown, instrument);
            Assert.Equal("no_result", entry["status"]!.GetValue<string>());
            Assert.Null(entry["resultId"]);
        }

        Assert.Equal("unknown", Entry(scored.Breakdown, "english")["gate"]!.GetValue<string>());
    }

    // FIT v2 recompute (migration 20261109011531_fit_v2_provider_recompute): a provider attempt's state change and a
    // stored provider result enqueue a recompute in the SAME transaction (rolled back here, so the shared seed is
    // untouched), and a write that changes nothing the FIT reads enqueues nothing.
    [Fact]
    public async Task A_provider_attempt_state_change_or_result_change_enqueues_a_recompute_in_its_transaction()
    {
        await using var connection = new Npgsql.NpgsqlConnection(_fixture.Fit.ConnectionString);
        await connection.OpenAsync();

        async Task<long?> SeqAfterAsync(string change)
        {
            await using var tx = await connection.BeginTransactionAsync();
            foreach (var statement in new[] { "DELETE FROM fit_recompute_requests", change })
            {
                await using var command = new Npgsql.NpgsqlCommand(statement, connection, tx);
                await command.ExecuteNonQueryAsync();
            }

            await using var read = new Npgsql.NpgsqlCommand(
                "SELECT request_seq FROM fit_recompute_requests WHERE candidate_id = @c AND vacancy_id = @v", connection, tx);
            read.Parameters.AddWithValue("c", FitV2ProviderFixture.CandScored);
            read.Parameters.AddWithValue("v", FitV2ProviderFixture.VacProvider);
            var seq = await read.ExecuteScalarAsync() as long?;
            await tx.RollbackAsync();
            return seq;
        }


        Assert.Null(await SeqAfterAsync("SELECT 1"));
        Assert.Equal(1, await SeqAfterAsync(
            "UPDATE assessment_provider_attempts SET state = 'voided' WHERE id = 'e0000000-0000-4000-8000-0000000000a1'"));
        Assert.Equal(1, await SeqAfterAsync(
            "UPDATE assessment_provider_results SET requires_human_review = true WHERE attempt_id = 'e0000000-0000-4000-8000-0000000000a1'"));
        Assert.Null(await SeqAfterAsync(
            "UPDATE assessment_provider_attempts SET state = state WHERE id = 'e0000000-0000-4000-8000-0000000000a1'"));
        // Round 12 (Codex round 11 P1): a stored provider result DELETED because the provider answered result_not_visible
        // must leave FIT, so the result trigger fires on DELETE too (migration 20261109233537_assessment_provider_round12).
        Assert.Equal(1, await SeqAfterAsync(
            "DELETE FROM assessment_provider_results WHERE attempt_id = 'e0000000-0000-4000-8000-0000000000a1'"));
        // Codex atsux run 1 [P1]: an accepted erasure takes the result out of FIT, so its marker enqueues too
        // (migration 20261109030506_fit_v2_provider_erasure_recompute).
        Assert.Equal(1, await SeqAfterAsync(
            "UPDATE assessment_provider_attempts SET provider_erasure_requested_at = now() WHERE id = 'e0000000-0000-4000-8000-0000000000a1'"));

        // The C# provider writes run as app_tenant under TenantScope, which may not execute the enqueue function
        // itself: the SECURITY DEFINER trigger does it for the row being written.
        Assert.Equal(1, await SeqAfterAsync(
            "SET LOCAL ROLE app_tenant; SELECT set_config('app.current_org_id', '11111111-1111-1111-1111-111111111111', true); "
            + "UPDATE assessment_provider_attempts SET state = 'voided' WHERE id = 'e0000000-0000-4000-8000-0000000000a1'; RESET ROLE"));
    }

    // The #312 cascade's scheduled retry is registered with the connector and only with it (its tables exist only then).
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task The_withdrawal_sweep_is_registered_only_with_the_connector_on(bool providers)
    {
        await using var factory = Factory(providers);

        var hosted = factory.Services.GetServices<IHostedService>();

        Assert.Equal(providers, hosted.Any(h => h is Tims.Api.Assessments.ProviderWithdrawalSweepHostedService));
    }

    // D17: the polling fallback is registered with the connector and only with it, like the sweep.
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task The_attempt_poller_is_registered_only_with_the_connector_on(bool providers)
    {
        await using var factory = Factory(providers);

        var hosted = factory.Services.GetServices<IHostedService>();

        Assert.Equal(providers, hosted.Any(h => h is Tims.Api.Assessments.ProviderAttemptPollHostedService));
    }

    // Round 11 (e2e H7): a provider result for a pipeline candidate who has no fit_scores row yet creates the FIT v2
    // row through the recompute queue (the trigger enqueues, the drain creates), without HR's Compute Rankings. A
    // candidate with the same provider result but no active application for the vacancy still gets no row. Own
    // vacancy, so the shared seed (and the computed=2 of the compute tests) is untouched.
    [Fact]
    public async Task A_provider_result_creates_the_missing_fit_row_for_a_pipeline_candidate_only()
    {
        const string Seed =
            """
            INSERT INTO vacancies (id, organization_id, title, role_family, team_id, assigned_to, created_by, business_unit_id, status, deleted_at, created_at, updated_at) VALUES
              ('7ac00000-0000-0000-0000-0000000000fc', '11111111-1111-1111-1111-111111111111', 'FIT v2 late', NULL, NULL, NULL, 'c0000000-0000-0000-0000-000000000001', NULL, 'open', NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00');
            INSERT INTO job_profiles (id, organization_id, vacancy_id, fit_requirements) VALUES
              ('9f000000-0000-0000-0000-0000000000fc', '11111111-1111-1111-1111-111111111111', '7ac00000-0000-0000-0000-0000000000fc',
               '{"assessments":[{"instrument":"english","use":"gate","min":{"cefr":"B2"},"reason":"clientes"}]}');
            INSERT INTO candidates (id, organization_id, email, first_name, last_name, years_experience, education, languages, deleted_at, created_at, updated_at) VALUES
              ('ca000000-0000-0000-0000-0000000000fc', '11111111-1111-1111-1111-111111111111', 'prov-late@fit.test', 'Lia', 'Late', 4, NULL, NULL, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
              ('ca000000-0000-0000-0000-0000000000fd', '11111111-1111-1111-1111-111111111111', 'prov-gone@fit.test', 'Gus', 'Gone', 4, NULL, NULL, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00');
            INSERT INTO applications (id, organization_id, candidate_id, vacancy_id, status) VALUES
              ('ab000000-0000-0000-0000-0000000000fc', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-0000000000fc', '7ac00000-0000-0000-0000-0000000000fc', 'active'),
              ('ab000000-0000-0000-0000-0000000000fd', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-0000000000fd', '7ac00000-0000-0000-0000-0000000000fc', 'rejected');
            INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                instrument_version, content_version, latest_result_id, assigned_by_id, created_at) VALUES
              ('e0000000-0000-4000-8000-0000000000e1', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000fc', '7ac00000-0000-0000-0000-0000000000fc', 'english', 'result_ready',
               'selection', 'clientes', 'es', 1, 'f0000000-0000-4000-8000-0000000000e1', 'aa000000-0000-4000-8000-0000000000e1', '1.0', 'english-2026.11.1', 'd0000000-0000-4000-8000-0000000000e1', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00'),
              ('e0000000-0000-4000-8000-0000000000e2', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000fd', '7ac00000-0000-0000-0000-0000000000fc', 'english', 'result_ready',
               'selection', 'clientes', 'es', 1, 'f0000000-0000-4000-8000-0000000000e2', 'aa000000-0000-4000-8000-0000000000e2', '1.0', 'english-2026.11.1', 'd0000000-0000-4000-8000-0000000000e2', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00');
            INSERT INTO assessment_provider_results (id, organization_id, attempt_id, provider_result_id, result_revision,
                result_schema, instrument, instrument_version, content_version, content_sha256, norm_version, scoring_version,
                scoring_method, purpose, validity_status, completion, global_percentile, cefr, level, time_multiplier_applied,
                rendered_for, rendered_level, completed_at, scored_at) VALUES
              (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000e1', 'd0000000-0000-4000-8000-0000000000e1', 1,
               'EnglishResultV1', 'english', '1.0', 'english-2026.11.1', repeat('1', 64), NULL, 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', NULL, 'C1', NULL, 1,
               'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00'),
              (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000e2', 'd0000000-0000-4000-8000-0000000000e2', 1,
               'EnglishResultV1', 'english', '1.0', 'english-2026.11.1', repeat('2', 64), NULL, 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', NULL, 'C1', NULL, 1,
               'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00');
            """;
        var late = Guid.Parse("ca000000-0000-0000-0000-0000000000fc");
        var gone = Guid.Parse("ca000000-0000-0000-0000-0000000000fd");
        var vacancy = Guid.Parse("7ac00000-0000-0000-0000-0000000000fc");
        await _fixture.Fit.ExecuteScalarAsync(Seed);

        // The provider writes enqueued both pairs; neither has a row.
        Assert.NotNull(await _fixture.Fit.GetRecomputeRequestAsync(late, vacancy));
        Assert.NotNull(await _fixture.Fit.GetRecomputeRequestAsync(gone, vacancy));
        Assert.Null(await _fixture.Fit.GetFitScoreAsync(late, vacancy));

        await using var factory = Factory(providers: true);
        // The registered drain may race this one; either way both requests end completed.
        for (var pass = 0; pass < 20; pass++)
        {
            using var scope = factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<Tims.Application.FitEngine.FitRecomputeUseCase>()
                .RunAsync(DateTimeOffset.UtcNow, fitV2Enabled: true, liaScoredAllowed: false, CancellationToken.None);
            if (await _fixture.Fit.GetRecomputeRequestAsync(late, vacancy) is null
                && await _fixture.Fit.GetRecomputeRequestAsync(gone, vacancy) is null)
            {
                break;
            }

            await Task.Delay(100);
        }

        Assert.Null(await _fixture.Fit.GetRecomputeRequestAsync(late, vacancy));
        Assert.Null(await _fixture.Fit.GetRecomputeRequestAsync(gone, vacancy));
        var created = await _fixture.Fit.GetFitScoreAsync(late, vacancy);
        Assert.NotNull(created);
        var english = Entry(JsonNode.Parse(created.Breakdown)!, "english");
        Assert.Equal("met", english["gate"]!.GetValue<string>());
        Assert.Equal("provider", english["source"]!.GetValue<string>());
        Assert.Null(await _fixture.Fit.GetFitScoreAsync(gone, vacancy)); // no active application: HR's compute decides
    }

    // Round 12 (Codex round 11 P1): a result the provider no longer lets tenant_hr see (result_not_visible) is deleted
    // from the ATS (HideResultAsync's writes, as app_tenant). Codex ats round 13 run 6 [P1]: the FIT row named that result
    // until the drain rewrote it, and for good with the worker off (FIT flags off). The deletion itself now deletes the
    // row (20261112170426), and neither drain brings it back: no provider result remains. Own vacancy and candidate.
    [Fact]
    public async Task A_result_no_longer_visible_leaves_fit_at_once_whatever_the_recompute_worker()
    {
        const string Seed =
            """
            INSERT INTO vacancies (id, organization_id, title, role_family, team_id, assigned_to, created_by, business_unit_id, status, deleted_at, created_at, updated_at) VALUES
              ('7ac00000-0000-0000-0000-0000000000d9', '11111111-1111-1111-1111-111111111111', 'FIT v2 hidden', NULL, NULL, NULL, 'c0000000-0000-0000-0000-000000000001', NULL, 'open', NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00');
            INSERT INTO job_profiles (id, organization_id, vacancy_id, fit_requirements) VALUES
              ('9f000000-0000-0000-0000-0000000000d9', '11111111-1111-1111-1111-111111111111', '7ac00000-0000-0000-0000-0000000000d9',
               '{"assessments":[{"instrument":"english","use":"gate","min":{"cefr":"B2"},"reason":"clientes"}]}');
            INSERT INTO candidates (id, organization_id, email, first_name, last_name, years_experience, education, languages, deleted_at, created_at, updated_at) VALUES
              ('ca000000-0000-0000-0000-0000000000d9', '11111111-1111-1111-1111-111111111111', 'prov-hidden@fit.test', 'Hilda', 'Hidden', 4, NULL, NULL, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00');
            INSERT INTO applications (id, organization_id, candidate_id, vacancy_id, status) VALUES
              ('ab000000-0000-0000-0000-0000000000d9', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-0000000000d9', '7ac00000-0000-0000-0000-0000000000d9', 'active');
            INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                instrument_version, content_version, latest_result_id, assigned_by_id, created_at) VALUES
              ('e0000000-0000-4000-8000-0000000000d9', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000d9', '7ac00000-0000-0000-0000-0000000000d9', 'english', 'result_ready',
               'selection', 'clientes', 'es', 1, 'f0000000-0000-4000-8000-0000000000d9', 'aa000000-0000-4000-8000-0000000000d9', '1.0', 'english-2026.11.1', 'd0000000-0000-4000-8000-0000000000d9', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00');
            INSERT INTO assessment_provider_results (id, organization_id, attempt_id, provider_result_id, result_revision,
                result_schema, instrument, instrument_version, content_version, content_sha256, norm_version, scoring_version,
                scoring_method, purpose, validity_status, completion, global_percentile, cefr, level, time_multiplier_applied,
                rendered_for, rendered_level, completed_at, scored_at) VALUES
              (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000d9', 'd0000000-0000-4000-8000-0000000000d9', 1,
               'EnglishResultV1', 'english', '1.0', 'english-2026.11.1', repeat('9', 64), NULL, 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', NULL, 'C1', NULL, 1,
               'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00');
            """;
        var candidate = Guid.Parse("ca000000-0000-0000-0000-0000000000d9");
        var vacancy = Guid.Parse("7ac00000-0000-0000-0000-0000000000d9");
        var attemptId = Guid.Parse("e0000000-0000-4000-8000-0000000000d9");
        var resultId = Guid.Parse("d0000000-0000-4000-8000-0000000000d9");
        await _fixture.Fit.ExecuteScalarAsync(Seed);
        await using var factory = Factory(providers: true);
        await DrainAsync(factory, candidate, vacancy);
        var before = await _fixture.Fit.GetFitScoreAsync(candidate, vacancy);
        Assert.NotNull(before);
        Assert.Equal("met", Entry(JsonNode.Parse(before.Breakdown)!, "english")["gate"]!.GetValue<string>());

        // HideResultAsync's two writes, as app_tenant under the org (the repository itself, with its audit row, is pinned
        // in Assessments/AssessmentProviderRound12Tests; this fixture has no audit_logs table).
        await _fixture.Fit.ExecuteScalarAsync(
            "BEGIN; SET LOCAL ROLE app_tenant; SELECT set_config('app.current_org_id', '11111111-1111-1111-1111-111111111111', true); "
            + $"DELETE FROM assessment_provider_results WHERE provider_result_id = '{resultId}'; "
            + $"UPDATE assessment_provider_attempts SET latest_result_id = NULL WHERE id = '{attemptId}'; COMMIT;");

        Assert.Null(await _fixture.Fit.GetFitScoreAsync(candidate, vacancy)); // gone in the hide's own transaction
        Assert.NotNull(await _fixture.Fit.GetRecomputeRequestAsync(candidate, vacancy)); // the DELETE still enqueues
        await DrainAsync(factory, candidate, vacancy, fitV2Enabled: false);
        Assert.Null(await _fixture.Fit.GetFitScoreAsync(candidate, vacancy));
        await _fixture.Fit.ExecuteScalarAsync(
            "SELECT public.fit_v2_request_recompute('11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-0000000000d9', '7ac00000-0000-0000-0000-0000000000d9')");
        await DrainAsync(factory, candidate, vacancy);
        Assert.Null(await _fixture.Fit.GetFitScoreAsync(candidate, vacancy));
    }

    // The result trigger deletes only the row that names the deleted result: deleting another result of the same
    // attempt's candidate and vacancy (an older revision's id the row does not name) leaves it. Rolled back.
    [Fact]
    public async Task Deleting_a_result_the_fit_row_does_not_name_leaves_the_row()
    {
        await ComputeAsync(providers: true);
        Assert.NotNull(await _fixture.Fit.GetFitScoreAsync(FitV2ProviderFixture.CandScored, FitV2ProviderFixture.VacProvider));
        await using var connection = new NpgsqlConnection(_fixture.Fit.ConnectionString);
        await connection.OpenAsync();
        await using var tx = await connection.BeginTransactionAsync();
        async Task<long> RunAsync(string sql)
        {
            await using var command = new NpgsqlCommand(sql, connection, tx);
            return Convert.ToInt64(await command.ExecuteScalarAsync() ?? 0L, System.Globalization.CultureInfo.InvariantCulture);
        }

        await RunAsync(
            "INSERT INTO assessment_provider_results (id, organization_id, attempt_id, provider_result_id, result_revision, "
            + "result_schema, instrument, instrument_version, content_version, content_sha256, norm_version, scoring_version, "
            + "scoring_method, purpose, validity_status, completion, global_percentile, cefr, level, time_multiplier_applied, "
            + "rendered_for, rendered_level, completed_at, scored_at) VALUES (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', "
            + "'e0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000a9', 1, 'ItciaResultV1', 'itcia', '1.0', "
            + "'itcia-2026.11.1', repeat('9', 64), NULL, 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', NULL, NULL, 2, 1, "
            + "'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00')");
        await RunAsync("DELETE FROM assessment_provider_results WHERE provider_result_id = 'd0000000-0000-4000-8000-0000000000a9'");
        Assert.Equal(1, await RunAsync(
            $"SELECT count(*) FROM fit_scores WHERE candidate_id = '{FitV2ProviderFixture.CandScored}' AND vacancy_id = '{FitV2ProviderFixture.VacProvider}'"));
        await RunAsync("DELETE FROM assessment_provider_results WHERE provider_result_id = 'd0000000-0000-4000-8000-0000000000a2'");
        Assert.Equal(0, await RunAsync(
            $"SELECT count(*) FROM fit_scores WHERE candidate_id = '{FitV2ProviderFixture.CandScored}' AND vacancy_id = '{FitV2ProviderFixture.VacProvider}'"));
        await tx.RollbackAsync();
    }

    // Codex ats round 13 [P1] (migration 20261112170426_fit_v2_provider_erasure_removes_fit_rows): an accepted erasure
    // used to leave the erased result's score, id and versions in the stored FIT row until the queue drained, and for
    // good with FIT v2 off (the drain completes the request without a write). The marker's own transaction now deletes
    // the row, written here as the C# writes it (app_tenant under the org); neither drain brings it back, since no
    // provider result remains. Own vacancy and candidate.
    [Fact]
    public async Task An_accepted_erasure_removes_the_fit_row_built_from_the_result_at_once_even_with_fit_v2_off()
    {
        const string Seed =
            """
            INSERT INTO vacancies (id, organization_id, title, role_family, team_id, assigned_to, created_by, business_unit_id, status, deleted_at, created_at, updated_at) VALUES
              ('7ac00000-0000-0000-0000-0000000000d8', '11111111-1111-1111-1111-111111111111', 'FIT v2 erased', NULL, NULL, NULL, 'c0000000-0000-0000-0000-000000000001', NULL, 'open', NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00');
            INSERT INTO job_profiles (id, organization_id, vacancy_id, fit_requirements) VALUES
              ('9f000000-0000-0000-0000-0000000000d8', '11111111-1111-1111-1111-111111111111', '7ac00000-0000-0000-0000-0000000000d8',
               '{"assessments":[{"instrument":"english","use":"gate","min":{"cefr":"B2"},"reason":"clientes"}]}');
            INSERT INTO candidates (id, organization_id, email, first_name, last_name, years_experience, education, languages, deleted_at, created_at, updated_at) VALUES
              ('ca000000-0000-0000-0000-0000000000d8', '11111111-1111-1111-1111-111111111111', 'prov-erased@fit.test', 'Elsa', 'Erased', 4, NULL, NULL, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00');
            INSERT INTO applications (id, organization_id, candidate_id, vacancy_id, status) VALUES
              ('ab000000-0000-0000-0000-0000000000d8', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-0000000000d8', '7ac00000-0000-0000-0000-0000000000d8', 'active');
            INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                instrument_version, content_version, latest_result_id, assigned_by_id, created_at) VALUES
              ('e0000000-0000-4000-8000-0000000000d8', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000d8', '7ac00000-0000-0000-0000-0000000000d8', 'english', 'result_ready',
               'selection', 'clientes', 'es', 1, 'f0000000-0000-4000-8000-0000000000d8', 'aa000000-0000-4000-8000-0000000000d8', '1.0', 'english-2026.11.1', 'd0000000-0000-4000-8000-0000000000d8', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00');
            INSERT INTO assessment_provider_results (id, organization_id, attempt_id, provider_result_id, result_revision,
                result_schema, instrument, instrument_version, content_version, content_sha256, norm_version, scoring_version,
                scoring_method, purpose, validity_status, completion, global_percentile, cefr, level, time_multiplier_applied,
                rendered_for, rendered_level, completed_at, scored_at) VALUES
              (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000d8', 'd0000000-0000-4000-8000-0000000000d8', 1,
               'EnglishResultV1', 'english', '1.0', 'english-2026.11.1', repeat('8', 64), NULL, 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', NULL, 'C1', NULL, 1,
               'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00');
            """;
        var candidate = Guid.Parse("ca000000-0000-0000-0000-0000000000d8");
        var vacancy = Guid.Parse("7ac00000-0000-0000-0000-0000000000d8");
        await _fixture.Fit.ExecuteScalarAsync(Seed);
        await using var factory = Factory(providers: true);
        await DrainAsync(factory, candidate, vacancy); // round 11: the provider result creates the pipeline row
        var before = await _fixture.Fit.GetFitScoreAsync(candidate, vacancy);
        Assert.NotNull(before);
        var english = Entry(JsonNode.Parse(before.Breakdown)!, "english");
        Assert.Equal("provider", english["source"]!.GetValue<string>());
        Assert.Equal("d0000000-0000-4000-8000-0000000000d8", english["resultId"]!.GetValue<string>());

        // MarkErasureRequestedAsync's write, as app_tenant under the org (this fixture has no audit_logs table).
        await _fixture.Fit.ExecuteScalarAsync(
            "BEGIN; SET LOCAL ROLE app_tenant; SELECT set_config('app.current_org_id', '11111111-1111-1111-1111-111111111111', true); "
            + "UPDATE assessment_provider_attempts SET provider_erasure_requested_at = now() WHERE id = 'e0000000-0000-4000-8000-0000000000d8'; COMMIT;");

        Assert.Null(await _fixture.Fit.GetFitScoreAsync(candidate, vacancy)); // gone in the erasure's transaction
        await DrainAsync(factory, candidate, vacancy, fitV2Enabled: false);
        Assert.Null(await _fixture.Fit.GetFitScoreAsync(candidate, vacancy));
        await _fixture.Fit.ExecuteScalarAsync(
            "SELECT public.fit_v2_request_recompute('11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-0000000000d8', '7ac00000-0000-0000-0000-0000000000d8')");
        await DrainAsync(factory, candidate, vacancy);
        Assert.Null(await _fixture.Fit.GetFitScoreAsync(candidate, vacancy)); // no provider result remains to recreate it
    }

    // Codex ats round 13 run 2 [P1]: a FIT compute reads the provider results under FIT v2's advisory lock and writes the
    // row before it lets go. Without that lock in the erasure trigger, a compute that read the result just before the
    // erasure could write it back after the delete. Session A plays the compute (the lock under the production key, then
    // the stale write); session B is the erasure, as app_tenant. B must wait for A, then delete A's write.
    [Fact]
    public async Task An_erasure_waits_for_a_compute_in_flight_and_then_deletes_what_it_wrote()
    {
        var org = Guid.Parse("11111111-1111-1111-1111-111111111111");
        var candidate = Guid.Parse("ca000000-0000-0000-0000-0000000000d7");
        var vacancy = Guid.Parse("7ac00000-0000-0000-0000-0000000000d7");
        const string Attempt = "e0000000-0000-4000-8000-0000000000d7";
        await _fixture.Fit.ExecuteScalarAsync(
            "INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state, "
            + "purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id, "
            + "instrument_version, content_version, latest_result_id, assigned_by_id, created_at) VALUES "
            + $"('{Attempt}', '{org}', 'b0000000-0000-4000-8000-0000000000a0', '{candidate}', '{vacancy}', 'english', 'result_ready', "
            + "'selection', 'clientes', 'es', 1, 'f0000000-0000-4000-8000-0000000000d7', 'aa000000-0000-4000-8000-0000000000d7', '1.0', "
            + "'english-2026.11.1', 'd0000000-0000-4000-8000-0000000000d7', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00')");

        await using var compute = new NpgsqlConnection(_fixture.Fit.ConnectionString);
        await compute.OpenAsync();
        await using var computeTx = await compute.BeginTransactionAsync();
        await using (var lockCommand = new NpgsqlCommand(
            "SELECT pg_advisory_xact_lock(hashtextextended(@key, 0))", compute, computeTx))
        {
            lockCommand.Parameters.AddWithValue("key",
                Tims.Infrastructure.FitEngine.FitEngineWriteRepository.FitV2LockKey(org, candidate, vacancy));
            await lockCommand.ExecuteNonQueryAsync();
        }

        var erasure = Task.Run(() => _fixture.Fit.ExecuteScalarAsync(
            "BEGIN; SET LOCAL ROLE app_tenant; SELECT set_config('app.current_org_id', '11111111-1111-1111-1111-111111111111', true); "
            + $"UPDATE assessment_provider_attempts SET provider_erasure_requested_at = now() WHERE id = '{Attempt}'; COMMIT;"));
        var finishedFirst = await Task.WhenAny(erasure, Task.Delay(TimeSpan.FromSeconds(2)));
        Assert.NotSame(erasure, finishedFirst); // the erasure waits for the compute's lock

        // The compute's write, from the result it read before the erasure.
        await using (var write = new NpgsqlCommand(
            "INSERT INTO fit_scores (id, organization_id, candidate_id, vacancy_id, overall_score, breakdown, weights, is_partial, "
            + "calculated_at, created_at, updated_at) VALUES (gen_random_uuid(), @org, @cand, @vac, 70, "
            + """'{"fitVersion":2,"assessments":[{"instrument":"english","source":"provider","resultId":"d0000000-0000-4000-8000-0000000000d7"}]}', """
            + "'{}', false, now(), now(), now())", compute, computeTx))
        {
            write.Parameters.AddWithValue("org", org);
            write.Parameters.AddWithValue("cand", candidate);
            write.Parameters.AddWithValue("vac", vacancy);
            await write.ExecuteNonQueryAsync();
        }

        await computeTx.CommitAsync();
        await erasure.WaitAsync(TimeSpan.FromSeconds(30));
        Assert.Null(await _fixture.Fit.GetFitScoreAsync(candidate, vacancy)); // the compute's write did not survive
    }

    // The same trigger, pinned row by row in one rolled-back transaction: only an erasure (the accepted marker, or the
    // provider's subject.erased setting state 'erased') deletes, and only the row of the attempt's own candidate and
    // vacancy whose breakdown holds a PROVIDER entry for the attempt's instrument. The attempt writes run as app_tenant.
    [Fact]
    public async Task Only_an_erasure_removes_a_fit_row_and_only_the_one_holding_that_attempts_provider_entry()
    {
        const string Org = "11111111-1111-1111-1111-111111111111";
        const string V1 = "7ac00000-0000-0000-0000-0000000000e1";
        const string V2 = "7ac00000-0000-0000-0000-0000000000e2";
        static string Candidate(int n) => $"ca000000-0000-0000-0000-0000000000e{n}";
        static string Breakdown(string entries) => $$"""{"fitVersion":2,"assessment":70,"assessments":[{{entries}}]}""";
        const string ProviderEnglish = """{"instrument":"english","source":"provider","resultId":"d0000000-0000-4000-8000-0000000000e0","score":null,"gate":"met"}""";
        const string ProviderLia = """{"instrument":"lia","source":"provider","resultId":"d0000000-0000-4000-8000-0000000000e9","score":70,"gate":null}""";
        const string NativeEnglish = """{"instrument":"english","source":"ats","resultId":"d0000000-0000-4000-8000-0000000000e8","score":null,"gate":"met"}""";

        // (row, its breakdown, the attempt write on (candidate, V1, english), whether the row must survive)
        var cases = new (string Candidate, string Vacancy, string Breakdown, string Write, bool Kept)[]
        {
            (Candidate(1), V1, Breakdown(ProviderEnglish), "provider_erasure_requested_at = now()", false),
            (Candidate(1), V2, Breakdown(ProviderEnglish), "", true), // same candidate, another vacancy
            (Candidate(2), V1, Breakdown(ProviderEnglish), "", true), // another candidate, same vacancy
            (Candidate(3), V1, Breakdown(ProviderLia), "provider_erasure_requested_at = now()", true), // no english entry
            (Candidate(4), V1, Breakdown(NativeEnglish), "provider_erasure_requested_at = now()", true), // not the provider's
            (Candidate(5), V1, """{"assessment":70,"interview":null}""", "provider_erasure_requested_at = now()", true), // v1 row
            (Candidate(6), V1, Breakdown(ProviderEnglish), "state = 'voided'", true), // a state change that is no erasure
            (Candidate(7), V1, Breakdown(ProviderEnglish), "state = 'erased', latest_result_id = NULL", false), // subject.erased
        };

        await using var connection = new NpgsqlConnection(_fixture.Fit.ConnectionString);
        await connection.OpenAsync();
        await using var tx = await connection.BeginTransactionAsync();
        async Task RunAsync(string sql)
        {
            await using var command = new NpgsqlCommand(sql, connection, tx);
            await command.ExecuteNonQueryAsync();
        }

        for (var i = 0; i < cases.Length; i++)
        {
            var c = cases[i];
            await RunAsync(
                "INSERT INTO fit_scores (id, organization_id, candidate_id, vacancy_id, overall_score, breakdown, weights, "
                + "is_partial, calculated_at, created_at, updated_at) VALUES "
                + $"(gen_random_uuid(), '{Org}', '{c.Candidate}', '{c.Vacancy}', 70, '{c.Breakdown}', '{{}}', false, now(), now(), now())");
            if (c.Write.Length > 0)
            {
                await RunAsync(
                    "INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state, "
                    + "purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id, "
                    + "instrument_version, content_version, latest_result_id, assigned_by_id, created_at) VALUES "
                    + $"('e0000000-0000-4000-8000-0000000000e{i}', '{Org}', 'b0000000-0000-4000-8000-0000000000a0', '{c.Candidate}', '{V1}', 'english', 'result_ready', "
                    + $"'selection', 'clientes', 'es', 1, 'f0000000-0000-4000-8000-0000000000e{i}', 'aa000000-0000-4000-8000-0000000000e{i}', '1.0', 'english-2026.11.1', "
                    + $"'d0000000-0000-4000-8000-0000000000e0', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00')");
            }
        }

        // The writes as the C# repository makes them: app_tenant, the org in the GUC.
        await RunAsync($"SET LOCAL ROLE app_tenant; SELECT set_config('app.current_org_id', '{Org}', true)");
        for (var i = 0; i < cases.Length; i++)
        {
            if (cases[i].Write.Length > 0)
            {
                await RunAsync(
                    $"UPDATE assessment_provider_attempts SET {cases[i].Write} WHERE id = 'e0000000-0000-4000-8000-0000000000e{i}'");
            }
        }

        await RunAsync("RESET ROLE");
        for (var i = 0; i < cases.Length; i++)
        {
            await using var read = new NpgsqlCommand(
                "SELECT count(*)::int FROM fit_scores WHERE candidate_id = @c AND vacancy_id = @v", connection, tx);
            read.Parameters.AddWithValue("c", Guid.Parse(cases[i].Candidate));
            read.Parameters.AddWithValue("v", Guid.Parse(cases[i].Vacancy));
            var count = (int)(await read.ExecuteScalarAsync())!;
            Assert.True(count == (cases[i].Kept ? 1 : 0), $"case {i}: expected the row {(cases[i].Kept ? "kept" : "deleted")}");
        }

        await tx.RollbackAsync();
    }

    private async Task DrainAsync(
        WebApplicationFactory<Program> factory, Guid candidate, Guid vacancy, bool fitV2Enabled = true)
    {
        // The registered drain may race this one; either way the request ends completed.
        for (var pass = 0; pass < 20; pass++)
        {
            using var scope = factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<Tims.Application.FitEngine.FitRecomputeUseCase>()
                .RunAsync(DateTimeOffset.UtcNow, fitV2Enabled, liaScoredAllowed: false, CancellationToken.None);
            if (await _fixture.Fit.GetRecomputeRequestAsync(candidate, vacancy) is null)
            {
                return;
            }

            await Task.Delay(100);
        }

        Assert.Null(await _fixture.Fit.GetRecomputeRequestAsync(candidate, vacancy));
    }

    private static JsonNode Entry(JsonNode breakdown, string instrument) =>
        Assert.Single(breakdown["assessments"]!.AsArray(), e => e!["instrument"]!.GetValue<string>() == instrument)!;

    private async Task<(JsonNode Breakdown, bool IsPartial)> ReadBreakdownAsync(Guid candidateId)
    {
        var row = await _fixture.Fit.GetFitScoreAsync(candidateId, FitV2ProviderFixture.VacProvider);
        Assert.NotNull(row);
        return (JsonNode.Parse(row.Breakdown)!, row.IsPartial);
    }

    private async Task ComputeAsync(bool providers, bool liaScored = false)
    {
        await using var factory = Factory(providers, liaScored);
        using var client = factory.CreateClient();
        var request = new HttpRequestMessage(
            HttpMethod.Post, $"/fit-engine/vacancies/{FitV2ProviderFixture.VacProvider}/compute");
        request.Headers.Add("Authorization", $"Bearer {Mint(FitEngineFixture.OrgAdminSub)}");

        var response = await client.SendAsync(request);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("{\"computed\":2}", await response.Content.ReadAsStringAsync());
    }

    private WebApplicationFactory<Program> Factory(bool providers, bool liaScored = false) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:FitEngineLiaScoredEnabled", liaScored ? "true" : "false");
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.Fit.ConnectionString);
            builder.UseSetting("Platform:FitEngineWriteEnabled", "true");
            builder.UseSetting("Platform:FitEngineV2Enabled", "true");
            builder.UseSetting("Platform:AssessmentProvidersEnabled", providers ? "true" : "false");
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

/// <summary>
/// A <see cref="FitEngineFixture"/> database (its own container) plus the provider migration applied on top, in the
/// production privilege shape (<c>anon</c>/<c>authenticated</c> exist, so the migration's REVOKEs run), and a seed of
/// one vacancy that lists three provider instruments, two candidates, and their provider attempts and results.
/// </summary>
public sealed class FitV2ProviderFixture : IAsyncLifetime
{
    public static readonly Guid VacProvider = Guid.Parse("7ac00000-0000-0000-0000-0000000000fa");
    public static readonly Guid CandScored = Guid.Parse("ca000000-0000-0000-0000-0000000000fa");
    public static readonly Guid CandReview = Guid.Parse("ca000000-0000-0000-0000-0000000000fb");
    public static readonly Guid ResultLia = Guid.Parse("d0000000-0000-4000-8000-0000000000a1");
    public static readonly Guid ResultLiaVoided = Guid.Parse("d0000000-0000-4000-8000-0000000000b1");

    public FitEngineFixture Fit { get; } = new();

    public async Task InitializeAsync()
    {
        await Fit.InitializeAsync();
        await ExecuteAsync(ProviderTestDatabase.CreateRolesSql);
        await using (var db = new AssessmentProviderDbContext(
            new DbContextOptionsBuilder<AssessmentProviderDbContext>().UseNpgsql(Fit.ConnectionString).Options))
        {
            await db.Database.MigrateAsync();
        }

        await ExecuteAsync(SeedSql);
    }

    public Task DisposeAsync() => Fit.DisposeAsync();

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(Fit.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync();
    }

    // OrgA = 1111…, OrgB = 2222…, OrgAdmin = c000…0001 (FitEngineFixture). Provider result ids: d000…a* (scored
    // candidate), d000…b* (review candidate), d000…c1 (OrgB's row for the SAME candidate and vacancy ids, assigned
    // later and scoring higher, so reading it would change the asserted LIA entry).
    private const string SeedSql =
        """
        INSERT INTO vacancies (id, organization_id, title, role_family, team_id, assigned_to, created_by, business_unit_id, status, deleted_at, created_at, updated_at) VALUES
          ('7ac00000-0000-0000-0000-0000000000fa', '11111111-1111-1111-1111-111111111111', 'FIT v2 provider', NULL, NULL, NULL, 'c0000000-0000-0000-0000-000000000001', NULL, 'open', NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00');
        INSERT INTO job_profiles (id, organization_id, vacancy_id, fit_requirements) VALUES
          ('9f000000-0000-0000-0000-0000000000fa', '11111111-1111-1111-1111-111111111111', '7ac00000-0000-0000-0000-0000000000fa',
           '{"minYearsExperience":2,"assessments":[{"instrument":"lia","use":"scored","min":{"globalPercentile":40},"reason":"análisis de datos"},{"instrument":"itcia","use":"scored","min":{"level":3},"reason":"uso de IA"},{"instrument":"english","use":"gate","min":{"cefr":"B2"},"reason":"clientes"}]}');
        INSERT INTO candidates (id, organization_id, email, first_name, last_name, years_experience, education, languages, deleted_at, created_at, updated_at) VALUES
          ('ca000000-0000-0000-0000-0000000000fa', '11111111-1111-1111-1111-111111111111', 'prov-scored@fit.test', 'Paz', 'Scored', 4, NULL, NULL, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
          ('ca000000-0000-0000-0000-0000000000fb', '11111111-1111-1111-1111-111111111111', 'prov-review@fit.test', 'Rui', 'Review', 4, NULL, NULL, NULL, '2026-01-01 00:00:00', '2026-01-02 00:00:00');
        INSERT INTO applications (id, organization_id, candidate_id, vacancy_id, status) VALUES
          ('ab000000-0000-0000-0000-0000000000fa', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-0000000000fa', '7ac00000-0000-0000-0000-0000000000fa', 'active'),
          ('ab000000-0000-0000-0000-0000000000fb', '11111111-1111-1111-1111-111111111111', 'ca000000-0000-0000-0000-0000000000fb', '7ac00000-0000-0000-0000-0000000000fa', 'active');

        INSERT INTO assessment_provider_bindings (id, organization_id, provider, provider_tenant_id, enabled_instruments, default_locale) VALUES
          ('b0000000-0000-4000-8000-0000000000a0', '11111111-1111-1111-1111-111111111111', 'tims-assessments', 'b0000000-0000-4000-8000-0000000000a1', ARRAY['lia','english','itcia'], 'es'),
          ('b0000000-0000-4000-8000-0000000000b0', '22222222-2222-2222-2222-222222222222', 'tims-assessments', 'b0000000-0000-4000-8000-0000000000b1', ARRAY['lia'], 'es');

        INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
            purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
            instrument_version, content_version, latest_result_id, assigned_by_id, created_at) VALUES
          ('e0000000-0000-4000-8000-0000000000a1', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000fa', '7ac00000-0000-0000-0000-0000000000fa', 'lia', 'result_ready',
           'selection', 'análisis de datos', 'es', 1.5, 'f0000000-0000-4000-8000-0000000000a1', 'aa000000-0000-4000-8000-0000000000a1', '1.0', 'lia-2026.11.1', 'd0000000-0000-4000-8000-0000000000a1', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00'),
          ('e0000000-0000-4000-8000-0000000000a2', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000fa', '7ac00000-0000-0000-0000-0000000000fa', 'itcia', 'result_ready',
           'selection', 'uso de IA', 'es', 1, 'f0000000-0000-4000-8000-0000000000a1', 'aa000000-0000-4000-8000-0000000000a2', '1.0', 'itcia-2026.11.1', 'd0000000-0000-4000-8000-0000000000a2', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00'),
          ('e0000000-0000-4000-8000-0000000000a3', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000fa', '7ac00000-0000-0000-0000-0000000000fa', 'english', 'result_ready',
           'selection', 'clientes', 'es', 1, 'f0000000-0000-4000-8000-0000000000a1', 'aa000000-0000-4000-8000-0000000000a3', '1.0', 'english-2026.11.1', 'd0000000-0000-4000-8000-0000000000a3', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00'),
          ('e0000000-0000-4000-8000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000fb', '7ac00000-0000-0000-0000-0000000000fa', 'lia', 'voided',
           'selection', 'análisis de datos', 'es', 1, 'f0000000-0000-4000-8000-0000000000b1', 'aa000000-0000-4000-8000-0000000000b1', '1.0', 'lia-2026.11.1', 'd0000000-0000-4000-8000-0000000000b1', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00'),
          ('e0000000-0000-4000-8000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'b0000000-0000-4000-8000-0000000000a0', 'ca000000-0000-0000-0000-0000000000fb', '7ac00000-0000-0000-0000-0000000000fa', 'itcia', 'result_ready',
           'selection', 'uso de IA', 'es', 1.5, 'f0000000-0000-4000-8000-0000000000b1', 'aa000000-0000-4000-8000-0000000000b2', '1.0', 'itcia-2026.11.1', 'd0000000-0000-4000-8000-0000000000b2', 'c0000000-0000-0000-0000-000000000001', '2026-11-01 09:00:00+00'),
          ('e0000000-0000-4000-8000-0000000000c1', '22222222-2222-2222-2222-222222222222', 'b0000000-0000-4000-8000-0000000000b0', 'ca000000-0000-0000-0000-0000000000fa', '7ac00000-0000-0000-0000-0000000000fa', 'lia', 'result_ready',
           'selection', 'análisis de datos', 'es', 1, 'f0000000-0000-4000-8000-0000000000c1', 'aa000000-0000-4000-8000-0000000000c1', '1.0', 'lia-2026.11.1', 'd0000000-0000-4000-8000-0000000000c1', 'c0000000-0000-0000-0000-000000000001', '2026-11-05 09:00:00+00');

        INSERT INTO assessment_provider_results (id, organization_id, attempt_id, provider_result_id, result_revision,
            result_schema, instrument, instrument_version, content_version, content_sha256, norm_version, scoring_version,
            scoring_method, purpose, validity_status, completion, global_percentile, cefr, level, time_multiplier_applied,
            rendered_for, rendered_level, completed_at, scored_at) VALUES
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000a1', 'd0000000-0000-4000-8000-0000000000a1', 1,
           'LiaResultV1', 'lia', '1.0', 'lia-2026.11.1', repeat('a', 64), 'lia-norms-2026.1', 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', 30, NULL, NULL, 1.5,
           'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00'),
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000a2', 'd0000000-0000-4000-8000-0000000000a2', 1,
           'ItciaResultV1', 'itcia', '1.0', 'itcia-2026.11.1', repeat('b', 64), NULL, 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', NULL, NULL, 2, 1,
           'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00'),
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000a3', 'd0000000-0000-4000-8000-0000000000a3', 1,
           'EnglishResultV1', 'english', '1.0', 'english-2026.11.1', repeat('c', 64), NULL, 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', NULL, 'C1', NULL, 1,
           'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00'),
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000b1', 'd0000000-0000-4000-8000-0000000000b1', 2,
           'LiaResultV1', 'lia', '1.0', 'lia-2026.11.1', repeat('d', 64), 'lia-norms-2026.1', 'scoring-1', 'deterministic', 'selection', 'voided', 'complete', 88, NULL, NULL, 1,
           'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00'),
          (gen_random_uuid(), '11111111-1111-1111-1111-111111111111', 'e0000000-0000-4000-8000-0000000000b2', 'd0000000-0000-4000-8000-0000000000b2', 1,
           'ItciaResultV1', 'itcia', '1.0', 'itcia-2026.11.1', repeat('e', 64), NULL, 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', NULL, NULL, 5, 1,
           'tenant_hr', 'full', '2026-11-02 10:00:00+00', '2026-11-02 10:00:05+00'),
          (gen_random_uuid(), '22222222-2222-2222-2222-222222222222', 'e0000000-0000-4000-8000-0000000000c1', 'd0000000-0000-4000-8000-0000000000c1', 1,
           'LiaResultV1', 'lia', '1.0', 'lia-2026.11.1', repeat('f', 64), 'lia-norms-2026.1', 'scoring-1', 'deterministic', 'selection', 'valid', 'complete', 99, NULL, NULL, 1,
           'tenant_hr', 'full', '2026-11-06 10:00:00+00', '2026-11-06 10:00:05+00');
        """;
}

[CollectionDefinition("FitV2Provider")]
public sealed class FitV2ProviderCollection : ICollectionFixture<FitV2ProviderFixture>;
