using Tims.Application.Email;
using Tims.Application.PlatformInvitations;
using Tims.Domain.Identity;

namespace Tims.UnitTests.PlatformInvitations;

public sealed class TenantInvitationsUseCaseTests
{
    private static readonly Guid Org = Guid.NewGuid();
    private static readonly Uri Origin = new("https://app.example.test");

    [Fact]
    public void Super_admin_can_grant_every_staff_role()
    {
        Assert.Equal(RoleSlugs.AssignableStaffRoles, InvitationGrantPolicy.GrantableRoles(["super_admin"]));
    }

    [Fact]
    public void Hr_admin_can_grant_everything_except_super_admin()
    {
        var roles = InvitationGrantPolicy.GrantableRoles(["hr_admin"]);
        Assert.DoesNotContain("super_admin", roles);
        Assert.Equal(["hr_admin", "hrbp", "recruiter", "leader", "committee", "employee"], roles);
    }

    [Fact]
    public void Other_callers_grant_only_their_own_roles_plus_employee_and_never_non_staff()
    {
        Assert.Equal(["recruiter", "employee"], InvitationGrantPolicy.GrantableRoles(["recruiter", "external", "candidate", "platform_owner"]));
        Assert.Equal(["employee"], InvitationGrantPolicy.GrantableRoles([]));
        Assert.False(InvitationGrantPolicy.CanGrant(["recruiter"], "hr_admin"));
        Assert.False(InvitationGrantPolicy.CanGrant(["super_admin"], "external"));
        Assert.False(InvitationGrantPolicy.CanGrant(["super_admin"], "SUPER_ADMIN"));
    }

