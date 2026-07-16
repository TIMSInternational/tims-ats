using System.Text.Json;
using Tims.Application.Hris;

namespace Tims.IntegrationTests.Hris;

/// <summary>
/// WP3.2 secret hygiene (HARD requirement): a <see cref="ConnectorSecret"/> must never render its
/// plaintext via ToString, interpolation, or serialization — only the connector's explicit
/// <see cref="ConnectorSecret.Reveal"/> may read it.
/// </summary>
public sealed class ConnectorSecretTests
{
    private const string Plaintext = "top-secret-bamboo-key";

    [Fact]
    public void ToString_is_masked()
    {
        var secret = new ConnectorSecret(Plaintext);

        Assert.Equal("***", secret.ToString());
        Assert.DoesNotContain(Plaintext, $"the secret is {secret}", StringComparison.Ordinal);
    }

    [Fact]
    public void Json_serialization_does_not_expose_the_plaintext()
    {
        var secret = new ConnectorSecret(Plaintext);

        // No public property returns the value, so System.Text.Json emits no plaintext.
        var json = JsonSerializer.Serialize(secret);

        Assert.DoesNotContain(Plaintext, json, StringComparison.Ordinal);
    }

    [Fact]
    public void Reveal_returns_the_plaintext_for_the_connector()
    {
        var secret = new ConnectorSecret(Plaintext);

        Assert.Equal(Plaintext, secret.Reveal());
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    public void Rejects_a_null_or_empty_secret(string? value)
    {
        Assert.Throws<ArgumentException>(() => new ConnectorSecret(value!));
    }
}
