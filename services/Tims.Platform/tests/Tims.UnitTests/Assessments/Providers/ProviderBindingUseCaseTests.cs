using Tims.Application.Assessments.Providers;

namespace Tims.UnitTests.Assessments.Providers;

/// <summary>Platform-owner binding: only instruments the provider offers for selection (hiring) can be enabled.</summary>
public sealed class ProviderBindingUseCaseTests
{
    private static readonly DateTimeOffset Now = new(2026, 11, 9, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task Binding_creates_the_provider_tenant_and_stores_the_enabled_instruments()
    {
        var repository = new FakeRepository { Binding = null };
        var provider = new FakeProvider();

        var result = await new ProviderBindingUseCase(repository, provider).BindOrganizationAsync(
            Guid.NewGuid(), new ProviderBindingInput(FakeRepository.Org, ["lia", "english"], "es"), Now, CancellationToken.None);

        Assert.Equal(ProviderBindingOutcome.Bound, result.Outcome);
        Assert.Equal(["lia", "english"], result.Binding!.EnabledInstruments);
        Assert.Equal(provider.TenantId.ToString(), result.Binding.ProviderTenantId);
        Assert.Equal(["catalog", "tenant"], provider.Calls);
    }

    [Fact]
    public async Task A_development_only_instrument_cannot_be_enabled_for_hiring()
    {
        var repository = new FakeRepository { Binding = null };
        var provider = new FakeProvider(); // its catalog marks mi as selection_allowed: false

        var result = await new ProviderBindingUseCase(repository, provider).BindOrganizationAsync(
            Guid.NewGuid(), new ProviderBindingInput(FakeRepository.Org, ["lia", "mi"], "es"), Now, CancellationToken.None);

        Assert.Equal(ProviderBindingOutcome.InstrumentNotOffered, result.Outcome);
        Assert.Equal("mi", result.Detail);
        Assert.DoesNotContain("binding", repository.Writes);
        Assert.DoesNotContain("tenant", provider.Calls);
    }
}
