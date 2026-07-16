using Tims.Domain.Access;

namespace Tims.UnitTests.Access;

/// <summary>
/// WP2.5b Part C: the identity-anchored self-service guard (the Sprint-1.7 pattern). A HARD
/// <c>subject == ctx.UserId</c> check that is NOT scope-aware — no scope, no anchors widen it.
/// </summary>
public sealed class SelfServiceGuardTests
{
    private static readonly Guid Caller = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid Other = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000002");

    [Fact]
    public void RequireSelf_passes_for_own_subject()
    {
        SelfServiceGuard.RequireSelf(Caller, Caller); // does not throw
    }

    [Fact]
    public void RequireSelf_throws_for_another_users_subject()
    {
        Assert.Throws<SelfServiceForbiddenException>(() => SelfServiceGuard.RequireSelf(Caller, Other));
    }
}
