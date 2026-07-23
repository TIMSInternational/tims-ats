using Npgsql;

namespace Tims.Infrastructure.Evaluation360;

/// <summary>
/// DI holder for the evaluation360 WRITE <see cref="NpgsqlDataSource"/> — mirrors
/// <see cref="Evaluation360ReadDataSourceHolder"/>. The write context FILTERS and SETS the three NATIVE Prisma enum
/// types (<c>review_cycles.status</c>, <c>rater_assignments.relationship</c>/<c>.status</c>: createCycle inserts
/// status='draft', the transitions filter+set status, assignRaters re-checks status ∈ ['draft','open'], submitRatings
/// claims on status='pending' + cycle status='open') — Postgres has no implicit <c>enum = text</c> operator, so the
/// source must MAP the enums to CLR enums. It reuses the Slice-7 <see cref="Evaluation360ReadDataSource.Build"/> /
/// <see cref="Evaluation360ReadDataSource.MapEnums"/> (single source of the store-type names — no drift).
///
/// A DEDICATED holder type (not the read holder) isolates THIS source to <c>Evaluation360WriteDbContext</c>:
/// EFCore.PG's <c>UseNpgsql(dataSource)</c> auto-resolves a registered <see cref="NpgsqlDataSource"/>, so registering
/// the raw source openly would bleed the enum mappings into every OTHER string-based context. Registering this wrapper
/// keeps the source exclusive to the write context (exactly like the read holder). Disposing it disposes the source.
/// </summary>
public sealed class Evaluation360WriteDataSourceHolder(NpgsqlDataSource dataSource) : IDisposable
{
    public NpgsqlDataSource DataSource { get; } = dataSource;

    public void Dispose() => DataSource.Dispose();
}
