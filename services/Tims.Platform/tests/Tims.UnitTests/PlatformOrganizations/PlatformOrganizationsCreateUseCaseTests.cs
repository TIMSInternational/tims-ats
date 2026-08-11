using Tims.Application.PlatformOrganizations;

namespace Tims.UnitTests.PlatformOrganizations;

/// <summary>
/// Phase-5 slice 21 (issue #76) — the pure rules of the platform organization CREATE surface, pinned
/// against the TS they port (<c>routers/platform/organizations.ts:104-169</c>).
///
/// <para>Two centres of gravity. The first is <c>audit_logs.changes</c>: TS writes
/// <c>JSON.stringify({ name, slug, plan })</c> into a Prisma <c>Json?</c> field, which stores a jsonb STRING
/// SCALAR whose content is that exact text — jsonb re-orders and re-spaces object keys but preserves a
/// string scalar verbatim. Key order, spacing and escaping are therefore all part of the stored value, and
/// each is a way this port could drift while every other test stays green.</para>
///
/// <para>The second is <c>notify</c>. <c>organizations.ts:149</c> awaits it with no <c>try</c> and no
/// <c>.catch</c>, so a fan-out failure is a 500 AFTER the seven-table transaction has committed. That is the
/// correction issue #76 makes, re-read from source, and the propagation test below is its unit-level pin —
/// a port that "helpfully" swallowed the exception would be greener and wrong.</para>
///
/// <para><b>Honest limitation, carried across from slice 20.</b> These tests pin the C# EMIT order. They
/// cannot prove it equals the TS literal's order, because no Zod runs here. That half was verified by
/// reading <c>organizations.ts:164</c>, where the payload is a hard-coded object literal — so unlike the
/// update payload, the order does not depend on Zod's schema iteration at all.</para>
/// </summary>
public class PlatformOrganizationsCreateUseCaseTests
{
    private static PlatformOrganizationCreateInput Input(
        string name = "Acme",
        string slug = "acme",
        string plan = "trial",
        string adminEmail = "admin@tims.test",
        string? billingEmail = null) =>
        new(name, slug, plan, adminEmail, billingEmail);

    // ── audit_logs.changes: which keys appear, and in what order ─────────────────────────────────

    [Fact]
    public void BuildCreateChangesJson_emits_name_then_slug_then_plan_and_nothing_else()
    {
        // The order is fixed by the object LITERAL at organizations.ts:164, not by Zod's declaration order.
        // adminEmail and billingEmail are absent — the payload is not the parse output.
        Assert.Equal(
            """{"name":"Acme","slug":"acme","plan":"trial"}""",
            PlatformOrganizationsCreateUseCase.BuildCreateChangesJson(Input()));
    }

    [Fact]
    public void BuildCreateChangesJson_never_mentions_either_email()
    {
        var json = PlatformOrganizationsCreateUseCase.BuildCreateChangesJson(
            Input(adminEmail: "admin@tims.test", billingEmail: "billing@tims.test"));

        Assert.DoesNotContain("adminEmail", json, StringComparison.Ordinal);
        Assert.DoesNotContain("billingEmail", json, StringComparison.Ordinal);
        Assert.DoesNotContain("tims.test", json, StringComparison.Ordinal);
    }

    [Fact]
    public void BuildCreateChangesJson_has_no_conditionals_and_no_empty_object_case()
    {
        // Unlike the update payload, all three keys are required in Zod, so all three are always present.
        var json = PlatformOrganizationsCreateUseCase.BuildCreateChangesJson(Input(name: "X Y", slug: "x-y", plan: "enterprise"));

        Assert.Equal("""{"name":"X Y","slug":"x-y","plan":"enterprise"}""", json);
    }

    // ── audit_logs.changes: escaping. These pin the encoder, and they are not cosmetic ───────────

    [Fact]
    public void BuildCreateChangesJson_leaves_non_ascii_unescaped_like_JSON_stringify()
    {
        // The .NET DEFAULT encoder emits "Fundación"; JSON.stringify emits "Fundación". Organization
        // names on this platform are Spanish, so the default encoder would make almost every audit row's
        // stored text differ from the TS bytes.
        Assert.Equal(
            """{"name":"Fundación Ñandú","slug":"acme","plan":"trial"}""",
            PlatformOrganizationsCreateUseCase.BuildCreateChangesJson(Input(name: "Fundación Ñandú")));
    }

