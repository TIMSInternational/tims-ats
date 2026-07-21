namespace Tims.IntegrationTests.TeamIntel;

/// <summary>xUnit collection so the Phase-5 Slice 6 team-intel read tests share ONE Postgres container.</summary>
[CollectionDefinition("TeamIntelRead")]
public sealed class TeamIntelReadCollection : ICollectionFixture<TeamIntelReadFixture>;
