using Tims.Application.People;
using Tims.Domain.People;

namespace Tims.UnitTests.People;

public sealed class AssignablePeopleTests
{
    [Theory]
    [InlineData("interview_evaluator", AssignablePurpose.InterviewEvaluator)]
    [InlineData("vacancy_approver", AssignablePurpose.VacancyApprover)]
    [InlineData("offer_approver", AssignablePurpose.OfferApprover)]
    public void TryParse_AcceptsOnlyTheExactWireNames(string value, AssignablePurpose expected)
    {
        Assert.True(AssignablePurposes.TryParse(value, out var purpose));
        Assert.Equal(expected, purpose);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("Offer_Approver")]
    [InlineData("user_read")]
    [InlineData("InterviewEvaluator")]
    public void TryParse_RejectsAnythingElse(string? value) => Assert.False(AssignablePurposes.TryParse(value, out _));

    [Fact]
    public void Rules_GateTheCallerOnThePickerActionAndApproversOnTheApprovePermission()
    {
        Assert.Equal(new AssignablePurposeRule("interview", "create", null, null),
            AssignablePurposes.RuleFor(AssignablePurpose.InterviewEvaluator));
        Assert.Equal(new AssignablePurposeRule("vacancy", "create", "vacancy", "approve"),
            AssignablePurposes.RuleFor(AssignablePurpose.VacancyApprover));
        Assert.Equal(new AssignablePurposeRule("offer", "create", "offer", "approve"),
            AssignablePurposes.RuleFor(AssignablePurpose.OfferApprover));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(51)]
    public async Task UseCase_RejectsOutOfBoundsLimitsBeforeQuerying(int limit)
    {
        var repository = new RecordingRepository();
        await Assert.ThrowsAsync<ArgumentOutOfRangeException>(() => new AssignablePeopleUseCase(repository)
            .ListAsync(Guid.NewGuid(), AssignablePurpose.InterviewEvaluator, null, limit, CancellationToken.None));
        Assert.Equal(0, repository.Calls);
    }

    [Fact]
    public async Task UseCase_TrimsSearchAndTreatsBlankAsNoFilter()
    {
        var repository = new RecordingRepository();
        var useCase = new AssignablePeopleUseCase(repository);
        await useCase.ListAsync(Guid.NewGuid(), AssignablePurpose.OfferApprover, "  ana  ", 10, CancellationToken.None);
        Assert.Equal("ana", repository.LastSearch);
        Assert.Equal(new AssignablePurposeRule("offer", "create", "offer", "approve"), repository.LastRule);
        await useCase.ListAsync(Guid.NewGuid(), AssignablePurpose.OfferApprover, "   ", 10, CancellationToken.None);
        Assert.Null(repository.LastSearch);
    }

    [Fact]
    public async Task UseCase_DropsNonStaffRoleHintsAndDuplicates()
    {
        var repository = new RecordingRepository
        {
            Result = [new(Guid.NewGuid(), "Ana", "Lopez", "ana@test", null, ["external", "recruiter", "candidate", "recruiter"])],
        };
        var result = await new AssignablePeopleUseCase(repository)
            .ListAsync(Guid.NewGuid(), AssignablePurpose.InterviewEvaluator, null, 25, CancellationToken.None);
        Assert.Equal(["recruiter"], Assert.Single(result.People).RoleSlugs);
    }

    private sealed class RecordingRepository : IAssignablePeopleRepository
    {
        public int Calls { get; private set; }
        public string? LastSearch { get; private set; }
        public AssignablePurposeRule? LastRule { get; private set; }
        public IReadOnlyList<AssignablePerson> Result { get; init; } = [];

        public Task<IReadOnlyList<AssignablePerson>> ListAsync(Guid organizationId, AssignablePurposeRule rule,
            string? search, int limit, CancellationToken cancellationToken)
        {
            Calls++;
            LastSearch = search;
            LastRule = rule;
            return Task.FromResult(Result);
        }
    }
}
