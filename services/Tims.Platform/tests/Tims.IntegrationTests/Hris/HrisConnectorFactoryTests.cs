using Microsoft.Extensions.Options;
using Tims.Domain.Hris;
using Tims.Infrastructure.Hris;
using Tims.Infrastructure.Hris.BambooHr;

namespace Tims.IntegrationTests.Hris;

/// <summary>
/// WP3.2 — <see cref="HrisConnectorFactory"/> resolves the wired BambooHR connector and fails closed
/// (throws) for any provider that has no connector, so a mis-provisioned <c>provider</c> value surfaces
/// loudly instead of resolving a broken connector. It ALSO fails closed when a wired provider is disabled
/// via its <c>Hris:*Enabled</c> flag.
/// </summary>
public sealed class HrisConnectorFactoryTests
{
    private static BambooHrConnector NewBambooConnector() =>
        new(new HttpClient(), new EnvConnectorSecretStore(), Options.Create(new HrisOptions()));

    private static HrisConnectorFactory NewFactory(BambooHrConnector connector, bool bambooEnabled = true) =>
        new(connector, Options.Create(new HrisOptions { BambooHrEnabled = bambooEnabled }));

    [Fact]
    public void Create_returns_the_bamboo_hr_connector()
    {
        var connector = NewBambooConnector();
        var factory = NewFactory(connector);

        Assert.Same(connector, factory.Create(HrisProvider.BambooHr));
    }

    [Fact]
    public void Create_throws_for_an_unwired_provider()
    {
        var factory = NewFactory(NewBambooConnector());

        // No connector is wired for an out-of-range provider value (fail-closed).
        Assert.Throws<NotSupportedException>(() => factory.Create((HrisProvider)999));
    }

    [Fact]
    public void Create_fails_closed_when_the_bamboo_hr_provider_is_disabled()
    {
        var factory = NewFactory(NewBambooConnector(), bambooEnabled: false);

        // Disabled provider ⇒ throw, never hand back a live connector.
        Assert.Throws<InvalidOperationException>(() => factory.Create(HrisProvider.BambooHr));
    }
}
