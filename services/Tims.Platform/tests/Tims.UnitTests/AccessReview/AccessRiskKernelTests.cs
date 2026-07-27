using Tims.Domain.AccessReview;
using Xunit;

namespace Tims.UnitTests.AccessReview;

public sealed class AccessRiskKernelTests
{
    private static readonly DateTime Now = new(2026, 7, 17, 0, 0, 0, DateTimeKind.Utc);
    private static readonly Guid Org = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid OtherOrg = Guid.Parse("22222222-2222-2222-2222-222222222222");

    private static DateTime DaysAgo(int n) => Now.AddDays(-n);

    private static RoleAssignment Role(string slug, Guid? organizationId = null, DateTime? expiresAt = null) =>
        new(slug, organizationId ?? Org, expiresAt);

    /// <summary>Distinguishes "lastLoginAt not passed" (defaults to a recent login below) from
    /// "lastLoginAt explicitly passed as null" (never logged in). A plain `DateTime? lastLoginAt = null`
    /// optional parameter can't tell these apart — C# only allows `null` as the default value of a
    /// nullable-value-type parameter, so an omitted argument and an explicit `null` argument both
    /// arrive as `null` inside the method. This wrapper carries an `IsSet` bit alongside the value,
    /// with an implicit conversion from `DateTime?` so call sites stay exactly `Base(lastLoginAt: null)`.</summary>
    private readonly struct LastLogin
    {
        public bool IsSet { get; }
        public DateTime? Value { get; }
        private LastLogin(DateTime? value) { IsSet = true; Value = value; }
        public static implicit operator LastLogin(DateTime? value) => new(value);
    }

    private static UserAccessInput Base(
        bool isActive = true, DateTime? deletedAt = null, LastLogin lastLoginAt = default,
        IReadOnlyList<RoleAssignment>? roles = null, bool isPlatformOwner = false) =>
        new(Org, isActive, deletedAt, lastLoginAt.IsSet ? lastLoginAt.Value : DaysAgo(1), roles ?? [Role("recruiter")], isPlatformOwner, Now);

    [Fact]
    public void AccessStatusOf_DeletedBeatsInactiveBeatsActive()
    {
        Assert.Equal(AccessStatus.Deleted, AccessRiskKernel.AccessStatusOf(isActive: true, deletedAt: Now));
        Assert.Equal(AccessStatus.Inactive, AccessRiskKernel.AccessStatusOf(isActive: false, deletedAt: null));
        Assert.Equal(AccessStatus.Active, AccessRiskKernel.AccessStatusOf(isActive: true, deletedAt: null));
    }

    [Fact]
    public void HealthyActiveRecruiter_RaisesNoFlags()
    {
        var (status, flags) = AccessRiskKernel.AssessUserAccess(Base());
        Assert.Equal(AccessStatus.Active, status);
        Assert.Equal(new AccessRiskFlags(false, false, false, false, false, false), flags);
    }

    [Fact]
    public void NeverLoggedIn_ActiveWithNoLogin()
    {
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(lastLoginAt: null)).Flags.NeverLoggedIn);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base()).Flags.NeverLoggedIn);
    }

    [Theory]
    [InlineData(91, true)]
    [InlineData(89, false)]
    public void Stale_BoundaryAtNinetyDays(int daysAgo, bool expectedStale)
    {
        Assert.Equal(expectedStale, AccessRiskKernel.AssessUserAccess(Base(lastLoginAt: DaysAgo(daysAgo))).Flags.Stale);
    }

    [Fact]
    public void Stale_NeverFiresWhenNoLogin()
    {
        Assert.False(AccessRiskKernel.AssessUserAccess(Base(lastLoginAt: null)).Flags.Stale);
    }

    [Fact]
    public void Privileged_BySuperAdminRoleOrPlatformOwnerFlag()
    {
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(roles: [Role("super_admin")])).Flags.Privileged);
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(isPlatformOwner: true)).Flags.Privileged);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base()).Flags.Privileged);
    }

    [Fact]
    public void DeprovisionGap_InactiveOrDeletedButStillHoldsARole()
    {
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(isActive: false)).Flags.DeprovisionGap);
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(deletedAt: Now)).Flags.DeprovisionGap);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base(isActive: false, roles: [])).Flags.DeprovisionGap);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base()).Flags.DeprovisionGap);
    }

    [Fact]
    public void ExpiredGrant_ActiveUserHoldingAnExpiredRole_IsLiveLingeringAccess()
    {
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(roles: [Role("recruiter", expiresAt: DaysAgo(1))])).Flags.ExpiredGrant);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base(roles: [Role("recruiter", expiresAt: DaysAgo(-30))])).Flags.ExpiredGrant);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base()).Flags.ExpiredGrant);
    }

    [Fact]
    public void ExpiredGrant_NotCountedWhenUserIsInactive_CountsAsDeprovisionGapInstead()
    {
        var (_, flags) = AccessRiskKernel.AssessUserAccess(
            Base(isActive: false, lastLoginAt: null, roles: [Role("recruiter", expiresAt: DaysAgo(1))]));
        Assert.False(flags.ExpiredGrant);
        Assert.True(flags.DeprovisionGap);
    }

    [Fact]
    public void CrossOrgRole_RoleBelongsToADifferentOrgThanTheUser()
    {
        Assert.True(AccessRiskKernel.AssessUserAccess(Base(roles: [Role("recruiter", organizationId: OtherOrg)])).Flags.CrossOrgRole);
        Assert.False(AccessRiskKernel.AssessUserAccess(Base()).Flags.CrossOrgRole);
    }

    [Fact]
    public void InactiveAccount_NeverRaisesActiveOnlyFlags()
    {
        var (_, flags) = AccessRiskKernel.AssessUserAccess(
            Base(isActive: false, lastLoginAt: null, roles: [Role("recruiter", expiresAt: DaysAgo(1))]));
        Assert.False(flags.NeverLoggedIn);
        Assert.False(flags.Stale);
        Assert.False(flags.ExpiredGrant);
    }
}
