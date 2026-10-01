using System.Text.Json.Nodes;
using Tims.Application.CandidateConsent;
using Xunit;

namespace Tims.UnitTests.CandidateConsent;

/// <summary>
/// #312 pure rules: the strict staff-withdrawal and self-service bodies, and the self-service orchestration (org by
/// slug, canonical email, always a deletion request, the data subject as actor).
/// </summary>
public sealed class CandidateConsentUseCaseTests
{
    private static JsonNode? Parse(string json) => JsonNode.Parse(json);

    [Fact]
    public void Staff_ValidBody_TrimsReason_AndReadsDeletionFlag()
    {
        Assert.True(CandidateConsentUseCase.TryParseStaffWithdrawal(
            Parse("""{"channel":"email","reason":"  Pidió no ser contactado  ","requestDeletion":true}"""), out var input));
        Assert.Equal("email", input.Channel);
        Assert.Equal("Pidió no ser contactado", input.Reason);
        Assert.True(input.RequestDeletion);
    }

    [Fact]
    public void Staff_OptionalFields_DefaultToNoReasonAndNoDeletion()
    {
        Assert.True(CandidateConsentUseCase.TryParseStaffWithdrawal(Parse("""{"channel":"in_person"}"""), out var a));
        Assert.Null(a.Reason);
        Assert.False(a.RequestDeletion);
        Assert.True(CandidateConsentUseCase.TryParseStaffWithdrawal(Parse("""{"channel":"letter","reason":"   "}"""), out var b));
        Assert.Null(b.Reason);
        Assert.True(CandidateConsentUseCase.TryParseStaffWithdrawal(Parse("""{"channel":"phone","reason":null}"""), out var c));
        Assert.Null(c.Reason);
    }

    [Theory]
    [InlineData("""{}""")] // channel required
    [InlineData("""{"channel":"portal"}""")] // self-service only
    [InlineData("""{"channel":"EMAIL"}""")] // exact values
    [InlineData("""{"channel":"fax"}""")]
    [InlineData("""{"channel":1}""")]
    [InlineData("""{"channel":"email","reason":5}""")]
    [InlineData("""{"channel":"email","reason":"a\u0000b"}""")] // control characters
    [InlineData("""{"channel":"email","requestDeletion":"yes"}""")]
    [InlineData("""{"channel":"email","requestDeletion":null}""")]
    [InlineData("""{"channel":"email","withdrawnBy":"x"}""")] // unknown key
    [InlineData("""[]""")]
    [InlineData("""null""")]
    public void Staff_InvalidBody_IsRejected(string json) =>
        Assert.False(CandidateConsentUseCase.TryParseStaffWithdrawal(Parse(json), out _));

    [Fact]
    public void Staff_ReasonBound_IsInclusive()
    {
        var max = new string('a', CandidateConsentConstants.MaxReasonLength);
        Assert.True(CandidateConsentUseCase.TryParseStaffWithdrawal(
            Parse($$"""{"channel":"other","reason":"{{max}}"}"""), out _));
        Assert.False(CandidateConsentUseCase.TryParseStaffWithdrawal(
            Parse($$"""{"channel":"other","reason":"{{max}}a"}"""), out _));
    }

    [Theory]
    [InlineData("""{"organizationSlug":"acme"}""", "acme")]
    [InlineData("""{"organizationSlug":"acme-colombia-2"}""", "acme-colombia-2")]
    public void Portal_ValidBody(string json, string slug)
    {
        Assert.True(CandidateConsentUseCase.TryParsePortalWithdrawal(Parse(json), out var parsed));
        Assert.Equal(slug, parsed);
    }

    [Theory]
    [InlineData("""{}""")]
    [InlineData("""{"organizationSlug":""}""")]
    [InlineData("""{"organizationSlug":"Acme"}""")]
    [InlineData("""{"organizationSlug":"acme corp"}""")]
    [InlineData("""{"organizationSlug":"acme","email":"a@b.co"}""")] // the identity is never input
    [InlineData("""{"organizationSlug":7}""")]
    public void Portal_InvalidBody_IsRejected(string json) =>
        Assert.False(CandidateConsentUseCase.TryParsePortalWithdrawal(Parse(json), out _));

