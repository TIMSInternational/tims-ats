using System.Net;
using System.Text.Json;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// AS-7 / AS-14 staff reads over the REAL host + real Postgres (RLS forced, app_tenant), with the fake provider: the
/// assignable catalog and one candidate's attempts with their results. Pins the dark flag, the <c>assessment:read</c>
/// gate, the vacancy scope (catalog 404; out-of-scope attempts omitted), owner default D6 (a narrow reader never gets the
/// level), #312 (a withdrawn candidate shows nothing) and the vacancy's pinned version. Each test owns its rows.
/// </summary>
public sealed partial class ProviderEndpointTests
{
    private const string LiaGateRequirements =
        """{"assessments":[{"instrument":"lia","use":"gate","min":{"globalPercentile":40},"reason":"Análisis"}]}""";

    private const string Catalog = "/assessments/provider-catalog";
    private const string Attempts = "/assessments/provider-attempts";

    // The leader (Own) reads at OWN scope: a vacancy assigned to it is in scope, VacancyA is not.
    private static readonly Guid OwnUser = Guid.Parse("c0000000-0000-0000-0000-000000000002");

    /// <summary>
    /// assessment:read for the recruiter (organization) and the leader (own). Idempotent: the fixture is shared, and the
    /// other tests use create/update only.
    /// </summary>
    private Task GrantReadAsync() => fixture.ExecuteAsync(
        """
        INSERT INTO role_permissions (id, role_id, permission_id, scope) VALUES
          ('90000000-0000-0000-0000-0000000000c1', 'a0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000003', 'organization'),
          ('90000000-0000-0000-0000-0000000000c2', 'a0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000003', 'own')
        ON CONFLICT (id) DO NOTHING;
        """);