    [Fact]
    public void BuildCreateChangesJson_leaves_html_sensitive_characters_unescaped()
    {
        // The default encoder escapes & < > + ' as \uXXXX for HTML-injection safety. JSON.stringify does
        // not, and this value is never interpolated into markup — it goes into a jsonb column.
        Assert.Equal(
            """{"name":"A&B <Ltd> +1 'x'","slug":"acme","plan":"trial"}""",
            PlatformOrganizationsCreateUseCase.BuildCreateChangesJson(Input(name: "A&B <Ltd> +1 'x'")));
    }

    [Fact]
    public void BuildCreateChangesJson_still_escapes_what_JSON_stringify_escapes()
    {
        Assert.Equal(
            """{"name":"say \"hi\"\n\\done","slug":"acme","plan":"trial"}""",
            PlatformOrganizationsCreateUseCase.BuildCreateChangesJson(Input(name: "say \"hi\"\n\\done")));
    }

    // ── Zod bounds (organizations.ts:105-111). Reject, never clamp ───────────────────────────────

    [Theory]
    [InlineData(2, true)]
    [InlineData(100, true)]
    [InlineData(1, false)]
    [InlineData(101, false)]
    public void IsValidCreateInput_enforces_both_name_bounds(int length, bool expected) =>
        Assert.Equal(expected, PlatformOrganizationsCreateUseCase.IsValidCreateInput(Input(name: new string('a', length))));

    [Theory]
    [InlineData(2, true)]
    [InlineData(50, true)]
    [InlineData(1, false)]
    [InlineData(51, false)]
    public void IsValidCreateInput_enforces_both_slug_bounds(int length, bool expected) =>
        Assert.Equal(expected, PlatformOrganizationsCreateUseCase.IsValidCreateInput(Input(slug: new string('a', length))));

    [Theory]
    [InlineData("abc-123")]
    [InlineData("--")]
    [InlineData("-abc")]
    [InlineData("abc-")]
    [InlineData("00")]
    public void IsValidCreateInput_accepts_every_string_the_slug_regex_accepts_including_the_degenerate_ones(string slug)
    {
        // /^[a-z0-9-]+$/ genuinely accepts "--", "-abc" and "abc-". They are terrible slugs and they are
        // valid input; tightening the pattern here would refuse requests TS accepts.
        Assert.True(PlatformOrganizationsCreateUseCase.IsValidCreateInput(Input(slug: slug)));
    }

    [Theory]
    [InlineData("Abc")]
    [InlineData("a_b")]
    [InlineData("a b")]
    [InlineData("á")]
    [InlineData("ab.c")]
    [InlineData("acme\n")]
    public void IsValidCreateInput_rejects_everything_outside_the_slug_character_class(string slug)
    {
        // "acme\n" is the reason the pattern is anchored \A..\z rather than ^..$: .NET's `$` also matches
        // BEFORE a trailing newline, JS's (without the m flag) does not.
        Assert.False(PlatformOrganizationsCreateUseCase.IsValidCreateInput(Input(slug: slug)));
    }

    [Theory]
    [InlineData("trial")]
    [InlineData("starter")]
    [InlineData("professional")]
    [InlineData("enterprise")]
    public void IsValidCreateInput_accepts_every_plan_member(string plan) =>
        Assert.True(PlatformOrganizationsCreateUseCase.IsValidCreateInput(Input(plan: plan)));

    [Theory]
    [InlineData("gold")]
    [InlineData("Trial")]
    [InlineData("")]
    public void IsValidCreateInput_rejects_a_non_member_plan(string plan) =>
        Assert.False(PlatformOrganizationsCreateUseCase.IsValidCreateInput(Input(plan: plan)));

