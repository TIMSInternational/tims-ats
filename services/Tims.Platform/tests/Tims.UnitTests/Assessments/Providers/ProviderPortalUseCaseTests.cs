using Tims.Application.Assessments.Providers;
using Tims.Domain.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>
/// The candidate portal's reads (D16): coarse statuses only (D9: never a review or validity state), only the candidate's
/// own attempts, and consent templates only for an attempt that still needs consent.
/// </summary>
public sealed class ProviderPortalUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 14, 0, 0, TimeSpan.Zero);

    private readonly FakeRepository _repository = new();
    private readonly FakeProvider _provider = new();

    private ProviderPortalUseCase Portal => new(_repository, _provider);

    [Theory]
    [InlineData(ProviderAttemptStates.Created, false, false, ProviderPortalStatuses.Ready)]
    [InlineData(ProviderAttemptStates.Launched, true, false, ProviderPortalStatuses.ConsentNeeded)]
    [InlineData(ProviderAttemptStates.Created, true, true, ProviderPortalStatuses.Expired)]
    [InlineData(ProviderAttemptStates.InProgress, false, true, ProviderPortalStatuses.InProgress)] // resumable past the start deadline
    [InlineData(ProviderAttemptStates.Completed, false, false, ProviderPortalStatuses.Completed)]
    [InlineData(ProviderAttemptStates.ResultReady, false, false, ProviderPortalStatuses.Completed)] // whatever the validity (D9)
    [InlineData(ProviderAttemptStates.Expired, false, false, ProviderPortalStatuses.Expired)]
    [InlineData(ProviderAttemptStates.Voided, false, false, ProviderPortalStatuses.NeedsReview)] // D4: the org decides on a retake
    [InlineData(ProviderAttemptStates.PendingCreate, false, false, null)]
    [InlineData(ProviderAttemptStates.Cancelled, false, false, null)]
    [InlineData(ProviderAttemptStates.Erased, false, false, null)]
    public void Each_attempt_state_shows_one_coarse_portal_status(string state, bool missing, bool pastDeadline, string? expected)
    {
        var created = _repository.AddCreatedAttempt("lia", state, pastDeadline ? Now.AddMinutes(-1) : Now.AddDays(3));
        var attempt = created with { MissingConsents = missing ? ["assessment"] : [] };

        Assert.Equal(expected, ProviderPortalStatuses.For(attempt, Now));
    }

    // Codex release round A2 [P2] (D9): a published result voided later by a new revision leaves the attempt voided but
    // holding a result; the candidate keeps seeing "completed", never the invalidation.
    [Theory]
    [InlineData(ProviderAttemptStates.Voided)]
    [InlineData(ProviderAttemptStates.Expired)]
    public void A_finished_attempt_holding_a_result_shows_as_completed_whatever_its_later_revisions(string state)
    {
        var attempt = _repository.AddCreatedAttempt("lia", state) with { LatestResultId = Guid.NewGuid() };

        Assert.Equal(ProviderPortalStatuses.Completed, ProviderPortalStatuses.For(attempt, Now));
    }

    [Fact]
    public void An_attempt_in_a_withdrawal_or_under_erasure_is_never_shown()
    {
        var attempt = _repository.AddCreatedAttempt("lia");

        Assert.Null(ProviderPortalStatuses.For(attempt with { WithdrawalState = ProviderWithdrawalStates.Pending }, Now));
        Assert.Null(ProviderPortalStatuses.For(attempt with { ErasureRequestedAt = Now }, Now));
    }

    [Fact]
    public async Task The_list_carries_status_missing_purposes_deadline_and_delivery_and_hides_the_rest()
    {
        var lia = _repository.AddCreatedAttempt("lia");
        _repository.Attempts[0] = lia with { MissingConsents = ["assessment", "ai_scoring"] };
        _repository.AddCreatedAttempt("pca", ProviderAttemptStates.InProgress);
        _repository.AddCreatedAttempt("english", ProviderAttemptStates.Cancelled);

        var list = await Portal.ListAsync("invu", "ANA@example.com ", Now, CancellationToken.None);

        Assert.Equal(PortalOutcome.Ok, list.Outcome);
        Assert.Equal(2, list.Attempts.Count);
        var first = list.Attempts.Single(a => a.Instrument == "lia");
        Assert.Equal((ProviderPortalStatuses.ConsentNeeded, "native"), (first.Status, first.Delivery));
        Assert.Equal(["assessment", "ai_scoring"], first.MissingConsents);
        // The candidate's own application's vacancy: the portal names it in the consent notice.
        Assert.Equal(FakeRepository.Vacancy, first.VacancyId);
        var second = list.Attempts.Single(a => a.Instrument == "pca");
        Assert.Equal((ProviderPortalStatuses.InProgress, "link_out"), (second.Status, second.Delivery));
        Assert.Empty(second.MissingConsents);
        Assert.Empty(_provider.Calls); // listing never calls the provider
    }

    [Fact]
    public async Task An_unknown_organization_slug_is_not_found()
    {
        var list = await Portal.ListAsync("someone-else", "ana@example.com", Now, CancellationToken.None);

        Assert.Equal(PortalOutcome.NotFound, list.Outcome);
    }

    [Fact]
    public async Task Templates_are_fetched_for_each_missing_purpose_in_the_portal_locale()
    {
        var attempt = _repository.AddCreatedAttempt("english");
        _repository.Attempts[0] = attempt with { MissingConsents = ["assessment", "voice"] };

        var result = await Portal.ConsentTemplatesAsync(attempt.Id, "ana@example.com", "en", Now, CancellationToken.None);

        Assert.Equal(PortalOutcome.Ok, result.Outcome);
        Assert.Equal(["assessment", "voice"], result.Templates.Select(t => t.Purpose));
        Assert.Equal([("assessment", "en"), ("voice", "en")], _provider.TemplateRequests);
    }

    [Fact]
    public async Task A_locale_the_provider_does_not_offer_falls_back_to_the_attempts_locale()
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.Attempts[0] = attempt with { MissingConsents = ["assessment"] };
        _provider.OnConsentTemplate = (purpose, locale) => locale == "en"
            ? ProviderCall<ProviderConsentTemplate>.Fail(new ProviderFailure(422, "locale_not_supported", false, []))
            : ProviderCall<ProviderConsentTemplate>.Success(FakeProvider.Template(purpose, locale));

        var result = await Portal.ConsentTemplatesAsync(attempt.Id, "ana@example.com", "en", Now, CancellationToken.None);

        Assert.Equal("es", Assert.Single(result.Templates).Locale);
    }

    [Theory]
    [InlineData("other@example.com", false, false)] // not this candidate's attempt
    [InlineData("ana@example.com", true, false)]    // nothing left to consent to
    [InlineData("ana@example.com", false, true)]    // #312 withdrawn
    public async Task Templates_are_not_found_unless_the_attempt_is_the_candidates_and_needs_consent(
        string email, bool nothingMissing, bool withdrawn)
    {
        var attempt = _repository.AddCreatedAttempt("lia");
        _repository.Attempts[0] = attempt with { MissingConsents = nothingMissing ? [] : ["assessment"] };
        _repository.LaunchWithdrawn = withdrawn;

        var result = await Portal.ConsentTemplatesAsync(attempt.Id, email, "es", Now, CancellationToken.None);

        Assert.Equal(PortalOutcome.NotFound, result.Outcome);
        Assert.Empty(_provider.TemplateRequests);
    }

    [Fact]
    public async Task A_template_the_provider_cannot_serve_makes_the_whole_answer_unavailable()
    {
        var attempt = _repository.AddCreatedAttempt("english");
        _repository.Attempts[0] = attempt with { MissingConsents = ["assessment", "voice"] };
        _provider.OnConsentTemplate = (purpose, locale) => purpose == "voice"
            ? ProviderCall<ProviderConsentTemplate>.Fail(ProviderFailure.Local(ProviderFailure.Unavailable, true))
            : ProviderCall<ProviderConsentTemplate>.Success(FakeProvider.Template(purpose, locale));

        var result = await Portal.ConsentTemplatesAsync(attempt.Id, "ana@example.com", "es", Now, CancellationToken.None);

        Assert.Equal(new PortalConsentTemplates(PortalOutcome.ProviderUnavailable, []), result with { Templates = [] });
        Assert.Empty(result.Templates); // never a partial consent screen
    }
}
