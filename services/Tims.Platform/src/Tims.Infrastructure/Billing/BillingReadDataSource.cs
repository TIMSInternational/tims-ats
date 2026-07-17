using Npgsql;

namespace Tims.Infrastructure.Billing;

/// <summary>
/// Builds the Npgsql data source for <see cref="BillingReadDbContext"/> with UNMAPPED TYPES enabled.
/// The Prisma-OWNED <c>invoices.status</c> / <c>subscriptions.plan</c> / <c>subscriptions.status</c>
/// columns are NATIVE Postgres enum types (<c>InvoiceStatus</c>/<c>OrgPlan</c>/<c>SubscriptionStatus</c>);
/// EFCore.PG does NOT read an unmapped enum into a CLR <c>string</c> by default (it throws
/// "Reading as 'System.String' is not supported"). <see cref="NpgsqlDataSourceBuilder.EnableUnmappedTypes"/>
/// makes Npgsql read/write those enums as text, so the mapped C# string properties resolve. Shared by the
/// Program.cs DI registration and the Testcontainers fixture so both read identically. Read-only: the data
/// source only ever backs <c>AsNoTracking</c> reads under <see cref="TenantScope"/>.
/// </summary>
public static class BillingReadDataSource
{
    public static NpgsqlDataSource Build(string connectionString)
    {
        var builder = new NpgsqlDataSourceBuilder(connectionString);
        builder.EnableUnmappedTypes();
        return builder.Build();
    }
}

/// <summary>
/// DI holder for the billing <see cref="NpgsqlDataSource"/>. It exists purely to ISOLATE the
/// EnableUnmappedTypes data source: EFCore.PG's <c>UseNpgsql(connectionString)</c> auto-resolves an
/// <see cref="NpgsqlDataSource"/> registered in the application service provider, so registering the raw
/// data source openly would silently bleed EnableUnmappedTypes into every OTHER string-based context
/// (Identity/Anchor/Hris/ExternalAssessment/ExternalValidation/Audit). Registering THIS wrapper (not the
/// raw <see cref="NpgsqlDataSource"/> service type) keeps the data source exclusive to
/// <see cref="BillingReadDbContext"/>. Disposing it disposes the underlying source.
/// </summary>
public sealed class BillingReadDataSourceHolder(NpgsqlDataSource dataSource) : IDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public void Dispose() => DataSource.Dispose();
}
