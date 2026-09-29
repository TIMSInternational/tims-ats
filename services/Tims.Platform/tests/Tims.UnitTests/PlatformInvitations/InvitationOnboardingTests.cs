using Tims.Application.PlatformInvitations;

namespace Tims.UnitTests.PlatformInvitations;

public sealed class InvitationOnboardingTests
{
    private static readonly string Token = Guid.NewGuid().ToString();
    private static readonly SetupProfile Profile = new("Test", "Recipient");

    private sealed class Repository : IInvitationOnboardingRepository
    {
        public InvitationSetup? Invitation { get; set; } = new(Guid.NewGuid(), "invitee@example.test",
            Guid.NewGuid(), "Test org", "recruiter", "pending", DateTime.UtcNow.AddDays(1), false);
        public int Writes { get; private set; }
        public Task<InvitationSetup?> PreviewAsync(string token, CancellationToken ct) => Task.FromResult(Invitation);
        public Task<bool> CompleteAsync(string token, SetupIdentity identity, SetupProfile profile, CancellationToken ct)
        { Writes++; return Task.FromResult(true); }
    }

    private sealed class Identity : IInvitationIdentityProvider
    {
        public SetupIdentity? User { get; set; } = new(Guid.NewGuid().ToString(), "invitee@example.test");
        public int Creates { get; private set; }
        public Task<bool> CreateAsync(string email, string password, CancellationToken ct)
        { Creates++; return Task.FromResult(true); }
        public Task<SetupIdentity?> VerifyAsync(string accessToken, CancellationToken ct) => Task.FromResult(User);
    }

    [Fact]
    public async Task New_identity_requires_separate_authenticated_finalization()
    {
        var repository = new Repository();
        var identity = new Identity();
        var setup = new InvitationOnboarding(repository, identity, TimeProvider.System);
        Assert.Equal("account_created", (await setup.RegisterAsync(Token, "a-long-test-secret", default)).Outcome);
        Assert.Equal(0, repository.Writes);
        Assert.Equal("complete", (await setup.CompleteAsync(Token, "verified", Profile, default)).Outcome);
        Assert.Equal(1, repository.Writes);
    }

    [Fact]
    public async Task Existing_account_credentials_are_never_overwritten()
    {
        var repository = new Repository { Invitation = new Repository().Invitation! with { AccountExists = true } };
        var identity = new Identity();
        var setup = new InvitationOnboarding(repository, identity, TimeProvider.System);
        Assert.Equal("sign_in_required", (await setup.RegisterAsync(Token, "a-long-test-secret", default)).Outcome);
        Assert.Equal(0, identity.Creates);
    }

    [Theory]
    [InlineData("accepted")]
    [InlineData("revoked")]
    [InlineData("expired")]
    public async Task Terminal_invitation_cannot_create_identity(string status)
    {
        var repository = new Repository();
        repository.Invitation = repository.Invitation! with { Status = status };
        var identity = new Identity();
        var setup = new InvitationOnboarding(repository, identity, TimeProvider.System);
        Assert.Equal("unavailable", (await setup.RegisterAsync(Token, "a-long-test-secret", default)).Outcome);
        Assert.Equal(0, identity.Creates);
    }

    [Fact]
    public async Task Wrong_or_unverified_identity_cannot_finalize()
    {
        var repository = new Repository();
        var wrong = new Identity { User = new(Guid.NewGuid().ToString(), "another@example.test") };
        var setup = new InvitationOnboarding(repository, wrong, TimeProvider.System);
        Assert.Equal("wrong_account", (await setup.CompleteAsync(Token, "verified", Profile, default)).Outcome);
        wrong.User = null;
        Assert.Equal("sign_in_required", (await setup.CompleteAsync(Token, "invalid", Profile, default)).Outcome);
        Assert.Equal(0, repository.Writes);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(11)]
    [InlineData(129)]
    public async Task Secret_bounds_prevent_identity_calls(int length)
    {
        var identity = new Identity();
        var setup = new InvitationOnboarding(new Repository(), identity, TimeProvider.System);
        Assert.Equal("invalid_input", (await setup.RegisterAsync(Token, new string('p', length), default)).Outcome);
        Assert.Equal(0, identity.Creates);
    }

    [Theory]
    [InlineData("es", "Configurar mi acceso")]
    [InlineData("en", "Set up your access")]
    public void Email_encodes_untrusted_details_and_explains_setup(string locale, string cta)
    {
        var body = InvitationEmail.Render("<script>org</script>", "<admin>",
            "https://app.example.test/accept-invitation?token=test", new DateTime(2026, 9, 22), locale);
        Assert.DoesNotContain("<script>", body);
        Assert.DoesNotContain("<admin>", body);
        Assert.Contains(cta, body);
        Assert.Contains(locale == "en" ? "password" : "contraseña", body);
        Assert.Contains("role=\"presentation\"", body);
    }
}
