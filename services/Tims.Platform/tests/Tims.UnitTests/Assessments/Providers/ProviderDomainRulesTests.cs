using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>FIT v2 mapping, job-relatedness and the attempt lifecycle — the hiring guardrails that are pure rules.</summary>
public sealed class ProviderDomainRulesTests
{
    private static readonly DateTimeOffset Completed = new(2026, 11, 9, 14, 38, 0, TimeSpan.Zero);

    private static ProviderFitRow Row(
        string state = ProviderAttemptStates.ResultReady, string? validity = ProviderValidity.Valid, string? purpose = "selection",
        bool humanReview = false, bool hasResult = true, string instrument = ProviderInstruments.Lia, int assignedDay = 1,
        decimal requested = 1.5m, decimal applied = 1.5m) =>
        new(Guid.NewGuid(), instrument, state, hasResult ? Guid.NewGuid() : null, hasResult ? purpose : null,
            hasResult ? validity : null, humanReview, Completed, 46.2, null, null, "content-1", "norms-1",
            new DateTimeOffset(2026, 11, assignedDay, 9, 0, 0, TimeSpan.Zero), requested, hasResult ? applied : null);

    [Fact]
    public void A_valid_selection_result_is_valid_and_carries_its_value_and_versions()
    {
        var result = Assert.Single(ProviderFitMapping.Map([Row()]));

        Assert.Equal(ProviderResultIntegrity.Valid, result.Integrity);
        Assert.Equal(46.2, result.GlobalPercentile);
        Assert.Equal("provider", result.Source);
        Assert.Null(result.NormalizedScore);
        Assert.Equal("content-1", result.ContentVersion);
        Assert.Equal("norms-1", result.NormVersion);
    }

    [Theory]
    [InlineData(ProviderValidity.NeedsReview, false, ProviderAttemptStates.ResultReady)]
    [InlineData(ProviderValidity.Voided, false, ProviderAttemptStates.Voided)]
    [InlineData(ProviderValidity.Valid, true, ProviderAttemptStates.ResultReady)] // ITC-IA requires_human_review
    [InlineData(ProviderValidity.Valid, false, ProviderAttemptStates.Voided)] // voided after the result was published
    public void Anything_short_of_a_clean_valid_result_is_needs_review_and_never_carries_a_value(
        string validity, bool humanReview, string state)
    {
        var result = Assert.Single(ProviderFitMapping.Map([Row(state, validity, humanReview: humanReview)]));

        Assert.Equal(ProviderResultIntegrity.NeedsReview, result.Integrity);
        Assert.Null(result.GlobalPercentile); // a needs-review result can never be scored, even by accident
    }

    [Fact]
    public void A_voided_attempt_with_no_result_yet_shows_as_needs_review_not_as_missing()
    {
        var result = Assert.Single(ProviderFitMapping.Map([Row(ProviderAttemptStates.Voided, hasResult: false)]));

        Assert.Equal(ProviderResultIntegrity.NeedsReview, result.Integrity);
    }

    [Fact]
    public void Development_results_and_in_flight_attempts_are_not_reported()
    {
        Assert.Empty(ProviderFitMapping.Map([Row(purpose: "development")]));
        Assert.Empty(ProviderFitMapping.Map([Row(ProviderAttemptStates.InProgress, hasResult: false)]));
        Assert.Empty(ProviderFitMapping.Map([Row(ProviderAttemptStates.Created, hasResult: false)]));
    }

    [Theory]
    [InlineData(1.0)] // granted 1.5x, sat at standard time
    [InlineData(2.0)]
    public void A_result_sat_at_another_time_multiplier_than_assigned_is_needs_review_without_a_value(double applied)
    {
        var result = Assert.Single(ProviderFitMapping.Map([Row(requested: 1.5m, applied: (decimal)applied)]));

        Assert.Equal(ProviderResultIntegrity.NeedsReview, result.Integrity);
        Assert.Null(result.GlobalPercentile);
    }

    [Fact]
    public void Only_the_latest_non_cancelled_attempt_per_instrument_is_reported()
    {
        var voided = Row(ProviderAttemptStates.Voided, ProviderValidity.Voided, assignedDay: 1);
        var reassigned = Row(assignedDay: 3);
        var cancelledLater = Row(ProviderAttemptStates.Cancelled, hasResult: false, assignedDay: 5);
        var english = Row(instrument: ProviderInstruments.English, assignedDay: 2);

        var results = ProviderFitMapping.Map([reassigned, voided, cancelledLater, english]);

        Assert.Equal(2, results.Count);
        var lia = Assert.Single(results, r => r.Instrument == ProviderInstruments.Lia);
        Assert.Equal(reassigned.ProviderResultId.ToString(), lia.ResultId);
        Assert.Equal(ProviderResultIntegrity.Valid, lia.Integrity);

        // A re-assignment still in flight supersedes the voided attempt: no stale needs-review entry for it.
        Assert.Empty(ProviderFitMapping.Map([voided, Row(ProviderAttemptStates.Created, hasResult: false, assignedDay: 4)]));
    }

