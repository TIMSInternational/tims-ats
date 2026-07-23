using Tims.Application.Evaluation360;
using Tims.Domain.Evaluation360;

namespace Tims.UnitTests.Evaluation360;

/// <summary>
/// Deterministic (no-DB) unit proofs of the <see cref="Evaluation360WriteUseCase"/> orchestration: createCycle
/// pass-through, the transition <c>count === 0 ⇒</c> conflict-signalling mapping, the assignRaters
/// cycleNotOpen/missingUsers/created outcome mapping (with the fixed ['draft','open'] expected statuses), and the
/// submitRatings ordering (ownership pre-fetch null ⇒ NotFound WITHOUT claiming; claimed=false ⇒ Conflict; claimed ⇒
/// Submitted). The real-RLS state-machine / identity-anchoring / claim-idempotency bites live in the Testcontainers
/// integration suite.
/// </summary>
public sealed class Evaluation360WriteUseCaseTests
{
    private const string Org = "11111111-1111-1111-1111-111111111111";
    private static readonly Guid Caller = Guid.Parse("c0000000-0000-0000-0000-000000000001");
    private static readonly Guid CycleId = Guid.Parse("7c000000-0000-0000-0000-00000000000f");
    private static readonly Guid AssignmentId = Guid.Parse("a5510000-0000-0000-0000-000000000001");
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);

    private static readonly IReadOnlyList<RaterAssignmentInput> OneAssignment = new[]
    {
        new RaterAssignmentInput(
            Guid.Parse("d0000000-0000-0000-0000-000000000001"),
            Guid.Parse("d0000000-0000-0000-0000-000000000002"),
            "peer"),
    };

    private static readonly IReadOnlyList<RatingSubmissionInput> SixRatings = new[]
    {
        new RatingSubmissionInput("leadership", 4, null),
        new RatingSubmissionInput("communication", 5, "note"),
        new RatingSubmissionInput("collaboration", 3, null),
        new RatingSubmissionInput("execution", 4, null),
        new RatingSubmissionInput("adaptability", 5, null),
        new RatingSubmissionInput("integrity", 4, null),
    };

    // ── createCycle: returns the repo result verbatim ──
    [Fact]
    public async Task Create_returns_repo_result()
    {
        var repo = new FakeRepo { CreateResult = new CreateCycleResult("new-id", "Q3 Review", "draft", Now) };
        var result = await new Evaluation360WriteUseCase(repo)
            .CreateCycleAsync(Org, Caller, "Q3 Review", Now, CancellationToken.None);

        Assert.Equal("new-id", result.Id);
        Assert.Equal("Q3 Review", result.Name);
        Assert.Equal("draft", result.Status);
        Assert.Equal("Q3 Review", repo.CreatedName);
        Assert.Equal(Caller, repo.CreatedById);
    }

    // ── transitions: count>0 ⇒ Transitioned true + target status; count 0 ⇒ Transitioned false (endpoint → 409) ──
    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Open_maps_transition_flag_and_status(bool transitioned)
    {
        var result = await new Evaluation360WriteUseCase(new FakeRepo { Transitioned = transitioned })
            .OpenCycleAsync(Org, CycleId, Now, CancellationToken.None);
        Assert.Equal(transitioned, result.Transitioned);
        Assert.Equal("open", result.Status);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Close_maps_transition_flag_and_status(bool transitioned)
    {
        var result = await new Evaluation360WriteUseCase(new FakeRepo { Transitioned = transitioned })
            .CloseCycleAsync(Org, CycleId, Now, CancellationToken.None);
        Assert.Equal(transitioned, result.Transitioned);
        Assert.Equal("closed", result.Status);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task Publish_maps_transition_flag_and_status(bool transitioned)
    {
        var result = await new Evaluation360WriteUseCase(new FakeRepo { Transitioned = transitioned })
            .PublishCycleAsync(Org, CycleId, Now, CancellationToken.None);
        Assert.Equal(transitioned, result.Transitioned);
        Assert.Equal("published", result.Status);
    }

    // ── assignRaters: the use case always passes ['draft','open']; maps the repo result to the outcome ──
    [Fact]
    public async Task Assign_passes_draft_open_expected_statuses()
    {
        var repo = new FakeRepo { AssignResult = new AssignRatersDbResult(false, Array.Empty<string>(), 1) };
        await new Evaluation360WriteUseCase(repo).AssignRatersAsync(Org, CycleId, OneAssignment, Now, CancellationToken.None);
        Assert.Equal(new[] { "draft", "open" }, repo.ExpectedStatuses);
    }

    [Fact]
    public async Task Assign_cycleNotOpen_maps_to_CycleNotOpen()
    {
        var repo = new FakeRepo { AssignResult = new AssignRatersDbResult(true, Array.Empty<string>(), 0) };
        var result = await new Evaluation360WriteUseCase(repo).AssignRatersAsync(Org, CycleId, OneAssignment, Now, CancellationToken.None);
        Assert.Equal(AssignRatersOutcome.CycleNotOpen, result.Outcome);
        Assert.Equal(0, result.Created);
    }

    [Fact]
    public async Task Assign_missingUsers_maps_to_MissingUsers()
    {
        var repo = new FakeRepo { AssignResult = new AssignRatersDbResult(false, new[] { "d0000000-0000-0000-0000-000000000099" }, 0) };
        var result = await new Evaluation360WriteUseCase(repo).AssignRatersAsync(Org, CycleId, OneAssignment, Now, CancellationToken.None);
        Assert.Equal(AssignRatersOutcome.MissingUsers, result.Outcome);
    }

    [Fact]
    public async Task Assign_created_maps_to_Created_with_count()
    {
        var repo = new FakeRepo { AssignResult = new AssignRatersDbResult(false, Array.Empty<string>(), 3) };
        var result = await new Evaluation360WriteUseCase(repo).AssignRatersAsync(Org, CycleId, OneAssignment, Now, CancellationToken.None);
        Assert.Equal(AssignRatersOutcome.Created, result.Outcome);
        Assert.Equal(3, result.Created);
    }

    // ── submitRatings: pre-fetch null ⇒ NotFound WITHOUT claiming (never leaks that the id exists for another rater) ──
    [Fact]
    public async Task Submit_ownership_prefetch_null_is_NotFound_and_does_not_claim()
    {
        var repo = new FakeRepo { Belongs = false };
        var result = await new Evaluation360WriteUseCase(repo)
            .SubmitRatingsAsync(Org, Caller, AssignmentId, SixRatings, Now, CancellationToken.None);

        Assert.Equal(SubmitRatingsOutcome.NotFound, result.Outcome);
        Assert.False(repo.SubmitCalled); // the claim never ran
    }

    [Fact]
    public async Task Submit_claimed_false_is_Conflict()
    {
        var repo = new FakeRepo { Belongs = true, Claimed = false };
        var result = await new Evaluation360WriteUseCase(repo)
            .SubmitRatingsAsync(Org, Caller, AssignmentId, SixRatings, Now, CancellationToken.None);

        Assert.Equal(SubmitRatingsOutcome.Conflict, result.Outcome);
        Assert.True(repo.SubmitCalled);
    }

    [Fact]
    public async Task Submit_claimed_true_is_Submitted_and_passes_caller_as_rater()
    {
        var repo = new FakeRepo { Belongs = true, Claimed = true };
        var result = await new Evaluation360WriteUseCase(repo)
            .SubmitRatingsAsync(Org, Caller, AssignmentId, SixRatings, Now, CancellationToken.None);

        Assert.Equal(SubmitRatingsOutcome.Submitted, result.Outcome);
        Assert.Equal(Caller, repo.SubmitRaterUserId); // the caller is the rater on BOTH the pre-fetch and the claim
        Assert.Equal(Caller, repo.PrefetchRaterUserId);
    }

    private sealed class FakeRepo : IEvaluation360WriteRepository
    {
        public CreateCycleResult CreateResult { get; init; } = new("id", "n", "draft", default);
        public bool Transitioned { get; init; }
        public AssignRatersDbResult AssignResult { get; init; } = new(false, Array.Empty<string>(), 0);
        public bool Belongs { get; init; }
        public bool Claimed { get; init; }

        public string? CreatedName { get; private set; }
        public Guid CreatedById { get; private set; }
        public IReadOnlyList<string>? ExpectedStatuses { get; private set; }
        public bool SubmitCalled { get; private set; }
        public Guid SubmitRaterUserId { get; private set; }
        public Guid PrefetchRaterUserId { get; private set; }

        public Task<CreateCycleResult> CreateCycleAsync(
            string organizationId, Guid createdById, string name, DateTimeOffset now, CancellationToken cancellationToken)
        {
            CreatedName = name;
            CreatedById = createdById;
            return Task.FromResult(CreateResult);
        }

        public Task<bool> OpenCycleAsync(string organizationId, Guid cycleId, DateTimeOffset now, CancellationToken cancellationToken) =>
            Task.FromResult(Transitioned);

        public Task<bool> CloseCycleAsync(string organizationId, Guid cycleId, DateTimeOffset now, CancellationToken cancellationToken) =>
            Task.FromResult(Transitioned);

        public Task<bool> PublishCycleAsync(string organizationId, Guid cycleId, DateTimeOffset now, CancellationToken cancellationToken) =>
            Task.FromResult(Transitioned);

        public Task<AssignRatersDbResult> AssignRatersAsync(
            string organizationId, Guid cycleId, IReadOnlyList<RaterAssignmentInput> assignments,
            IReadOnlyList<string> expectedStatuses, DateTimeOffset now, CancellationToken cancellationToken)
        {
            ExpectedStatuses = expectedStatuses;
            return Task.FromResult(AssignResult);
        }

        public Task<bool> AssignmentBelongsToRaterAsync(
            string organizationId, Guid raterUserId, Guid assignmentId, CancellationToken cancellationToken)
        {
            PrefetchRaterUserId = raterUserId;
            return Task.FromResult(Belongs);
        }

        public Task<bool> SubmitRatingsAsync(
            string organizationId, Guid raterUserId, Guid assignmentId, IReadOnlyList<RatingSubmissionInput> ratings,
            DateTimeOffset now, CancellationToken cancellationToken)
        {
            SubmitCalled = true;
            SubmitRaterUserId = raterUserId;
            return Task.FromResult(Claimed);
        }
    }
}
