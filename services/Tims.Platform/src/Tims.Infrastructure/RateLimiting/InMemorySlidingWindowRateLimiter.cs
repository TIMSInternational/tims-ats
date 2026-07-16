using System.Collections.Concurrent;
using Tims.Application.RateLimiting;
using Tims.Domain.RateLimiting;

namespace Tims.Infrastructure.RateLimiting;

/// <summary>
/// The process-local fallback limiter — a faithful port of the TS <c>checkMemoryRateLimit</c>
/// in-memory path (fixed-window count keyed <c>{category}:{identifier}</c>, with the same
/// 5-minute cleanup of expired entries). In TS this is the fallback whenever the Upstash env
/// vars are absent; in the C# port it is engaged ONLY in Development (the
/// <c>RateLimitGuard</c> gates it) — never in production, a deliberate documented divergence.
///
/// NOT bucket-shared with any other process. Its purpose is local-dev/CI parity, not distributed
/// enforcement.
/// </summary>
public sealed class InMemorySlidingWindowRateLimiter : IRateLimiter, IDisposable
{
    private sealed class Entry
    {
        public int Count;
        public long ResetAtMs;
    }

    private readonly ConcurrentDictionary<string, Entry> _store = new(StringComparer.Ordinal);
    private readonly Func<long> _nowMs;
    private readonly Timer? _cleanup;

    public InMemorySlidingWindowRateLimiter()
        : this(() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), startCleanupTimer: true)
    {
    }

    /// <summary>Test seam: inject a clock and disable the background timer for determinism.</summary>
    internal InMemorySlidingWindowRateLimiter(Func<long> nowMs, bool startCleanupTimer)
    {
        _nowMs = nowMs;
        if (startCleanupTimer)
        {
            // Mirror the TS `setInterval(..., 5 * 60 * 1000)` expired-entry sweep.
            _cleanup = new Timer(_ => Cleanup(), null, TimeSpan.FromMinutes(5), TimeSpan.FromMinutes(5));
        }
    }

    public Task<RateLimitResult> LimitAsync(
        string identifier,
        RateLimitCategory category,
        CancellationToken cancellationToken = default)
    {
        ArgumentException.ThrowIfNullOrEmpty(identifier);
        cancellationToken.ThrowIfCancellationRequested();

        var requests = RateLimits.Tokens(category);
        var windowMs = RateLimits.WindowMs(category);
        var now = _nowMs();
        var key = $"{RateLimits.CategoryToken(category)}:{identifier}";

        // Read-modify-write under a per-entry lock so a concurrent burst can't overcount/undercount.
        var entry = _store.GetOrAdd(key, _ => new Entry { Count = 0, ResetAtMs = 0 });
        lock (entry)
        {
            if (entry.Count == 0 || entry.ResetAtMs < now)
            {
                entry.Count = 1;
                entry.ResetAtMs = now + windowMs;
                return Task.FromResult(new RateLimitResult(
                    Allowed: true, Limit: requests, Remaining: requests - 1, ResetAtMs: entry.ResetAtMs));
            }

            entry.Count++;
            var blocked = entry.Count > requests;
            return Task.FromResult(new RateLimitResult(
                Allowed: !blocked,
                Limit: requests,
                Remaining: Math.Max(0, requests - entry.Count),
                ResetAtMs: entry.ResetAtMs));
        }
    }

    /// <summary>Removes entries whose window has elapsed — the TS cleanup interval body.</summary>
    internal void Cleanup()
    {
        var now = _nowMs();
        foreach (var (key, entry) in _store)
        {
            if (entry.ResetAtMs < now)
            {
                _store.TryRemove(key, out _);
            }
        }
    }

    public void Dispose() => _cleanup?.Dispose();
}
