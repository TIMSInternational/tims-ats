using Microsoft.AspNetCore.Http;
using Tims.Api.Authentication;
using Tims.Api.Configuration;
using Tims.Api.Proctoring;
using Tims.Application.Identity;
using Tims.Domain.Access;
using Tims.Domain.Identity;
using Tims.Infrastructure.Identity;

namespace Tims.IntegrationTests.Proctoring;

/// <summary>
/// Integrity-test data has a narrower role matrix than ordinary assessment data.
/// These exercise the actual staff gate with real permission resolution and fake
/// grants, including accounts that hold both allowed and disallowed roles.
/// </summary>
public sealed class StaffProctoringSensitiveRoleGateTests
{
    private static readonly string OrganizationId = Guid.NewGuid().ToString();
    private static readonly string UserId = Guid.NewGuid().ToString();

    [Theory]
    [InlineData("read")]
    [InlineData("update")]
    public async Task Recruiter_AndLeader_AreDenied_EvenWithAssessmentGrants(string action)
    {
        foreach (var role in new[] { "recruiter", "leader" })
        {
            var grants = new TestGrants();
            var result = await AuthorizeAsync(PrincipalType.OrgUser, [role], action, grants);

            Assert.Equal(StatusCodes.Status403Forbidden, Status(result));
            Assert.Equal(0, grants.Calls);
        }
    }

    [Fact]
    public async Task Candidate_CannotPassStaffGate_EvenWithPrivilegedRoleClaim()
    {
        var grants = new TestGrants();
        var result = await AuthorizeAsync(PrincipalType.Candidate, ["super_admin"], "read", grants);

        Assert.Equal(StatusCodes.Status401Unauthorized, Status(result));
        Assert.Equal(0, grants.Calls);
    }

    [Fact]
    public async Task Hrbp_CanRead_AssignedScope_ButCannotUpdate_WithAnUpdateGrant()
    {
        var grants = new TestGrants();
        var read = await AuthorizeAsync(PrincipalType.OrgUser, ["hrbp"], "read", grants);
        Assert.Null(read.Failure);
        Assert.Equal(AccessScope.Unit, read.Scope);

        var update = await AuthorizeAsync(PrincipalType.OrgUser, ["hrbp"], "update", grants);
        Assert.Equal(StatusCodes.Status403Forbidden, Status(update));
        Assert.Equal(1, grants.Calls);
    }

    [Fact]
    public async Task HrAdmin_CanReadGrantedScope_ButCannotUpdate_WithAnUpdateGrant()
    {
        var grants = new TestGrants();
        var read = await AuthorizeAsync(PrincipalType.OrgUser, ["hr_admin"], "read", grants);
        Assert.Null(read.Failure);
        Assert.Equal(AccessScope.Company, read.Scope);

        var update = await AuthorizeAsync(PrincipalType.OrgUser, ["hr_admin"], "update", grants);
        Assert.Equal(StatusCodes.Status403Forbidden, Status(update));
        Assert.Equal(1, grants.Calls);
    }

    [Theory]
    [InlineData("read")]
    [InlineData("update")]
    public async Task SuperAdmin_CanUsePrivilegedOrganizationScope(string action)
    {
        var grants = new TestGrants();
        var result = await AuthorizeAsync(PrincipalType.OrgUser, ["super_admin"], action, grants);

        Assert.Null(result.Failure);
        Assert.Equal(AccessScope.Organization, result.Scope);
        Assert.Equal(0, grants.Calls);
    }

    [Theory]
    [InlineData("read")]
    [InlineData("update")]
    public async Task PlatformOwner_RequiresAnOrganization(string action)
    {
        var grants = new TestGrants();
        var assigned = await AuthorizeAsync(PrincipalType.PlatformOwner, ["platform_owner"], action, grants);
        Assert.Null(assigned.Failure);
        Assert.Equal(AccessScope.Organization, assigned.Scope);

        var orgless = await AuthorizeAsync(PrincipalType.PlatformOwner, ["platform_owner"], action,
            grants, organizationId: string.Empty);
        Assert.Equal(StatusCodes.Status400BadRequest, Status(orgless));
    }

