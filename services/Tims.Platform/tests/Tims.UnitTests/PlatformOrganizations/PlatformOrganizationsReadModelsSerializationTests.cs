using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Tims.Application.PlatformOrganizations;

namespace Tims.UnitTests.PlatformOrganizations;

/// <summary>
/// Phase-5 slice 19 (issue #76) / issue <b>#211</b> — the WIRE SHAPE of the platform-organizations read
/// models, pinned against the tRPC procedures they port
/// (<c>routers/platform/organizations.ts</c>).
///
/// <para><b>TS is the contract.</b> Both platform-organizations flags are dark, so the tRPC path is the
/// live one and C# is what moves. Everything asserted here is a shape TS already emits.</para>
///
/// <para><b>Why these are worth a test at all.</b> The parity harness compares payloads literally:
/// <c>scripts/parity/normalize.ts</c> offers only <c>dropNullish</c> and <c>sortArraysBy</c> — it cannot
/// rename a key — and <c>diff()</c> walks the UNION of both key sets, so a key present on one side only is
/// a FAIL. Every assertion below therefore corresponds to a real parity FAIL if it regresses. And since
/// <c>verify organization</c> CANNOT be run (both flags dark, harness fail-closed against a dark backend),
/// these unit tests are the only executable check that exists for any of it.</para>
///
/// <para><b>Serialized with <c>new JsonSerializerOptions(JsonSerializerDefaults.Web)</c> deliberately</b> —
/// those are the defaults the minimal-API pipeline actually uses. <c>Program.cs</c> never calls
/// <c>ConfigureHttpJsonOptions</c>, so a hand-tuned options bag here would prove something the endpoint
/// does not do.</para>
///
/// <para><b>Honest limitation.</b> These pin the C# side only. Nothing here reads the TS, so they cannot
/// catch a change made on the tRPC side; they catch a REGRESSION of the C# side away from it.</para>
///
/// <para><b>Scope note.</b> The date theory below also covers <c>PlatformOrganizationRow</c>, which is a
/// WRITE model despite this class's name. It is on the same surface, had the identical missing-converter
/// defect, and is the only type here the published OpenAPI contract describes as
/// <c>format: date-time</c> — splitting it into a second file would have hidden that it is the same bug.
/// Everything else in this class is read-side.</para>
/// </summary>
public class PlatformOrganizationsReadModelsSerializationTests
{
    private static readonly JsonSerializerOptions WebDefaults = new(JsonSerializerDefaults.Web);

    /// <summary>Whole seconds and <see cref="DateTimeKind.Unspecified"/> — the two shapes that break
    /// without <c>NodeIsoDateTimeConverter</c>. Npgsql returns <c>timestamp without time zone</c> as
    /// Unspecified, and STJ then emits neither the trailing <c>Z</c> nor 3-digit milliseconds.</summary>
    private static readonly DateTime WholeSecond = new(2026, 8, 11, 12, 0, 0, DateTimeKind.Unspecified);

    private static readonly DateTime WithMillis = new(2026, 8, 11, 12, 0, 0, 123, DateTimeKind.Unspecified);

    // ── the renames (#211 divergences 1, 2 and 4) ────────────────────────────────────────────────

    [Fact]
    public void Detail_serializes_relation_counts_as_underscore_count()
    {
        var json = JsonSerializer.Serialize(BuildDetail(), WebDefaults);

        // TS returns Prisma's `_count` (organizations.ts). The DoesNotContain is the load-bearing half:
        // it fails an ADDED alias too, not just a reverted rename.
        Assert.Contains("\"_count\":", json);
        Assert.DoesNotContain("\"counts\":", json);
    }

    [Fact]
    public void ListItem_serializes_relation_counts_as_underscore_count()
    {
        var json = JsonSerializer.Serialize(BuildListItem(), WebDefaults);

        Assert.Contains("\"_count\":", json);
        Assert.DoesNotContain("\"counts\":", json);
    }

    [Fact]
    public void ListItem_serializes_pending_invoices_as_invoices()
    {
        var json = JsonSerializer.Serialize(BuildListItem(), WebDefaults);

        Assert.Contains("\"invoices\":", json);
        Assert.DoesNotContain("\"pendingInvoices\":", json);
    }

