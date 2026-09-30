using System.Net;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;
using Npgsql;
using Tims.Application.Email;
using Tims.IntegrationTests.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformInvitations;

/// <summary>Own container: seeds admin roles into Beta, which the platform invitation suites must not see.</summary>
public sealed class TenantInvitationFixture : IAsyncLifetime
{
    public const string SuperAdminSub = "sub-f8-super-admin";
    public const string HrAdminSub = "sub-f8-hr-admin";
    public const string RecruiterSub = "sub-f8-recruiter";
    public static readonly Guid AcmeInvitation = Guid.Parse("f8000000-0000-0000-0000-00000000000a");
    public static readonly Guid ExpiredSuperAdminInvitation = Guid.Parse("f8000000-0000-0000-0000-00000000000b");
    public static readonly Guid PendingRecruiterInvitation = Guid.Parse("f8000000-0000-0000-0000-00000000000c");
    public static readonly Guid GuardedSuperAdminInvitation = Guid.Parse("f8000000-0000-0000-0000-00000000000d");
    public OrganizationInvitationFixture Inner { get; } = new();
    public string ConnectionString => Inner.ConnectionString;

    public async Task InitializeAsync()
    {
        await Inner.InitializeAsync();
        await using var connection = new NpgsqlConnection(ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO roles(id,organization_id,name,slug,updated_at) VALUES
              ('f8000000-0000-0000-0000-0000000000a1','22222222-2222-2222-2222-222222222222','Super','super_admin',now()),
              ('f8000000-0000-0000-0000-0000000000a2','22222222-2222-2222-2222-222222222222','HR','hr_admin',now()),
              ('f8000000-0000-0000-0000-0000000000a3','22222222-2222-2222-2222-222222222222','Recruiter','recruiter',now());
            INSERT INTO permissions(id,module,action) VALUES ('f8000000-0000-0000-0000-0000000000b1','user','create')
              ON CONFLICT (module,action) DO NOTHING;
            INSERT INTO role_permissions(id,role_id,permission_id,scope)
              SELECT gen_random_uuid(), r.id, p.id, 'organization' FROM roles r, permissions p
              WHERE r.slug IN ('super_admin','hr_admin') AND r.organization_id='22222222-2222-2222-2222-222222222222'
                AND p.module='user' AND p.action='create';
            INSERT INTO users(id,organization_id,supabase_user_id,email,is_platform_owner,is_active) VALUES
              ('f8000000-0000-0000-0000-0000000000c1','22222222-2222-2222-2222-222222222222','sub-f8-super-admin','sa@beta.test',false,true),
              ('f8000000-0000-0000-0000-0000000000c2','22222222-2222-2222-2222-222222222222','sub-f8-hr-admin','hr@beta.test',false,true),
              ('f8000000-0000-0000-0000-0000000000c3','22222222-2222-2222-2222-222222222222','sub-f8-recruiter','rec@beta.test',false,true);
            INSERT INTO user_roles(id,user_id,role_id) VALUES
              (gen_random_uuid(),'f8000000-0000-0000-0000-0000000000c1','f8000000-0000-0000-0000-0000000000a1'),
              (gen_random_uuid(),'f8000000-0000-0000-0000-0000000000c2','f8000000-0000-0000-0000-0000000000a2'),
              (gen_random_uuid(),'f8000000-0000-0000-0000-0000000000c3','f8000000-0000-0000-0000-0000000000a3');
            INSERT INTO platform_invitations(id,email,type,organization_id,organization_name,role_slug,token,status,invited_by_id,expires_at,updated_at)
              VALUES ('f8000000-0000-0000-0000-00000000000a','acme-invitee@acme.test','user','11111111-1111-1111-1111-111111111111','Acme',
                'employee','f8-acme-token','pending','a1000000-0000-0000-0000-0000000000aa',now()+interval '7 days',now());
            INSERT INTO platform_invitations(id,email,type,organization_id,organization_name,role_slug,token,status,invited_by_id,expires_at,updated_at)
              VALUES
              ('f8000000-0000-0000-0000-00000000000b','expired-sa@beta.test','user','22222222-2222-2222-2222-222222222222','Beta',
                'super_admin','f8-expired-sa-token','expired','f8000000-0000-0000-0000-0000000000c1',now()-interval '1 day',now()-interval '8 days'),
              ('f8000000-0000-0000-0000-00000000000c','pending-rec@beta.test','user','22222222-2222-2222-2222-222222222222','Beta',
                'recruiter','f8-pending-rec-token','pending','f8000000-0000-0000-0000-0000000000c1',now()+interval '1 day',now()-interval '6 days'),
              ('f8000000-0000-0000-0000-00000000000d','guarded-sa@beta.test','user','22222222-2222-2222-2222-222222222222','Beta',
                'super_admin','f8-guarded-sa-token','pending','f8000000-0000-0000-0000-0000000000c1',now()+interval '1 day',now()-interval '6 days');
            """;
        await command.ExecuteNonQueryAsync();
    }

    public Task DisposeAsync() => Inner.DisposeAsync();
}

[CollectionDefinition("TenantInvitations")]
public sealed class TenantInvitationCollection : ICollectionFixture<TenantInvitationFixture>;

[Collection("TenantInvitations")]
public sealed class TenantInvitationEndpointTests(TenantInvitationFixture fixture)
{
    private const string Issuer = "https://test-project.supabase.co/auth/v1";
    private const string Audience = "authenticated";
    private static readonly RSA Rsa = RSA.Create(2048);
    private static readonly RsaSecurityKey Key = new(Rsa) { KeyId = "tenant-invitation-test" };

    [Fact]
    public async Task Flag_off_route_is_absent()
    {
        using var factory = Factory(new FakeSender(), enabled: false);
        var response = await Send(factory.CreateClient(), HttpMethod.Get, "/tenant-invitations", TenantInvitationFixture.HrAdminSub);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    [Theory]
    [InlineData(PlatformOrganizationsCreateFixture.OrgUserSub, HttpStatusCode.Forbidden)] // no role at all
    [InlineData(TenantInvitationFixture.RecruiterSub, HttpStatusCode.Forbidden)] // no user:create grant
    [InlineData(PlatformOrganizationsCreateFixture.PlatformOwnerSub, HttpStatusCode.Forbidden)] // platform console only
    [InlineData(null, HttpStatusCode.Unauthorized)]
    public async Task Callers_without_user_create_are_denied_and_nothing_is_written(string? sub, HttpStatusCode expected)
    {
        var sender = new FakeSender();
        using var factory = Factory(sender);
        var before = await Count("unauthorized@beta.test");
        var response = await Send(factory.CreateClient(), HttpMethod.Post, "/tenant-invitations", sub, Body("unauthorized@beta.test", "employee"));
        Assert.Equal(expected, response.StatusCode);
        Assert.Equal(before, await Count("unauthorized@beta.test")); Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Hr_admin_cannot_invite_super_admin_but_super_admin_can()
    {
        var sender = new FakeSender();
        using var factory = Factory(sender);
        var denied = await Send(factory.CreateClient(), HttpMethod.Post, "/tenant-invitations", TenantInvitationFixture.HrAdminSub, Body("escalate@beta.test", "super_admin"));
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.Equal(0, await Count("escalate@beta.test")); Assert.Equal(0, sender.Calls);

        var allowed = await Send(factory.CreateClient(), HttpMethod.Post, "/tenant-invitations", TenantInvitationFixture.SuperAdminSub, Body("second-sa@beta.test", "super_admin"));
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
        Assert.Equal(1, await Count("second-sa@beta.test"));
    }

    [Fact]
    public async Task Hr_admin_invites_into_own_org_sends_email_lists_and_rejects_duplicate()
    {
        var sender = new FakeSender();
        using var factory = Factory(sender);
        var client = factory.CreateClient();
        var response = await Send(client, HttpMethod.Post, "/tenant-invitations", TenantInvitationFixture.HrAdminSub, Body("New.Hire@beta.test", "recruiter"));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.Equal(PlatformOrganizationsCreateFixture.OtherOrg, json.RootElement.GetProperty("organizationId").GetGuid());
        Assert.Equal("accepted", json.RootElement.GetProperty("delivery").GetString());
        Assert.Equal(1, sender.Calls); Assert.Contains("/accept-invitation?token=", sender.Html);
        Assert.Equal("New.Hire@beta.test", sender.To);

        var list = await Send(client, HttpMethod.Get, "/tenant-invitations", TenantInvitationFixture.HrAdminSub);
        var body = await list.Content.ReadAsStringAsync();
        Assert.Contains("New.Hire@beta.test", body);
        Assert.DoesNotContain("acme-invitee@acme.test", body); // other tenant's row never listed
        Assert.DoesNotContain("token", body, StringComparison.OrdinalIgnoreCase);

        var duplicate = await Send(client, HttpMethod.Post, "/tenant-invitations", TenantInvitationFixture.HrAdminSub, Body("new.hire@beta.test", "employee"));
        Assert.Equal(HttpStatusCode.Conflict, duplicate.StatusCode); Assert.Equal(1, sender.Calls);
    }

    [Fact]
    public async Task Organization_id_in_body_is_rejected_not_honoured()
    {
        using var factory = Factory(new FakeSender());
        var body = JsonSerializer.Serialize(new { email = "cross@acme.test", roleSlug = "employee", organizationId = PlatformOrganizationsCreateFixture.HomeOrg });
        var response = await Send(factory.CreateClient(), HttpMethod.Post, "/tenant-invitations", TenantInvitationFixture.HrAdminSub, body);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Equal(0, await Count("cross@acme.test"));
    }

    [Fact]
    public async Task Cross_tenant_resend_and_revoke_are_not_found_and_leave_the_row_untouched()
    {
        var sender = new FakeSender();
        using var factory = Factory(sender);
        var client = factory.CreateClient();
        var id = TenantInvitationFixture.AcmeInvitation;
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/resend", TenantInvitationFixture.SuperAdminSub)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/revoke", TenantInvitationFixture.SuperAdminSub)).StatusCode);
        Assert.Equal("pending", await Status(id)); Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Own_invitation_resend_then_revoke()
    {
        var sender = new FakeSender();
        using var factory = Factory(sender);
        var client = factory.CreateClient();
        var created = await Send(client, HttpMethod.Post, "/tenant-invitations", TenantInvitationFixture.SuperAdminSub, Body("resend-revoke@beta.test", "employee"));
        using var json = JsonDocument.Parse(await created.Content.ReadAsStringAsync());
        var id = json.RootElement.GetProperty("id").GetGuid();
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/resend", TenantInvitationFixture.SuperAdminSub)).StatusCode);
        Assert.Equal(2, sender.Calls);
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/revoke", TenantInvitationFixture.HrAdminSub)).StatusCode);
        Assert.Equal("revoked", await Status(id));
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/resend", TenantInvitationFixture.SuperAdminSub)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/revoke", TenantInvitationFixture.SuperAdminSub)).StatusCode);
    }

    [Fact]
    public async Task Hr_admin_cannot_revive_an_expired_super_admin_invitation_but_super_admin_can()
    {
        var sender = new FakeSender();
        using var factory = Factory(sender);
        var client = factory.CreateClient();
        var id = TenantInvitationFixture.ExpiredSuperAdminInvitation;
        var expiresBefore = await ExpiresAt(id);

        var denied = await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/resend", TenantInvitationFixture.HrAdminSub);
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.Equal("expired", await Status(id)); Assert.Equal(expiresBefore, await ExpiresAt(id)); Assert.Equal(0, sender.Calls);
        Assert.Equal(1, await DenialAudits(id));

        // Positive control: the same invitation IS resendable by a caller who may grant super_admin.
        var allowed = await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/resend", TenantInvitationFixture.SuperAdminSub);
        Assert.Equal(HttpStatusCode.OK, allowed.StatusCode);
        Assert.Equal("sent", await Status(id)); Assert.True(await ExpiresAt(id) > DateTime.UtcNow.AddDays(6));
        Assert.Equal(1, sender.Calls); Assert.Equal("expired-sa@beta.test", sender.To);
    }

    [Fact]
    public async Task Hr_admin_resends_an_invitation_for_a_role_they_may_grant()
    {
        var sender = new FakeSender();
        using var factory = Factory(sender);
        var id = TenantInvitationFixture.PendingRecruiterInvitation;
        var response = await Send(factory.CreateClient(), HttpMethod.Post, $"/tenant-invitations/{id}/resend", TenantInvitationFixture.HrAdminSub);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("sent", await Status(id)); Assert.Equal(1, sender.Calls); Assert.Equal(0, await DenialAudits(id));
    }

    [Fact]
    public async Task Delivery_repository_rechecks_the_role_inside_its_own_statements()
    {
        // Defense in depth below the use case: an organization-bound delivery repository whose grantable set
        // excludes the stored role can neither read nor mark-sent the invitation, even with a valid snapshot.
        using var factory = Factory(new FakeSender());
        using var scope = factory.Services.CreateScope();
        var repository = scope.ServiceProvider.GetRequiredService<Tims.Application.PlatformInvitations.ITenantInvitationRepository>();
        var id = TenantInvitationFixture.GuardedSuperAdminInvitation;
        var org = PlatformOrganizationsCreateFixture.OtherOrg;
        var hrGrantable = Tims.Domain.Identity.InvitationGrantPolicy.GrantableRoles(["hr_admin"]);
        var saGrantable = Tims.Domain.Identity.InvitationGrantPolicy.GrantableRoles(["super_admin"]);

        Assert.Null(await repository.ForOrganization(org, hrGrantable).FindAsync(id, default));
        var snapshot = await repository.ForOrganization(org, saGrantable).FindAsync(id, default);
        Assert.NotNull(snapshot);
        var now = DateTime.UtcNow;
        Assert.False(await repository.ForOrganization(org, hrGrantable).MarkSentAsync(snapshot!, now, now.AddDays(7), default));
        Assert.Equal("pending", await Status(id));
        Assert.True(await repository.ForOrganization(org, saGrantable).MarkSentAsync(snapshot!, now, now.AddDays(7), default));
        Assert.Equal("sent", await Status(id));
    }

    [Fact]
    public async Task Role_list_is_limited_to_grantable_roles()
    {
        using var factory = Factory(new FakeSender());
        var response = await Send(factory.CreateClient(), HttpMethod.Get, "/tenant-invitations/roles", TenantInvitationFixture.HrAdminSub);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("\"hr_admin\"", body); Assert.Contains("\"employee\"", body);
        Assert.DoesNotContain("\"super_admin\"", body);
    }

    private async Task<long> Count(string email)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT count(*) FROM platform_invitations WHERE lower(email)=lower(@e)", connection);
        command.Parameters.AddWithValue("e", email);
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private async Task<string?> Status(Guid id)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT status::text FROM platform_invitations WHERE id=@id", connection);
        command.Parameters.AddWithValue("id", id);
        return (string?)await command.ExecuteScalarAsync();
    }

    private async Task<DateTime> ExpiresAt(Guid id)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("SELECT expires_at FROM platform_invitations WHERE id=@id", connection);
        command.Parameters.AddWithValue("id", id);
        return (DateTime)(await command.ExecuteScalarAsync())!;
    }

    private async Task<long> DenialAudits(Guid id)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            "SELECT count(*) FROM audit_logs WHERE action='user_invitation_denied' AND entity_id=@id AND metadata::text LIKE '%resend%'", connection);
        command.Parameters.AddWithValue("id", id.ToString());
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private WebApplicationFactory<Program> Factory(FakeSender sender, bool enabled = true) =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", fixture.ConnectionString);
            builder.UseSetting("Platform:TenantInvitationsEnabled", enabled.ToString());
            builder.UseSetting("Platform:SupabaseJwtIssuer", Issuer);
            builder.UseSetting("Platform:SupabaseJwtAudience", Audience);
            builder.UseSetting("Invitations:AppOrigin", "https://app.example.test");
            builder.ConfigureTestServices(services =>
            {
                services.AddSingleton<IEmailSender>(sender);
                services.PostConfigure<JwtBearerOptions>(JwtBearerDefaults.AuthenticationScheme, options =>
                {
                    options.RequireHttpsMetadata = false;
                    options.TokenValidationParameters.IssuerSigningKeys = [
                        JsonWebKeyConverter.ConvertFromRSASecurityKey(new RsaSecurityKey(Rsa.ExportParameters(false)) { KeyId = Key.KeyId })];
                });
            });
        });

    private static Task<HttpResponseMessage> Send(HttpClient client, HttpMethod method, string path, string? sub, string? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        if (body is not null) request.Content = new StringContent(body, System.Text.Encoding.UTF8, "application/json");
        if (sub is not null) request.Headers.Add("Authorization", "Bearer " + Mint(sub));
        return client.SendAsync(request);
    }

    private static string Body(string email, string role) => JsonSerializer.Serialize(new { email, roleSlug = role });

    private static string Mint(string sub) => new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
    {
        Issuer = Issuer,
        Audience = Audience,
        Subject = new ClaimsIdentity([new Claim("sub", sub)]),
        Expires = DateTime.UtcNow.AddMinutes(10),
        SigningCredentials = new SigningCredentials(Key, SecurityAlgorithms.RsaSha256),
    });

    private sealed class FakeSender : IEmailSender
    {
        public int Calls { get; private set; }
        public string Html { get; private set; } = "";
        public string To { get; private set; } = "";
        public Task<bool> SendEmailAsync(string to, string subject, string html, CancellationToken ct)
        { Calls++; Html = html; To = to; return Task.FromResult(true); }
    }
}
