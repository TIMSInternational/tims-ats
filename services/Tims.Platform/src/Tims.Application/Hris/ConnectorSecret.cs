namespace Tims.Application.Hris;

/// <summary>
/// A wrapper around a connector credential (e.g. the BambooHR API key) whose ONE job is to keep the
/// plaintext from ever being logged, serialized, or echoed. HARD requirement (Phase 3): the secret
/// goes ONLY into the connector's Authorization header — nowhere else.
///
/// Hygiene mechanics:
/// <list type="bullet">
///   <item><see cref="ToString"/> is masked, so string interpolation / structured logging emit
///     <c>***</c>, never the value.</item>
///   <item>The plaintext is exposed ONLY through the explicit <see cref="Reveal"/> METHOD, never a
///     property — so reflection-based serializers (System.Text.Json, Serilog destructuring) do not
///     pick it up, and every read site is greppable.</item>
/// </list>
/// </summary>
public sealed class ConnectorSecret
{
    private readonly string _value;

    public ConnectorSecret(string value)
    {
        if (string.IsNullOrEmpty(value))
        {
            throw new ArgumentException("A connector secret cannot be null or empty.", nameof(value));
        }

        _value = value;
    }

    /// <summary>
    /// Returns the plaintext credential. The ONLY legitimate caller is the connector building its
    /// Authorization header — deliberately a method (not a property) so it is not serialized and every
    /// use is explicit and auditable.
    /// </summary>
    public string Reveal() => _value;

    /// <summary>Masked — the plaintext is never rendered, even under interpolation or logging.</summary>
    public override string ToString() => "***";
}
