using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Npgsql;

namespace Tims.IntegrationTests.Monitoring;

/// <summary>
/// #173 — proof that <c>SecurityDenialAuditMiddleware</c> actually writes, through the REAL pipeline.
///
/// The gap it closes: TS runs <c>withSecurityAudit</c> OUTERMOST on every procedure, so a denial
/// lands an <c>authz_denied</c> row with actor, IP and UA. Every C# gate returned a bare status code
/// and wrote nothing — and since several domains' read flags are ALREADY LIVE in production, denials
/// on those surfaces were already invisible to the access-review surface that consumes these events.
///
/// This drives real HTTP against real Postgres and asserts on the row, rather than unit-testing the
/// middleware over a fake: the whole defect was that a component existed and was never invoked, which
/// is exactly the class a unit test cannot catch. It reuses the monitoring fixture because that
/// fixture already produces all three outcomes the middleware discriminates — a 403 from
/// <c>MonitoringStaffGate</c> (resolvable staff without the grant), a 401 (unknown sub), and a 200.
/// </summary>
[Collection("MonitoringRead")]
public sealed class SecurityDenialAuditTests(MonitoringReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string ExecutiveKpis = "/monitoring/executive-kpis";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "denial-audit-test-key" };

    private readonly MonitoringReadFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory(bool trustXRealIp = false, string? auditDisabled = null) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:MonitoringReadEnabled", "true");
            if (trustXRealIp)
            {
                builder.UseSetting("Platform:TrustXRealIpHeader", "true");
            }

            if (auditDisabled is not null)
            {
                builder.UseSetting("Platform:SecurityDenialAuditDisabled", auditDisabled);
            }
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

    private static string Mint(string sub) =>
        new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Subject = new ClaimsIdentity([new Claim("sub", sub)]),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(PrivateKey, SecurityAlgorithms.RsaSha256),
        });

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? token, string? xff = null, string? realIp = null)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        if (xff is not null)
        {
            request.Headers.Add("x-forwarded-for", xff);
        }

        if (realIp is not null)
        {
            request.Headers.Add("x-real-ip", realIp);
        }

        return await client.SendAsync(request);
    }

    private sealed record DenialRow(Guid OrganizationId, Guid? ActorId, string Entity, string? Metadata, string? IpAddress, string? UserAgent);

    private async Task<IReadOnlyList<DenialRow>> DenialRowsAsync()
    {
        var rows = new List<DenialRow>();
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            "SELECT organization_id, actor_id, entity, metadata::text, ip_address, user_agent " +
            "FROM audit_logs WHERE action = 'authz_denied' ORDER BY created_at";
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add(new DenialRow(
                reader.GetGuid(0),
                await reader.IsDBNullAsync(1) ? null : reader.GetGuid(1),
                reader.GetString(2),
                await reader.IsDBNullAsync(3) ? null : reader.GetString(3),
                await reader.IsDBNullAsync(4) ? null : reader.GetString(4),
                await reader.IsDBNullAsync(5) ? null : reader.GetString(5)));
        }

        return rows;
    }

    private async Task ClearDenialsAsync()
    {
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM audit_logs WHERE action = 'authz_denied'";
        await command.ExecuteNonQueryAsync();
    }

    [Fact]
    public async Task A_403_from_the_staff_gate_writes_an_authz_denied_row()
    {
        await ClearDenialsAsync();
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        // NoGrant is resolvable staff in OrgA WITHOUT monitoring:read — MonitoringStaffGate 403s.
        var response = await Get(client, ExecutiveKpis, Mint(MonitoringReadFixture.NoGrantSub),
            xff: "1.2.3.4, 10.0.0.9");

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);

        var rows = await DenialRowsAsync();
        var row = Assert.Single(rows);
        Assert.Equal(MonitoringReadFixture.OrgA, row.OrganizationId);
        Assert.Equal(MonitoringReadFixture.NoGrantId, row.ActorId);
        Assert.Contains("FORBIDDEN", row.Metadata);
        // The ROUTE PATTERN, not the raw URL — so a path id cannot smuggle caller-controlled text in.
        Assert.Equal("platform:GET /monitoring/executive-kpis", row.Entity);
        // #174's derivation: the LAST xff hop, never the attacker-chosen first. (#181: `x-real-ip` is
        // stripped by default on this deployment, so XFF is the only surviving source.)
        Assert.Equal("10.0.0.9", row.IpAddress);
    }

    [Fact]
    public async Task A_client_supplied_x_real_ip_is_IGNORED_by_default()
    {
        // #181. This test previously asserted the OPPOSITE — that a caller-supplied `x-real-ip` becomes
        // the audit row's address — under the name `The_audit_ip_prefers_the_platform_edge_header`. That
        // name encoded an assumption from the TS deployment (Vercel does set the header) which is FALSE
        // for this service: it runs on App Runner with no ALB/CloudFront, and App Runner neither sets nor
        // strips `x-real-ip`. So the "platform edge header" was in fact the client, and the one forensic
        // field a §21 obligation produces was attacker-chosen. TrustedProxyHeaderMiddleware now strips it
        // and the derivation falls through to the last XFF hop, which an appending proxy controls.
        await ClearDenialsAsync();
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        await Get(client, ExecutiveKpis, Mint(MonitoringReadFixture.NoGrantSub),
            xff: "1.2.3.4, 10.0.0.9", realIp: "203.0.113.66");

        var row = Assert.Single(await DenialRowsAsync());
        Assert.Equal("10.0.0.9", row.IpAddress);          // last XFF hop
        Assert.NotEqual("203.0.113.66", row.IpAddress);   // the spoofed value never lands
    }

    [Fact]
    public async Task An_explicitly_TRUSTED_x_real_ip_is_honoured()
    {
        // The escape hatch, so putting a real edge in front later does not require a code change. Pinned
        // so the flag is proven to do something — an inert opt-in would be worse than none, since the
        // operator would believe the header is being honoured when it is silently dropped.
        await ClearDenialsAsync();
        await using var factory = EnabledFactory(trustXRealIp: true);
        using var client = factory.CreateClient();

        await Get(client, ExecutiveKpis, Mint(MonitoringReadFixture.NoGrantSub),
            xff: "1.2.3.4, 10.0.0.9", realIp: "203.0.113.66");

        var row = Assert.Single(await DenialRowsAsync());
        Assert.Equal("203.0.113.66", row.IpAddress);
    }

    [Fact]
    public async Task The_kill_switch_removes_the_middleware_but_leaves_the_denial_intact()
    {
        // #181. A global middleware on the auth path that writes to the DB on every 401/403 needs a way
        // OFF that is not a rebuild-and-redeploy (the image ships by immutable tag, auto-deploy off).
        // The denial itself must be untouched — this disables the OBSERVER, never the control.
        await ClearDenialsAsync();
        await using var factory = EnabledFactory(auditDisabled: "true");
        using var client = factory.CreateClient();

        var response = await Get(client, ExecutiveKpis, Mint(MonitoringReadFixture.NoGrantSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Empty(await DenialRowsAsync());
    }

    [Theory]
    [InlineData("false")]
    [InlineData("TRUE")]
    [InlineData("1")]
    [InlineData("yes")]
    [InlineData("")]
    public async Task A_garbled_kill_switch_value_leaves_the_audit_ON(string flag)
    {
        // The polarity that matters. This flag is DISABLED-phrased precisely because the middleware is
        // already live: anything other than the exact string "true" must keep the control running, so a
        // typo in configuration can never silently stop a live security control from recording denials.
        await ClearDenialsAsync();
        await using var factory = EnabledFactory(auditDisabled: flag);
        using var client = factory.CreateClient();

        await Get(client, ExecutiveKpis, Mint(MonitoringReadFixture.NoGrantSub));

        Assert.Single(await DenialRowsAsync());
    }

    [Fact]
    public async Task A_200_writes_no_denial_row()
    {
        await ClearDenialsAsync();
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExecutiveKpis, Mint(MonitoringReadFixture.OrgReaderSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Empty(await DenialRowsAsync());
    }

    [Fact]
    public async Task An_unauthenticated_401_writes_nothing_resolve_or_skip()
    {
        // Parity with observeDenial's resolve-or-SKIP: there is no tenant to attribute the row to,
        // and audit_logs.organization_id is a real FK. Losing these is deliberate, not an oversight —
        // an unauthenticated caller cannot be pinned to an org without inventing one.
        await ClearDenialsAsync();
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExecutiveKpis, token: null);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Empty(await DenialRowsAsync());
    }

    [Fact]
    public async Task A_valid_jwt_whose_sub_is_not_staff_also_writes_nothing()
    {
        // 401 from PrincipalResolver: authenticated at the JWT layer but resolved to no TIMS user, so
        // again no org. Distinct path from the no-token case above, same skip.
        await ClearDenialsAsync();
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExecutiveKpis, Mint("sub-does-not-exist"));

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Empty(await DenialRowsAsync());
    }

    [Fact]
    public async Task Repeated_probing_leaves_one_row_per_attempt()
    {
        // The scenario the gap made invisible: a low-privilege principal enumerating the surface.
        await ClearDenialsAsync();
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        foreach (var path in new[] { ExecutiveKpis, "/monitoring/module-health", "/monitoring/alert-rules" })
        {
            await Get(client, path, Mint(MonitoringReadFixture.NoGrantSub));
        }

        var rows = await DenialRowsAsync();
        Assert.Equal(3, rows.Count);
        Assert.All(rows, r => Assert.Equal(MonitoringReadFixture.NoGrantId, r.ActorId));
        Assert.Contains(rows, r => r.Entity.EndsWith("/monitoring/module-health", StringComparison.Ordinal));
    }
}