    [Fact]
    public void IsValidCreateInput_requires_a_valid_admin_email_and_tolerates_an_absent_billing_email()
    {
        Assert.True(PlatformOrganizationsCreateUseCase.IsValidCreateInput(Input(billingEmail: null)));
        Assert.True(PlatformOrganizationsCreateUseCase.IsValidCreateInput(Input(billingEmail: "billing@tims.test")));
        Assert.False(PlatformOrganizationsCreateUseCase.IsValidCreateInput(Input(adminEmail: "nope")));
        // A PRESENT billingEmail must still be a valid email — including the empty string, which .email()
        // rejects. (`.optional()` means absent, not "anything goes".)
        Assert.False(PlatformOrganizationsCreateUseCase.IsValidCreateInput(Input(billingEmail: "nope")));
        Assert.False(PlatformOrganizationsCreateUseCase.IsValidCreateInput(Input(billingEmail: string.Empty)));
    }

    [Fact]
    public void IsValidCreateInput_bounds_neither_email_because_Zod_does_not()
    {
        // organizations.ts:109-110 has no .max(). Ported as-is; the missing bound is issue #207, not
        // something to fix inside a port. THIS ASSERTION INVERTS when that lands.
        var long_ = new string('a', 5000) + "@example.com";
        Assert.True(PlatformOrganizationsCreateUseCase.IsValidCreateInput(Input(adminEmail: long_)));
    }

    // ── z.string().email(), as Zod 3.25.76 actually implements it ────────────────────────────────

    [Theory]
    [InlineData("a@b.co", true)]
    [InlineData("admin@tims.test", true)]
    [InlineData("a+b@c.co", true)]
    [InlineData("a.b@c.co", true)]
    [InlineData("a'b@c.co", true)]
    [InlineData("a_b@c.co", true)]
    [InlineData("a@sub.domain.co", true)]
    [InlineData("a@b-c.co", true)]
    [InlineData("a@b", false)]        // the TLD part requires [A-Z]{2,}
    [InlineData("a@b.", false)]
    [InlineData("a@b.c", false)]      // single-character TLD
    [InlineData("a@-b.co", false)]    // a label may not START with a hyphen
    [InlineData(".a@b.co", false)]    // (?!\.) — no leading dot
    [InlineData("a..b@c.co", false)]  // (?!.*\.\.) — no consecutive dots
    [InlineData("a.@b.co", false)]    // the char before @ must be [A-Z0-9_+-]
    [InlineData("a b@c.co", false)]
    [InlineData("@b.co", false)]
    [InlineData("nope", false)]
    [InlineData("", false)]
    [InlineData("José@b.co", false)]  // non-ASCII: JS's non-unicode /i never folds into the ASCII classes
    [InlineData("a\n@b.co", false)]   // \A..\z, not ^..$
    [InlineData("a@b.co\n", false)]
    public void IsValidEmail_agrees_with_the_installed_Zod_email_regex(string value, bool expected)
    {
        // The pattern is copied VERBATIM from node_modules/.pnpm/zod@3.25.76/.../v3/types.js:384 — not
        // MailAddress, not EmailAddressAttribute, not an invented regex, all of which disagree with Zod on
        // real inputs. Every case here was cross-checked against the real z.string().email() schema.
        Assert.Equal(expected, PlatformOrganizationsCreateUseCase.IsValidEmail(value));
    }

    // ── derived values (organizations.ts:119, :141-142) ──────────────────────────────────────────

    [Fact]
    public void ResolveBillingEmail_reproduces_the_JS_or_operator_not_the_nullish_one()
    {
        // `input.billingEmail || input.adminEmail`: an EMPTY STRING also falls through. Zod rejects '' at the
        // endpoint so the two are equivalent behind it, but a `??` here would be a silent divergence the
        // moment the schema relaxed.
        Assert.Equal("admin@tims.test", PlatformOrganizationsCreateUseCase.ResolveBillingEmail(Input(billingEmail: null)));
        Assert.Equal("admin@tims.test", PlatformOrganizationsCreateUseCase.ResolveBillingEmail(Input(billingEmail: string.Empty)));
        Assert.Equal("billing@tims.test", PlatformOrganizationsCreateUseCase.ResolveBillingEmail(Input(billingEmail: "billing@tims.test")));
    }

    [Theory]
    [InlineData("trial", "trialing")]
    [InlineData("starter", "active")]
    [InlineData("professional", "active")]
    [InlineData("enterprise", "active")]
    public void ResolveSubscriptionStatus_is_trialing_only_for_the_trial_plan(string plan, string expected) =>
        Assert.Equal(expected, PlatformOrganizationsCreateUseCase.ResolveSubscriptionStatus(plan));