    /// <summary>
    /// A candidate with two LIA attempts holding a valid result (percentile 30, below the minimum of 40): one on VacancyA
    /// and one on a fresh vacancy assigned to the leader (in its own scope).
    /// </summary>
    private async Task<(Guid Candidate, Guid OwnVacancy)> ResultsAsync()
    {
        var candidate = Guid.NewGuid();
        var vacancy = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO candidates (id, organization_id, first_name, last_name, email)
               VALUES ('{candidate}', '{ProviderEndpointFixture.OrgA}', 'Res', 'Ult', 'res-{candidate:N}@a.example');
             INSERT INTO vacancies (id, organization_id, assigned_to, created_by)
               VALUES ('{vacancy}', '{ProviderEndpointFixture.OrgA}', '{OwnUser}', '{ProviderEndpointFixture.AdminId}');
             INSERT INTO job_profiles (id, organization_id, vacancy_id, fit_requirements) VALUES (gen_random_uuid(),
               '{ProviderEndpointFixture.OrgA}', '{vacancy}', '{LiaGateRequirements}');
             """);
        await ResultAttemptAsync(candidate, ProviderEndpointFixture.VacancyA);
        await ResultAttemptAsync(candidate, vacancy);
        return (candidate, vacancy);
    }

    private Task ResultAttemptAsync(Guid candidate, Guid vacancy)
    {
        var attempt = Guid.NewGuid();
        var result = Guid.NewGuid();
        return fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument,
                 state, purpose, job_relatedness_reason, locale, time_multiplier, aids, provider_subject_id,
                 provider_assignment_id, instrument_version, content_version, required_consents, expires_at,
                 latest_result_id, assigned_by_id)
               VALUES ('{attempt}', '{ProviderEndpointFixture.OrgA}', 'aaaa0000-0000-4000-8000-0000000000b0', '{candidate}',
                 '{vacancy}', 'lia', 'result_ready', 'selection', 'Análisis', 'es', 1.25, ARRAY['extended_breaks'],
                 gen_random_uuid(), gen_random_uuid(), '1.0', 'content-1', ARRAY['assessment'], now() + interval '14 days',
                 '{result}', '{ProviderEndpointFixture.AdminId}');
             INSERT INTO assessment_provider_results (id, organization_id, attempt_id, provider_result_id, result_revision,
                 result_schema, instrument, instrument_version, content_version, content_sha256, scoring_version,
                 scoring_method, purpose, validity_status, validity_reasons, completion, global_percentile,
                 time_multiplier_applied, rendered_for, rendered_level, completed_at, scored_at)
               VALUES (gen_random_uuid(), '{ProviderEndpointFixture.OrgA}', '{attempt}', '{result}', 1, 'LiaResultV1', 'lia',
                 '1.0', 'content-1', repeat('a', 64), 's-1', 'deterministic', 'selection', 'valid', ARRAY[]::text[], 'complete', 30,
                 1.25, 'tenant_hr', 'full', now() - interval '1 hour', now() - interval '1 hour');
             """);
    }

    [Fact]
    public async Task StaffReads_DarkFlag_AreNotMapped()
    {
        await using var factory = Factory(enabled: false);
        using var client = factory.CreateClient();
        var reader = Mint(ProviderEndpointFixture.ReaderSub);

        Assert.Equal(HttpStatusCode.NotFound, (await Get(client, Catalog, reader)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound,
            (await Get(client, $"{Attempts}?candidateId={ProviderEndpointFixture.AssignCandidate}", reader)).StatusCode);
    }

    [Fact]
    public async Task StaffReads_RequireAuthenticationAndTheReadGrant()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var orgB = Mint(ProviderEndpointFixture.OrgBSub); // assessment create + update, no read

        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, Catalog, null)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Get(client, Catalog, orgB)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await Get(client, $"{Attempts}?candidateId={ProviderEndpointFixture.AssignCandidate}", orgB)).StatusCode);
    }

    [Fact]
    public async Task Catalog_ListsTheBindingsInstruments_AndTheVacancysPinnedVersion()
    {
        // A fresh vacancy with one LIA attempt pinned to 1.0 and no English attempt (other tests assign on VacancyA).
        var (candidate, vacancy) = await ResultsAsync();
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var reader = Mint(ProviderEndpointFixture.ReaderSub);

        var plain = await ReadJson(await Get(client, Catalog, reader));
        var pinned = await ReadJson(await Get(client, $"{Catalog}?vacancyId={vacancy}", reader));

        Assert.NotEqual(Guid.Empty, candidate);
        Assert.True(plain.GetProperty("connected").GetBoolean());
        Assert.Equal(["lia", "english"], plain.GetProperty("instruments").EnumerateArray()
            .Select(i => i.GetProperty("instrument").GetString()!).ToArray());
        Assert.All(plain.GetProperty("instruments").EnumerateArray(),
            i => Assert.Equal(JsonValueKind.Null, i.GetProperty("pinnedVersion").ValueKind));
        var lia = pinned.GetProperty("instruments").EnumerateArray().Single(i => i.GetProperty("instrument").GetString() == "lia");
        var english = pinned.GetProperty("instruments").EnumerateArray().Single(i => i.GetProperty("instrument").GetString() == "english");
        Assert.Equal("1.0", lia.GetProperty("pinnedVersion").GetString());
        Assert.Equal(JsonValueKind.Null, english.GetProperty("pinnedVersion").ValueKind);
    }

    [Fact]
    public async Task Catalog_AVacancyOutOfScopeOrMalformed_IsRefused()
    {
        await GrantReadAsync();
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var own = await Get(client, $"{Catalog}?vacancyId={ProviderEndpointFixture.VacancyA}", Mint(ProviderEndpointFixture.OwnSub));
        var foreign = await Get(client, $"{Catalog}?vacancyId={ProviderEndpointFixture.VacancyB}", Mint(ProviderEndpointFixture.ReaderSub));
        var malformed = await Get(client, $"{Catalog}?vacancyId=not-a-guid", Mint(ProviderEndpointFixture.ReaderSub));

        Assert.Equal(HttpStatusCode.NotFound, own.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, foreign.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
    }

    [Fact]
    public async Task Attempts_HrSeesTheLevel_ANarrowReaderOnlyTheMinimum_AndOnlyInScopeVacancies()
    {
        await GrantReadAsync();
        var (candidate, ownVacancy) = await ResultsAsync();
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var hr = await ReadJson(await Get(client, $"{Attempts}?candidateId={candidate}", Mint(ProviderEndpointFixture.ReaderSub)));
        var leader = await ReadJson(await Get(client, $"{Attempts}?candidateId={candidate}", Mint(ProviderEndpointFixture.OwnSub)));

        var hrAttempts = hr.GetProperty("attempts").EnumerateArray().ToList();
        Assert.Equal(2, hrAttempts.Count);
        var hrOwn = hrAttempts.Single(a => a.GetProperty("vacancyId").GetGuid() == ownVacancy);
        Assert.Equal("result_ready", hrOwn.GetProperty("status").GetString());
        Assert.Equal(30, hrOwn.GetProperty("result").GetProperty("globalPercentile").GetDouble());
        Assert.Equal("not_met", hrOwn.GetProperty("result").GetProperty("minimum").GetString());
        Assert.Equal(1.25m, hrOwn.GetProperty("timeMultiplier").GetDecimal());

        // D6: the leader sees only its own-scope vacancy, and there only "below minimum", never the level.
        var leaderAttempt = Assert.Single(leader.GetProperty("attempts").EnumerateArray().ToList());
        Assert.Equal(ownVacancy, leaderAttempt.GetProperty("vacancyId").GetGuid());
        Assert.Equal("not_met", leaderAttempt.GetProperty("result").GetProperty("minimum").GetString());
        Assert.Equal(JsonValueKind.Null, leaderAttempt.GetProperty("result").GetProperty("globalPercentile").ValueKind);
        Assert.Equal(JsonValueKind.Null, leaderAttempt.GetProperty("timeMultiplier").ValueKind);
        Assert.Equal(JsonValueKind.Null, leaderAttempt.GetProperty("aids").ValueKind);
    }

    [Fact]
    public async Task Attempts_AWithdrawnCandidate_ShowsNothing_AndABadIdIsRefused()
    {
        var (candidate, _) = await ResultsAsync();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO data_consents (id, organization_id, subject_user_id, consent_type, withdrawn_at)
               VALUES (gen_random_uuid(), '{ProviderEndpointFixture.OrgA}', '{candidate}', 'recruitment_data_processing', now());
             """);
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var reader = Mint(ProviderEndpointFixture.ReaderSub);

        var withdrawn = await ReadJson(await Get(client, $"{Attempts}?candidateId={candidate}", reader));
        var missing = await Get(client, Attempts, reader);
        var malformed = await Get(client, $"{Attempts}?candidateId=123", reader);
        var unknown = await ReadJson(await Get(client, $"{Attempts}?candidateId={Guid.NewGuid()}", reader));

        Assert.True(withdrawn.GetProperty("consentWithdrawn").GetBoolean());
        Assert.Empty(withdrawn.GetProperty("attempts").EnumerateArray());
        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, malformed.StatusCode);
        Assert.Empty(unknown.GetProperty("attempts").EnumerateArray()); // no oracle
    }

    // Codex atsux run 1 [P2]: the withdrawal is told only to a reader with one of the candidate's vacancies in scope; for
    // anyone else the answer is the same as for an unknown candidate.
    [Fact]
    public async Task Attempts_AWithdrawalIsNotRevealedOutsideTheReadersScope()
    {
        await GrantReadAsync();
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO candidates (id, organization_id, first_name, last_name, email)
               VALUES ('{candidate}', '{ProviderEndpointFixture.OrgA}', 'Wil', 'Drawn', 'wd-{candidate:N}@a.example');
             INSERT INTO data_consents (id, organization_id, subject_user_id, consent_type, withdrawn_at)
               VALUES (gen_random_uuid(), '{ProviderEndpointFixture.OrgA}', '{candidate}', 'recruitment_data_processing', now());
             """);
        await ResultAttemptAsync(candidate, ProviderEndpointFixture.VacancyA); // VacancyA: outside the leader's own scope
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var leader = await ReadJson(await Get(client, $"{Attempts}?candidateId={candidate}", Mint(ProviderEndpointFixture.OwnSub)));
        var hr = await ReadJson(await Get(client, $"{Attempts}?candidateId={candidate}", Mint(ProviderEndpointFixture.ReaderSub)));

        Assert.False(leader.GetProperty("consentWithdrawn").GetBoolean());
        Assert.Empty(leader.GetProperty("attempts").EnumerateArray());
        Assert.True(hr.GetProperty("consentWithdrawn").GetBoolean());
    }

    // Design §6.3: a second candidate of a vacancy already pinned to a version gets that version, stored at reserve and
    // sent on the create.
    [Fact]
    public async Task Assign_ASecondCandidateOfAPinnedVacancy_GetsThePinnedVersion()
    {
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO candidates (id, organization_id, first_name, last_name, email)
               VALUES ('{candidate}', '{ProviderEndpointFixture.OrgA}', 'Pia', 'Pinned', 'pin-{candidate:N}@a.example');
             INSERT INTO applications (id, organization_id, candidate_id, vacancy_id, status)
               VALUES (gen_random_uuid(), '{ProviderEndpointFixture.OrgA}', '{candidate}', '{ProviderEndpointFixture.VacancyA}', 'active');
             """);
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider);
        using var client = factory.CreateClient();

        var response = await Send(client, Assign, AssignBody(candidate, ProviderEndpointFixture.VacancyA),
            Mint(ProviderEndpointFixture.AdminSub));

        Assert.True(response.IsSuccessStatusCode, await response.Content.ReadAsStringAsync());
        Assert.Equal("1.0", Assert.Single(provider.CreatedVersions));
        Assert.Equal("1.0", await fixture.ScalarAsync(
            $"SELECT instrument_version FROM assessment_provider_attempts WHERE candidate_id = '{candidate}'"));
    }
}