    // ── the shape change (#211 divergence 3) ─────────────────────────────────────────────────────

    [Fact]
    public void ListItem_serializes_last_login_as_a_users_array()
    {
        var json = JsonSerializer.Serialize(BuildListItem(), WebDefaults);

        // TS: `users: { select: { lastLoginAt }, ..., take: 1 }` — an ARRAY of 0 or 1, not a scalar.
        Assert.Contains("\"users\":[{\"lastLoginAt\":\"2026-08-11T12:00:00.123Z\"}]", json);

        // ...and NO scalar `lastLoginAt` at the top level of the item. Asserted structurally rather
        // than with a DoesNotContain on the raw text, which could not distinguish the top-level key
        // from the legitimate nested one inside `users[]`.
        var item = JsonNode.Parse(json)!.AsObject();
        Assert.False(item.ContainsKey("lastLoginAt"));
    }

    [Fact]
    public void ListItem_with_no_login_serializes_users_as_an_empty_array_not_null()
    {
        var json = JsonSerializer.Serialize(BuildListItem(users: []), WebDefaults);

        // `[]`, never `null`: dropNullish DROPS a null but KEEPS an empty array, so emitting null here
        // would be a parity FAIL of its own rather than a harmless equivalent.
        Assert.Contains("\"users\":[]", json);
        Assert.DoesNotContain("\"users\":null", json);
    }

    // ── dates (#211 NEW-7) ───────────────────────────────────────────────────────────────────────

    [Theory]
    [MemberData(nameof(DateCarryingPayloads))]
    public void Every_DateTime_on_this_surface_serializes_in_Node_toISOString_form(string label, object payload)
    {
        var json = JsonSerializer.Serialize(payload, payload.GetType(), WebDefaults);

        // TS goes over superjson and the harness reads `result.data.json` (scripts/parity/trpc.ts), so
        // the TS side is always `Date.prototype.toISOString()`: always 3-digit ms, always a trailing Z.
        // Raw STJ on a `timestamp without time zone` emits neither.
        var dates = Regex.Matches(json, "\"(?:[^\"\\\\]|\\\\.)*\"")
            .Select(m => m.Value.Trim('"'))
            .Where(v => Regex.IsMatch(v, @"^\d{4}-\d{2}-\d{2}T"))
            .ToList();

        // Non-vacuity: a payload that emitted NO date strings would otherwise pass the loop trivially.
        Assert.NotEmpty(dates);
        Assert.All(dates, date => Assert.Matches(@"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$", date));

        // `label` is the theory discriminator, so a failure names which payload broke.
        Assert.NotEmpty(label);
    }

    public static TheoryData<string, object> DateCarryingPayloads() => new()
    {
        { "listItem", BuildListItem() },
        { "detail", BuildDetail() },
        // `writeRow` ADDED 2026-08-11. #211's scope was read models and the fix stopped there — but
        // PlatformOrganizationRow is the RESPONSE BODY of POST /platform/organizations,
        // PATCH /platform/organizations/{id} and POST /platform/organizations/{id}/suspend, it had the
        // identical defect (three bare DateTime members, no converter), and it is the one type on this
        // surface that the published contract describes as `format: date-time` — so a client parsing it
        // per RFC 3339 either throws on the missing offset or reads it as LOCAL time. It also had no
        // TS byte-diff to catch it: `verify-write` is C#-only, and the `organization-create` read-back
        // asserts `id`, `name` and `slug` only.
        { "writeRow", BuildWriteRow() },
    };

    /// <summary>The write/create response row. Mixed Kinds and a whole-second value on purpose: those
    /// are the two shapes that break without the converter.</summary>
    private static PlatformOrganizationRow BuildWriteRow() => new(
        Id: "00000000-0000-4000-8000-0000000000ff",
        Name: "Write Org",
        Slug: "write-org",
        Domain: null,
        Logo: null,
        Plan: "trial",
        Settings: JsonNode.Parse("{}"),
        BillingEmail: "billing@tims.test",
        IsActive: true,
        CreatedAt: WholeSecond,
        UpdatedAt: WithMillis,
        DeletedAt: WithMillis);