    [Fact]
    public void ResolveTrialEndsAt_is_fourteen_days_out_for_trial_and_null_otherwise()
    {
        var now = new DateTime(2026, 8, 11, 12, 0, 0, DateTimeKind.Unspecified);

        Assert.Equal(now.AddDays(14), PlatformOrganizationsCreateUseCase.ResolveTrialEndsAt("trial", now));
        Assert.Null(PlatformOrganizationsCreateUseCase.ResolveTrialEndsAt("starter", now));
        Assert.Null(PlatformOrganizationsCreateUseCase.ResolveTrialEndsAt("professional", now));
        Assert.Null(PlatformOrganizationsCreateUseCase.ResolveTrialEndsAt("enterprise", now));
    }

    // ── the notification payload (organizations.ts:149-155) ──────────────────────────────────────

    [Fact]
    public void BuildCreatedNotification_reproduces_the_TS_copy_verbatim()
    {
        var org = Guid.NewGuid();
        var notification = PlatformOrganizationsCreateUseCase.BuildCreatedNotification(Row(org, "Acme"));

        Assert.Equal(org, notification.OrganizationId);
        Assert.Equal("success", notification.Type);
        // Unaccented "organizacion" is what the TS actually writes; asserting the misspelling is the point.
        Assert.Equal("Nueva organizacion creada: Acme", notification.Title);
        Assert.Equal("platform", notification.Module);
        Assert.Equal("/platform/organizations", notification.ActionUrl);
        Assert.Null(notification.Message);
        Assert.Null(notification.EntityType);
        Assert.Null(notification.EntityId);
    }

    [Fact]
    public void BuildCreatedNotification_interpolates_the_DB_returned_name_not_the_input()
    {
        // organizations.ts:151 uses `org.name` — the value the row came back with.
        var notification = PlatformOrganizationsCreateUseCase.BuildCreatedNotification(Row(Guid.NewGuid(), "Stored Name"));

        Assert.Equal("Nueva organizacion creada: Stored Name", notification.Title);
    }

    // ── the notify contract, over a recording repository ─────────────────────────────────────────

    [Fact]
    public async Task CreateAsync_hands_the_repository_the_serialized_changes_payload()
    {
        // The bytes are built in the use case, not the repository, precisely so this assertion can exist
        // without a database.
        var repository = new RecordingRepository();
        var useCase = new PlatformOrganizationsCreateUseCase(repository, TimeProvider.System);

        await useCase.CreateAsync(Input(name: "Acme", slug: "acme", plan: "starter"), Guid.NewGuid(), CancellationToken.None);

        Assert.Equal("""{"name":"Acme","slug":"acme","plan":"starter"}""", repository.LastChangesJson);
    }

    [Fact]
    public async Task CreateAsync_always_notifies_on_success()
    {
        // Unconditional, unlike suspendOrganization's `if (input.suspend)` branch.
        var repository = new RecordingRepository();
        var useCase = new PlatformOrganizationsCreateUseCase(repository, TimeProvider.System);

        await useCase.CreateAsync(Input(), Guid.NewGuid(), CancellationToken.None);
        await useCase.CreateAsync(Input(), Guid.NewGuid(), CancellationToken.None);

        Assert.Equal(2, repository.Notifications.Count);
    }

    [Fact]
    public async Task CreateAsync_does_not_notify_when_the_slug_was_taken()
    {
        var repository = new RecordingRepository { Outcome = CreateOrganizationOutcome.SlugTaken };
        var useCase = new PlatformOrganizationsCreateUseCase(repository, TimeProvider.System);

        var result = await useCase.CreateAsync(Input(), Guid.NewGuid(), CancellationToken.None);

        Assert.Equal(CreateOrganizationOutcome.SlugTaken, result.Outcome);
        Assert.Null(result.Row);
        Assert.Empty(repository.Notifications);
    }