    [Theory]
    [InlineData("hr_admin", "super_admin")]
    [InlineData("recruiter", "hr_admin")]
    [InlineData("leader", "recruiter")]
    public async Task Privilege_escalation_is_refused_before_any_write_or_email(string caller, string requested)
    {
        var create = new CreateRepo(); var sender = new Sender();
        var result = await Case(create, new TenantRepo(), sender).CreateAsync(Org, [caller], "new@example.test", requested, Guid.NewGuid(), Origin, default);
        Assert.Equal(TenantInvitationCreateOutcome.RoleNotGrantable, result.Outcome);
        Assert.Equal(0, create.Creates); Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Allowed_invitation_uses_callers_org_unique_path_and_org_bound_delivery()
    {
        var create = new CreateRepo(); var tenant = new TenantRepo(); var sender = new Sender();
        var result = await Case(create, tenant, sender).CreateAsync(Org, ["hr_admin"], "new@example.test", "recruiter", Guid.NewGuid(), Origin, default);
        Assert.Equal(TenantInvitationCreateOutcome.Created, result.Outcome);
        Assert.Equal("accepted", result.Response!.Delivery);
        Assert.Equal(Org, create.LastInput!.OrganizationId); Assert.True(create.LastUnique);
        Assert.Equal(1, sender.Calls); Assert.Equal([Org], tenant.BoundOrganizations);
        Assert.Equal(InvitationGrantPolicy.GrantableRoles(["hr_admin"]), tenant.BoundGrantableRoles);
    }

    [Theory]
    [InlineData(UserInvitationCreateOutcome.Duplicate, TenantInvitationCreateOutcome.Duplicate)]
    [InlineData(UserInvitationCreateOutcome.RoleUnavailable, TenantInvitationCreateOutcome.RoleUnavailable)]
    [InlineData(UserInvitationCreateOutcome.OrganizationUnavailable, TenantInvitationCreateOutcome.OrganizationUnavailable)]
    public async Task Rejections_map_without_sending(UserInvitationCreateOutcome repoOutcome, TenantInvitationCreateOutcome expected)
    {
        var create = new CreateRepo { Outcome = repoOutcome }; var sender = new Sender();
        var result = await Case(create, new TenantRepo(), sender).CreateAsync(Org, ["super_admin"], "new@example.test", "employee", Guid.NewGuid(), Origin, default);
        Assert.Equal(expected, result.Outcome); Assert.Equal(0, sender.Calls);
    }

    [Fact]
    public async Task Invalid_email_is_rejected_without_repository()
    {
        var create = new CreateRepo();
        var result = await Case(create, new TenantRepo(), new Sender()).CreateAsync(Org, ["super_admin"], "not-an-email", "employee", Guid.NewGuid(), Origin, default);
        Assert.Equal(TenantInvitationCreateOutcome.Invalid, result.Outcome); Assert.Equal(0, create.Creates);
    }

    [Fact]
    public async Task Role_list_is_filtered_to_grantable_roles()
    {
        var create = new CreateRepo();
        var roles = await Case(create, new TenantRepo(), new Sender()).ListGrantableRolesAsync(Org, ["hr_admin"], default);
        Assert.Equal(["hr_admin", "employee"], roles!.Select(r => r.Slug));
    }

    [Fact]
    public async Task Resend_only_sees_the_callers_organization()
    {
        var tenant = new TenantRepo(); var sender = new Sender();
        var result = await Case(new CreateRepo(), tenant, sender).ResendAsync(Org, ["super_admin"], Guid.NewGuid(), Origin, default);
        Assert.Equal(InvitationResendOutcome.NotFound, result.Resend!.Outcome);
        Assert.Equal([Org], tenant.LookedUpOrganizations); Assert.Empty(tenant.BoundOrganizations); Assert.Equal(0, sender.Calls);
    }

    [Theory]
    [InlineData("hr_admin", "super_admin")]
    [InlineData("recruiter", "hr_admin")]
    [InlineData("leader", "recruiter")]
    public async Task Resending_an_invitation_for_a_role_above_the_caller_is_refused_before_any_email_or_write(string caller, string stored)
    {
        var tenant = new TenantRepo { Target = new(stored) }; var sender = new Sender();
        var result = await Case(new CreateRepo(), tenant, sender).ResendAsync(Org, [caller], Guid.NewGuid(), Origin, default);
        Assert.Null(result.Resend); Assert.Equal(stored, result.DeniedRoleSlug);
        Assert.Empty(tenant.BoundOrganizations); Assert.Equal(0, sender.Calls); Assert.Equal(0, tenant.MarkSentCalls);
    }

    [Theory]
    [InlineData("hr_admin", "recruiter")]
    [InlineData("super_admin", "super_admin")]
    [InlineData("recruiter", "recruiter")]
    [InlineData("recruiter", null)] // NULL role_slug is accepted as employee, which every caller may grant
    public async Task Resending_a_grantable_role_sends_and_binds_the_callers_grantable_roles(string caller, string? stored)
    {
        var tenant = new TenantRepo { Target = new(stored) }; var sender = new Sender();
        var result = await Case(new CreateRepo(), tenant, sender).ResendAsync(Org, [caller], Guid.NewGuid(), Origin, default);
        Assert.Null(result.DeniedRoleSlug); Assert.Equal(InvitationResendOutcome.Sent, result.Resend!.Outcome);
        Assert.Equal([Org], tenant.BoundOrganizations); Assert.Equal(1, sender.Calls); Assert.Equal(1, tenant.MarkSentCalls);
        Assert.Equal(InvitationGrantPolicy.GrantableRoles([caller]), tenant.BoundGrantableRoles);
    }

    [Theory]
    [InlineData(null, null, null, TenantInvitationListFilter.All, 50)]
    [InlineData("all", "1", null, TenantInvitationListFilter.All, 1)]
    [InlineData("active", "100", null, TenantInvitationListFilter.Active, 100)]
    [InlineData("expired", "007", "3f2504e0-4f89-41d3-9a0c-0305e82c3301", TenantInvitationListFilter.Expired, 7)]
    public void List_query_parses_valid_input(string? status, string? limit, string? cursor, TenantInvitationListFilter filter, int take)
    {
        var query = TenantInvitationListQuery.Parse(status, limit, cursor);
        Assert.NotNull(query);
        Assert.Equal(filter, query!.Filter); Assert.Equal(take, query.Take);
        Assert.Equal(cursor is null ? null : Guid.Parse(cursor), query.Cursor);
    }

    [Theory]
    [InlineData("pending", null, null)] // stored status names are not filters; only all|active|expired
    [InlineData("ACTIVE", null, null)]
    [InlineData("", null, null)]
    [InlineData(null, "0", null)]
    [InlineData(null, "101", null)] // rejected, never clamped
    [InlineData(null, "-1", null)]
    [InlineData(null, "1e2", null)]
    [InlineData(null, "", null)]
    [InlineData(null, "99999999999", null)]
    [InlineData(null, null, "not-a-guid")]
    [InlineData(null, null, "{3f2504e0-4f89-41d3-9a0c-0305e82c3301}")]
    public void List_query_rejects_invalid_input(string? status, string? limit, string? cursor)
    {
        Assert.Null(TenantInvitationListQuery.Parse(status, limit, cursor));
    }

    [Fact]
    public async Task List_asks_for_one_extra_row_and_returns_the_last_displayed_id_as_cursor()
    {
        var rows = Enumerable.Range(0, 4).Select(i => Row(i)).ToList();
        var tenant = new TenantRepo { Rows = rows };
        var cursor = Guid.NewGuid();
        var page = await Case(new CreateRepo(), tenant, new Sender()).ListAsync(Org, new(TenantInvitationListFilter.Active, 3, cursor), default);
        Assert.Equal((TenantInvitationListFilter.Active, 4, (Guid?)cursor), tenant.LastList);
        Assert.Equal(rows.Take(3).Select(r => r.Id), page.Invitations.Select(r => r.Id));
        Assert.Equal(rows[2].Id, page.NextCursor); // the last DISPLAYED row, never the look-ahead row
    }

    [Fact]
    public async Task List_final_page_has_no_cursor()
    {
        var tenant = new TenantRepo { Rows = Enumerable.Range(0, 3).Select(i => Row(i)).ToList() };
        var page = await Case(new CreateRepo(), tenant, new Sender()).ListAsync(Org, new(TenantInvitationListFilter.All, 3, null), default);
        Assert.Equal(3, page.Invitations.Count); Assert.Null(page.NextCursor);
    }

    private static TenantInvitationRow Row(int i) =>
        new(Guid.NewGuid(), $"u{i}@example.test", "employee", "pending", DateTime.UtcNow.AddMinutes(-i), DateTime.UtcNow.AddDays(1), null);

    [Fact]
    public void Effective_invited_role_matches_acceptance_coalesce()
    {
        Assert.Equal("employee", InvitationGrantPolicy.EffectiveInvitedRole(null));
        Assert.Equal("super_admin", InvitationGrantPolicy.EffectiveInvitedRole("super_admin"));
    }

    private static TenantInvitationsUseCase Case(CreateRepo create, TenantRepo tenant, Sender sender) =>
        new(create, tenant, sender, TimeProvider.System);

    private sealed class CreateRepo : IUserInvitationCreateRepository
    {
        public UserInvitationCreateOutcome Outcome { get; init; } = UserInvitationCreateOutcome.Created;
        public int Creates { get; private set; }
        public bool LastUnique { get; private set; }
        public UserInvitationInput? LastInput { get; private set; }
        public Task<IReadOnlyList<InvitationRole>?> ListRolesAsync(Guid organizationId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<InvitationRole>?>([new("super_admin", "SA"), new("hr_admin", "HR"), new("employee", "E")]);
        public Task<UserInvitationPending> CreateUniqueAsync(UserInvitationInput input, Guid actor, DateTime now, CancellationToken ct) => Create(input, true, now);
        public Task<UserInvitationPending> CreateAsync(UserInvitationInput input, Guid actor, DateTime now, CancellationToken ct) => Create(input, false, now);
        private Task<UserInvitationPending> Create(UserInvitationInput input, bool unique, DateTime now)
        {
            Creates++; LastUnique = unique; LastInput = input;
            return Task.FromResult(Outcome != UserInvitationCreateOutcome.Created ? new UserInvitationPending(Outcome)
                : new UserInvitationPending(Outcome, new(Guid.NewGuid(), input.Email, "tok", "pending", input.OrganizationId, "Org", now), now.AddDays(7)));
        }
    }

    private sealed class TenantRepo : ITenantInvitationRepository
    {
        public TenantInvitationTarget? Target { get; init; }
        public List<Guid> BoundOrganizations { get; } = [];
        public List<Guid> LookedUpOrganizations { get; } = [];
        public IReadOnlyList<string>? BoundGrantableRoles { get; private set; }
        public int MarkSentCalls { get; private set; }
        public Task<TenantInvitationTarget?> FindTargetAsync(Guid organizationId, Guid id, CancellationToken ct)
        { LookedUpOrganizations.Add(organizationId); return Task.FromResult(Target); }
        public List<TenantInvitationRow> Rows { get; init; } = [];
        public (TenantInvitationListFilter Filter, int Take, Guid? Cursor)? LastList { get; private set; }
        public Task<IReadOnlyList<TenantInvitationRow>> ListOpenAsync(Guid organizationId, TenantInvitationListFilter filter,
            int take, Guid? cursor, DateTime now, CancellationToken ct)
        {
            LastList = (filter, take, cursor);
            return Task.FromResult<IReadOnlyList<TenantInvitationRow>>(Rows.Take(take).ToList());
        }
        public Task<TenantInvitationRevokeOutcome> RevokeAsync(Guid organizationId, Guid id, Guid actor, DateTime now, CancellationToken ct) =>
            Task.FromResult(TenantInvitationRevokeOutcome.NotFound);
        public IInvitationResendRepository ForOrganization(Guid organizationId, IReadOnlyList<string> grantableRoles)
        { BoundOrganizations.Add(organizationId); BoundGrantableRoles = grantableRoles; return new Delivery(this, organizationId); }
        private sealed class Delivery(TenantRepo owner, Guid organizationId) : IInvitationResendRepository
        {
            public Task<InvitationResendSnapshot?> FindAsync(Guid id, CancellationToken ct) =>
                Task.FromResult(owner.Target is null ? null
                    : new InvitationResendSnapshot(id, "invitee@example.test", "tok", "expired", organizationId, "Org", DateTime.UtcNow));
            public Task<bool> MarkSentAsync(InvitationResendSnapshot expected, DateTime sentAt, DateTime expiresAt, CancellationToken ct)
            { owner.MarkSentCalls++; return Task.FromResult(true); }
        }
    }

    private sealed class Sender : IEmailSender
    {
        public int Calls { get; private set; }
        public Task<bool> SendEmailAsync(string to, string subject, string html, CancellationToken ct) { Calls++; return Task.FromResult(true); }
    }
}
