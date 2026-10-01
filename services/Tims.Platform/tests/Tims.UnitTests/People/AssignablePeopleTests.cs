using Tims.Application.People;
using Tims.Domain.Access;
using Tims.Domain.People;

namespace Tims.UnitTests.People;

public sealed class AssignablePeopleTests
{
    [Theory]
    [InlineData("interview_evaluator", AssignablePurpose.InterviewEvaluator)]
    [InlineData("vacancy_approver", AssignablePurpose.VacancyApprover)]
    [InlineData("offer_approver", AssignablePurpose.OfferApprover)]
    [InlineData("vacancy_assignee", AssignablePurpose.VacancyAssignee)]
    [InlineData("colleague", AssignablePurpose.Colleague)]
    [InlineData("performance_subject", AssignablePurpose.PerformanceSubject)]
    [InlineData("learning_enrollee", AssignablePurpose.LearningEnrollee)]
    [InlineData("onboarding_hire", AssignablePurpose.OnboardingHire)]
    [InlineData("succession_candidate", AssignablePurpose.SuccessionCandidate)]
    [InlineData("evaluation360_participant", AssignablePurpose.Evaluation360Participant)]
    [InlineData("ninebox_committee_member", AssignablePurpose.NineBoxCommitteeMember)]
    [InlineData("org_structure_member", AssignablePurpose.OrgStructureMember)]
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
        // vacancy.submitForApproval is gated on vacancy:update (packages/api/src/routers/vacancy/approvals.ts).
        Assert.Equal(new AssignablePurposeRule("vacancy", "update", "vacancy", "approve"),
            AssignablePurposes.RuleFor(AssignablePurpose.VacancyApprover));
        Assert.Equal(new AssignablePurposeRule("offer", "create", "offer", "approve"),
            AssignablePurposes.RuleFor(AssignablePurpose.OfferApprover));
        // The wizard's hiring manager feeds vacancy.create's assignedTo, which accepts any active member.
        Assert.Equal(new AssignablePurposeRule("vacancy", "create", null, null),
            AssignablePurposes.RuleFor(AssignablePurpose.VacancyAssignee));
    }

    [Fact]
    public void Rules_ForTheNonRecruitmentPickers_FollowTheMutationEachFeeds()
    {
        // submitFeedback / giveRecognition are protectedProcedure: no caller permission at all.
        Assert.Equal(new AssignablePurposeRule(null, null, null, null),
            AssignablePurposes.RuleFor(AssignablePurpose.Colleague));
        // assertSubjectInScope mutations: narrow callers get their subject set instead of a 403.
        Assert.Equal(new AssignablePurposeRule("performance", "create", null, null, SubjectScoped: true),
            AssignablePurposes.RuleFor(AssignablePurpose.PerformanceSubject));
        Assert.Equal(new AssignablePurposeRule("learning", "create", null, null, SubjectScoped: true),
            AssignablePurposes.RuleFor(AssignablePurpose.LearningEnrollee));
        Assert.Equal(new AssignablePurposeRule("onboarding", "create", null, null, SubjectScoped: true),
            AssignablePurposes.RuleFor(AssignablePurpose.OnboardingHire));
        Assert.Equal(new AssignablePurposeRule("succession", "create", null, null, SubjectScoped: true),
            AssignablePurposes.RuleFor(AssignablePurpose.SuccessionCandidate));
        // Org-scope-only C# gates: the whole directory, org-wide callers only.
        Assert.Equal(new AssignablePurposeRule("evaluation360", "create", null, null),
            AssignablePurposes.RuleFor(AssignablePurpose.Evaluation360Participant));
        Assert.Equal(new AssignablePurposeRule("ninebox", "update", null, null),
            AssignablePurposes.RuleFor(AssignablePurpose.NineBoxCommitteeMember));
        Assert.Equal(new AssignablePurposeRule("user", "create", null, null),
            AssignablePurposes.RuleFor(AssignablePurpose.OrgStructureMember));
    }

    [Fact]
    public void EveryPurpose_HasAWireNameAndARule()
    {
        foreach (var purpose in Enum.GetValues<AssignablePurpose>())
        {
            Assert.NotNull(AssignablePurposes.RuleFor(purpose));
        }
        var wire = new[]
        {
            "interview_evaluator", "vacancy_approver", "offer_approver", "vacancy_assignee", "colleague",
            "performance_subject", "learning_enrollee", "onboarding_hire", "succession_candidate",
            "evaluation360_participant", "ninebox_committee_member", "org_structure_member",
        };
        Assert.Equal(Enum.GetValues<AssignablePurpose>().Length, wire.Length);
        Assert.All(wire, name => Assert.True(AssignablePurposes.TryParse(name, out _)));
    }

    [Theory]
    [InlineData(AssignablePurpose.PerformanceSubject, AccessScope.Organization, false)]
    [InlineData(AssignablePurpose.PerformanceSubject, AccessScope.Company, false)]
    [InlineData(AssignablePurpose.PerformanceSubject, AccessScope.Team, true)]
    [InlineData(AssignablePurpose.PerformanceSubject, AccessScope.Unit, true)]
    [InlineData(AssignablePurpose.PerformanceSubject, AccessScope.Own, true)]
    [InlineData(AssignablePurpose.OnboardingHire, AccessScope.Unit, true)]
    [InlineData(AssignablePurpose.InterviewEvaluator, AccessScope.Team, false)]
    [InlineData(AssignablePurpose.OrgStructureMember, AccessScope.Organization, false)]
    public void SubjectFilter_AppliesOnlyToASubjectScopedPurposeBelowOrgScope(
        AssignablePurpose purpose, AccessScope scope, bool expected) =>
        Assert.Equal(expected, AssignablePurposes.NeedsSubjectFilter(AssignablePurposes.RuleFor(purpose), scope));

    [Theory]
    [InlineData(new[] { "employee" }, true)]
    [InlineData(new[] { "leader", "external" }, true)]
    [InlineData(new[] { "external" }, false)]
    [InlineData(new[] { "candidate" }, false)]
    [InlineData(new string[0], false)]
    [InlineData(new[] { "platform_owner" }, false)]
    public void Colleague_RequiresAStaffRole(string[] roles, bool expected) =>
        Assert.Equal(expected, AssignablePurposes.IsAnyStaffMember(roles));

    [Theory]
    [InlineData(AssignablePurpose.InterviewEvaluator, AccessScope.Organization, true)]
    [InlineData(AssignablePurpose.InterviewEvaluator, AccessScope.Company, true)]
    [InlineData(AssignablePurpose.InterviewEvaluator, AccessScope.Unit, false)]
    [InlineData(AssignablePurpose.InterviewEvaluator, AccessScope.Team, false)]
    [InlineData(AssignablePurpose.InterviewEvaluator, AccessScope.Own, false)]
    [InlineData(AssignablePurpose.VacancyApprover, AccessScope.Unit, true)]
    [InlineData(AssignablePurpose.VacancyApprover, AccessScope.Own, true)]
    [InlineData(AssignablePurpose.OfferApprover, AccessScope.Team, true)]
    [InlineData(AssignablePurpose.VacancyAssignee, AccessScope.Organization, true)]
    [InlineData(AssignablePurpose.VacancyAssignee, AccessScope.Team, false)]
    [InlineData(AssignablePurpose.VacancyAssignee, AccessScope.Unit, false)]
    [InlineData(AssignablePurpose.PerformanceSubject, AccessScope.Own, true)]
    [InlineData(AssignablePurpose.PerformanceSubject, AccessScope.Team, true)]
    [InlineData(AssignablePurpose.OnboardingHire, AccessScope.Unit, true)]
    [InlineData(AssignablePurpose.Evaluation360Participant, AccessScope.Team, false)]
    [InlineData(AssignablePurpose.NineBoxCommitteeMember, AccessScope.Team, false)]
    [InlineData(AssignablePurpose.OrgStructureMember, AccessScope.Unit, false)]
    [InlineData(AssignablePurpose.OrgStructureMember, AccessScope.Organization, true)]
    public void CallerScope_TheWholeDirectoryNeedsOrgWideScope_ApproverListsAnyGrantedScope(
        AssignablePurpose purpose, AccessScope scope, bool expected) =>
        Assert.Equal(expected, AssignablePurposes.CallerScopeAllows(AssignablePurposes.RuleFor(purpose), scope));

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

    private static VacancyApproverFilter Filter() => new(Guid.NewGuid(), Guid.NewGuid(), AccessScope.Unit);

    [Theory]
    [InlineData(AssignablePurpose.InterviewEvaluator)]
    [InlineData(AssignablePurpose.OfferApprover)]
    [InlineData(AssignablePurpose.VacancyAssignee)]
    public async Task UseCase_RejectsVacancyIdForNonVacancyPurposesBeforeQuerying(AssignablePurpose purpose)
    {
        var repository = new RecordingRepository();
        await Assert.ThrowsAsync<ArgumentException>(() => new AssignablePeopleUseCase(repository)
            .ListAsync(Guid.NewGuid(), purpose, null, 10, Filter(), null, CancellationToken.None));
        Assert.Equal(0, repository.Calls);
    }

    [Theory]
    [InlineData(AssignablePurpose.InterviewEvaluator)]
    [InlineData(AssignablePurpose.Colleague)]
    [InlineData(AssignablePurpose.OrgStructureMember)]
    public async Task UseCase_RejectsASubjectSetForNonSubjectScopedPurposesBeforeQuerying(AssignablePurpose purpose)
    {
        var repository = new RecordingRepository();
        await Assert.ThrowsAsync<ArgumentException>(() => new AssignablePeopleUseCase(repository)
            .ListAsync(Guid.NewGuid(), purpose, null, 10, null, [Guid.NewGuid()], CancellationToken.None));
        Assert.Equal(0, repository.Calls);
    }

    [Fact]
    public async Task UseCase_ForwardsTheSubjectSetForASubjectScopedPurpose()
    {
        var repository = new RecordingRepository();
        Guid[] subjects = [Guid.NewGuid()];
        await new AssignablePeopleUseCase(repository)
            .ListAsync(Guid.NewGuid(), AssignablePurpose.PerformanceSubject, null, 10, null, subjects, CancellationToken.None);
        Assert.Same(subjects, repository.LastSubjects);
    }

    [Fact]
    public async Task UseCase_ForwardsVacancyIdForTheVacancyApproverPurpose()
    {
        var repository = new RecordingRepository();
        var filter = Filter();
        await new AssignablePeopleUseCase(repository)
            .ListAsync(Guid.NewGuid(), AssignablePurpose.VacancyApprover, null, 10, filter, null, CancellationToken.None);
        Assert.Equal(filter, repository.LastVacancy);
    }

    private sealed class RecordingRepository : IAssignablePeopleRepository
    {
        public int Calls { get; private set; }
        public string? LastSearch { get; private set; }
        public AssignablePurposeRule? LastRule { get; private set; }
        public IReadOnlyList<AssignablePerson> Result { get; init; } = [];

        public VacancyApproverFilter? LastVacancy { get; private set; }
        public IReadOnlyCollection<Guid>? LastSubjects { get; private set; }

        public Task<IReadOnlyList<AssignablePerson>?> ListAsync(Guid organizationId, AssignablePurposeRule rule,
            string? search, int limit, VacancyApproverFilter? vacancy, IReadOnlyCollection<Guid>? subjects,
            CancellationToken cancellationToken)
        {
            LastSubjects = subjects;
            Calls++;
            LastSearch = search;
            LastRule = rule;
            LastVacancy = vacancy;
            return Task.FromResult<IReadOnlyList<AssignablePerson>?>(Result);
        }
    }
}
