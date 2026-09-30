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
    /// <summary>Holds user:create at UNIT scope only — a narrow grant the gate must refuse (org scope required).</summary>
    public const string UnitScopedSub = "sub-f8-unit-scoped";
    public static readonly Guid SuperAdminUser = Guid.Parse("f8000000-0000-0000-0000-0000000000c1");
    public static readonly Guid HrAdminUser = Guid.Parse("f8000000-0000-0000-0000-0000000000c2");
    /// <summary>Delivered one minute before the fixture ran: inside the resend cooldown.</summary>
    public static readonly Guid RecentlySentInvitation = Guid.Parse("f8000000-0000-0000-0000-00000000000e");
    /// <summary>A pending super_admin invitation reserved for the revoke-above-own-role pin.</summary>
    public static readonly Guid PendingSuperAdminForRevoke = Guid.Parse("f8000000-0000-0000-0000-00000000000f");
    /// <summary>Never sent; reserved for the repository-level cooldown guard test.</summary>
    public static readonly Guid CooldownGuardInvitation = Guid.Parse("f8000000-0000-0000-0000-000000000010");
    public static readonly Guid AcmeInvitation = Guid.Parse("f8000000-0000-0000-0000-00000000000a");
    public static readonly Guid ExpiredSuperAdminInvitation = Guid.Parse("f8000000-0000-0000-0000-00000000000b");
    public static readonly Guid PendingRecruiterInvitation = Guid.Parse("f8000000-0000-0000-0000-00000000000c");
    public static readonly Guid GuardedSuperAdminInvitation = Guid.Parse("f8000000-0000-0000-0000-00000000000d");
    /// <summary>Seeded paging rows in Beta: more than one max page, pairs tied on created_at, mixed effective states.</summary>
    public const int PagingRows = 130;
    public const int PagingActiveRows = 43; // n % 3 == 2 for n in 0..129
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
              ('f8000000-0000-0000-0000-0000000000a3','22222222-2222-2222-2222-222222222222','Recruiter','recruiter',now()),
              ('f8000000-0000-0000-0000-0000000000a4','22222222-2222-2222-2222-222222222222','HRBP','hrbp',now());
            INSERT INTO permissions(id,module,action) VALUES ('f8000000-0000-0000-0000-0000000000b1','user','create')
              ON CONFLICT (module,action) DO NOTHING;
            INSERT INTO role_permissions(id,role_id,permission_id,scope)
              SELECT gen_random_uuid(), r.id, p.id, 'organization' FROM roles r, permissions p
              WHERE r.slug IN ('super_admin','hr_admin') AND r.organization_id='22222222-2222-2222-2222-222222222222'
                AND p.module='user' AND p.action='create';
            INSERT INTO role_permissions(id,role_id,permission_id,scope)
              SELECT gen_random_uuid(), 'f8000000-0000-0000-0000-0000000000a4', p.id, 'unit' FROM permissions p
              WHERE p.module='user' AND p.action='create';
            INSERT INTO users(id,organization_id,supabase_user_id,email,is_platform_owner,is_active) VALUES
              ('f8000000-0000-0000-0000-0000000000c1','22222222-2222-2222-2222-222222222222','sub-f8-super-admin','sa@beta.test',false,true),
              ('f8000000-0000-0000-0000-0000000000c2','22222222-2222-2222-2222-222222222222','sub-f8-hr-admin','hr@beta.test',false,true),
              ('f8000000-0000-0000-0000-0000000000c3','22222222-2222-2222-2222-222222222222','sub-f8-recruiter','rec@beta.test',false,true),
              ('f8000000-0000-0000-0000-0000000000c4','22222222-2222-2222-2222-222222222222','sub-f8-unit-scoped','hrbp@beta.test',false,true);
            INSERT INTO user_roles(id,user_id,role_id) VALUES
              (gen_random_uuid(),'f8000000-0000-0000-0000-0000000000c1','f8000000-0000-0000-0000-0000000000a1'),
              (gen_random_uuid(),'f8000000-0000-0000-0000-0000000000c2','f8000000-0000-0000-0000-0000000000a2'),
              (gen_random_uuid(),'f8000000-0000-0000-0000-0000000000c3','f8000000-0000-0000-0000-0000000000a3'),
              (gen_random_uuid(),'f8000000-0000-0000-0000-0000000000c4','f8000000-0000-0000-0000-0000000000a4');
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
            INSERT INTO platform_invitations(id,email,type,organization_id,organization_name,role_slug,token,status,invited_by_id,expires_at,sent_at,updated_at)
              VALUES
              ('f8000000-0000-0000-0000-00000000000e','recently-sent@beta.test','user','22222222-2222-2222-2222-222222222222','Beta',
                'employee','f8-recent-token','sent','f8000000-0000-0000-0000-0000000000c1',now()+interval '7 days',
                (now() AT TIME ZONE 'UTC') - interval '1 minute',now()),
              ('f8000000-0000-0000-0000-00000000000f','revoke-sa@beta.test','user','22222222-2222-2222-2222-222222222222','Beta',
                'super_admin','f8-revoke-sa-token','pending','f8000000-0000-0000-0000-0000000000c1',now()+interval '7 days',NULL,now()),
              ('f8000000-0000-0000-0000-000000000010','cooldown-guard@beta.test','user','22222222-2222-2222-2222-222222222222','Beta',
                'employee','f8-cooldown-guard-token','pending','f8000000-0000-0000-0000-0000000000c1',now()+interval '7 days',NULL,now()-interval '1 day');
            -- Paging rows (all older than anything a test creates): n%3=0 stored expired, n%3=1 stored pending but
            -- past expires_at (EFFECTIVELY expired), n%3=2 sent and live. created_at repeats in pairs so the id
            -- tie-break is exercised on every page boundary.
            INSERT INTO platform_invitations(id,email,type,organization_id,organization_name,role_slug,token,status,invited_by_id,expires_at,created_at,updated_at)
              SELECT gen_random_uuid(), 'page-' || n || '@beta.test', 'user', '22222222-2222-2222-2222-222222222222', 'Beta', 'employee',
                     'f8-page-token-' || n,
                     (CASE n % 3 WHEN 0 THEN 'expired' WHEN 1 THEN 'pending' ELSE 'sent' END)::"InvitationStatus",
                     'f8000000-0000-0000-0000-0000000000c1',
                     CASE n % 3 WHEN 2 THEN now() + interval '5 days' ELSE now() - interval '1 day' END,
                     timestamp '2026-01-01 00:00:00' + (n / 2) * interval '1 second', now()
              FROM generate_series(0, 129) AS n;
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
        const string createDenial = "action='user_invitation_denied' AND entity_id IS NULL AND metadata->>'roleSlug'='super_admin' AND metadata->>'reason'='role_not_grantable'";
        var deniedBefore = await AuditCount(createDenial, TenantInvitationFixture.HrAdminUser);
        var denied = await Send(factory.CreateClient(), HttpMethod.Post, "/tenant-invitations", TenantInvitationFixture.HrAdminSub, Body("escalate@beta.test", "super_admin"));
        Assert.Equal(HttpStatusCode.Forbidden, denied.StatusCode);
        Assert.Equal(0, await Count("escalate@beta.test")); Assert.Equal(0, sender.Calls);
        Assert.Equal(deniedBefore + 1, await AuditCount(createDenial, TenantInvitationFixture.HrAdminUser));

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
        // Both refusals are audited against the CALLER's org, never the foreign row's org.
        Assert.Equal(1, await AuditCount($"action='user_invitation_revoke_refused' AND entity_id='{id}' AND metadata->>'outcome'='NotFound'",
            TenantInvitationFixture.SuperAdminUser, PlatformOrganizationsCreateFixture.OtherOrg));
        Assert.Equal(1, await AuditCount($"action='invitation_resend' AND entity_id='{id}' AND metadata->>'outcome'='NotFound'",
            TenantInvitationFixture.SuperAdminUser, PlatformOrganizationsCreateFixture.OtherOrg));
        Assert.Equal(0, await AuditCount($"entity_id='{id}' AND organization_id='{PlatformOrganizationsCreateFixture.HomeOrg}'"));
    }

    [Fact]
    public async Task Revoke_of_an_unknown_id_is_404_and_audited()
    {
        using var factory = Factory(new FakeSender());
        var id = Guid.NewGuid();
        var response = await Send(factory.CreateClient(), HttpMethod.Post, $"/tenant-invitations/{id}/revoke", TenantInvitationFixture.HrAdminSub);
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Equal(1, await AuditCount($"action='user_invitation_revoke_refused' AND entity_id='{id}' AND metadata->>'outcome'='NotFound' AND metadata->>'surface'='tenant'",
            TenantInvitationFixture.HrAdminUser, PlatformOrganizationsCreateFixture.OtherOrg));
    }

    [Fact]
    public async Task Hr_admin_may_revoke_a_pending_super_admin_invitation_by_design()
    {
        // Documented, intentional asymmetry: create/resend are grant-policy gated, revoke is NOT — removing a pending
        // grant can never escalate anyone. Pin it so a future "consistency" change is a deliberate decision.
        using var factory = Factory(new FakeSender());
        var id = TenantInvitationFixture.PendingSuperAdminForRevoke;
        var response = await Send(factory.CreateClient(), HttpMethod.Post, $"/tenant-invitations/{id}/revoke", TenantInvitationFixture.HrAdminSub);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("revoked", await Status(id));
        Assert.Equal(1, await AuditCount($"action='user_invitation_revoked' AND entity_id='{id}' AND metadata->>'previousStatus'='pending'",
            TenantInvitationFixture.HrAdminUser, PlatformOrganizationsCreateFixture.OtherOrg));
    }

    [Fact]
    public async Task Resend_inside_the_cooldown_is_429_sends_nothing_writes_nothing_and_is_audited()
    {
        var sender = new FakeSender();
        using var factory = Factory(sender);
        var id = TenantInvitationFixture.RecentlySentInvitation;
        var before = await Row(id);
        var response = await Send(factory.CreateClient(), HttpMethod.Post, $"/tenant-invitations/{id}/resend", TenantInvitationFixture.HrAdminSub);
        Assert.Equal((HttpStatusCode)429, response.StatusCode);
        Assert.True(response.Headers.RetryAfter?.Delta is { } delta && delta > TimeSpan.Zero && delta <= TimeSpan.FromMinutes(5));
        Assert.Equal(0, sender.Calls);
        Assert.Equal(before, await Row(id)); // status, sent_at, expires_at and updated_at all untouched
        Assert.Equal(1, await AuditCount($"action='invitation_resend' AND entity_id='{id}' AND metadata->>'outcome'='Cooldown'",
            TenantInvitationFixture.HrAdminUser, PlatformOrganizationsCreateFixture.OtherOrg));
    }

    [Fact]
    public async Task Mark_sent_guard_refuses_a_delivery_inside_the_cooldown_even_with_a_valid_snapshot()
    {
        // The in-UPDATE half of the cooldown: a request that passed the use case's pre-send check (e.g. two concurrent
        // clicks) cannot record a second delivery inside the window. sent_at is moved WITHOUT touching updated_at, so
        // the optimistic-concurrency guard still matches and the cooldown predicate is the only thing that can refuse.
        using var factory = Factory(new FakeSender());
        using var scope = factory.Services.CreateScope();
        var repository = scope.ServiceProvider.GetRequiredService<Tims.Application.PlatformInvitations.ITenantInvitationRepository>();
        var id = TenantInvitationFixture.CooldownGuardInvitation;
        var delivery = repository.ForOrganization(PlatformOrganizationsCreateFixture.OtherOrg,
            Tims.Domain.Identity.InvitationGrantPolicy.GrantableRoles(["hr_admin"]));
        var snapshot = await delivery.FindAsync(id, default);
        Assert.NotNull(snapshot);
        var now = DateTime.UtcNow;

        await Execute("UPDATE platform_invitations SET sent_at = (now() AT TIME ZONE 'UTC') - interval '2 minutes' WHERE id=@id", id);
        Assert.False(await delivery.MarkSentAsync(snapshot!, now, now.AddDays(7), default));
        Assert.Equal("pending", await Status(id));

        // Positive control with the SAME snapshot: once the last delivery is outside the window, the write lands.
        await Execute("UPDATE platform_invitations SET sent_at = (now() AT TIME ZONE 'UTC') - interval '6 minutes' WHERE id=@id", id);
        Assert.True(await delivery.MarkSentAsync(snapshot!, now, now.AddDays(7), default));
        Assert.Equal("sent", await Status(id));
    }

    [Fact]
    public async Task Impersonated_mutation_is_403_and_writes_nothing_while_reads_still_resolve()
    {
        var sender = new FakeSender();
        var secret = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32));
        await using var factory = Factory(sender).WithWebHostBuilder(b => b.UseSetting("Platform:ImpersonationSecret", secret));
        var cookie = Tims.Domain.Identity.ImpersonationCookie.SignImpersonationToken(secret, PlatformOrganizationsCreateFixture.Actor.ToString(),
            TenantInvitationFixture.HrAdminUser.ToString(), DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        using var client = factory.CreateClient();
        client.DefaultRequestHeaders.Add("Cookie", $"{Tims.Domain.Identity.ImpersonationCookie.CookieName}={cookie}");
        const string invitationAudits = "action LIKE 'user_invitation%' OR action = 'invitation_resend'";
        var auditsBefore = await AuditCount(invitationAudits, PlatformOrganizationsCreateFixture.Actor);

        // Positive control: the impersonation resolved to the hr_admin target (a read is allowed), so the 403 below
        // is the impersonated-write refusal, not a resolution failure.
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Get, "/tenant-invitations?limit=1", PlatformOrganizationsCreateFixture.PlatformOwnerSub)).StatusCode);
        var response = await Send(client, HttpMethod.Post, "/tenant-invitations", PlatformOrganizationsCreateFixture.PlatformOwnerSub, Body("impersonated@beta.test", "employee"));
        Assert.Equal(HttpStatusCode.Forbidden, response.StatusCode);
        Assert.Equal(0, await Count("impersonated@beta.test")); Assert.Equal(0, sender.Calls);
        // No invitation row, email, or invitation audit attributed to the impersonating owner.
        Assert.Equal(auditsBefore, await AuditCount(invitationAudits, PlatformOrganizationsCreateFixture.Actor));
    }

    [Fact]
    public async Task Unit_scoped_user_create_grant_is_refused_on_every_route_and_writes_nothing()
    {
        var sender = new FakeSender();
        using var factory = Factory(sender);
        var client = factory.CreateClient();
        var sub = TenantInvitationFixture.UnitScopedSub;
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Post, "/tenant-invitations", sub, Body("unit-scoped@beta.test", "employee"))).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Get, "/tenant-invitations", sub)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Get, "/tenant-invitations/roles", sub)).StatusCode);
        var id = TenantInvitationFixture.PendingRecruiterInvitation;
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/revoke", sub)).StatusCode);
        Assert.Equal(0, await Count("unit-scoped@beta.test")); Assert.Equal(0, sender.Calls);
        Assert.NotEqual("revoked", await Status(id));
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
        var sa = TenantInvitationFixture.SuperAdminUser; var beta = PlatformOrganizationsCreateFixture.OtherOrg;
        Assert.Equal(1, await AuditCount($"action='user_invitation_created' AND entity_id='{id}'", sa, beta));
        Assert.Equal(1, await AuditCount($"action='user_invitation_delivery' AND entity_id='{id}' AND metadata->>'outcome'='accepted' AND metadata->>'surface'='tenant'", sa, beta));

        // The initial delivery starts the cooldown: an immediate resend is refused and sends nothing.
        Assert.Equal((HttpStatusCode)429, (await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/resend", TenantInvitationFixture.SuperAdminSub)).StatusCode);
        Assert.Equal(1, sender.Calls);
        await Execute("UPDATE platform_invitations SET sent_at = sent_at - interval '6 minutes' WHERE id=@id", id);

        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/resend", TenantInvitationFixture.SuperAdminSub)).StatusCode);
        Assert.Equal(2, sender.Calls);
        Assert.Equal(1, await AuditCount($"action='invitation_resend' AND entity_id='{id}' AND metadata->>'outcome'='Sent' AND metadata->>'surface'='tenant'", sa, beta));
        Assert.Equal(HttpStatusCode.OK, (await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/revoke", TenantInvitationFixture.HrAdminSub)).StatusCode);
        Assert.Equal("revoked", await Status(id));
        Assert.Equal(1, await AuditCount($"action='user_invitation_revoked' AND entity_id='{id}'", TenantInvitationFixture.HrAdminUser, beta));
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/resend", TenantInvitationFixture.SuperAdminSub)).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, HttpMethod.Post, $"/tenant-invitations/{id}/revoke", TenantInvitationFixture.SuperAdminSub)).StatusCode);
        Assert.Equal(1, await AuditCount($"action='user_invitation_revoke_refused' AND entity_id='{id}' AND metadata->>'outcome'='InvalidStatus'", sa, beta));
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
    public async Task List_pages_through_every_row_beyond_the_max_page_without_gaps_or_repeats()
    {
        using var factory = Factory(new FakeSender());
        var client = factory.CreateClient();
        var ids = new List<Guid>(); var emails = new List<string>(); var pages = 0;
        string? cursor = null;
        (DateTime CreatedAt, Guid Id)? previous = null;
        var ties = 0;
        do
        {
            var path = "/tenant-invitations?status=all&limit=100" + (cursor is null ? "" : "&cursor=" + cursor);
            var response = await Send(client, HttpMethod.Get, path, TenantInvitationFixture.HrAdminSub);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var rows = json.RootElement.GetProperty("invitations").EnumerateArray().ToList();
            Assert.InRange(rows.Count, 1, 100);
            foreach (var row in rows)
            {
                var key = (row.GetProperty("createdAt").GetDateTime(), row.GetProperty("id").GetGuid());
                // Strictly descending on (createdAt, id) across page boundaries too. Ties on createdAt (seeded in
                // pairs) must be broken by id DESC in Postgres's uuid order, which is byte order — i.e. ordinal
                // order of the canonical lowercase "D" string, NOT System.Guid.CompareTo.
                if (previous is { } p)
                {
                    Assert.True(key.Item1 <= p.CreatedAt);
                    if (key.Item1 == p.CreatedAt)
                    {
                        Assert.True(string.CompareOrdinal(key.Item2.ToString("D"), p.Id.ToString("D")) < 0,
                            $"tie at {key.Item1:O} not ordered by id DESC: {p.Id} then {key.Item2}");
                        ties++;
                    }
                }
                previous = key;
                ids.Add(key.Item2); emails.Add(row.GetProperty("email").GetString()!);
            }
            var next = json.RootElement.GetProperty("nextCursor");
            cursor = next.ValueKind == JsonValueKind.Null ? null : next.GetString();
            if (cursor is not null) Assert.Equal(rows[^1].GetProperty("id").GetGuid(), Guid.Parse(cursor));
            pages++;
        }
        while (cursor is not null && pages < 10);

        Assert.Null(cursor);
        Assert.True(pages >= 2);
        Assert.Equal(ids.Count, ids.Distinct().Count()); // no row served twice
        Assert.Equal(TenantInvitationFixture.PagingRows, emails.Count(e => e.StartsWith("page-", StringComparison.Ordinal)));
        Assert.Equal(await OpenRowCount(), (long)ids.Count); // and none skipped
        Assert.True(ties >= TenantInvitationFixture.PagingRows / 2 - 1); // the tie-break check actually ran
    }

    [Fact]
    public async Task Status_filter_uses_effective_expiry()
    {
        using var factory = Factory(new FakeSender());
        var client = factory.CreateClient();
        var active = await ListAll(client, "active");
        var expired = await ListAll(client, "expired");
        Assert.All(active, row => Assert.Contains(row.Status, new[] { "pending", "sent" }));
        Assert.All(active, row => Assert.True(row.ExpiresAt > DateTime.UtcNow));
        Assert.All(expired, row => Assert.Equal("expired", row.Status)); // stored pending past expiry reports expired
        Assert.Equal(TenantInvitationFixture.PagingActiveRows, active.Count(r => r.Email.StartsWith("page-", StringComparison.Ordinal)));
        Assert.Equal(TenantInvitationFixture.PagingRows - TenantInvitationFixture.PagingActiveRows,
            expired.Count(r => r.Email.StartsWith("page-", StringComparison.Ordinal)));
        Assert.Empty(active.Select(r => r.Id).Intersect(expired.Select(r => r.Id)));
    }

    [Fact]
    public async Task Foreign_or_unknown_cursor_yields_an_empty_page_not_another_orgs_rows()
    {
        using var factory = Factory(new FakeSender());
        var client = factory.CreateClient();
        foreach (var cursor in new[] { TenantInvitationFixture.AcmeInvitation, Guid.NewGuid() })
        {
            var response = await Send(client, HttpMethod.Get, $"/tenant-invitations?cursor={cursor}", TenantInvitationFixture.HrAdminSub);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            var body = await response.Content.ReadAsStringAsync();
            Assert.Equal("{\"invitations\":[],\"nextCursor\":null}", body);
        }
    }

    [Theory]
    [InlineData("?limit=0")]
    [InlineData("?limit=101")]
    [InlineData("?limit=abc")]
    [InlineData("?status=pending")]
    [InlineData("?cursor=not-a-guid")]
    public async Task Invalid_list_query_is_400_for_a_granted_caller_but_403_for_an_ungranted_one(string query)
    {
        using var factory = Factory(new FakeSender());
        var client = factory.CreateClient();
        Assert.Equal(HttpStatusCode.BadRequest, (await Send(client, HttpMethod.Get, "/tenant-invitations" + query, TenantInvitationFixture.HrAdminSub)).StatusCode);
        Assert.Equal(HttpStatusCode.Forbidden, (await Send(client, HttpMethod.Get, "/tenant-invitations" + query, TenantInvitationFixture.RecruiterSub)).StatusCode);
    }

    private sealed record ListedRow(Guid Id, string Email, string Status, DateTime ExpiresAt);

    private static async Task<List<ListedRow>> ListAll(HttpClient client, string status)
    {
        var all = new List<ListedRow>();
        string? cursor = null;
        for (var pages = 0; pages < 10; pages++)
        {
            var response = await Send(client, HttpMethod.Get,
                $"/tenant-invitations?status={status}&limit=40" + (cursor is null ? "" : "&cursor=" + cursor), TenantInvitationFixture.HrAdminSub);
            Assert.Equal(HttpStatusCode.OK, response.StatusCode);
            using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            all.AddRange(json.RootElement.GetProperty("invitations").EnumerateArray().Select(row => new ListedRow(
                row.GetProperty("id").GetGuid(), row.GetProperty("email").GetString()!, row.GetProperty("status").GetString()!,
                row.GetProperty("expiresAt").GetDateTime().ToUniversalTime())));
            var next = json.RootElement.GetProperty("nextCursor");
            if (next.ValueKind == JsonValueKind.Null) return all;
            cursor = next.GetString();
        }
        throw new InvalidOperationException("pagination did not terminate");
    }

    private async Task<long> OpenRowCount()
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand("""
            SELECT count(*) FROM platform_invitations
            WHERE organization_id='22222222-2222-2222-2222-222222222222' AND type::text='user'
              AND status::text IN ('pending','sent','expired')
            """, connection);
        return (long)(await command.ExecuteScalarAsync())!;
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

    /// <summary>audit_logs rows matching <paramref name="where"/> (test-authored SQL), optionally for one actor and org.</summary>
    private async Task<long> AuditCount(string where, Guid? actor = null, Guid? organization = null)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            $"SELECT count(*) FROM audit_logs WHERE ({where}) AND (@actor::uuid IS NULL OR actor_id=@actor) AND (@org::uuid IS NULL OR organization_id=@org)",
            connection);
        command.Parameters.Add(new NpgsqlParameter("actor", NpgsqlTypes.NpgsqlDbType.Uuid) { Value = actor is { } a ? a : DBNull.Value });
        command.Parameters.Add(new NpgsqlParameter("org", NpgsqlTypes.NpgsqlDbType.Uuid) { Value = organization is { } o ? o : DBNull.Value });
        return (long)(await command.ExecuteScalarAsync())!;
    }

    private async Task<string> Row(Guid id)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            "SELECT concat_ws('|', status::text, sent_at::text, expires_at::text, updated_at::text) FROM platform_invitations WHERE id=@id", connection);
        command.Parameters.AddWithValue("id", id);
        return (string)(await command.ExecuteScalarAsync())!;
    }

    private async Task Execute(string sql, Guid id)
    {
        await using var connection = new NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(sql, connection);
        command.Parameters.AddWithValue("id", id);
        Assert.Equal(1, await command.ExecuteNonQueryAsync());
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
