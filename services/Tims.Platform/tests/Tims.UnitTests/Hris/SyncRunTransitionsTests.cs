using Tims.Domain.Hris;

namespace Tims.UnitTests.Hris;

/// <summary>
/// WP3.1 — the sync-run state machine guards. Legal edges: pending→running and
/// running→{succeeded|failed|partial}; the three terminal states are FINAL. Every other edge is
/// invalid and must throw <see cref="InvalidSyncRunTransitionException"/>.
/// </summary>
public sealed class SyncRunTransitionsTests
{
    [Theory]
    [InlineData(SyncRunStatus.Pending, SyncRunStatus.Running)]
    [InlineData(SyncRunStatus.Running, SyncRunStatus.Succeeded)]
    [InlineData(SyncRunStatus.Running, SyncRunStatus.Failed)]
    [InlineData(SyncRunStatus.Running, SyncRunStatus.Partial)]
    public void CanTransition_allows_the_legal_edges(SyncRunStatus from, SyncRunStatus to)
    {
        Assert.True(SyncRunTransitions.CanTransition(from, to));
        Assert.Equal(to, SyncRunTransitions.EnsureCanTransition(from, to));
    }

    [Theory]
    // Skipping running.
    [InlineData(SyncRunStatus.Pending, SyncRunStatus.Succeeded)]
    [InlineData(SyncRunStatus.Pending, SyncRunStatus.Failed)]
    [InlineData(SyncRunStatus.Pending, SyncRunStatus.Partial)]
    // Going backwards.
    [InlineData(SyncRunStatus.Running, SyncRunStatus.Pending)]
    // Self-loops.
    [InlineData(SyncRunStatus.Pending, SyncRunStatus.Pending)]
    [InlineData(SyncRunStatus.Running, SyncRunStatus.Running)]
    // Terminal states are final — no edge out of any of them.
    [InlineData(SyncRunStatus.Succeeded, SyncRunStatus.Running)]
    [InlineData(SyncRunStatus.Failed, SyncRunStatus.Running)]
    [InlineData(SyncRunStatus.Partial, SyncRunStatus.Running)]
    [InlineData(SyncRunStatus.Succeeded, SyncRunStatus.Failed)]
    [InlineData(SyncRunStatus.Failed, SyncRunStatus.Partial)]
    public void CanTransition_rejects_illegal_edges(SyncRunStatus from, SyncRunStatus to)
    {
        Assert.False(SyncRunTransitions.CanTransition(from, to));
    }

    [Fact]
    public void EnsureCanTransition_throws_on_an_illegal_edge_with_both_states()
    {
        var ex = Assert.Throws<InvalidSyncRunTransitionException>(
            () => SyncRunTransitions.EnsureCanTransition(SyncRunStatus.Succeeded, SyncRunStatus.Running));

        Assert.Equal(SyncRunStatus.Succeeded, ex.From);
        Assert.Equal(SyncRunStatus.Running, ex.To);
    }

    [Fact]
    public void InvalidSyncRunTransitionException_is_a_domain_exception()
    {
        Assert.IsAssignableFrom<HrisDomainException>(
            new InvalidSyncRunTransitionException(SyncRunStatus.Pending, SyncRunStatus.Succeeded));
    }

    [Theory]
    [InlineData(SyncRunStatus.Succeeded, true)]
    [InlineData(SyncRunStatus.Failed, true)]
    [InlineData(SyncRunStatus.Partial, true)]
    [InlineData(SyncRunStatus.Pending, false)]
    [InlineData(SyncRunStatus.Running, false)]
    public void IsTerminal_classifies_the_three_outcomes(SyncRunStatus status, bool terminal)
    {
        Assert.Equal(terminal, SyncRunTransitions.IsTerminal(status));
    }
}
