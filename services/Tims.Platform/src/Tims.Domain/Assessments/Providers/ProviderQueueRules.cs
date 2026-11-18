namespace Tims.Domain.Assessments.Providers;

/// <summary>
/// The webhook inbox as a work queue (contract step 6: answer 2xx within 10 s, process asynchronously). The receiving
/// request only verifies the signature and commits the inbox row; the row then carries <c>next_attempt_at</c> and is
/// processed by the inbox worker under a lease. The row is the durable record: a crash between the acknowledgement and
/// the processing loses nothing, because nothing but the row's own <c>next_attempt_at</c> decides when it runs.
/// </summary>
public static class ProviderInboxProcessing
{
    /// <summary>
    /// How long a claim holds one inbox row. The worker processes ONE row at a time and cancels it after
    /// <see cref="MaxProcessingDuration"/>, so the lease always outlives the work under it; an instance that dies
    /// mid-event frees the row when the lease expires.
    /// </summary>
    public static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(15);

    /// <summary>
    /// The most one event's processing may take: a token fetch, a reconcile read, a result read, and at worst one #312
    /// cascade pass (itself capped by <see cref="ProviderWithdrawalLeasing.MaxPassDuration"/>). Well inside the lease.
    /// </summary>
    public static readonly TimeSpan MaxProcessingDuration = TimeSpan.FromMinutes(10);

    /// <summary>The first retry of a failed event waits this long; each later one doubles it, up to <see cref="MaxRetryDelay"/>.</summary>
    public static readonly TimeSpan FirstRetryDelay = TimeSpan.FromSeconds(30);

    public static readonly TimeSpan MaxRetryDelay = TimeSpan.FromHours(1);

    /// <summary>
    /// After this long since the row was received, a still-failing event stops being retried and stays <c>failed</c>
    /// for operators: the same 72 h the contract gives the sender's own retries. The D17 poller remains the backstop for
    /// the attempt it concerned.
    /// </summary>
    public static readonly TimeSpan RetryWindow = TimeSpan.FromHours(72);

    /// <summary>
    /// When a failed event is retried next, or null when it is not retried any more. <paramref name="attempts"/> counts
    /// the processing attempts made so far, this one included.
    /// </summary>
    public static DateTimeOffset? NextRetryAt(int attempts, DateTimeOffset receivedAt, DateTimeOffset now)
    {
        // 30 s · 2^(n-1), capped at an hour (2^7 · 30 s already exceeds it, so the shift never overflows).
        var exponent = Math.Clamp(attempts - 1, 0, 7);
        var delay = TimeSpan.FromTicks(Math.Min(MaxRetryDelay.Ticks, FirstRetryDelay.Ticks << exponent));
        var next = now + delay;
        return next > receivedAt + RetryWindow ? null : next;
    }
}

/// <summary>
/// Leases for the #312 withdrawal cascade's work (D15). A pass CLAIMS the pending attempts it works on (one conditional
/// UPDATE with <c>FOR UPDATE SKIP LOCKED</c>, lease free or expired, by the database clock), so two instances, or the
/// sweep and a webhook, never send the same cancels and withdrawals at once.
/// </summary>
public static class ProviderWithdrawalLeasing
{
    public static readonly TimeSpan LeaseDuration = TimeSpan.FromMinutes(15);

    /// <summary>The most one pass may take; past it the pass is cancelled, well before its claims expire.</summary>
    public static readonly TimeSpan MaxPassDuration = TimeSpan.FromMinutes(8);
}

/// <summary>
/// A create announced before it is sent (the create fence of the #312 cascade). An attempt's <c>create_started_at</c> is
/// set, durably, BEFORE <c>POST /v1/assignments</c> leaves, and cleared only when the provider's answer is recorded. A
/// withdrawal pass that cannot find the attempt's assignment by <c>external_ref</c> keeps the attempt pending while such a
/// create may still land at the provider.
/// </summary>
public static class ProviderCreateFence
{
    /// <summary>
    /// After this long an announced create can no longer be in flight: one create is bounded by the client's per-call
    /// timeout (at most 30 s) plus a token request. A lookup by <c>external_ref</c> after it sees every create that landed.
    /// </summary>
    public static readonly TimeSpan StaleAfter = TimeSpan.FromMinutes(10);
}

/// <summary>
/// Consent purposes an instrument OFFERS as optional (the candidate may decline them and still sit the instrument).
/// English administers its speaking section only when both <c>voice</c> and <c>ai_scoring</c> are active; without them
/// the result reports speaking as not assessed.
/// </summary>
public static class OptionalConsents
{
    public static IReadOnlyList<string> For(string instrument) => instrument == ProviderInstruments.English
        ? [ConsentPurposes.Voice, ConsentPurposes.AiScoring]
        : [];

    /// <summary>
    /// Why the speaking section of an English attempt is not assessed, from the candidate's recorded decisions:
    /// <c>no_voice_consent</c>, <c>no_ai_scoring_consent</c>, or null (not English, or nothing declined).
    /// </summary>
    public static string? SpeakingNotAssessedReason(string instrument, IReadOnlyCollection<string> declined)
    {
        ArgumentNullException.ThrowIfNull(declined);
        if (instrument != ProviderInstruments.English)
        {
            return null;
        }

        if (declined.Contains(ConsentPurposes.Voice))
        {
            return "no_voice_consent";
        }

        return declined.Contains(ConsentPurposes.AiScoring) ? "no_ai_scoring_consent" : null;
    }
}
