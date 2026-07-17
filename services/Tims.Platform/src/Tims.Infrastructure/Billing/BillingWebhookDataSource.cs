using Npgsql;

namespace Tims.Infrastructure.Billing;

/// <summary>
/// Builds the Npgsql data source for <see cref="BillingWebhookDbContext"/> with UNMAPPED TYPES enabled — the
/// <c>subscriptions.status</c> / <c>subscriptions.plan</c> columns are NATIVE Postgres enum types
/// (<c>SubscriptionStatus</c>/<c>OrgPlan</c>), so the read-once decision query resolves them into the mapped
/// C# <c>string</c> property (see <see cref="BillingReadDataSource"/> for the same rationale). Isolated behind
/// <see cref="BillingWebhookDataSourceHolder"/> so EnableUnmappedTypes never bleeds into the other
/// (string-based) contexts. Backs the PRIVILEGED webhook write connection (NOT app_tenant).
/// </summary>
public static class BillingWebhookDataSource
{
    public static NpgsqlDataSource Build(string connectionString)
    {
        var builder = new NpgsqlDataSourceBuilder(connectionString);
        builder.EnableUnmappedTypes();
        return builder.Build();
    }
}

/// <summary>
/// DI holder isolating the webhook <see cref="NpgsqlDataSource"/> (EnableUnmappedTypes) from every other
/// context — registering the raw <see cref="NpgsqlDataSource"/> service would let EFCore.PG auto-adopt it
/// globally. Registering THIS wrapper keeps the data source exclusive to <see cref="BillingWebhookDbContext"/>.
/// </summary>
public sealed class BillingWebhookDataSourceHolder(NpgsqlDataSource dataSource) : IDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public void Dispose() => DataSource.Dispose();
}