    // ── the full Prisma scalar set (#211 NEW-5, NEW-6, NEW-8) ────────────────────────────────────

    [Fact]
    public void ListItem_carries_the_full_Prisma_organization_scalar_set()
    {
        // A HARD-CODED literal list of the keys TS emits. The rename tests above catch a rename; THIS
        // is the one that catches a future field DROP, which is the failure mode that produced #211.
        // TS uses `include`, not `select`, so every Organization scalar is on the wire.
        AssertKeySetEquals(
            BuildListItem(),
            [
                "id", "name", "slug", "domain", "logo", "plan", "settings", "billingEmail", "isActive",
                "createdAt", "updatedAt", "deletedAt",
                "_count", "subscription", "users", "invoices",
            ]);
    }

    [Fact]
    public void Detail_carries_the_full_Prisma_organization_scalar_set()
    {
        AssertKeySetEquals(
            BuildDetail(),
            [
                "id", "name", "slug", "domain", "logo", "plan", "settings", "billingEmail", "isActive",
                "createdAt", "updatedAt", "deletedAt",
                "companies", "users", "subscription", "featureFlags", "billingProfile", "_count",
            ]);
    }

    [Fact]
    public void Detail_nested_records_carry_their_full_Prisma_scalar_sets()
    {
        var root = JsonNode.Parse(JsonSerializer.Serialize(BuildDetail(), WebDefaults))!.AsObject();

        // Each of these is reached by a BARE Prisma `include` on the TS side, which returns every
        // column of the table. 27 guaranteed-non-null scalars were missing across these six before
        // #211 (companies 8 + business units 6 + teams 6 + subscription 1 + feature flags 3 +
        // billing profile 3), plus 11 nullable ones; each one was a guaranteed parity FAIL on its own.
        // The count read 29 when this file was written — an inherited, uncounted number, corrected
        // 2026-08-11 by diffing the base-commit records field-by-field against the Prisma models.
        AssertKeySetEquals(
            root["companies"]!.AsArray()[0]!,
            [
                "id", "organizationId", "name", "country", "currency", "timezone", "language",
                "legalName", "taxId", "settings", "isActive", "createdAt", "updatedAt", "businessUnits",
            ]);

        AssertKeySetEquals(
            root["companies"]!.AsArray()[0]!["businessUnits"]!.AsArray()[0]!,
            [
                "id", "organizationId", "companyId", "name", "code", "parentId", "settings", "isActive",
                "createdAt", "updatedAt", "teams",
            ]);

        AssertKeySetEquals(
            root["companies"]!.AsArray()[0]!["businessUnits"]!.AsArray()[0]!["teams"]!.AsArray()[0]!,
            [
                "id", "organizationId", "businessUnitId", "name", "leaderId", "settings", "isActive",
                "createdAt", "updatedAt",
            ]);

        AssertKeySetEquals(
            root["subscription"]!,
            [
                "id", "organizationId", "stripeCustomerId", "stripeSubscriptionId", "plan", "status",
                "currentPeriodStart", "currentPeriodEnd", "trialEndsAt", "cancelledAt",
                "lastStripeEventAt", "createdAt", "updatedAt",
            ]);

        AssertKeySetEquals(
            root["featureFlags"]!.AsArray()[0]!,
            ["id", "organizationId", "key", "enabled", "payload", "createdAt", "updatedAt"]);

        AssertKeySetEquals(
            root["billingProfile"]!,
            [
                "id", "organizationId", "companyName", "taxId", "address", "city", "state", "country",
                "zipCode", "billingEmail", "billingPhone", "createdAt", "updatedAt",
            ]);

        // UNLIKE every other relation here, TS selects users explicitly (8 keys) — so this record is
        // narrow BY PARITY, and widening it would be just as wrong as narrowing the others.
        AssertKeySetEquals(
            root["users"]!.AsArray()[0]!,
            ["id", "firstName", "lastName", "email", "jobTitle", "isActive", "lastLoginAt", "isPlatformOwner"]);
    }

