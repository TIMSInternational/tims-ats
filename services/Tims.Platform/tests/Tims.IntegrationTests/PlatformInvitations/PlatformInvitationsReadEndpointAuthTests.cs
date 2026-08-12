using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Tims.IntegrationTests.PlatformInvitations;

/// <summary>
/// Phase-5 slice 22 (issue #75) endpoint boot matrix: real host + real Postgres, driving the REAL HTTP
/// pipeline through PrincipalResolver + PlatformOwnerGate on all THREE routes —
///   platform-owner → 200; resolvable ordinary org-user → 403; missing/tampered JWT → 401;
///   flag OFF (default) → 404 (dark).
///
/// <para>TRAP 4: without this class the gate is unenforced. Every repository-level test calls the
/// repository directly, so <c>PlatformOwnerGate</c> could be deleted from all three handlers with the whole
/// suite green. The deny assertions are per-ROUTE rather than once for the surface, because the gate is
/// copied into each handler and deleting it from ONE handler is the realistic mistake.</para>
/// </summary>
[Collection("PlatformInvitationsRead")]
public sealed class PlatformInvitationsReadEndpointAuthTests(PlatformInvitationsReadFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private const string KpisPath = "/platform/invitations/kpis";
    private const string ListPath = "/platform/invitations";
    private const string ExportPath = "/platform/invitations/export";

    private static readonly RSA SigningRsa = RSA.Create(2048);
    private static readonly RsaSecurityKey PrivateKey = new(SigningRsa) { KeyId = "platform-invitations-test-key" };

    private readonly PlatformInvitationsReadFixture _fixture = fixture;

    private WebApplicationFactory<Program> EnabledFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", _fixture.ConnectionString);
            builder.UseSetting("Platform:PlatformInvitationsReadEnabled", "true");
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

    private static WebApplicationFactory<Program> DarkFactory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
            builder.UseSetting("Platform:DatabaseConnectionString", "Host=localhost;Port=5432;Database=x;Username=x"));

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

    private static async Task<HttpResponseMessage> Get(HttpClient client, string path, string? token)
    {
        var request = new HttpRequestMessage(HttpMethod.Get, path);
        if (token is not null)
        {
            request.Headers.Add("Authorization", $"Bearer {token}");
        }

        return await client.SendAsync(request);
    }

    // ── the gate, per route ──────────────────────────────────────────────────────────────────────────
    [Theory]
    [InlineData(KpisPath)]
    [InlineData(ListPath)]
    [InlineData(ExportPath)]
    public async Task PlatformOwner_Is200(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData(KpisPath)]
    [InlineData(ListPath)]
    [InlineData(ExportPath)]
    public async Task OrdinaryOrgUser_Is403(string path)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, path, Mint(PlatformInvitationsReadFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    [Theory]
    [InlineData(KpisPath, null)]
    [InlineData(ListPath, null)]
    [InlineData(ExportPath, null)]
    [InlineData(KpisPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    [InlineData(ListPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    [InlineData(ExportPath, "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhdHRhY2tlciJ9.c2ln")]
    public async Task RejectedCredential_Is401(string path, string? token)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        Assert.Equal(HttpStatusCode.Unauthorized, (await Get(client, path, token)).StatusCode);
    }

    [Theory]
    [InlineData(KpisPath)]
    [InlineData(ListPath)]
    [InlineData(ExportPath)]
    public async Task Route_Is404_WhenFlagDefaultsOff(string path)
    {
        await using var factory = DarkFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync(path);

        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    /// <summary>
    /// AUTH RUNS BEFORE VALIDATION. A non-owner sending input that is ALSO invalid must get 403, not 400 —
    /// tRPC runs middleware before Zod, and the reverse order tells a caller who may not know the endpoint
    /// exists that it has a `limit` bound.
    /// </summary>
    [Fact]
    public async Task OrdinaryOrgUser_WithInvalidInput_Is403_Not400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ListPath}?limit=9999", Mint(PlatformInvitationsReadFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>The same ordering property on the export, whose only validated inputs are the two enums.</summary>
    [Fact]
    public async Task OrdinaryOrgUser_WithInvalidExportFilter_Is403_Not400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ExportPath}?status=nonsense", Mint(PlatformInvitationsReadFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    // ── the 400 matrix, as an OWNER (so a 400 can only come from validation) ─────────────────────────
    [Theory]
    // page: z.number().int().min(0)
    [InlineData("?page=-1")]
    // limit: z.number().int().min(1).max(50) — note 50, not listOrganizations' 100
    [InlineData("?limit=0")]
    [InlineData("?limit=51")]
    // type: z.enum(['org_admin','user']) — an unknown value is a 400, NOT an ignored filter
    [InlineData("?type=admin")]
    [InlineData("?type=ORG_ADMIN")]
    // status: z.enum of five values
    [InlineData("?status=nonsense")]
    [InlineData("?status=Sent")]
    public async Task PlatformOwner_InvalidInput_Is400(string queryString)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ListPath + queryString, Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    /// <summary>
    /// <c>search</c> is bounded at 100 on the RAW input, before trimming. 101 characters is a 400 even
    /// though a shorter trimmed form would have been accepted — matching <c>z.string().max(100)</c>, which
    /// runs on what the client sent.
    /// </summary>
    [Fact]
    public async Task PlatformOwner_OverlongSearch_Is400()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(
            client,
            $"{ListPath}?search={new string('a', 101)}",
            Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task PlatformOwner_BoundarySearch_Is200()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(
            client,
            $"{ListPath}?search={new string('a', 100)}",
            Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Theory]
    [InlineData("?limit=1")]
    [InlineData("?limit=50")]
    [InlineData("?page=0")]
    public async Task PlatformOwner_BoundaryInput_Is200(string queryString)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ListPath + queryString, Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    // ── payload shape, over the real wire ───────────────────────────────────────────────────────────
    /// <summary>
    /// The KPI arithmetic, cross-org and asserted per key. The four buckets deliberately do NOT sum to
    /// <c>total</c>: the seeded <c>revoked</c> row belongs to none of them, which is real TS behaviour
    /// (<c>getInvitationKpis</c> counts pending+sent, accepted and expired only).
    /// </summary>
    [Fact]
    public async Task Kpis_CountCrossOrg_AndRevokedIsInNoBucket()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, KpisPath, Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;

        Assert.Equal(5, root.GetProperty("total").GetInt32());
        // pending + sent, spanning OrgA and OrgB — a tenant-scoped read would return 1, not 2.
        Assert.Equal(2, root.GetProperty("pending").GetInt32());
        Assert.Equal(1, root.GetProperty("accepted").GetInt32());
        Assert.Equal(1, root.GetProperty("expired").GetInt32());
    }

    /// <summary>
    /// Every date on the wire must carry the trailing <c>Z</c> and exactly three millisecond digits, because
    /// that is what superjson + <c>Date.prototype.toISOString()</c> emit on the TS side. This is the #211
    /// defect class: the columns are <c>timestamp(3) without time zone</c>, so the DEFAULT serialisation
    /// emits neither, and <c>expiresAt</c>/<c>createdAt</c> are NOT NULL on every row — a guaranteed parity
    /// failure on the first row rather than a latent one. Asserted on a row whose <c>sent_at</c> has
    /// non-zero ms AND on the <c>.000</c> case, since STJ drops a zero fraction entirely.
    /// </summary>
    [Fact]
    public async Task List_SerialisesDatesAsNodeIso()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ListPath, Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        var body = await response.Content.ReadAsStringAsync();

        // 08:30:00.123 — a non-zero fraction, which must survive verbatim.
        Assert.Contains("\"2026-07-01T08:30:00.123Z\"", body, StringComparison.Ordinal);
        // A ZERO fraction, which default STJ would render as "2026-07-02T08:30:00" with no ms and no Z.
        Assert.Contains("\"2026-07-02T08:30:00.000Z\"", body, StringComparison.Ordinal);
        // Belt and braces over the whole payload: no bare-local date may appear anywhere.
        Assert.DoesNotContain("T08:30:00\"", body, StringComparison.Ordinal);
        Assert.DoesNotContain("T00:00:00\"", body, StringComparison.Ordinal);
    }

    /// <summary>
    /// The list is cross-org and ordered <c>created_at DESC</c>, and the nested relations resolve: the
    /// org-less row emits <c>organization: null</c> while an org-bearing row emits the joined
    /// <c>{ id, name }</c>. Also pins the omissions — <c>token</c> above all, which is the bearer credential
    /// for the two unauthenticated procedures and must never appear in a console list response.
    /// </summary>
    [Fact]
    public async Task List_IsCrossOrg_ResolvesRelations_AndOmitsTheToken()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ListPath, Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        var body = await response.Content.ReadAsStringAsync();
        using var json = JsonDocument.Parse(body);
        var root = json.RootElement;

        Assert.Equal(5, root.GetProperty("total").GetInt32());
        var invitations = root.GetProperty("invitations");
        Assert.Equal(5, invitations.GetArrayLength());

        // created_at DESC over five distinct timestamps ⇒ exactly one correct order.
        Assert.Equal("revoked@acme.test", invitations[0].GetProperty("email").GetString());
        Assert.Equal("orgless@new.test", invitations[1].GetProperty("email").GetString());
        Assert.Equal("pending@globex.test", invitations[2].GetProperty("email").GetString());
        Assert.Equal("accepted@acme.test", invitations[3].GetProperty("email").GetString());
        Assert.Equal("sent@acme.test", invitations[4].GetProperty("email").GetString());

        // The OrgB row proves the read crosses tenants at all.
        Assert.Equal("Globex Inc", invitations[2].GetProperty("organization").GetProperty("name").GetString());

        // organization_id IS NULL ⇒ organization: null. Note dropNullish would MASK this in the parity
        // harness, so it is asserted here instead of relying on the harness to catch it.
        Assert.Equal(JsonValueKind.Null, invitations[1].GetProperty("organization").ValueKind);
        // ...while organizationName (the denormalised column) is still populated on that same row — the two
        // are different fields and the TS select returns BOTH.
        Assert.Equal("Newco Pending", invitations[1].GetProperty("organizationName").GetString());

        // invitedBy is a required relation and always resolves.
        Assert.Equal("Rick", invitations[0].GetProperty("invitedBy").GetProperty("firstName").GetString());

        // The five columns invitationListSelect omits. `token` is the security-relevant one; the others
        // would each be a parity FAIL, since diff() walks the union of both key sets.
        Assert.DoesNotContain("token", body, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("organizationSlug", body, StringComparison.Ordinal);
        Assert.DoesNotContain("organizationPlan", body, StringComparison.Ordinal);
        Assert.DoesNotContain("invitedById", body, StringComparison.Ordinal);
        Assert.DoesNotContain("updatedAt", body, StringComparison.Ordinal);
    }

    /// <summary>
    /// The <c>search</c> filter is case-INSENSITIVE (Prisma <c>mode: 'insensitive'</c> → ILIKE) and matches
    /// a substring of the email. Asserted with an upper-cased needle so a plain <c>LIKE</c> would fail.
    /// </summary>
    [Fact]
    public async Task List_SearchIsCaseInsensitiveSubstringOnEmail()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ListPath}?search=GLOBEX", Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        Assert.Equal(1, json.RootElement.GetProperty("total").GetInt32());
        Assert.Equal("pending@globex.test", json.RootElement.GetProperty("invitations")[0].GetProperty("email").GetString());
    }

    /// <summary>
    /// A whitespace-only <c>search</c> is NO filter, not a filter on the empty string — reproducing
    /// <c>if (search?.trim())</c>. It must return the full unfiltered set.
    /// </summary>
    [Fact]
    public async Task List_WhitespaceSearchIsNoFilter()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ListPath}?search=%20%20", Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        Assert.Equal(5, json.RootElement.GetProperty("total").GetInt32());
    }

    /// <summary>The search value is TRIMMED before querying, so a padded needle still matches.</summary>
    [Fact]
    public async Task List_SearchIsTrimmedBeforeQuerying()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ListPath}?search=%20globex%20", Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        Assert.Equal(1, json.RootElement.GetProperty("total").GetInt32());
    }

    /// <summary>
    /// <c>total</c> is the UNPAGED count for the filter while <c>invitations</c> is the page — so a
    /// <c>limit=2</c> request returns 2 rows and a total of 5. Getting this backwards (returning the page
    /// length as the total) breaks every paginator and is invisible without an explicit assertion.
    /// </summary>
    [Fact]
    public async Task List_TotalIsUnpaged_WhilePageIsLimited()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ListPath}?limit=2", Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        Assert.Equal(5, json.RootElement.GetProperty("total").GetInt32());
        Assert.Equal(2, json.RootElement.GetProperty("invitations").GetArrayLength());
    }

    /// <summary>
    /// A <c>page</c> beyond the data returns an empty array and the real total. Zod puts no upper bound on
    /// <c>page</c>, so this also covers the offset arithmetic staying sane far past the row count.
    /// </summary>
    [Fact]
    public async Task List_PageBeyondData_IsEmptyWithRealTotal()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ListPath}?page=99", Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        Assert.Equal(5, json.RootElement.GetProperty("total").GetInt32());
        Assert.Equal(0, json.RootElement.GetProperty("invitations").GetArrayLength());
    }

    /// <summary>
    /// The inexpressible-offset boundary: <c>page * limit</c> exceeds <see cref="int.MaxValue"/>, which
    /// would overflow <c>Skip()</c> into a negative argument and throw. It must answer 200 with an empty
    /// page and the true total — the same answer Postgres gives TS for an OFFSET past the end.
    /// </summary>
    [Fact]
    public async Task List_InexpressibleOffset_IsEmptyPageNot500()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ListPath}?page=2000000000&limit=50", Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(5, json.RootElement.GetProperty("total").GetInt32());
        Assert.Equal(0, json.RootElement.GetProperty("invitations").GetArrayLength());
    }

    [Fact]
    public async Task List_FiltersByTypeAndStatus()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();
        var token = Mint(PlatformInvitationsReadFixture.PlatformOwnerSub);

        var typeResponse = await Get(client, $"{ListPath}?type=org_admin", token);
        Assert.Equal(HttpStatusCode.OK, typeResponse.StatusCode);
        using var byType = JsonDocument.Parse(await typeResponse.Content.ReadAsStringAsync());
        Assert.Equal(2, byType.RootElement.GetProperty("total").GetInt32());

        var statusResponse = await Get(client, $"{ListPath}?status=revoked", token);
        Assert.Equal(HttpStatusCode.OK, statusResponse.StatusCode);
        using var byStatus = JsonDocument.Parse(await statusResponse.Content.ReadAsStringAsync());
        Assert.Equal(1, byStatus.RootElement.GetProperty("total").GetInt32());
    }

    // ── the export ──────────────────────────────────────────────────────────────────────────────────
    /// <summary>
    /// The CSV envelope is <c>{ csv, count }</c> — NOT the audit-log export's <c>{ format, data, count }</c>.
    /// Copying that envelope would be the natural mistake and a parity FAIL on all three keys.
    /// </summary>
    [Fact]
    public async Task Export_EnvelopeIsCsvAndCount()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExportPath, Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var root = json.RootElement;

        Assert.Equal(5, root.GetProperty("count").GetInt32());
        Assert.NotNull(root.GetProperty("csv").GetString());
        Assert.False(root.TryGetProperty("format", out _), "the invitations export has no `format` key — that is the audit export's shape");
        Assert.False(root.TryGetProperty("data", out _), "the invitations export returns `csv`, not `data`");
    }

    /// <summary>
    /// The exact header and the exact hostile row, byte for byte.
    ///
    /// <para><b>The row asserts a DELIBERATELY REPRODUCED VULNERABILITY, and that is why it is spelled out
    /// rather than loosely matched.</b> <c>exportInvitationsCsv</c> hand-rolls its CSV and quotes only
    /// <c>organizationName</c>; it does NOT use <c>csvCell</c>/<c>CsvCell</c>, so a leading <c>=</c> is
    /// emitted RAW and executes when the file is opened in Excel or Sheets (CWE-1236). Reproducing it is the
    /// parity requirement — a C#-only hardening is invisible while the flag is dark and turns the parity
    /// diff from "is the port right" into "which stack is right". If someone hardens the C# side, THIS
    /// assertion fails, which is the intended forcing function: the fix belongs in both stacks in one
    /// change, and it is filed as its own issue.</para>
    /// </summary>
    [Fact]
    public async Task Export_CsvMatchesTsByteForByte_IncludingTheUnhardenedCells()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExportPath, Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var csv = json.RootElement.GetProperty("csv").GetString();
        Assert.NotNull(csv);

        var lines = csv!.Split('\n');
        Assert.Equal(6, lines.Length); // header + 5 rows
        Assert.Equal("Email,Tipo,Organizacion,Rol,Estado,Enviada,Expira,Aceptada", lines[0]);

        // created_at DESC ⇒ the revoked row is first. Every cell of it is load-bearing:
        //   organizationName `=1+1", Inc` → quoted, inner quote doubled, leading `=` NOT neutralised
        //   role_slug ''                  → "-", because TS uses `|| '-'` (falsy), not `?? '-'`
        //   sent_at / accepted_at NULL    → "-"
        //   expires_at                    → the UTC date part only
        Assert.Equal("revoked@acme.test,user,\"=1+1\"\", Inc\",-,revoked,-,2026-08-01,-", lines[1]);

        // The neutralising apostrophe CsvCell would have prepended must be absent. A wide region on purpose:
        // asserting over the whole CSV rather than one cell, so hardening ANY cell trips this.
        Assert.DoesNotContain("'=", csv, StringComparison.Ordinal);
        // ...and no cell other than Organizacion is quoted.
        Assert.Equal("orgless@new.test,org_admin,\"Newco Pending\",-,expired,2026-07-04,2026-07-11,-", lines[2]);
    }

    /// <summary>
    /// The export applies its <c>type</c>/<c>status</c> filters and <c>count</c> tracks the filtered row
    /// count, not the table's.
    /// </summary>
    [Fact]
    public async Task Export_AppliesFilters()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ExportPath}?status=accepted", Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());

        Assert.Equal(1, json.RootElement.GetProperty("count").GetInt32());
        Assert.Equal(2, json.RootElement.GetProperty("csv").GetString()!.Split('\n').Length);
    }

    /// <summary>
    /// <b>The export audit row is SKIPPED for an org-less platform owner, and that is TS parity, not a
    /// missing feature.</b> <c>logPlatformExport</c> resolves the row's org as
    /// <c>info.targetOrgId || ctx.user?.organizationId</c> then returns early when that is falsy;
    /// <c>exportInvitationsCsv</c> passes no <c>targetOrgId</c>, and a platform owner is normally org-less.
    /// So the correct number of <c>platform_export</c> rows after an owner export is ZERO. An
    /// unconditional write would additionally have thrown on <c>Guid.Parse("")</c>.
    /// </summary>
    [Fact]
    public async Task Export_ByOrglessOwner_WritesNoAuditRow()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        // A DELTA, not an absolute count: this container is shared across the collection and xUnit does not
        // order tests within a class, so `Assert.Equal(0, total)` would pass or fail depending on whether
        // Export_ByOwnerWithAnOrg_WritesOneAuditRow happened to run first.
        var before = await _fixture.CountAuditRowsAsync();

        var response = await Get(client, ExportPath, Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        Assert.Equal(before, await _fixture.CountAuditRowsAsync());
        Assert.Empty(await _fixture.GetExportAuditRowsForActorAsync(PlatformInvitationsReadFixture.PlatformOwnerId));
    }

    /// <summary>
    /// The OTHER branch of the resolve-or-skip — the one that actually writes. A platform owner who has an
    /// org row of their own resolves an <c>organizationId</c>, so TS's <c>logPlatformExport</c> writes, and
    /// so must this port.
    ///
    /// <para>Added after a coverage review noted that only the SKIP branch was tested. Without this, a
    /// throwing <c>Guid.Parse</c>, a wrong <c>entity</c> string or a malformed metadata object would ship
    /// green — the export would still 200, because <c>ISecurityEventWriter</c> is fail-soft and swallows
    /// exactly these faults. Fail-soft code needs a positive test precisely because it cannot fail loudly.
    /// </para>
    /// </summary>
    [Fact]
    public async Task Export_ByOwnerWithAnOrg_WritesOneAuditRow()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExportPath, Mint(PlatformInvitationsReadFixture.PlatformOwnerWithOrgSub));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);

        var rows = await _fixture.GetExportAuditRowsForActorAsync(PlatformInvitationsReadFixture.PlatformOwnerWithOrgId);
        var row = Assert.Single(rows);

        // The caller's OWN org, since exportInvitationsCsv passes no targetOrgId.
        Assert.Equal(PlatformInvitationsReadFixture.OrgA, row.OrganizationId);
        // TS: `entity: \`export:${info.resource}\`` — the prefix matters, it is what distinguishes an export
        // event from any other platform_export subject.
        Assert.Equal("export:invitations", row.Entity);
        Assert.NotNull(row.Metadata);
        // TS metadata is { resource, count, format } with format present only when supplied — it is here.
        // Postgres normalises jsonb with a space after the colon, so match on the pieces rather than a
        // hand-built substring of the whole object.
        Assert.Contains("\"resource\": \"invitations\"", row.Metadata, StringComparison.Ordinal);
        Assert.Contains("\"format\": \"csv\"", row.Metadata, StringComparison.Ordinal);
        Assert.Contains("\"count\": 5", row.Metadata, StringComparison.Ordinal);
    }
}
