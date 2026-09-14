using Tims.Application.Fx;

namespace Tims.Application.PlatformDashboard;

/// <summary>
/// An <see cref="IFxRateProvider"/> decorator that resolves each currency PAIR at most once per instance
/// (Phase-5 slice 23, issue #81, PR 3 of 3).
///
/// <para><b>This exists to match TS, not merely to be faster.</b> The TS <c>getFxRate</c> keeps a
/// process-wide <c>rateCache</c> with a six-hour TTL, so within a single procedure call every row sharing a
/// currency pair converts at the SAME rate — no matter how many rows there are.
/// <see cref="Tims.Infrastructure.Fx.FxRateProvider"/> has no cache, so an unmemoized <c>getChurnRisk</c>
/// would re-read the pin table ONCE PER INVOICE PER ORGANIZATION, and a refresh landing mid-request could
/// hand two rows of the SAME payload two different rates. Memoizing removes both problems at once, and it
/// changes no output that TS could produce.</para>
///
/// <para>Precisely: ONE query per non-identity pair on this surface, not two. <c>LegFromBaseAsync</c>
/// short-circuits the USD base leg without touching the database, and every conversion in all three reads
/// targets <c>PlatformBillingCurrency</c> (USD), so the <c>to</c> leg is always that identity leg. Two
/// queries would need a non-USD→non-USD pair, which these endpoints cannot produce. (An earlier version of
/// this paragraph said "two queries per non-identity pair" and doubled the figure.)</para>
///
/// <para><b>Deliberately per-CALL, not per-process.</b> Each use-case method news one up and discards it,
/// so a pin refreshed between two requests is picked up by the next one. A longer-lived instance would be a
/// second cache layer with its own staleness, which is a behaviour the port has no mandate to invent —
/// the six-hour TTL is the TS side's, and reproducing it would mean reproducing its expiry too.</para>
///
/// <para>Identity pairs DO reach this decorator — <c>FxMoneyConverter.SumAsync</c> calls the provider
/// unconditionally for every row, with no <c>from == to</c> check above it — so the memo holds a
/// <c>(USD,USD)</c> entry like any other. What they never reach is the DATABASE: the inner provider
/// short-circuits an identity pair before querying. So on a single-currency platform this decorator saves
/// dictionary lookups rather than round trips, and the round trips it does save are the cross-currency
/// ones. (An earlier version of this paragraph said identity pairs "never reach the inner provider", which
/// is false and was self-refuting — its own parenthetical named the provider doing the short-circuiting.)
/// </para>
///
/// <para>It is NOT thread-safe, and does not need to be: every caller awaits its rows in a sequential
/// <c>foreach</c>.</para>
/// </summary>
public sealed class MemoizingFxRateProvider(IFxRateProvider inner) : IFxRateProvider
{
    private readonly IFxRateProvider _inner = inner;

    private readonly Dictionary<(string From, string To), FxPin?> _pins = [];

    public async Task<FxPin?> GetPinAsync(string from, string to, CancellationToken cancellationToken)
    {
        var key = (from, to);
        if (_pins.TryGetValue(key, out var cached))
        {
            return cached;
        }

        var pin = await _inner.GetPinAsync(from, to, cancellationToken).ConfigureAwait(false);

        // A null pin (cold start / unknown currency) is memoized TOO. Re-asking cannot succeed within one
        // request, and caching the miss keeps a fail-soft path from issuing N pointless round trips before
        // the use case turns it into a single 503.
        _pins[key] = pin;
        return pin;
    }
}
