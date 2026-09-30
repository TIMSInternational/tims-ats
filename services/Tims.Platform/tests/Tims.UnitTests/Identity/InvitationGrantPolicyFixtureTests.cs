using Tims.Domain.Identity;
using Tims.UnitTests.Fixtures;

namespace Tims.UnitTests.Identity;

/// <summary>
/// The staff-role grant policy is enforced on two stacks — C# /tenant-invitations (InvitationGrantPolicy) and tRPC
/// user.create / user.assignRole (packages/shared grantableStaffRoles). Both assert this SAME golden matrix
/// (contracts/identity-fixtures/invitation-grant-policy.json; TS: tests/access/invitation-grant-policy-fixtures.test.ts).
/// </summary>
public sealed class InvitationGrantPolicyFixtureTests
{
    private sealed record Root(string Description, List<string> ProbeRoles, List<Case> Cases);
    private sealed record Case(string Name, List<string> CallerRoles, List<string> Grantable);

    private static readonly Root Data = Fx.Load<Root>("identity-fixtures", "invitation-grant-policy.json");

    public static IEnumerable<object[]> Cases() => Fx.Rows(Data.Cases.Select(c => c.Name).ToList());

    [Theory]
    [MemberData(nameof(Cases))]
    public void Grantable_roles_match_golden_fixture(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);
        Assert.Equal(c.Grantable, InvitationGrantPolicy.GrantableRoles(c.CallerRoles));
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Can_grant_agrees_for_every_probe_role(int index, string name)
    {
        var c = Data.Cases[index];
        Assert.Equal(name, c.Name);
        foreach (var role in Data.ProbeRoles)
            Assert.Equal((role, c.Grantable.Contains(role)), (role, InvitationGrantPolicy.CanGrant(c.CallerRoles, role)));
    }

    [Fact]
    public void Matrix_covers_every_assignable_staff_role_as_a_sole_caller_role()
    {
        var soleCallers = Data.Cases.Where(c => c.CallerRoles.Count == 1).Select(c => c.CallerRoles[0]).ToHashSet();
        foreach (var role in RoleSlugs.AssignableStaffRoles)
        {
            Assert.Contains(role, soleCallers);
            Assert.Contains(role, Data.ProbeRoles);
        }
    }
}
