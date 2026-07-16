namespace Tims.IntegrationTests;

/// <summary>Shares one Postgres container (data_access_logs + RLS + a missing-table DB) across the WP2.7 audit tests.</summary>
[CollectionDefinition("AuditWriter")]
public sealed class AuditWriterCollection : ICollectionFixture<AuditWriterFixture>;
