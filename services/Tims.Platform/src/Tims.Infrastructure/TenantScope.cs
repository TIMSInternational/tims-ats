using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Tims.Infrastructure;

/// <summary>
/// Reproduces the current TS `tenantDb` mechanism (see
/// docs/architecture/2026-07-15-csharp-backend-target-architecture.md §3) through
/// EF Core: every tenant unit of work runs inside a transaction that issues
/// `SET LOCAL ROLE app_tenant` + parameterized `set_config('app.current_org_id', ..., true)`
/// BEFORE any query, and is released on commit/rollback.
///
/// `SET LOCAL` (not session-level `SET` / `set_config(..., false)`) is mandatory:
/// under Supavisor transaction-mode pooling, session-scoped state leaks onto the next
/// borrower of the physical connection. `SET LOCAL` is transaction-scoped, so it can
/// never outlive the transaction it was issued in — that is exactly what makes this
/// safe under pooling (proven by the Spike A pooling-reuse test).
///
/// Fail-closed: passing `organizationId: null` sets the GUC to an empty string. The
/// RLS policy predicate `NULLIF(current_setting('app.current_org_id', true), '')::uuid`
/// then evaluates to NULL, and the fail-closed policy hides every row.
/// </summary>
public sealed class TenantScope : IAsyncDisposable
{
    private readonly IDbContextTransaction _transaction;
    private bool _completed;

    private TenantScope(IDbContextTransaction transaction)
    {
        _transaction = transaction;
    }

    public static async Task<TenantScope> BeginAsync(
        DbContext db,
        Guid? organizationId,
        CancellationToken cancellationToken = default)
    {
        // SET LOCAL requires an open transaction (it's transaction-scoped) — begin
        // it first, then issue the role switch + GUC before any product query runs.
        var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

        // Role names cannot be parameterized in Postgres (SET ROLE takes an
        // identifier, not a literal) but "app_tenant" is a fixed, non-user-supplied
        // constant, so a raw command is safe here — no string interpolation of any
        // caller-controlled value occurs anywhere in this method.
        await db.Database.ExecuteSqlRawAsync("SET LOCAL ROLE app_tenant", cancellationToken);

        // Prefer parameterized set_config over string interpolation for the org id:
        // ExecuteSqlInterpolatedAsync binds the FormattableString argument as a real
        // Npgsql parameter, never concatenating it into the SQL text.
        var orgValue = organizationId?.ToString() ?? string.Empty;
        await db.Database.ExecuteSqlInterpolatedAsync(
            $"SELECT set_config('app.current_org_id', {orgValue}, true)",
            cancellationToken);

        return new TenantScope(transaction);
    }

    public Task CommitAsync(CancellationToken cancellationToken = default)
    {
        _completed = true;
        return _transaction.CommitAsync(cancellationToken);
    }

    public async ValueTask DisposeAsync()
    {
        if (!_completed)
        {
            await _transaction.RollbackAsync();
        }

        await _transaction.DisposeAsync();
    }
}
