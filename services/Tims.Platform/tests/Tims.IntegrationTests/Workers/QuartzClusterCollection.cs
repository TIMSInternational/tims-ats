namespace Tims.IntegrationTests.Workers;

/// <summary>
/// Binds the Phase-4 Slice-2 clustered-Quartz tests to one shared Postgres container (<see
/// cref="QuartzClusterFixture"/>) AND serializes them. Serialization is load-bearing here: Quartz's
/// <c>SchedulerRepository</c> is a PROCESS-WIDE static keyed by scheduler name, and every clustered scheduler
/// built through <c>QuartzScheduleBuilder.ApplyPersistentStore</c> uses the same constant
/// <c>ClusteredSchedulerName</c> — so two of these test classes running in parallel would collide on that
/// name. Sharing this collection keeps them sequential. (The RAM-store host tests use the DEFAULT scheduler
/// name, so they don't collide with these and can run in their own <c>WorkerHostCollection</c>.)
/// </summary>
[CollectionDefinition(Name)]
public sealed class QuartzClusterCollection : ICollectionFixture<QuartzClusterFixture>
{
    public const string Name = "QuartzCluster";
}