    [Fact]
    public async Task RecruiterGrant_CannotWiden_HrbpReadScope_OnMixedRoleAccount()
    {
        var grants = new TestGrants();
        var result = await AuthorizeAsync(PrincipalType.OrgUser, ["recruiter", "hrbp"], "read", grants);

        Assert.Null(result.Failure);
        Assert.Equal(AccessScope.Unit, result.Scope);
        Assert.Equal(["hrbp"], grants.LastRoles);
    }

    [Fact]
    public async Task RecruiterGrant_CannotWiden_HrAdminReadScope_OrEnableUpdate_OnMixedRoleAccount()
    {
        var grants = new TestGrants();
        var read = await AuthorizeAsync(PrincipalType.OrgUser, ["recruiter", "hr_admin"], "read", grants);

        Assert.Null(read.Failure);
        Assert.Equal(AccessScope.Company, read.Scope);
        Assert.Equal(["hr_admin"], grants.LastRoles);

        var update = await AuthorizeAsync(PrincipalType.OrgUser, ["recruiter", "hr_admin"], "update", grants);
        Assert.Equal(StatusCodes.Status403Forbidden, Status(update));
        Assert.Equal(1, grants.Calls);
    }

    [Fact]
    public async Task HrbpStillRequiresAnAssessmentReadGrant()
    {
        var result = await AuthorizeAsync(PrincipalType.OrgUser, ["hrbp"], "read", new TestGrants(false));
        Assert.Equal(StatusCodes.Status403Forbidden, Status(result));
    }

    [Fact]
    public async Task OtherActionsAreDenied()
    {
        var result = await AuthorizeAsync(PrincipalType.OrgUser, ["hr_admin"], "delete", new TestGrants());
        Assert.Equal(StatusCodes.Status403Forbidden, Status(result));
    }

    private static async Task<StaffProctoringGateResult> AuthorizeAsync(
        PrincipalType type, IReadOnlyList<string> roles, string action, TestGrants grants,
        string? organizationId = null)
    {
        var context = new TenantContext(type, organizationId ?? OrganizationId, UserId, roles);
        var http = new DefaultHttpContext();
        http.Items[ResolvedPrincipal.HttpContextKey] = new ResolvedPrincipal(context);
        return await StaffProctoringGate.AuthorizeAsync(new System.Security.Claims.ClaimsPrincipal(),
            http, resolver: null!, new PermissionService(grants, new NullPermissionCache()),
            new PlatformOptions(), action, CancellationToken.None);
    }

    private static int? Status(StaffProctoringGateResult result) =>
        (result.Failure as IStatusCodeHttpResult)?.StatusCode;

    private sealed class TestGrants(bool grantHrbpRead = true) : IPermissionGrantRepository
    {
        public int Calls { get; private set; }
        public IReadOnlyList<string> LastRoles { get; private set; } = [];

        public Task<IReadOnlyList<Grant>> FindGrantsAsync(
            string orgId, IReadOnlyList<string> roleSlugs, string module, string action,
            CancellationToken ct)
        {
            Calls++;
            LastRoles = roleSlugs.ToArray();
            Assert.Equal(OrganizationId, orgId);
            Assert.Equal("assessment", module);
            IReadOnlyList<Grant> grants = roleSlugs.SelectMany(role => role switch
            {
                "recruiter" => new[] { new Grant(role, module, action, "organization") },
                "leader" => [new Grant(role, module, action, "team")],
                "hrbp" when grantHrbpRead || action != "read" =>
                    [new Grant(role, module, action, "unit")],
                "hr_admin" => [new Grant(role, module, action, "company")],
                _ => Array.Empty<Grant>(),
            }).ToArray();
            return Task.FromResult(grants);
        }
    }
}
