namespace Tims.Application.Fx;

/// <summary>
/// The write/read port the daily refresh job uses over <c>fx_rates</c> + the currency-discovery query. Runs on
/// the PRIVILEGED/owner connection (fx_rates is global + RLS-exempt; the discovery query reads comp/company/band
/// currencies across ALL orgs, which needs the BYPASSRLS owner role — NOT a tenant scope).
/// </summary>
public interface IFxRateWriteRepository
{
    /// <summary>Distinct currency codes referenced anywhere the reads convert FROM/INTO — the union of
    /// <c>employee_compensations.currency</c>, <c>salary_bands.currency</c>, <c>companies.currency</c> — so the
    /// job pins exactly the pairs the reads need. Read cross-org on the owner connection.</summary>
    Task<IReadOnlyList<string>> ListReferencedCurrenciesAsync(CancellationToken cancellationToken);

    /// <summary>Idempotent upsert of the base→quote pins for one <paramref name="asOf"/> date:
    /// <c>INSERT … ON CONFLICT (base_currency, quote_currency, as_of) DO UPDATE</c> (same as_of → the existing
    /// row is refreshed in place, NO duplicate; a new as_of → a new row). Returns the number of rows written.</summary>
    Task<int> UpsertRatesAsync(
        string baseCurrency,
        DateOnly asOf,
        IReadOnlyDictionary<string, double> rates,
        DateTime fetchedAt,
        string source,
        CancellationToken cancellationToken);
}
