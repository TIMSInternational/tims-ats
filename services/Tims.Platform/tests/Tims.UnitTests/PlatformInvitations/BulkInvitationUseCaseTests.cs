using Tims.Application.PlatformInvitations;

namespace Tims.UnitTests.PlatformInvitations;

public sealed class BulkInvitationUseCaseTests
{
    private static readonly Guid Org = Guid.NewGuid();
    private static readonly Uri Origin = new("https://app.example.test");
    private static BulkInvitationInput Input(params string[] emails) => new(Org, emails.Select(e => new BulkInvitee(e)).ToArray());
    [Fact]
    public async Task Batch_duplicates_are_case_insensitive_and_results_preserve_input_order()
    {
        var worker = new Worker(); var result = await new BulkInvitationUseCase(worker, new Clock()).ExecuteAsync(Input("a@example.test", "A@example.test", "b@example.test"), Guid.NewGuid(), Origin, default);
        Assert.Equal(new BulkInvitationSummary(3, 2, 1, 0), result!.Summary);
        Assert.Equal(new[] { 0, 1, 2 }, result.Results.Select(r => r.Index)); Assert.Equal("A@example.test", result.Results[1].Email);
        Assert.Equal("duplicate_row", result.Results[1].Reason); Assert.Equal(2, worker.Calls);
    }
    [Fact]
    public async Task Budget_stops_starting_rows_and_marks_them_not_attempted()
    {
        var clock = new Clock(); var worker = new Worker { Handler = (_, _) => { clock.Advance(TimeSpan.FromSeconds(13)); return Task.FromResult(Sent()); } };
        var result = await new BulkInvitationUseCase(worker, clock).ExecuteAsync(Input("a@example.test", "b@example.test", "c@example.test"), Guid.NewGuid(), Origin, default);
        Assert.Equal(1, worker.Calls); Assert.Equal(new BulkInvitationSummary(3, 1, 0, 2), result!.Summary);
        Assert.All(result.Results.Skip(1), r => Assert.Equal("not_attempted", r.Reason));
    }
    [Fact]
    public async Task Runs_at_most_four_workers_and_handles_out_of_order_completion()
    {
        var fourStarted = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var release = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var active = 0; var maximum = 0;
        var worker = new Worker
        {
            Handler = async (_, ct) =>
        {
            var count = Interlocked.Increment(ref active); maximum = Math.Max(maximum, count); if (count == 4) fourStarted.TrySetResult();
            await release.Task.WaitAsync(ct); Interlocked.Decrement(ref active); return Sent();
        }
        };
        var operation = new BulkInvitationUseCase(worker, new Clock()).ExecuteAsync(Input(Enumerable.Range(0, 12).Select(i => $"a{i}@example.test").ToArray()), Guid.NewGuid(), Origin, default);
        await fourStarted.Task.WaitAsync(TimeSpan.FromSeconds(5)); Assert.Equal(4, worker.Calls); release.SetResult();
        var result = await operation; Assert.Equal(4, maximum); Assert.Equal(12, result!.Summary.Sent); Assert.Equal(Enumerable.Range(0, 12), result.Results.Select(r => r.Index));
    }
    [Theory]
    [InlineData("accepted", "sent", null)]
    [InlineData("unconfirmed", "error", "delivery_unconfirmed")]
    [InlineData("changed", "error", "state_changed")]
    [InlineData("state_unconfirmed", "error", "state_unconfirmed")]
    public async Task Delivery_outcome_is_not_mislabeled_as_sent(string delivery, string status, string? reason)
    {
        var worker = new Worker { Handler = (_, _) => Task.FromResult(new UserInvitationCreateResult(UserInvitationCreateOutcome.Created, new(Guid.NewGuid(), Org, delivery))) };
        var result = await new BulkInvitationUseCase(worker, new Clock()).ExecuteAsync(Input("a@example.test"), Guid.NewGuid(), Origin, default);
        Assert.Equal(status, result!.Results[0].Status); Assert.Equal(reason, result.Results[0].Reason);
    }
    [Theory]
    [InlineData(UserInvitationCreateOutcome.Duplicate, "duplicate", "already_invited")]
    [InlineData(UserInvitationCreateOutcome.RoleUnavailable, "error", "role_unavailable")]
    [InlineData(UserInvitationCreateOutcome.OrganizationUnavailable, "error", "organization_unavailable")]
    public async Task Rejected_targets_keep_specific_per_row_results(UserInvitationCreateOutcome outcome, string status, string reason)
    {
        var worker = new Worker { Handler = (_, _) => Task.FromResult(new UserInvitationCreateResult(outcome)) };
        var result = await new BulkInvitationUseCase(worker, new Clock()).ExecuteAsync(Input("a@example.test"), Guid.NewGuid(), Origin, default);
        Assert.Equal(status, result!.Results[0].Status); Assert.Equal(reason, result.Results[0].Reason);
    }
    [Fact]
    public async Task Failed_row_does_not_abort_other_rows_or_expose_internal_errors()
    {
        var worker = new Worker { Handler = (input, _) => input.Email.StartsWith('a') ? Task.FromException<UserInvitationCreateResult>(new Exception("secret-database-error")) : Task.FromResult(Sent()) };
        var result = await new BulkInvitationUseCase(worker, new Clock()).ExecuteAsync(Input("a@example.test", "b@example.test"), Guid.NewGuid(), Origin, default);
        Assert.Equal("operation_unconfirmed", result!.Results[0].Reason); Assert.Equal("sent", result.Results[1].Status);
        Assert.DoesNotContain("secret", System.Text.Json.JsonSerializer.Serialize(result));
    }
    [Fact]
    public async Task Missing_org_and_invalid_batches_never_start_workers()
    {
        var worker = new Worker { Available = false }; var useCase = new BulkInvitationUseCase(worker, new Clock());
        Assert.Null(await useCase.ExecuteAsync(Input("a@example.test"), Guid.NewGuid(), Origin, default)); Assert.Equal(0, worker.Calls);
        Assert.False(BulkInvitationUseCase.IsValid(Input()));
        Assert.False(BulkInvitationUseCase.IsValid(Input(Enumerable.Repeat("a@example.test", 201).ToArray())));
        Assert.True(BulkInvitationUseCase.IsValid(Input(Enumerable.Repeat("a@example.test", 200).ToArray())));
        Assert.False(BulkInvitationUseCase.IsValid(Input("not-an-email")));
    }
    [Fact]
    public async Task Cancellation_marks_active_rows_uncertain_and_queued_rows_unattempted()
    {
        using var cancel = new CancellationTokenSource();
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var active = 0;
        var worker = new Worker
        {
            Handler = async (_, ct) =>
            {
                if (Interlocked.Increment(ref active) == 4) started.SetResult();
                await Task.Delay(Timeout.InfiniteTimeSpan, ct); return Sent();
            }
        };
        var task = new BulkInvitationUseCase(worker, new Clock()).ExecuteAsync(Input(Enumerable.Range(0, 10).Select(i => $"a{i}@example.test").ToArray()), Guid.NewGuid(), Origin, cancel.Token);
        await started.Task.WaitAsync(TimeSpan.FromSeconds(5)); cancel.Cancel();
        var result = await task.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.Equal(4, worker.Calls); Assert.Equal(new BulkInvitationSummary(10, 0, 0, 10), result!.Summary);
        Assert.All(result.Results.Take(4), r => Assert.Equal("operation_unconfirmed", r.Reason));
        Assert.All(result.Results.Skip(4), r => Assert.Equal("not_attempted", r.Reason));
        Assert.Equal(Enumerable.Range(0, 10), result.Results.Select(r => r.Index));
    }
    private static UserInvitationCreateResult Sent() => new(UserInvitationCreateOutcome.Created, new(Guid.NewGuid(), Org, "accepted"));
    private sealed class Clock : TimeProvider
    {
        private long timestamp; public override long TimestampFrequency => TimeSpan.TicksPerSecond;
        public override long GetTimestamp() => timestamp; public void Advance(TimeSpan span) => timestamp += span.Ticks;
    }
    private sealed class Worker : IBulkInvitationWorker
    {
        private int calls; public int Calls => calls; public bool Available { get; init; } = true;
        public Func<UserInvitationInput, CancellationToken, Task<UserInvitationCreateResult>> Handler { get; init; } = (_, _) => Task.FromResult(Sent());
        public Task<bool> OrganizationAvailableAsync(Guid org, CancellationToken ct) => Task.FromResult(Available);
        public Task<UserInvitationCreateResult> ExecuteAsync(UserInvitationInput input, Guid actor, Uri origin, CancellationToken ct)
        { Interlocked.Increment(ref calls); return Handler(input, ct); }
    }
}
