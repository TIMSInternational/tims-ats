using Microsoft.Extensions.Options;
using Tims.Application.Hris;
using Tims.Domain.Hris;
using Tims.Infrastructure.Hris.BambooHr;

namespace Tims.Infrastructure.Hris;

/// <summary>
/// <see cref="IHrisConnectorFactory"/> keyed on <see cref="HrisProvider"/>. Phase 3 wires only
/// BambooHR (injected as the typed <see cref="BambooHrConnector"/>); any other provider is a
/// mis-provisioned connector row and throws <see cref="NotSupportedException"/> rather than returning
/// a broken connector. A provider that is wired but DISABLED (its <c>Hris:*Enabled</c> flag is false)
/// FAILS CLOSED — it throws instead of handing back a live connector.
/// </summary>
public sealed class HrisConnectorFactory : IHrisConnectorFactory
{
    private readonly BambooHrConnector _bambooHrConnector;
    private readonly HrisOptions _options;

    public HrisConnectorFactory(BambooHrConnector bambooHrConnector, IOptions<HrisOptions> options)
    {
        _bambooHrConnector = bambooHrConnector;
        _options = options.Value;
    }

    public IHrisConnector Create(HrisProvider provider) => provider switch
    {
        HrisProvider.BambooHr => _options.BambooHrEnabled
            ? _bambooHrConnector
            : throw new InvalidOperationException(
                "The BambooHR HRIS connector is disabled (Hris:BambooHrEnabled = false); refusing to create it (fail-closed)."),
        _ => throw new NotSupportedException(
            $"No HRIS connector is wired for provider '{provider}'. Only BambooHR is supported in Phase 3."),
    };
}
