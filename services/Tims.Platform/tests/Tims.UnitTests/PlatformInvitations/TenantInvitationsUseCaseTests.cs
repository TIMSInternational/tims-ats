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
        var result = await Case(new CreateRepo(), tenant, sender).ResendAsync(Org, Guid.NewGuid(), Origin, default);
        Assert.Equal(InvitationResendOutcome.NotFound, result.Outcome);
        Assert.Equal([Org], tenant.BoundOrganizations); Assert.Equal(0, sender.Calls);
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
        public List<Guid> BoundOrganizations { get; } = [];
        public Task<IReadOnlyList<TenantInvitationRow>> ListOpenAsync(Guid organizationId, CancellationToken ct) =>
            Task.FromResult<IReadOnlyList<TenantInvitationRow>>([]);
        public Task<TenantInvitationRevokeOutcome> RevokeAsync(Guid organizationId, Guid id, Guid actor, DateTime now, CancellationToken ct) =>
            Task.FromResult(TenantInvitationRevokeOutcome.NotFound);
        public IInvitationResendRepository ForOrganization(Guid organizationId) { BoundOrganizations.Add(organizationId); return new Delivery(); }
        private sealed class Delivery : IInvitationResendRepository
        {
            public Task<InvitationResendSnapshot?> FindAsync(Guid id, CancellationToken ct) => Task.FromResult<InvitationResendSnapshot?>(null);
            public Task<bool> MarkSentAsync(InvitationResendSnapshot expected, DateTime sentAt, DateTime expiresAt, CancellationToken ct) => Task.FromResult(true);
        }
    }

    private sealed class Sender : IEmailSender
    {
        public int Calls { get; private set; }
        public Task<bool> SendEmailAsync(string to, string subject, string html, CancellationToken ct) { Calls++; return Task.FromResult(true); }
    }
}
