using System.Net;
using Microsoft.AspNetCore.Mvc.Testing;
using Npgsql;

namespace Tims.IntegrationTests.ExternalVendor;

/// <summary>
/// #180 — denial auditing on the EXTERNAL (API-key) surface.
///
/// <para>#177 shipped <c>SecurityDenialAuditMiddleware</c> under the claim that it writes an
/// <c>authz_denied</c> row for "every C# 401/403". It does not: the middleware attributes rows from
/// <c>ResolvedPrincipal</c>, which <c>PrincipalResolutionMiddleware</c> stashes ONLY when the JWT carries
/// a <c>sub</c> claim. <c>ApiKeyAuthenticationHandler</c> issues <c>org_id</c>, <c>api_key_id</c> and
/// <c>scope</c> — never a <c>sub</c> — so every denial on <c>/external/*</c> wrote nothing at all.</para>
///
/// <para>TS covers exactly this case with a SECOND observer, <c>observeExternalDenial</c>
/// (packages/api/src/access/security-audit.ts), whose own doc comment explains why it is separate: the
/// key's org comes from the key, not from <c>ctx.user</c>. That control was never ported. This suite
/// pins the C# equivalent, implemented as a fallback inside the one existing middleware rather than a
/// second observer, so an API-key endpoint added later is covered without opting in.</para>
///
/// <para><b>What is NOT claimed:</b> a 401 from an invalid/revoked/expired key stays unaudited. That is
/// not an oversight — such a request has no authenticated org to attribute a row to, and
/// <c>audit_logs.organization_id</c> is a real FK. TS has the same boundary.</para>
/// </summary>
[Collection("ExternalAssessment")]
public sealed class ExternalDenialAuditTests(ExternalAssessmentFixture fixture)
{
    private const string ListPath = "/external/assessment-results";

    private WebApplicationFactory<Program> Factory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", fixture.ConnectionString);
            builder.UseSetting("Platform:ExternalVendorReadEnabled", "true");
        });

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        // #181: `x-real-ip` is stripped as untrusted on this deployment, so the address must come from
        // the LAST X-Forwarded-For hop — the entry an appending proxy writes. The leading hop is the
        // caller-controlled one and must never be picked.
        request.Headers.Add("x-forwarded-for", "198.51.100.1, 203.0.113.42");
        request.Headers.UserAgent.ParseAdd("vendor-integration/2.1");
        return await client.SendAsync(request);
    }

    private async Task<List<(Guid Org, Guid? Actor, string Action, string Entity, string? Metadata, string? Ip, string? Ua)>>
        ReadAuditAsync()
    {
        var rows = new List<(Guid, Guid?, string, string, string?, string?, string?)>();
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT organization_id, actor_id, action, entity, metadata::text, ip_address, user_agent " +
            "FROM audit_logs ORDER BY created_at";
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add((
                reader.GetGuid(0),
                reader.IsDBNull(1) ? null : reader.GetGuid(1),
                reader.GetString(2),
                reader.GetString(3),
                reader.IsDBNull(4) ? null : reader.GetString(4),
                reader.IsDBNull(5) ? null : reader.GetString(5),
                reader.IsDBNull(6) ? null : reader.GetString(6)));
        }

        return rows;
    }

    private async Task ClearAuditAsync()
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM audit_logs";
        await command.ExecuteNonQueryAsync();
    }

    [Fact]
    public async Task A_scope_denial_on_the_api_key_surface_writes_an_authz_denied_row()
    {
        await ClearAuditAsync();
        using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(client, ListPath, ExternalAssessmentFixture.ScopeExcludesToken);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        var row = Assert.Single(await ReadAuditAsync());
        Assert.Equal("authz_denied", row.Action);
        Assert.Equal(ExternalAssessmentFixture.OrgA, row.Org);
        Assert.Null(row.Actor); // the principal is a KEY, not a person — never a fabricated user id
        Assert.Contains("api_key", row.Metadata!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_grant_denial_on_the_api_key_surface_writes_an_authz_denied_row()
    {
        // A different denial path (the org's `external` role lacks the grant) through the same gate.
        await ClearAuditAsync();
        using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(client, ListPath, ExternalAssessmentFixture.NoGrantOrgToken);
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        var row = Assert.Single(await ReadAuditAsync());
        Assert.Equal("authz_denied", row.Action);
        Assert.Equal(ExternalAssessmentFixture.OrgB, row.Org);
    }

    [Fact]
    public async Task The_row_carries_the_api_key_id_so_a_leaked_key_can_be_identified()
    {
        // Without this the row says "someone with a key from OrgA was denied" — useless for revocation
        // when an org holds several keys. TS records apiKeyId for exactly this reason.
        await ClearAuditAsync();
        using var factory = Factory();
        using var client = factory.CreateClient();

        await Get(client, ListPath, ExternalAssessmentFixture.ScopeExcludesToken);

        var row = Assert.Single(await ReadAuditAsync());
        Assert.Contains(ExternalAssessmentFixture.ScopeExcludesKeyId.ToString(), row.Metadata!, StringComparison.Ordinal);
    }

    [Fact]
    public async Task The_row_carries_the_request_ip_and_user_agent()
    {
        await ClearAuditAsync();
        using var factory = Factory();
        using var client = factory.CreateClient();

        await Get(client, ListPath, ExternalAssessmentFixture.ScopeExcludesToken);

        var row = Assert.Single(await ReadAuditAsync());
        Assert.Equal("203.0.113.42", row.Ip);
        Assert.Equal("vendor-integration/2.1", row.Ua);
    }

    [Fact]
    public async Task The_entity_is_the_route_PATTERN_not_the_raw_url()
    {
        // Same discipline as the staff path: an id in the URL must not smuggle unbounded caller-controlled
        // text into the entity column, and rows must aggregate per endpoint rather than per resource.
        await ClearAuditAsync();
        using var factory = Factory();
        using var client = factory.CreateClient();

        await Get(client, $"/external/assessment-results/{ExternalAssessmentFixture.AssignmentA1}",
            ExternalAssessmentFixture.ScopeExcludesToken);

        var row = Assert.Single(await ReadAuditAsync());
        Assert.DoesNotContain(ExternalAssessmentFixture.AssignmentA1.ToString(), row.Entity, StringComparison.Ordinal);
        Assert.Contains("{", row.Entity, StringComparison.Ordinal); // the route parameter, unexpanded
    }

    [Fact]
    public async Task An_unauthenticated_401_writes_nothing_and_that_is_deliberate()
    {
        // A missing/garbage key has no authenticated org, and organization_id is a real FK. Auditing it
        // would also hand any anonymous caller an unbounded writer into an append-only table. TS draws the
        // same line. Asserted so the boundary is a decision on the record, not an accident.
        await ClearAuditAsync();
        using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(client, ListPath, "tims_not_a_real_key");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);

        Assert.Empty(await ReadAuditAsync());
    }

    [Fact]
    public async Task A_SUCCESSFUL_request_writes_no_denial_row()
    {
        await ClearAuditAsync();
        using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Get(client, ListPath, ExternalAssessmentFixture.ValidEmptyScopeToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        Assert.DoesNotContain(await ReadAuditAsync(), r => r.Action == "authz_denied");
    }
}