    [Fact]
    public void Portal_SlugBound()
    {
        var max = new string('a', CandidateConsentUseCase.MaxSlugLength);
        Assert.True(CandidateConsentUseCase.TryParsePortalWithdrawal(Parse($$"""{"organizationSlug":"{{max}}"}"""), out _));
        Assert.False(CandidateConsentUseCase.TryParsePortalWithdrawal(Parse($$"""{"organizationSlug":"{{max}}a"}"""), out _));
    }

    [Fact]
    public async Task Subject_UnknownOrg_WritesNothing()
    {
        var repository = new FakeRepository { OrganizationId = null };
        var result = await new CandidateConsentUseCase(repository).WithdrawBySubjectAsync(
            "nope", "Ana@Example.com", DateTime.UtcNow, CancellationToken.None);
        Assert.False(result.OrganizationFound);
        Assert.Null(repository.LastEmail);
    }

    [Fact]
    public async Task Subject_Withdrawal_IsByCanonicalEmail_AsDataSubject_WithDeletionRequest()
    {
        var orgId = Guid.NewGuid();
        var repository = new FakeRepository { OrganizationId = orgId };
        await new CandidateConsentUseCase(repository).WithdrawBySubjectAsync(
            "acme", "  Ana@Example.COM ", DateTime.UtcNow, CancellationToken.None);

        Assert.Equal(orgId, repository.LastOrganizationId);
        Assert.Equal("ana@example.com", repository.LastEmail);
        var actor = Assert.IsType<WithdrawalActor>(repository.LastActor);
        Assert.Null(actor.StaffUserId);
        Assert.Equal(CandidateConsentConstants.PortalChannel, actor.Channel);
        Assert.True(actor.RequestDeletion);
        Assert.Equal(CandidateConsentConstants.CandidatePortalSource, actor.RequestSource);
    }

    [Fact]
    public async Task Staff_Withdrawal_CarriesTheStaffActor()
    {
        var repository = new FakeRepository();
        var actorId = Guid.NewGuid();
        await new CandidateConsentUseCase(repository).WithdrawByStaffAsync(
            Guid.NewGuid(), actorId, Guid.NewGuid(), new StaffWithdrawalInput("phone", "r", false), DateTime.UtcNow,
            CancellationToken.None);
        var actor = Assert.IsType<WithdrawalActor>(repository.LastActor);
        Assert.Equal(actorId, actor.StaffUserId);
        Assert.Equal("phone", actor.Channel);
        Assert.Equal(CandidateConsentConstants.StaffSource, actor.RequestSource);
    }

    private sealed class FakeRepository : ICandidateConsentRepository
    {
        public Guid? OrganizationId { get; init; }

        public Guid? LastOrganizationId { get; private set; }

        public string? LastEmail { get; private set; }

        public WithdrawalActor? LastActor { get; private set; }

        public Task<CandidateConsentResult> GetAsync(Guid organizationId, Guid candidateId, CancellationToken cancellationToken) =>
            Task.FromResult(CandidateConsentResult.NotFound);

        public Task<CandidateConsentResult> WithdrawAsync(
            Guid organizationId, Guid candidateId, WithdrawalActor actor, DateTime now, CancellationToken cancellationToken)
        {
            LastActor = actor;
            return Task.FromResult(CandidateConsentResult.NotFound);
        }

        public Task<Guid?> FindActiveOrganizationBySlugAsync(string slug, CancellationToken cancellationToken) =>
            Task.FromResult(OrganizationId);

        public Task<PortalWithdrawalResult> WithdrawByEmailAsync(
            Guid organizationId, string email, WithdrawalActor actor, DateTime now, CancellationToken cancellationToken)
        {
            LastOrganizationId = organizationId;
            LastEmail = email;
            LastActor = actor;
            return Task.FromResult(new PortalWithdrawalResult(true, 1, 1));
        }
    }
}
