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
    ///
    /// <para><b>The two InlineData cases are NOT redundant — they exercise different machinery, and only
    /// the second one ever failed.</b> `?limit=9999` BINDS successfully and is rejected by the handler's
    /// validation, so it passed even when the ordering was broken. `?page=abc` cannot bind to an `int` at
    /// all, and Minimal-API binding runs BEFORE the handler delegate — so while `page`/`limit` were declared
    /// as `int`, this returned 400 for a caller who is not allowed to know the endpoint exists. An
    /// adversarial review proved that against the real host. The fix was to bind both as `string?` and parse
    /// after the gate; this case is the regression test for it, and a test using only bind-able values reads
    /// as covering the invariant while leaving it untested.</para>
    /// </summary>
    [Theory]
    [InlineData("?limit=9999")]      // binds, fails validation — passed even when the ordering was broken
    [InlineData("?page=abc")]        // cannot bind — this is the case that was returning 400
    [InlineData("?limit=abc")]
    [InlineData("?page=99999999999999999999")] // overflows int — also a bind failure
    public async Task OrdinaryOrgUser_WithInvalidInput_Is403_Not400(string queryString)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ListPath}{queryString}", Mint(PlatformInvitationsReadFixture.OrgUserSub));

        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
    }

    /// <summary>
    /// The same unbindable inputs, ANONYMOUS, must still be 401 — the authorization middleware precedes
    /// binding, so this half was already correct and must stay correct after the string-binding change.
    /// </summary>
    [Theory]
    [InlineData("?page=abc")]
    [InlineData("?limit=abc")]
    public async Task Anonymous_WithUnbindableInput_Is401(string queryString)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await client.GetAsync($"{ListPath}{queryString}");

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    /// <summary>
    /// As an OWNER the same unbindable values must still be 400 — the fix moved WHEN the rejection happens,
    /// not WHETHER it happens. Without this, binding them as `string?` could have silently started accepting
    /// garbage (e.g. falling back to the default page) and no test would have noticed.
    /// </summary>
    [Theory]
    [InlineData("?page=abc")]
    [InlineData("?limit=abc")]
    [InlineData("?page=1.5")]
    [InlineData("?page=%20")]
    [InlineData("?page=99999999999999999999")]
    public async Task Owner_WithUnbindableInput_Is400(string queryString)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ListPath}{queryString}", Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
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

    /// <summary>
    /// The OFFSET is <c>page * limit</c>, and nothing above proves the MULTIPLIER.
    /// <c>List_TotalIsUnpaged_WhilePageIsLimited</c> uses <c>page=0</c> (offset 0 either way) and
    /// <c>List_PageBeyondData_IsEmptyWithRealTotal</c> uses <c>page=99</c> over 5 rows (both
    /// <c>Skip(1980)</c> and a buggy <c>Skip(99)</c> return nothing). So the classic
    /// <c>Skip((int)query.Page)</c> off-by-multiplier shipped green. This is the case that catches it:
    /// created_at DESC is revoked / orgless / pending / accepted / sent, so page 1 at limit 2 must be the
    /// THIRD and FOURTH rows.
    /// </summary>
    [Fact]
    public async Task List_PaginationOffsetIsPageTimesLimit()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ListPath}?page=1&limit=2", Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(5, json.RootElement.GetProperty("total").GetInt32());
        var rows = json.RootElement.GetProperty("invitations");
        Assert.Equal(2, rows.GetArrayLength());
        Assert.Equal("pending@globex.test", rows[0].GetProperty("email").GetString());
        Assert.Equal("accepted@acme.test", rows[1].GetProperty("email").GetString());
    }

    /// <summary>
    /// Two filters at once must AND, not OR, and must not discard one another. Every filter test above sends
    /// exactly ONE filter per request — including <c>List_FiltersByTypeAndStatus</c>, whose name suggests
    /// otherwise — so a composition bug (a <c>source.Where(...)</c> whose result is dropped, or predicates
    /// OR'd) satisfied all of them. <c>search</c> is email-only, matching TS's
    /// <c>email: { contains, mode: 'insensitive' }</c>.
    /// </summary>
    [Theory]
    [InlineData("?type=user&status=revoked", 1)]     // only revoked@acme.test is both
    [InlineData("?type=org_admin&status=revoked", 0)] // AND ⇒ empty; OR would give 3
    [InlineData("?search=acme&type=user", 2)]         // accepted@acme.test + revoked@acme.test
    [InlineData("?search=acme&status=sent", 1)]       // sent@acme.test
    public async Task List_CombinedFilters_AreAnded(string queryString, int expectedTotal)
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ListPath}{queryString}", Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(expectedTotal, json.RootElement.GetProperty("total").GetInt32());
        Assert.Equal(expectedTotal, json.RootElement.GetProperty("invitations").GetArrayLength());
    }

    /// <summary>
    /// A filter that matches nothing must answer <c>total: 0</c> with an EMPTY array — not a 404, not a
    /// null. Nothing else drives the list to zero rows: the page-beyond-data cases keep a non-zero total.
    /// </summary>
    [Fact]
    public async Task List_NoMatches_IsEmptyArrayWithZeroTotal()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ListPath}?search=zzzznomatch", Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(0, json.RootElement.GetProperty("total").GetInt32());
        Assert.Equal(0, json.RootElement.GetProperty("invitations").GetArrayLength());
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
    /// <para><b>This assertion was the inverse of itself until 2026-08-12.</b> It used to pin a DELIBERATELY
    /// REPRODUCED vulnerability: <c>exportInvitationsCsv</c> hand-rolled its CSV and quoted only
    /// <c>organizationName</c>, so a leading <c>=</c> was emitted RAW and executed when the file was opened
    /// in Excel or Sheets (CWE-1236). Reproducing it was the parity requirement, and this test was the
    /// forcing function that made a C#-only hardening fail. The fix then landed in BOTH stacks in one commit
    /// (<c>invitations.ts</c> imports <c>csvRow</c>; <c>BuildCsv</c> calls <c>CsvCell.Row</c>), so the
    /// assertion now pins the HARDENED output. Byte-parity is preserved because both sides changed
    /// together.</para>
    /// </summary>
    [Fact]
    public async Task Export_CsvMatchesTsByteForByte_WithEveryCellHardened()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, ExportPath, Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        var csv = json.RootElement.GetProperty("csv").GetString();
        Assert.NotNull(csv);

        var lines = csv!.Split('\n');
        Assert.Equal(6, lines.Length); // header + 5 rows
        Assert.Equal(
            "\"Email\",\"Tipo\",\"Organizacion\",\"Rol\",\"Estado\",\"Enviada\",\"Expira\",\"Aceptada\"",
            lines[0]);

        // created_at DESC ⇒ the revoked row is first. Every cell of it is load-bearing:
        //   organizationName `=1+1", Inc` → quoted, inner quote doubled, leading `=` NEUTRALISED with `'`
        //   role_slug ''                  → `-`, because TS uses `|| '-'` (falsy), not `?? '-'`
        //   sent_at / accepted_at NULL    → `-`
        //   expires_at                    → the UTC date part only
        // …and every `-` placeholder then emits as `'-`, because `-` is ITSELF one of csvCell's
        // formula-trigger characters. Verified against the real TS module rather than inferred:
        // `csvRow(['-'])` returns `"'-"`. Both stacks agree, and it is a visible change to the file.
        Assert.Equal(
            "\"revoked@acme.test\",\"user\",\"'=1+1\"\", Inc\",\"'-\",\"revoked\",\"'-\",\"2026-08-01\",\"'-\"",
            lines[1]);

        // No formula trigger may survive unneutralised anywhere in the payload. A wide region on purpose:
        // asserting over the whole CSV rather than one cell, so un-hardening ANY cell trips this.
        Assert.DoesNotContain(",=", csv, StringComparison.Ordinal);
        // ...and EVERY cell is quoted now, not just Organizacion.
        Assert.Equal(
            "\"orgless@new.test\",\"org_admin\",\"Newco Pending\",\"'-\",\"expired\",\"2026-07-04\",\"2026-07-11\",\"'-\"",
            lines[2]);
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

        var request = new HttpRequestMessage(HttpMethod.Get, ExportPath);
        request.Headers.Authorization =
            new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", Mint(PlatformInvitationsReadFixture.PlatformOwnerWithOrgSub));
        request.Headers.TryAddWithoutValidation("User-Agent", "slice22-audit-probe/1.0");
        // ClientIpFor derives ONLY from x-real-ip / x-forwarded-for (HttpContextClientIp.cs:23-25) — it never
        // reads RemoteIpAddress — so under TestServer a request without these headers stores a NULL ip, which
        // is correct behaviour rather than a defect. Sending the header is what exercises the real path.
        request.Headers.TryAddWithoutValidation("x-forwarded-for", "203.0.113.7");
        var response = await client.SendAsync(request);
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
        // TS writes ipAddress AND userAgent too (security-audit.ts:180-181). Unasserted, a null-returning
        // ClientIpFor() or a mis-read header is swallowed by the fail-soft writer and ships green.
        Assert.Equal("slice22-audit-probe/1.0", row.UserAgent);
        Assert.Equal("203.0.113.7", row.IpAddress);
    }

    /// <summary>
    /// An export matching nothing must still be a 200 whose csv is the header ALONE — no trailing newline,
    /// no empty body, no "no rows" line. TS builds it as <c>[header, ...[]].join('\n')</c>.
    /// <c>BuildCsv_emits_only_the_header_for_no_rows</c> covers the pure function; nothing covered the
    /// endpoint, where the count and the envelope are also at stake.
    /// </summary>
    [Fact]
    public async Task Export_NoMatches_IsHeaderOnlyWithZeroCount()
    {
        await using var factory = EnabledFactory();
        using var client = factory.CreateClient();

        var response = await Get(client, $"{ExportPath}?status=accepted&type=org_admin", Mint(PlatformInvitationsReadFixture.PlatformOwnerSub));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(0, json.RootElement.GetProperty("count").GetInt32());
        Assert.Equal(
            "\"Email\",\"Tipo\",\"Organizacion\",\"Rol\",\"Estado\",\"Enviada\",\"Expira\",\"Aceptada\"",
            json.RootElement.GetProperty("csv").GetString());
    }
}
