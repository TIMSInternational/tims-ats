namespace Tims.Application.Fx;

/// <summary>The result of one gateway "latest" fetch (Slice 11c gateway): the provider's effective date + the
/// base→quote rates for the requested quote currencies. NEVER golden-fixtured (it wraps a live fetch).</summary>
public sealed record FxGatewayRates(string BaseCurrency, DateOnly AsOf, IReadOnlyDictionary<string, double> Rates);

/// <summary>
/// One resolved DB-pinned conversion rate <c>from → to</c> (Slice 11c FIX 4). <see cref="Rate"/> is the
/// cross-rate through the USD base; <see cref="Identity"/> is true when <c>from == to</c> (no conversion, no
/// pin needed). <see cref="AsOf"/> is the EARLIEST non-identity leg date of the USD cross-rate (a USD leg is
/// identity and carries no date), <c>null</c> for an identity pin — the Application-layer converter surfaces it
/// as <c>ratesAsOf</c> (mirrors the TS <c>sumMoney</c> impure wrapper; the pure MoneySum kernel never carries it).
/// </summary>
public sealed record FxPin(double Rate, DateOnly? AsOf, bool Identity);

/// <summary>The result of an <see cref="FxMoneyConverter.SumAsync"/> fold (Slice 11c FIX 4): the display-currency
/// total + <c>converted</c> flag from the pure kernel, plus <see cref="RatesAsOf"/> — the EARLIEST non-identity
/// pin date across the summed rows (<c>yyyy-MM-dd</c>, <c>null</c> when every row was identity). Mirrors the TS
/// <c>sumMoney</c> wrapper's <c>ratesAsOf</c>; keeps the pure golden <c>MoneySum</c> unchanged.</summary>
public sealed record FxSumResult(double Amount, bool Converted, string? RatesAsOf);
