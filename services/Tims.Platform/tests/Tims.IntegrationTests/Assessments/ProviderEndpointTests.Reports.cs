using System.Net;
using System.Text.Json;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// HR report downloads over the REAL host + real Postgres (RLS forced, app_tenant), with the fake provider: the list of
/// reports for an attempt's latest result, the PDF itself (headers, audit row), owner default D6 (a reader below company
/// scope is refused even on its own vacancy), a voided result, an unknown attempt, an off-pattern variant and the dark
/// flag.
/// </summary>
public sealed partial class ProviderEndpointTests
{
    private static string ReportsOf(Guid attempt) => $"/assessments/provider-attempts/{attempt}/reports";

    private static string ReportOf(Guid attempt, string query = "") => $"/assessments/provider-attempts/{attempt}/report{query}";

    /// <summary>A candidate on a fresh vacancy assigned to the leader, with one LIA attempt holding a stored result.</summary>
    private async Task<(Guid Attempt, Guid Result)> ReportAttemptAsync(string validity = "valid")
    {
        var candidate = Guid.NewGuid();
        var vacancy = Guid.NewGuid();
        var attempt = Guid.NewGuid();
        var result = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO candidates (id, organization_id, first_name, last_name, email)
               VALUES ('{candidate}', '{ProviderEndpointFixture.OrgA}', 'Rep', 'Ort', 'rep-{candidate:N}@a.example');
             INSERT INTO vacancies (id, organization_id, assigned_to, created_by)
               VALUES ('{vacancy}', '{ProviderEndpointFixture.OrgA}', '{OwnUser}', '{ProviderEndpointFixture.AdminId}');
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument,
                 state, purpose, job_relatedness_reason, locale, time_multiplier, aids, provider_subject_id,
                 provider_assignment_id, instrument_version, content_version, required_consents, expires_at,
                 latest_result_id, assigned_by_id)
               VALUES ('{attempt}', '{ProviderEndpointFixture.OrgA}', 'aaaa0000-0000-4000-8000-0000000000b0', '{candidate}',
                 '{vacancy}', 'lia', 'result_ready', 'selection', 'Análisis', 'es', 1, ARRAY[]::text[],
                 gen_random_uuid(), gen_random_uuid(), '1.0', 'content-1', ARRAY['assessment'], now() + interval '14 days',
                 '{result}', '{ProviderEndpointFixture.AdminId}');
             INSERT INTO assessment_provider_results (id, organization_id, attempt_id, provider_result_id, result_revision,
                 result_schema, instrument, instrument_version, content_version, content_sha256, scoring_version,
                 scoring_method, purpose, validity_status, validity_reasons, completion, global_percentile,
                 time_multiplier_applied, rendered_for, rendered_level, completed_at, scored_at, scores)
               VALUES (gen_random_uuid(), '{ProviderEndpointFixture.OrgA}', '{attempt}', '{result}', 1, 'LiaResultV1', 'lia',
                 '1.0', 'content-1', repeat('a', 64), 's-1', 'deterministic', 'selection', '{validity}',
                 {(validity == "voided" ? "ARRAY['administrative_void']" : "ARRAY[]::text[]")}, 'complete', 30,
                 1, 'tenant_hr', 'full', now() - interval '1 hour', now() - interval '1 hour', '{LiaScores}'::jsonb);
             """);
        return (attempt, result);
    }

    [Fact]
    public async Task Reports_HrListsThemAndDownloadsThePdf_NoStore_Audited()
    {
        await GrantReadAsync();
        var (attempt, result) = await ReportAttemptAsync();
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider);
        using var client = factory.CreateClient();
        var hr = Mint(ProviderEndpointFixture.ReaderSub);

        var listed = await Get(client, ReportsOf(attempt), hr);
        Assert.Equal(HttpStatusCode.OK, listed.StatusCode);
        var reports = (await ReadJson(listed)).GetProperty("reports").EnumerateArray().ToList();
        Assert.Equal(JsonValueKind.Null, reports[0].GetProperty("variant").ValueKind); // the native report first
        Assert.Equal(["pca", "gd"], reports.Skip(1).Select(r => r.GetProperty("variant").GetString()));

        var pdf = await Get(client, ReportOf(attempt, "?locale=en"), hr);
        Assert.Equal(HttpStatusCode.OK, pdf.StatusCode);
        Assert.Equal("application/pdf", pdf.Content.Headers.ContentType!.MediaType);
        Assert.True(pdf.Headers.CacheControl is { NoStore: true, Private: true }, pdf.Headers.CacheControl?.ToString());
        Assert.Equal("tims-lia.pdf", pdf.Content.Headers.ContentDisposition!.FileNameStar ?? pdf.Content.Headers.ContentDisposition.FileName);
        Assert.StartsWith("%PDF-", await pdf.Content.ReadAsStringAsync());
        Assert.Contains($"report:{result}:native:en", provider.Calls);
        Assert.Equal(1L, await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE action = 'assessment_provider_report_downloaded' AND entity_id = '{attempt}'"));
    }

    // Owner default D6: a report is the full interpretation, so the leader (own scope) is refused even on its own vacancy.
    [Fact]
    public async Task Reports_AReaderBelowCompanyScope_IsRefused_EvenOnItsOwnVacancy()
    {
        await GrantReadAsync();
        var (attempt, _) = await ReportAttemptAsync();
        var provider = new FakeProvider();
        await using var factory = Factory(provider: provider);
        using var client = factory.CreateClient();
        var leader = Mint(ProviderEndpointFixture.OwnSub);

        Assert.Equal(HttpStatusCode.Forbidden, (await Get(client, ReportsOf(attempt), leader)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Get(client, ReportOf(attempt), leader)).StatusCode);
        Assert.DoesNotContain(provider.Calls, c => c.StartsWith("report", StringComparison.Ordinal) || c.StartsWith("list_reports", StringComparison.Ordinal));
    }

    [Fact]
    public async Task Reports_AVoidedResult_AnUnknownAttempt_AndABadVariant_AreRefused()
    {
        await GrantReadAsync();
        var (voided, _) = await ReportAttemptAsync("voided");
        var (valid, _) = await ReportAttemptAsync();
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var hr = Mint(ProviderEndpointFixture.ReaderSub);

        var gone = await Get(client, ReportOf(voided), hr);
        Assert.Equal(HttpStatusCode.NotFound, gone.StatusCode);
        Assert.Equal("report_unavailable", (await ReadJson(gone)).GetProperty("error").GetString());
        var unknown = await Get(client, ReportOf(Guid.NewGuid()), hr);
        Assert.Equal("not_found", (await ReadJson(unknown)).GetProperty("error").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await Get(client, ReportOf(valid, "?variant=..%2Fetc"), hr)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Get(client, ReportOf(valid, "?locale=xx-YYYY"), hr)).StatusCode);
    }

    [Fact]
    public async Task Reports_DarkFlag_AreNotMapped()
    {
        await using var factory = Factory(enabled: false);
        using var client = factory.CreateClient();
        var hr = Mint(ProviderEndpointFixture.ReaderSub);

        Assert.Equal(HttpStatusCode.NotFound, (await Get(client, ReportsOf(Guid.NewGuid()), hr)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Get(client, ReportOf(Guid.NewGuid()), hr)).StatusCode);
    }
}