    [Fact]
    public void The_vacancy_reason_wins_and_unknown_or_malformed_entries_list_nothing()
    {
        var listed = JobRelatedness.ParseListedInstruments(
            """{"minYears":2,"assessments":[{"instrument":"lia","reason":"Análisis de datos"},{"instrument":"english"},{"instrument":"astrology"},{"instrument":"lia","reason":"duplicate ignored"},"junk"]}""");

        Assert.Equal(["english", "lia"], listed.Keys.Order().ToArray());
        Assert.Equal("Análisis de datos", listed["lia"]);
        Assert.Null(listed["english"]);
        Assert.Equal("Análisis de datos", JobRelatedness.EffectiveReason(listed["lia"], "HR override"));
        Assert.Equal("Rol con clientes en inglés", JobRelatedness.EffectiveReason(null, "  Rol con clientes en inglés "));
        Assert.Null(JobRelatedness.EffectiveReason(null, "ab"));
        Assert.Null(JobRelatedness.EffectiveReason(null, null));
        Assert.Empty(JobRelatedness.ParseListedInstruments("{not json"));
        Assert.Empty(JobRelatedness.ParseListedInstruments("""{"assessments":{"instrument":"lia"}}"""));
        Assert.Empty(JobRelatedness.ParseListedInstruments(null));
    }

    [Theory]
    [InlineData(ProviderAttemptStates.Created, ProviderAttemptStates.InProgress, true)]
    [InlineData(ProviderAttemptStates.Launched, ProviderAttemptStates.Completed, true)]
    [InlineData(ProviderAttemptStates.Completed, ProviderAttemptStates.InProgress, false)] // late assignment.started
    [InlineData(ProviderAttemptStates.ResultReady, ProviderAttemptStates.Completed, false)] // late session.completed
    [InlineData(ProviderAttemptStates.InProgress, ProviderAttemptStates.Expired, true)]
    [InlineData(ProviderAttemptStates.Completed, ProviderAttemptStates.Expired, false)] // never expire a finished sitting
    [InlineData(ProviderAttemptStates.InProgress, ProviderAttemptStates.Voided, true)] // a void wins over an open sitting
    [InlineData(ProviderAttemptStates.Completed, ProviderAttemptStates.Voided, true)]
    [InlineData(ProviderAttemptStates.ResultReady, ProviderAttemptStates.Voided, false)] // a late session.voided: results decide
    [InlineData(ProviderAttemptStates.Voided, ProviderAttemptStates.InProgress, false)]
    [InlineData(ProviderAttemptStates.Cancelled, ProviderAttemptStates.Voided, false)]
    [InlineData(ProviderAttemptStates.Erased, ProviderAttemptStates.ResultReady, false)]
    [InlineData(ProviderAttemptStates.Created, ProviderAttemptStates.PendingCreate, false)]
    [InlineData(ProviderAttemptStates.Created, "bogus", false)]
    public void Lifecycle_events_only_move_attempts_forward(string from, string to, bool allowed)
    {
        Assert.Equal(allowed, ProviderAttemptStates.CanTransition(from, to));
    }

    [Theory]
    [InlineData(ProviderAttemptStates.InProgress, false, false, true)]
    [InlineData(ProviderAttemptStates.Voided, true, false, true)]
    [InlineData(ProviderAttemptStates.Voided, false, false, false)]
    [InlineData(ProviderAttemptStates.Voided, true, true, false)]
    [InlineData(ProviderAttemptStates.ResultReady, true, true, false)]
    [InlineData(ProviderAttemptStates.Completed, true, false, false)]
    [InlineData(ProviderAttemptStates.Expired, true, false, false)]
    public void A_staff_cancel_overwrites_only_cancellable_states_and_the_void_its_own_confirmed_cancel_caused(
        string state, bool cancelledAtProvider, bool hasResult, bool expected) =>
        Assert.Equal(expected, ProviderAttemptStates.CanStaffCancelOver(state, cancelledAtProvider, hasResult));
}
