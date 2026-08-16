using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Application.Fx;

namespace Tims.Infrastructure.Fx;

/// <summary>
/// <see cref="IFxRateWriteRepository"/> over the GLOBAL <see cref="FxRateDbContext"/> connection (the
/// PRIVILEGED/owner login role — NOT under <see cref="TenantScope"/>): fx_rates is RLS-exempt, and the
/// currency-discovery query reads comp/company/band currencies across ALL orgs, which needs the BYPASSRLS owner
/// role. The upsert is the idempotent <c>INSERT … ON CONFLICT (base_currency, quote_currency, as_of) DO UPDATE</c>
/// — every id/value is a bound Npgsql parameter, never interpolated.
/// </summary>
public sealed class FxRateWriteRepository(FxRateDbContext db) : IFxRateWriteRepository
{
    // The currency-bearing tables the reads convert FROM/INTO. Fixed constants (never user input).
    //
    // MAINTENANCE RULE, learned the hard way: every table whose `currency` column feeds an
    // FxMoneyConverter consumer MUST be listed here, or that consumer's pins exist only by coincidence.
    // `invoices` was missing until 2026-08-15 — the platform-dashboard FX reads (slice 23 PR 3) sum
    // invoice amounts, and their COP invoices were covered ONLY because salary_bands/companies happened
    // to reference COP too. The first tenant invoiced in a currency no compensation row shares would have
    // had no pin: the live compensation reads fail-soft, but the dashboard reads answer 503 (their caveat
    // 9). Discovery-at-the-source is what disarms that permanently. `salary_adjustments` is deliberately
    // absent: no FX consumer converts its amounts (simulate-adjustment reads employee_compensations +
    // salary_bands, both listed).
    private static readonly string[] CurrencyTables = { "employee_compensations", "salary_bands", "companies", "invoices" };

    private readonly FxRateDbContext _db = db;

    public async Task<IReadOnlyList<string>> ListReferencedCurrenciesAsync(CancellationToken cancellationToken)
    {
        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        await OpenIfNeededAsync(connection, cancellationToken).ConfigureAwait(false);

        // Only union tables that actually exist (a test/staging DB may lack some) — to_regclass is null-safe.
        var present = new List<string>();
        foreach (var table in CurrencyTables)
        {
            await using var check = connection.CreateCommand();
            check.CommandText = "SELECT to_regclass(@t) IS NOT NULL";
            check.Parameters.AddWithValue("t", $"public.{table}");
            var exists = await check.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false);
            if (exists is true)
            {
                present.Add(table);
            }
        }

        if (present.Count == 0)
        {
            return Array.Empty<string>();
        }

        // Table names are fixed constants filtered through to_regclass above — never interpolated user input.
        var union = string.Join(
            " UNION ", present.Select(t => $"SELECT DISTINCT currency FROM {t} WHERE currency IS NOT NULL"));
        await using var command = connection.CreateCommand();
        command.CommandText = union;

        var currencies = new List<string>();
        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            if (!reader.IsDBNull(0))
            {
                currencies.Add(reader.GetString(0));
            }
        }

        return currencies;
    }

    public async Task<int> UpsertRatesAsync(
        string baseCurrency,
        DateOnly asOf,
        IReadOnlyDictionary<string, double> rates,
        DateTime fetchedAt,
        string source,
        CancellationToken cancellationToken)
    {
        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        await OpenIfNeededAsync(connection, cancellationToken).ConfigureAwait(false);

        var written = 0;
        foreach (var (quote, rate) in rates)
        {
            await using var command = connection.CreateCommand();
            command.CommandText =
                """
                INSERT INTO fx_rates (id, base_currency, quote_currency, rate, as_of, fetched_at, source)
                VALUES (@id, @base, @quote, @rate, @as_of, @fetched_at, @source)
                ON CONFLICT (base_currency, quote_currency, as_of)
                DO UPDATE SET rate = EXCLUDED.rate, fetched_at = EXCLUDED.fetched_at, source = EXCLUDED.source;
                """;
            command.Parameters.AddWithValue("id", Guid.NewGuid());
            command.Parameters.AddWithValue("base", baseCurrency);
            command.Parameters.AddWithValue("quote", quote);
            command.Parameters.AddWithValue("rate", rate);
            command.Parameters.AddWithValue("as_of", asOf);
            command.Parameters.AddWithValue("fetched_at", fetchedAt);
            command.Parameters.AddWithValue("source", source);
            written += await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        return written;
    }

    private static async Task OpenIfNeededAsync(NpgsqlConnection connection, CancellationToken cancellationToken)
    {
        if (connection.State != System.Data.ConnectionState.Open)
        {
            await connection.OpenAsync(cancellationToken).ConfigureAwait(false);
        }
    }
}
