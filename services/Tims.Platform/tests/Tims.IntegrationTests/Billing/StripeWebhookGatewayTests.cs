using System.Security.Cryptography;
using System.Text;
using Tims.Application.Billing;
using Tims.Infrastructure.Billing;

namespace Tims.IntegrationTests.Billing;

/// <summary>
/// Proves the REAL Stripe.net boundary in <see cref="StripeWebhookGateway"/> (no network): HMAC signature
/// verification (accept a genuinely-signed payload; reject missing secret/header, a tampered body, and a bad
/// signature — each a WebhookVerificationException → 400) AND the normalization of a Stripe subscription event
/// onto the infra-free snapshot (period read from the ITEM, unix conversion, metadata.orgId, customer id). The
/// signature is computed here exactly as Stripe does (<c>HMAC-SHA256(secret, "{t}.{payload}")</c>).
/// </summary>
public sealed class StripeWebhookGatewayTests
{
    // A throwaway HMAC key (any bytes work); deliberately low-entropy + non-Stripe-shaped so no secret scanner
    // mistakes it for a real signing secret.
    private const string Secret = "test-webhook-signing-key";
    private const string SubscriptionEventJson =
        """
        {
          "id": "evt_1",
          "object": "event",
          "type": "customer.subscription.updated",
          "created": 1609459200,
          "data": { "object": {
            "id": "sub_1",
            "object": "subscription",
            "status": "active",
            "customer": "cus_1",
            "cancel_at_period_end": false,
            "cancel_at": null,
            "canceled_at": null,
            "metadata": { "orgId": "11111111-1111-1111-1111-111111111111" },
            "items": { "object": "list", "data": [ {
              "id": "si_1",
              "object": "subscription_item",
              "price": { "id": "price_pro", "object": "price" },
              "current_period_start": 1609459200,
              "current_period_end": 1612137600
            } ] }
          } }
        }
        """;

    private static StripeWebhookGateway Gateway(string? secret = Secret) => new(secretKey: "sk_test_x", webhookSecret: secret);

    // Compute a valid Stripe-Signature header (current timestamp so it's inside the default 300s tolerance).
    private static string SignatureFor(string payload)
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(Secret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{payload}"));
        var hex = Convert.ToHexString(hash).ToLowerInvariant();
        return $"t={timestamp},v1={hex}";
    }

    [Fact]
    public void ConstructEvent_rejects_a_missing_webhook_secret()
    {
        var ex = Assert.Throws<WebhookVerificationException>(() =>
            Gateway(secret: null).ConstructEvent(SubscriptionEventJson, SignatureFor(SubscriptionEventJson)));
        Assert.Contains("secret", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ConstructEvent_rejects_a_missing_api_secret_key()
    {
        // TS constructWebhookEvent calls getStripe() (requires STRIPE_SECRET_KEY) during verification, so a
        // half-configured deploy (webhook secret present, API secret absent) fails closed → 400, never processes.
        var gateway = new StripeWebhookGateway(secretKey: null, webhookSecret: Secret);
        var ex = Assert.Throws<WebhookVerificationException>(() =>
            gateway.ConstructEvent(SubscriptionEventJson, SignatureFor(SubscriptionEventJson)));
        Assert.Contains("SecretKey", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ConstructEvent_rejects_a_missing_signature_header()
    {
        var ex = Assert.Throws<WebhookVerificationException>(() =>
            Gateway().ConstructEvent(SubscriptionEventJson, signature: null));
        Assert.Contains("Stripe-Signature", ex.Message, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ConstructEvent_rejects_a_bad_signature()
    {
        Assert.Throws<WebhookVerificationException>(() =>
            Gateway().ConstructEvent(SubscriptionEventJson, "t=1,v1=deadbeef"));
    }

    [Fact]
    public void ConstructEvent_rejects_a_tampered_body()
    {
        // Sign the original, then verify a MUTATED payload with that signature → HMAC mismatch → reject.
        var signature = SignatureFor(SubscriptionEventJson);
        var tampered = SubscriptionEventJson.Replace("price_pro", "price_enterprise", StringComparison.Ordinal);
        Assert.Throws<WebhookVerificationException>(() => Gateway().ConstructEvent(tampered, signature));
    }

    [Fact]
    public void ConstructEvent_verifies_and_normalizes_a_subscription_event()
    {
        var result = Gateway().ConstructEvent(SubscriptionEventJson, SignatureFor(SubscriptionEventJson));

        Assert.Equal("customer.subscription.updated", result.Type);
        // event.created (1609459200) → the canonical ordering instant.
        Assert.Equal(DateTimeOffset.FromUnixTimeSeconds(1609459200), result.CreatedAt);
        Assert.Null(result.Checkout);

        var snapshot = Assert.IsType<StripeSubscriptionSnapshot>(result.Subscription);
        Assert.Equal("cus_1", snapshot.CustomerId);
        Assert.Equal("11111111-1111-1111-1111-111111111111", snapshot.MetaOrgId);

        var sub = snapshot.Subscription;
        Assert.Equal("sub_1", sub.Id);
        Assert.Equal("active", sub.Status);
        Assert.False(sub.CancelAtPeriodEnd);
        Assert.Null(sub.CancelAt);
        Assert.Null(sub.CanceledAt);

        // The period lives on items.data[0] (recent Stripe API), normalized back to unix seconds.
        var item = Assert.Single(sub.Items.Data);
        Assert.Equal("price_pro", item.Price.Id);
        Assert.Equal(1609459200, item.CurrentPeriodStart);
        Assert.Equal(1612137600, item.CurrentPeriodEnd);
    }
}
