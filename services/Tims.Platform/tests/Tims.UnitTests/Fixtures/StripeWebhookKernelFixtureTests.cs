using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.Billing;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Pins the C# <see cref="StripeWebhookKernel"/> to the shared golden corpus
/// (contracts/billing-fixtures/stripe-webhook-kernel.json) — the SAME cases the TS vitest suite
/// (tests/billing/stripe-webhook.test.ts) asserts against the REAL webhook exports. Each case is dispatched
/// by its <c>fn</c>; a divergence on ANY billing invariant (unknown-status→past_due-never-active, the
/// same-second un-cancel guard, unknown-price→plan-null no-downgrade, duplicate detection, or a +00:00 date)
/// turns this suite RED (and the TS suite RED too). This is the regression-corpus gate for the ported kernels.
/// </summary>
public sealed class StripeWebhookKernelFixtureTests
{
    // Stripe's native shape (snake_case) is honored via [JsonPropertyName] on StripeSubscriptionLike, so the
    // default reader binds it. The camelCase stored-subscription inputs bind case-insensitively.
    private static readonly JsonSerializerOptions ReadCi = new() { PropertyNameCaseInsensitive = true };
    private static readonly JsonSerializerOptions Wire = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private static JsonNode Root() =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "billing-fixtures", "stripe-webhook-kernel.json")))!;

    private static StripeBillingEnv Env(JsonNode root)
    {
        var env = root["env"]!;
        return new StripeBillingEnv(
            env["starterPriceId"]?.GetValue<string>(),
            env["professionalPriceId"]?.GetValue<string>());
    }

    public static IEnumerable<object[]> Cases()
    {
        var cases = Root()["cases"]!.AsArray();
        for (var i = 0; i < cases.Count; i++)
        {
            yield return [i, cases[i]!["fn"]!.GetValue<string>(), cases[i]!["name"]!.GetValue<string>()];
        }
    }

    [Theory]
    [MemberData(nameof(Cases))]
    public void Kernel_matches_golden_fixture(int index, string fn, string name)
    {
        var root = Root();
        var node = root["cases"]![index]!;
        Assert.Equal(fn, node["fn"]!.GetValue<string>());
        Assert.Equal(name, node["name"]!.GetValue<string>());

        var input = node["input"];
        var expected = node["expected"];

        switch (fn)
        {
            case "mapStripeStatus":
                Assert.Equal(expected!.GetValue<string>(), StripeWebhookKernel.MapStripeStatus(input!.GetValue<string>()));
                break;

            case "priceIdToPlan":
                {
                    var actual = StripeWebhookKernel.PriceIdToPlan(input!.GetValue<string>(), Env(root));
                    AssertNullableString(expected, actual);
                    break;
                }

            case "mapStripeSubscriptionToFields":
                {
                    var sub = input.Deserialize<StripeSubscriptionLike>(ReadCi)!;
                    var fields = StripeWebhookKernel.MapStripeSubscriptionToFields(sub, Env(root));
                    var actual = JsonSerializer.SerializeToNode(fields, Wire)!;
                    Assert.True(
                        JsonNode.DeepEquals(expected, actual),
                        $"sync-fields mismatch for '{name}': {actual.ToJsonString()}");
                    break;
                }

            case "isDuplicateSubscription":
                {
                    var existingNode = input!["existing"];
                    var existing = existingNode is null ? null : existingNode.Deserialize<ExistingSubscription>(ReadCi);
                    var incoming = input["incoming"]!.GetValue<string>();
                    Assert.Equal(expected!.GetValue<bool>(), StripeWebhookKernel.IsDuplicateSubscription(existing, incoming));
                    break;
                }

            case "shouldDropEvent":
                {
                    var currentNode = input!["current"];
                    var current = currentNode is null ? null : currentNode.Deserialize<CurrentSubscription>(ReadCi);
                    var incomingStatus = input["incomingStatus"]!.GetValue<string>();
                    var eventAt = DateTimeOffset.Parse(
                        input["eventAt"]!.GetValue<string>(), CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
                    Assert.Equal(expected!.GetValue<bool>(), StripeWebhookKernel.ShouldDropEvent(current, incomingStatus, eventAt));
                    break;
                }

            default:
                throw new InvalidOperationException($"unknown kernel fn '{fn}'");
        }
    }

    private static void AssertNullableString(JsonNode? expected, string? actual)
    {
        if (expected is null || expected.GetValueKind() == JsonValueKind.Null)
        {
            Assert.Null(actual);
        }
        else
        {
            Assert.Equal(expected.GetValue<string>(), actual);
        }
    }
}