    [Fact]
    public async Task CreateAsync_creates_before_it_notifies()
    {
        var repository = new RecordingRepository();
        var useCase = new PlatformOrganizationsCreateUseCase(repository, TimeProvider.System);

        await useCase.CreateAsync(Input(), Guid.NewGuid(), CancellationToken.None);

        Assert.Equal(["create", "notify"], repository.Calls);
    }

    [Fact]
    public async Task A_notify_failure_PROPAGATES_because_the_TS_awaits_it_uncaught()
    {
        // THE pin on issue #76's correction, re-read from source: organizations.ts:149 is
        // `await notify({ ... })` with no try and no .catch. It is NOT best-effort. A port that wrapped this
        // in try/catch would be greener and wrong — the operator must see the 500 the TS gives them, after a
        // create that has already committed.
        var repository = new RecordingRepository { NotifyThrows = true };
        var useCase = new PlatformOrganizationsCreateUseCase(repository, TimeProvider.System);

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            useCase.CreateAsync(Input(), Guid.NewGuid(), CancellationToken.None));

        // ...and the create itself still happened, which is why the failure leaves committed state behind.
        Assert.Contains("create", repository.Calls);
    }

    [Fact]
    public async Task CreateAsync_refuses_input_that_violates_a_Zod_bound_rather_than_clamping_it()
    {
        // The endpoint has already returned 400 by the time this could fire, so it is unreachable there —
        // but a second caller (a worker, or #75's invitation flow) must not be able to bypass the bounds by
        // reaching the use case directly.
        var repository = new RecordingRepository();
        var useCase = new PlatformOrganizationsCreateUseCase(repository, TimeProvider.System);

        await Assert.ThrowsAsync<ArgumentException>(() =>
            useCase.CreateAsync(Input(slug: "NOT VALID"), Guid.NewGuid(), CancellationToken.None));

        Assert.Empty(repository.Calls);
    }

    // ── the shared plan list ─────────────────────────────────────────────────────────────────────

    [Fact]
    public void Plans_is_the_slice20_list_because_the_two_TS_schemas_coincide_today()
    {
        // create uses z.enum([...]) (a hand-written string-literal list) while update uses
        // z.nativeEnum(OrgPlan). They agree today, so sharing is correct — but a rename or addition to the
        // Prisma enum would desynchronise them, and this assertion is where that would surface.
        Assert.Same(PlatformOrganizationsWriteUseCase.Plans, PlatformOrganizationsCreateUseCase.Plans);
        Assert.Equal(["trial", "starter", "professional", "enterprise"], PlatformOrganizationsCreateUseCase.Plans);
    }

    private static PlatformOrganizationRow Row(Guid id, string name) =>
        new(id.ToString(), name, "acme", null, null, "trial", null, null, true, DateTime.UnixEpoch, DateTime.UnixEpoch, null);

    private sealed class RecordingRepository : IPlatformOrganizationsCreateRepository
    {
        private static readonly Guid DefaultId = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");

        public CreateOrganizationOutcome Outcome { get; init; } = CreateOrganizationOutcome.Created;

        public bool NotifyThrows { get; init; }

        public string? LastChangesJson { get; private set; }

        public List<string> Calls { get; } = [];

        public List<PlatformOwnerNotification> Notifications { get; } = [];

        public Task<CreateOrganizationResult> CreateAsync(
            PlatformOrganizationCreateInput input,
            string changesJson,
            Guid actorId,
            DateTime now,
            CancellationToken cancellationToken)
        {
            Calls.Add("create");
            LastChangesJson = changesJson;

            var row = Outcome == CreateOrganizationOutcome.Created
                ? new PlatformOrganizationRow(
                    DefaultId.ToString(), input.Name, input.Slug, null, null, input.Plan, null,
                    PlatformOrganizationsCreateUseCase.ResolveBillingEmail(input), true,
                    DateTime.UnixEpoch, DateTime.UnixEpoch, null)
                : null;

            return Task.FromResult(new CreateOrganizationResult(Outcome, row));
        }

        public Task NotifyPlatformOwnersAsync(PlatformOwnerNotification notification, CancellationToken cancellationToken)
        {
            Calls.Add("notify");

            if (NotifyThrows)
            {
                throw new InvalidOperationException("notify failed");
            }

            Notifications.Add(notification);
            return Task.CompletedTask;
        }
    }
}
