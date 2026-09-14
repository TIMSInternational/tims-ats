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
/// #173 — MFA step-up enforcement through the REAL pipeline.
///
/// The gap: TS composes <c>withMfaEnforcement</c> into <c>protectedProcedure</c>, so with
/// <c>MFA_ENFORCED=true</c> a privileged principal on an <c>aal1</c> session is refused by every
/// procedure. No C# endpoint enforced it, so the SAME token tRPC refused was served a 200 here.
///
/// These assert the whole contract, not just the status: the refusal, the two asymmetric failure
/// directions (flag fails OPEN, level fails CLOSED), that ordinary staff are untouched, that the
/// refusal is audited as <c>mfa_step_up_required</c> and NOT as a generic <c>authz_denied</c>, and
/// that the response body carries the exact sentinel the web client redirects on.
/// </summary>
[Collection("MonitoringRead")]
public sealed class MfaStepUpTests(MonitoringReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string ExecutiveKpis = "/monitoring/executive-kpis";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "mfa-test-key" };

    private readonly MonitoringReadFixture _fixture = fixture;

    private WebApplicationFactory<Program> Factory(string? mfaEnforced) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:MonitoringReadEnabled", "true");
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);
            if (mfaEnforced is not null)
            {
                builder.UseSetting("Platform:MfaEnforced", mfaEnforced);
            }

            var publicJwk = JsonWebKeyConverter.ConvertFromRSASecurityKey(
                new RsaSecurityKey(SigningRsa.ExportParameters(false)) { KeyId = PrivateKey.KeyId });
            builder.ConfigureTestServices(services =>
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [publicJwk];
                }));
        });

    /// <param name="aal">null models a token with NO aal claim at all — the fail-CLOSED case.</param>
    private static string Mint(string sub, string? aal)
    {
        var claims = new List<Claim> { new("sub", sub) };
        if (aal is not null)
        {
            claims.Add(new Claim("aal", aal));
        }

        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = Issuer,
            Audience = Audience,
            Subject = new ClaimsIdentity(claims),
            Expires = DateTime.UtcNow.AddMinutes(10),
            SigningCredentials = new SigningCredentials(PrivateKey, SecurityAlgorithms.RsaSha256),
        });
    }

    private static async Task<HttpResponseMessage> Get(HttpClient client, string token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, ExecutiveKpis);
        request.Headers.Add("Authorization", $"Bearer {token}");
        return await client.SendAsync(request);
    }

    private async Task<IReadOnlyList<(string Action, string Entity)>> AuditRowsAsync()
    {
        var rows = new List<(string, string)>();
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT action, entity FROM audit_logs ORDER BY created_at";
        await using var reader = await command.ExecuteReaderAsync();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetString(0), reader.GetString(1)));
        }

        return rows;
    }

    private async Task ClearAuditAsync()
    {
        await using var connection = new NpgsqlConnection(_fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM audit_logs";
        await command.ExecuteNonQueryAsync();
    }

    [Theory]
    [InlineData("aal1")]
    [InlineData(null)]      // no aal claim at all
    [InlineData("aal3")]    // unknown level
    public async Task Enforced_privileged_withoutStepUp_is403(string? aal)
    {
        // Fail-CLOSED on the LEVEL: once enforcement is on, an unknown or absent level is never
        // treated as good enough.
        await using var factory = Factory("true");
        using var client = factory.CreateClient();

        var response = await Get(client, Mint(MonitoringReadFixture.SuperAdminSub, aal));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        // The exact sentinel apps/web/lib/platform-api/client.ts lifts into PlatformApiError.message
        // and trpc-provider.tsx's redirectToMfaIfRequired matches to send the user to /mfa. A bare
        // 403 — what every other C# gate returns — could never trigger that recovery path.
        Assert.Contains("MFA_REQUIRED", body);
    }

    [Fact]
    public async Task Enforced_privileged_steppedUp_passesThrough()
    {
        await using var factory = Factory("true");
        using var client = factory.CreateClient();

        var response = await Get(client, Mint(MonitoringReadFixture.SuperAdminSub, "aal2"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Enforced_ordinaryStaff_onAal1_isUntouched()
    {
        // WHO must step up is the privileged set only. Gating ordinary staff would be a far larger
        // behaviour change than the control intends, and diverge from TS.
        await using var factory = Factory("true");
        using var client = factory.CreateClient();

        var response = await Get(client, Mint(MonitoringReadFixture.OrgReaderSub, "aal1"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData(null)]     // unset — the DEFAULT
    [InlineData("false")]
    [InlineData("TRUE")]   // exact match only
    [InlineData("yes")]
    public async Task TheFlag_failsOPEN_onAnythingButExactlyTrue(string? flag)
    {
        // The other asymmetric direction, and the one with production consequences if inverted: a
        // misconfigured env must never lock privileged operators out. Mirrors RLS_ENFORCED.
        await using var factory = Factory(flag);
        using var client = factory.CreateClient();

        var response = await Get(client, Mint(MonitoringReadFixture.SuperAdminSub, "aal1"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task TheRefusal_isAudited_asMfaStepUp_andNotAsAGenericDenial()
    {
        // The interaction with #173's other half (SecurityDenialAuditMiddleware, shipped first):
        // that observer sees this 403 on the way out and must SKIP it, because an MFA refusal is
        // audited distinctly. Same carve-out as observeDenial's `if (message === MFA_REQUIRED)`.
        // Without it every step-up would land TWO rows and pollute the authz_denied signal.
        await ClearAuditAsync();
        await using var factory = Factory("true");
        using var client = factory.CreateClient();

        await Get(client, Mint(MonitoringReadFixture.SuperAdminSub, "aal1"));

        var rows = await AuditRowsAsync();
        var row = Assert.Single(rows);
        Assert.Equal("mfa_step_up_required", row.Action);
        Assert.Equal("mfa", row.Entity);
        Assert.DoesNotContain(rows, r => r.Action == "authz_denied");
    }

    [Fact]
    public async Task AnUnenforcedRun_writesNoMfaRow()
    {
        await ClearAuditAsync();
        await using var factory = Factory(null);
        using var client = factory.CreateClient();

        await Get(client, Mint(MonitoringReadFixture.SuperAdminSub, "aal1"));

        Assert.DoesNotContain(await AuditRowsAsync(), r => r.Action == "mfa_step_up_required");
    }
}
