using Tims.Application.OrgStructure;
using Tims.Domain.OrgStructure;

namespace Tims.UnitTests.OrgStructure;

public sealed class OrgStructureUseCaseTests
{
    private static readonly OrgActor Actor = new(Guid.NewGuid(), Guid.NewGuid(), null, null);

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("tab\tinside")]
    public void Name_RejectsBlankOrControlCharacters(string? raw) =>
        Assert.False(OrgStructureInput.TryNormalizeName(raw, out _));

    [Fact]
    public void Name_TrimsAndEnforcesTheBoundAfterTrimming()
    {
        Assert.True(OrgStructureInput.TryNormalizeName("  Ventas  ", out var name));
        Assert.Equal("Ventas", name);
        Assert.True(OrgStructureInput.TryNormalizeName(" " + new string('a', 120) + " ", out _));
        Assert.False(OrgStructureInput.TryNormalizeName(new string('a', 121), out _));
    }

    [Fact]
    public void Code_BlankMeansNoCodeAndIsBounded()
    {
        Assert.True(OrgStructureInput.TryNormalizeCode("  ", out var blank));
        Assert.Null(blank);
        Assert.True(OrgStructureInput.TryNormalizeCode(new string('c', 40), out _));
        Assert.False(OrgStructureInput.TryNormalizeCode(new string('c', 41), out _));
    }

    [Fact]
    public async Task InvalidInputs_NeverReachTheRepository()
    {
        var repository = new ThrowingRepository();
        var useCase = new OrgStructureUseCase(repository);
        var now = DateTime.UtcNow;
        var ct = CancellationToken.None;

        Assert.Equal(OrgWriteStatus.BadRequest,
            (await useCase.CreateBusinessUnitAsync(Actor, new(" ", null, null), now, ct)).Status);
        Assert.Equal(OrgWriteStatus.BadRequest,
            (await useCase.UpdateBusinessUnitAsync(Actor, Guid.NewGuid(), new(default, default, default), now, ct)).Status);
        Assert.Equal(OrgWriteStatus.BadRequest, (await useCase.UpdateBusinessUnitAsync(
            Actor, Guid.NewGuid(), new(default, Optional<string?>.Of(new string('c', 41)), default), now, ct)).Status);
        Assert.Equal(OrgWriteStatus.BadRequest,
            (await useCase.CreateTeamAsync(Actor, new(Guid.NewGuid(), new string('n', 121), null), now, ct)).Status);
        Assert.Equal(OrgWriteStatus.BadRequest,
            (await useCase.UpdateTeamAsync(Actor, Guid.NewGuid(), new(default, default, default), now, ct)).Status);
        Assert.Equal(OrgWriteStatus.BadRequest,
            (await useCase.PutTeamMemberAsync(Actor, Guid.NewGuid(), Guid.NewGuid(), "owner", ct)).Status);
    }

    /// <summary>Every call fails the test: validation must short-circuit before persistence.</summary>
    private sealed class ThrowingRepository : IOrgStructureRepository
    {
        public Task<OrgStructureView> ReadStructureAsync(Guid organizationId, CancellationToken ct) => throw Unexpected();
        public Task<OrgStructureOptions> ReadOptionsAsync(Guid organizationId, CancellationToken ct) => throw Unexpected();
        public Task<OrgWriteResult<BusinessUnitRow>> CreateBusinessUnitAsync(OrgActor actor, CreateBusinessUnitInput input, DateTime now, CancellationToken ct) => throw Unexpected();
        public Task<OrgWriteResult<BusinessUnitRow>> UpdateBusinessUnitAsync(OrgActor actor, Guid businessUnitId, UpdateBusinessUnitInput input, DateTime now, CancellationToken ct) => throw Unexpected();
        public Task<OrgWriteResult<TeamRow>> CreateTeamAsync(OrgActor actor, CreateTeamInput input, DateTime now, CancellationToken ct) => throw Unexpected();
        public Task<OrgWriteResult<TeamRow>> UpdateTeamAsync(OrgActor actor, Guid teamId, UpdateTeamInput input, DateTime now, CancellationToken ct) => throw Unexpected();
        public Task<OrgWriteResult<TeamMembershipRow>> PutTeamMemberAsync(OrgActor actor, Guid teamId, Guid userId, string role, CancellationToken ct) => throw Unexpected();
        public Task<OrgWriteResult<TeamMembershipRow>> DeleteTeamMemberAsync(OrgActor actor, Guid teamId, Guid userId, CancellationToken ct) => throw Unexpected();
        public Task<OrgWriteResult<UnitAssignmentRow>> PutUnitAssigneeAsync(OrgActor actor, Guid businessUnitId, Guid userId, DateTime now, CancellationToken ct) => throw Unexpected();
        public Task<OrgWriteResult<UnitAssignmentRow>> DeleteUnitAssigneeAsync(OrgActor actor, Guid businessUnitId, Guid userId, CancellationToken ct) => throw Unexpected();
        public Task<OrgWriteResult<UserBusinessUnitRow>> SetUserBusinessUnitAsync(OrgActor actor, Guid userId, Guid? businessUnitId, DateTime now, CancellationToken ct) => throw Unexpected();

        private static InvalidOperationException Unexpected() => new("repository must not be reached");
    }
}
