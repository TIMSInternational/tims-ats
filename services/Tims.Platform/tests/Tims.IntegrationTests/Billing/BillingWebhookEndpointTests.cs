using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;

namespace Tims.IntegrationTests.Billing;

/// <summary>
/// Boots <c>WebApplicationFactory&lt;Program&gt;</c> against the real container and drives the ACTUAL HTTP
/// pipeline for <c>POST /billing/webhooks/stripe</c> — proving the raw-body read survives the middleware
/// (a broken raw read would silently fail signature verification), the 400/200 status contract, AND a full
/// end-to-end write (signed subscription event → org resolved by linkage → the row is updated). Uses a real
/// signature computed exactly as Stripe does. The route is dark-by-default, so the flag is enabled here.
/// </summary>
public sealed class BillingWebhookEndpointTests(BillingWebhookFixture fixture) : IClassFixture<BillingWebhookFixture>
{
    private const string Path = "/billing/webhooks/stripe";
    // Throwaway HMAC key (any bytes); low-entropy + non-Stripe-shaped so no secret scanner flags it.
    private const string WebhookSecret = "test-webhook-signing-key";

    private WebApplicationFactory<Program> Factory() =>
        new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("Platform:DatabaseConnectionString", fixture.ConnectionString);
            builder.UseSetting("Platform:BillingWebhookWriteEnabled", "true"); // dark by default → map the route
            builder.UseSetting("Stripe:WebhookSecret", WebhookSecret);
            // Verification also requires the API secret (TS parity); a subscription event makes no Stripe API
            // call, so a dummy key just satisfies the fail-closed gate. (Non-Stripe-shaped to dodge scanners.)
            builder.UseSetting("Stripe:SecretKey", "sk-test-dummy-not-a-real-key");
        });

    private static string Signature(string payload)
    {
        var timestamp = DateTimeOffset.UtcNow.ToUnixTimeSeconds(); // within Stripe's 300s tolerance
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(WebhookSecret));
        var hash = hmac.ComputeHash(Encoding.UTF8.GetBytes($"{timestamp}.{payload}"));
        return $"t={timestamp},v1={Convert.ToHexString(hash).ToLowerInvariant()}";
    }

    private static async Task<HttpResponseMessage> Post(HttpClient client, string payload, string? signature)
    {
        var request = new HttpRequestMessage(HttpMethod.Post, Path)
        {
            Content = new StringContent(payload, Encoding.UTF8, "application/json"),
        };
        if (signature is not null)
        {
            request.Headers.Add("Stripe-Signature", signature);
        }

        return await client.SendAsync(request);
    }

    [Fact]
    public async Task Missing_signature_is_400()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Post(client, """{"id":"evt","type":"invoice.paid","created":1750000000,"data":{"object":{}}}""", signature: null);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Bad_signature_is_400()
    {
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Post(client, """{"id":"evt","type":"invoice.paid","created":1750000000,"data":{"object":{}}}""", "t=1,v1=deadbeef");

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Signed_unhandled_event_is_200_handled_false()
    {
        var payload = """{"id":"evt","object":"event","type":"invoice.paid","created":1750000000,"data":{"object":{"id":"in_1","object":"invoice"}}}""";
        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Post(client, payload, Signature(payload));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(body);
        Assert.True(doc.RootElement.GetProperty("received").GetBoolean());
        Assert.False(doc.RootElement.GetProperty("handled").GetBoolean());
        Assert.Equal("invoice.paid", doc.RootElement.GetProperty("type").GetString());
    }

    // Full E2E: a signed subscription.updated for a linked org flows through the real pipeline (raw-body read
    // intact) and the write lands — the row's status is updated. (created 2025 > the seeded last event 2021.)
    [Fact]
    public async Task Signed_subscription_event_applies_end_to_end()
    {
        var org = BillingWebhookFixture.OrgResolve; // seeded sub_resolve, status active, last event 2021-06-01
        var payload =
            """
            {"id":"evt","object":"event","type":"customer.subscription.updated","created":1750000000,
             "data":{"object":{"id":"sub_resolve","object":"subscription","status":"past_due","customer":"cus_resolve",
             "cancel_at_period_end":false,"cancel_at":null,"canceled_at":null,"metadata":{},
             "items":{"object":"list","data":[{"id":"si_1","object":"subscription_item","price":{"id":"price_pro","object":"price"},
             "current_period_start":1750000000,"current_period_end":1752678400}]}}}}
            """;

        await using var factory = Factory();
        using var client = factory.CreateClient();

        var response = await Post(client, payload, Signature(payload));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.True(JsonDocument.Parse(body).RootElement.GetProperty("handled").GetBoolean());

        var row = await fixture.GetSubscriptionAsync(org);
        Assert.Equal("past_due", row!.Status); // the write landed through the real HTTP pipeline
    }
}
