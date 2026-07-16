namespace Tims.IntegrationTests.Workers;

/// <summary>
/// Serializes the test classes that boot a real Tims.Workers host. Quartz's <c>SchedulerRepository</c> is a
/// PROCESS-WIDE static keyed by scheduler name, so two concurrently-booted hosts (xunit runs test CLASSES in
/// parallel by default) would collide on the default scheduler name. Sharing this collection keeps the host
/// booters from overlapping — no need to contort the production scheduler identity with a random name.
/// </summary>
[CollectionDefinition(Name)]
public sealed class WorkerHostCollection
{
    public const string Name = "WorkerHost";
}
