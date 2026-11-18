using System.Net;
using System.Net.Http.Json;
using System.Text;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Tims.Domain.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// The org's assessment security settings (proctoring parity, 2026-11-11) over the REAL host + real Postgres: the
/// <c>assessment:update</c> + org-scope gate, strict bodies, the identity check held back by the platform flag, tenant
/// isolation, and an assignment carrying the org's block.
/// </summary>
public sealed partial class ProviderEndpointTests
{
    private const string ProctoringSettings = "/assessments/provider-settings/proctoring";

    private static readonly object StrictSettings = new
    {
        lockdown = true,
        antiCheat = new { threshold = 3, consequence = "auto_submit" },
        identityCheck = false,
    };

    private static Task<HttpResponseMessage> Put(HttpClient client, string path, object body, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Put, path)
        {
            Content = body is string raw ? new StringContent(raw, Encoding.UTF8, "application/json") : JsonContent.Create(body),
        };
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return client.SendAsync(request);
    }

    [Fact]
    public async Task Settings_require_assessment_update_at_org_scope()
    {
        await GrantReadAsync();
        await using var factory = Factory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await Put(client, ProctoringSettings, StrictSettings, null)).StatusCode);
        // The reader holds assessment:read only; the leader holds update at OWN scope: neither may change the org's settings.
        Assert.Equal(HttpStatusCode.Forbidden,
            (await Put(client, ProctoringSettings, StrictSettings, Mint(ProviderEndpointFixture.ReaderSub))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await Put(client, ProctoringSettings, StrictSettings, Mint(ProviderEndpointFixture.OwnSub))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden,
            (await Get(client, ProctoringSettings, Mint(ProviderEndpointFixture.OwnSub))).StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, ProctoringSettings, null)).StatusCode);
    }

    [Fact]
    public async Task Settings_bodies_are_strict()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();
        var token = Mint(ProviderEndpointFixture.OrgBSub);

        var missing = await Put(client, ProctoringSettings, """{"lockdown":true,"identityCheck":false}""", token);
        var outOfRange = await Put(client, ProctoringSettings,
            """{"lockdown":true,"antiCheat":{"threshold":25,"consequence":"void"},"identityCheck":false}""", token);

        Assert.Equal(HttpStatusCode.BadRequest, missing.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, outOfRange.StatusCode);
    }

    [Fact]
    public async Task The_identity_check_is_refused_while_the_platform_flag_is_off()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Put(client, ProctoringSettings,
            """{"lockdown":false,"antiCheat":null,"identityCheck":true}""", Mint(ProviderEndpointFixture.OrgBSub));

        Assert.Equal(HttpStatusCode.UnprocessableEntity, response.StatusCode);
        Assert.Equal("identity_check_unavailable", (await ReadJson(response)).GetProperty("error").GetString());
    }

    [Fact]
    public async Task With_the_platform_flag_on_the_identity_check_can_be_saved()
    {
        await using var factory = Factory().WithWebHostBuilder(b => b.UseSetting("Platform:AssessmentIdentityCheckEnabled", "true"));
        using var client = factory.CreateClient();
        var token = Mint(ProviderEndpointFixture.OrgBSub);

        var saved = await Put(client, ProctoringSettings, """{"lockdown":false,"antiCheat":null,"identityCheck":true}""", token);
        var json = await ReadJson(saved);

        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        Assert.True(json.GetProperty("identityCheck").GetBoolean());
        Assert.True(json.GetProperty("identityCheckAvailable").GetBoolean());

        // Leave OrgB without the identity check: later assigns in OrgB run with the flag off.
        await Put(client, ProctoringSettings, StrictSettings, token);
    }

    [Fact]
    public async Task Saved_settings_are_the_orgs_own_and_the_next_assignment_carries_them()
    {
        await using var factory = Factory(provider: _settingsProvider);
        using var client = factory.CreateClient();
        var orgB = Mint(ProviderEndpointFixture.OrgBSub);

        var saved = await Put(client, ProctoringSettings, StrictSettings, orgB);
        Assert.Equal(HttpStatusCode.OK, saved.StatusCode);
        var view = await ReadJson(saved);
        Assert.True(view.GetProperty("lockdown").GetBoolean());
        Assert.Equal(3, view.GetProperty("antiCheat").GetProperty("threshold").GetInt32());
        Assert.Equal("auto_submit", view.GetProperty("antiCheat").GetProperty("consequence").GetString());
        Assert.False(view.GetProperty("identityCheckAvailable").GetBoolean());

        // Another org reads its own (never saved: all off), never OrgB's.
        await GrantReadAsync();
        var orgA = await ReadJson(await Get(client, ProctoringSettings, Mint(ProviderEndpointFixture.AdminSub)));
        Assert.False(orgA.GetProperty("lockdown").GetBoolean());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, orgA.GetProperty("antiCheat").ValueKind);

        // An assignment created now carries OrgB's block, and the attempt keeps it.
        var candidate = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO candidates (id, organization_id, first_name, last_name, email)
               VALUES ('{candidate}', '{ProviderEndpointFixture.OrgB}', 'Pro', 'Ctor', 'pro-{candidate:N}@b.example');
             INSERT INTO applications (id, organization_id, candidate_id, vacancy_id, status)
               VALUES (gen_random_uuid(), '{ProviderEndpointFixture.OrgB}', '{candidate}', '{ProviderEndpointFixture.VacancyB}', 'active');
             """);
        var assigned = await Send(client, Assign, AssignBody(candidate, ProviderEndpointFixture.VacancyB), orgB);

        Assert.Equal(HttpStatusCode.OK, assigned.StatusCode);
        var attempt = await fixture.ScalarAsync(
            $"SELECT id::text FROM assessment_provider_attempts WHERE candidate_id = '{candidate}'");
        var sent = Assert.Single(_settingsProvider.CreatedProctoring, c => c.ExternalRef == (string)attempt!);
        Assert.Equal(new AssessmentProctoring(true, new AntiCheatPolicy(3, AntiCheatConsequences.AutoSubmit), false), sent.Proctoring);
        Assert.Equal("3|auto_submit", await fixture.ScalarAsync(
            $"SELECT proctoring_anti_cheat_threshold || '|' || proctoring_anti_cheat_consequence FROM assessment_provider_attempts WHERE id = '{attempt}'"));
        Assert.True((long)(await fixture.ScalarAsync(
            $"SELECT count(*) FROM audit_logs WHERE action = 'assessment_provider_settings_updated' AND organization_id = '{ProviderEndpointFixture.OrgB}' AND changes->'proctoring'->'after'->>'antiCheatThreshold' = '3'"))! >= 1);
    }

    private readonly FakeProvider _settingsProvider = new();
}