    private static void AssertKeySetEquals(object payload, string[] expected)
    {
        var node = payload as JsonNode
            ?? JsonNode.Parse(JsonSerializer.Serialize(payload, payload.GetType(), WebDefaults))!;

        var actual = node.AsObject().Select(p => p.Key).OrderBy(k => k, StringComparer.Ordinal).ToArray();

        Assert.Equal(expected.OrderBy(k => k, StringComparer.Ordinal).ToArray(), actual);
    }

    // ── builders ─────────────────────────────────────────────────────────────────────────────────

    private static PlatformOrganizationListItem BuildListItem(
        IReadOnlyList<PlatformOrganizationListUserLogin>? users = null) =>
        new(
            "11111111-1111-1111-1111-111111111111",
            "Parity Org",
            "parity-org",
            "parity.test",
            "https://cdn.test/logo.png",
            "trial",
            JsonNode.Parse("{}"),
            "billing@tims.test",
            true,
            WholeSecond,
            WithMillis,
            WithMillis,
            new PlatformOrganizationCounts(3, 2, 1),
            new PlatformOrganizationListSubscription("trial", "trialing", WithMillis),
            users ?? [new PlatformOrganizationListUserLogin(WithMillis)],
            [new PlatformOrganizationPendingInvoice("22222222-2222-2222-2222-222222222222", WithMillis)]);

    private static PlatformOrganizationDetail BuildDetail() =>
        new(
            "11111111-1111-1111-1111-111111111111",
            "Parity Org",
            "parity-org",
            "parity.test",
            "https://cdn.test/logo.png",
            "trial",
            JsonNode.Parse("{}"),
            "billing@tims.test",
            true,
            WholeSecond,
            WithMillis,
            WithMillis,
            [
                new PlatformOrganizationCompany(
                    "33333333-3333-3333-3333-333333333333",
                    "11111111-1111-1111-1111-111111111111",
                    "Parity Co",
                    "CO",
                    "USD",
                    "America/Bogota",
                    "es",
                    "Parity Co S.A.S.",
                    "900123456",
                    JsonNode.Parse("{}"),
                    true,
                    WholeSecond,
                    WithMillis,
                    [
                        new PlatformOrganizationBusinessUnit(
                            "44444444-4444-4444-4444-444444444444",
                            "11111111-1111-1111-1111-111111111111",
                            "33333333-3333-3333-3333-333333333333",
                            "Parity Unit",
                            "PU",
                            null,
                            JsonNode.Parse("{}"),
                            true,
                            WholeSecond,
                            WithMillis,
                            [
                                new PlatformOrganizationTeam(
                                    "55555555-5555-5555-5555-555555555555",
                                    "11111111-1111-1111-1111-111111111111",
                                    "44444444-4444-4444-4444-444444444444",
                                    "Parity Team",
                                    null,
                                    JsonNode.Parse("{}"),
                                    true,
                                    WholeSecond,
                                    WithMillis),
                            ]),
                    ]),
            ],
            [
                new PlatformOrganizationUser(
                    "66666666-6666-6666-6666-666666666666",
                    "Parity",
                    "Owner",
                    "owner@tims.test",
                    "CTO",
                    true,
                    WithMillis,
                    true),
            ],
            new PlatformOrganizationSubscription(
                "77777777-7777-7777-7777-777777777777",
                "11111111-1111-1111-1111-111111111111",
                "cus_test",
                "sub_test",
                "trial",
                "trialing",
                WithMillis,
                WithMillis,
                WithMillis,
                WithMillis,
                WithMillis,
                WholeSecond,
                WithMillis),
            [
                new PlatformOrganizationFeatureFlag(
                    "88888888-8888-8888-8888-888888888888",
                    "11111111-1111-1111-1111-111111111111",
                    "ats.beta",
                    true,
                    JsonNode.Parse("{\"tier\":1}"),
                    WholeSecond,
                    WithMillis),
            ],
            new PlatformOrganizationBillingProfile(
                "99999999-9999-9999-9999-999999999999",
                "11111111-1111-1111-1111-111111111111",
                "Parity Co S.A.S.",
                "900123456",
                "Calle 1",
                "Bogota",
                "DC",
                "CO",
                "110111",
                "billing@tims.test",
                "+5715551234",
                WholeSecond,
                WithMillis),
            new PlatformOrganizationDetailCounts(3, 2, 1, 4));
}
