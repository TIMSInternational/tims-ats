using Tims.Domain.Hris;

namespace Tims.Application.Hris;

/// <summary>
/// Resolves the <see cref="IHrisConnector"/> for an <see cref="HrisProvider"/>. Phase 3 wires only
/// <see cref="HrisProvider.BambooHr"/>; an unwired provider throws (fail-closed) rather than returning
/// a silently-broken connector, so a mis-provisioned <c>hris_connectors.provider</c> surfaces loudly.
/// </summary>
public interface IHrisConnectorFactory
{
    /// <summary>
    /// Returns the connector for <paramref name="provider"/>, or throws
    /// <see cref="System.NotSupportedException"/> when no connector is wired for it.
    /// </summary>
    IHrisConnector Create(HrisProvider provider);
}
