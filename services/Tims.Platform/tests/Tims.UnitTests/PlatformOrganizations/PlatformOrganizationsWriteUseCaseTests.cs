using Tims.Application.PlatformOrganizations;

namespace Tims.UnitTests.PlatformOrganizations;

/// <summary>
/// Phase-5 slice 20 (issue #76) — the pure rules of the platform organizations WRITE surface, pinned
/// against the TS they port (<c>routers/platform/organizations.ts:171-241</c>).
///
/// <para>The centre of gravity here is <c>audit_logs.changes</c>. TS writes
/// <c>JSON.stringify(rest)</c> into a Prisma <c>Json?</c> field, which stores a jsonb STRING SCALAR whose
/// content is that exact text — jsonb re-orders and re-spaces object keys but preserves a string scalar
/// verbatim (measured against Postgres 16 through Prisma 6). So key order, spacing and escaping are all
/// part of the stored value, and each of them is a way this port could drift while every other test stays
/// green.</para>
/// </summary>
public class PlatformOrganizationsWriteUseCaseTests
{
    private static PlatformOrganizationUpdateInput Input(
        string? name = null,
        string? plan = null,
        bool? isActive = null,
        PlatformOrganizationSettingsInput? settings = null) =>
        new(name, plan, isActive, settings);

    // ── audit_logs.changes: which keys appear ─────────────────────────────────────────────────────

    [Fact]
    public void BuildUpdateChangesJson_omits_absent_fields_entirely()
    {
        // Zod adds no key for an omitted `.optional()`, and JSON.stringify drops undefined. An absent
        // `name` must not appear as `"name":null` — that would read as "the name was cleared".
        Assert.Equal("""{"name":"Acme"}""", PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson(Input(name: "Acme")));
    }

    [Fact]
    public void BuildUpdateChangesJson_is_an_empty_object_when_only_the_id_was_sent()
    {
        // TS still issues the UPDATE (bumping updated_at via @updatedAt) and still writes the audit row,
        // with `changes` = "{}" . Skipping either would be a divergence.
        Assert.Equal("{}", PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson(Input()));
    }

    [Fact]
    public void BuildUpdateChangesJson_emits_the_schema_declaration_order()
    {
        // NOTE ON WHAT THIS CAN AND CANNOT PROVE. It pins the C# EMIT order. It cannot prove that order
        // equals Zod's, because no Zod runs here and the input record is positional — there is no
        // "caller's order" a C# test can vary. The cross-stack half was verified MANUALLY, by parsing
        // {"settings":{"currency":..,"locale":..},"isActive":..} against the real schema, which yields
        // {"isActive":true,"settings":{"locale":..,"currency":..}} — i.e. ZodObject rebuilds by iterating
        // its own `shape`. Nothing in the repo asserts the two orders agree; a parity fixture would, and
        // this surface has no parity-registry entry at all (#195).
        var json = PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson(Input(
            name: "Acme",
            plan: "starter",
            isActive: true,
            settings: new PlatformOrganizationSettingsInput(Locale: "es", Timezone: "America/Bogota", Currency: "COP")));

        Assert.Equal(
            """{"name":"Acme","plan":"starter","isActive":true,"settings":{"locale":"es","timezone":"America/Bogota","currency":"COP"}}""",
            json);
    }

    [Fact]
    public void BuildUpdateChangesJson_emits_the_settings_members_in_declaration_order_too()
    {
        var json = PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson(Input(
            settings: new PlatformOrganizationSettingsInput(Locale: "es", Timezone: null, Currency: "COP")));

        Assert.Equal("""{"settings":{"locale":"es","currency":"COP"}}""", json);
    }

    [Fact]
    public void BuildUpdateChangesJson_keeps_an_explicitly_empty_settings_object()
    {
        // `settings: {}` is PRESENT — Prisma replaces the column with {} rather than leaving it alone.
        // Collapsing this to "absent" would silently preserve settings TS would have wiped.
        var json = PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson(Input(
            settings: new PlatformOrganizationSettingsInput(null, null, null)));

        Assert.Equal("""{"settings":{}}""", json);
    }

    // ── audit_logs.changes: escaping. These pin the encoder, and they are not cosmetic ────────────

    [Fact]
    public void BuildUpdateChangesJson_leaves_non_ascii_unescaped_like_JSON_stringify()
    {
        // The .NET DEFAULT encoder emits "Fundación"; JSON.stringify emits "Fundación". Organization
        // names on this platform are Spanish, so the default encoder would make almost every audit row's
        // stored text differ from the TS bytes.
        Assert.Equal(
            """{"name":"Fundación Ñandú"}""",
            PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson(Input(name: "Fundación Ñandú")));
    }

    [Fact]
    public void BuildUpdateChangesJson_leaves_html_sensitive_characters_unescaped()
    {
        // The default encoder escapes & < > + as \uXXXX for HTML-injection safety. JSON.stringify does not,
        // and this value is never interpolated into markup — it goes into a jsonb column.
        Assert.Equal(
            """{"name":"A&B <Ltd> +1"}""",
            PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson(Input(name: "A&B <Ltd> +1")));
    }

    [Fact]
    public void BuildUpdateChangesJson_still_escapes_what_JSON_stringify_escapes()
    {
        Assert.Equal(
            """{"name":"say \"hi\"\n\\done"}""",
            PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson(Input(name: "say \"hi\"\n\\done")));
    }

    // ── the settings COLUMN value (distinct from the audit payload) ───────────────────────────────

    [Fact]
    public void BuildSettingsColumnJson_is_null_when_settings_was_absent()
    {
        // null here means "do not write the column at all" — the COALESCE in the update statement reads it
        // that way. Emitting "{}" instead would WIPE an organization's settings on every unrelated rename.
        Assert.Null(PlatformOrganizationsWriteUseCase.BuildSettingsColumnJson(null));
    }

    [Fact]
    public void BuildSettingsColumnJson_writes_only_the_present_members()
    {
        // Prisma REPLACES a Json column rather than merging, so an org that had a timezone loses it here.
        // Destructive and surprising — and faithfully reproduced, because narrowing it during a port makes
        // a step-5 parity diff unreadable.
        Assert.Equal(
            """{"locale":"es"}""",
            PlatformOrganizationsWriteUseCase.BuildSettingsColumnJson(new PlatformOrganizationSettingsInput("es", null, null)));
    }

    // ── Zod bounds (organizations.ts:171-181) ────────────────────────────────────────────────────

    [Fact]
    public void IsValidUpdateInput_accepts_a_name_at_the_limit_and_rejects_one_past_it()
    {
        Assert.True(PlatformOrganizationsWriteUseCase.IsValidUpdateInput(Input(name: new string('a', 100))));
        Assert.False(PlatformOrganizationsWriteUseCase.IsValidUpdateInput(Input(name: new string('a', 101))));
    }

    [Theory]
    [InlineData("trial")]
    [InlineData("starter")]
    [InlineData("professional")]
    [InlineData("enterprise")]
    public void IsValidUpdateInput_accepts_every_OrgPlan_member(string plan) =>
        Assert.True(PlatformOrganizationsWriteUseCase.IsValidUpdateInput(Input(plan: plan)));

    [Theory]
    [InlineData("Trial")]
    [InlineData("free")]
    [InlineData("")]
    public void IsValidUpdateInput_rejects_a_non_member_plan(string plan)
    {
        // z.nativeEnum is exact-match: the enum column would reject these anyway, but as a 500 rather than
        // the 400 tRPC returns.
        Assert.False(PlatformOrganizationsWriteUseCase.IsValidUpdateInput(Input(plan: plan)));
    }

    [Fact]
    public void IsValidUpdateInput_enforces_each_settings_member_bound()
    {
        Assert.True(PlatformOrganizationsWriteUseCase.IsValidUpdateInput(Input(
            settings: new PlatformOrganizationSettingsInput(new string('a', 10), new string('b', 50), new string('c', 10)))));

        Assert.False(PlatformOrganizationsWriteUseCase.IsValidUpdateInput(Input(
            settings: new PlatformOrganizationSettingsInput(new string('a', 11), null, null))));
        Assert.False(PlatformOrganizationsWriteUseCase.IsValidUpdateInput(Input(
            settings: new PlatformOrganizationSettingsInput(null, new string('b', 51), null))));
        Assert.False(PlatformOrganizationsWriteUseCase.IsValidUpdateInput(Input(
            settings: new PlatformOrganizationSettingsInput(null, null, new string('c', 11)))));
    }

    [Fact]
    public void IsValidUpdateInput_accepts_an_empty_name_because_Zod_does()
    {
        // z.string().max(100) has no min — "" is valid input and TS would store it. Adding a min here would
        // refuse a request TS accepts.
        Assert.True(PlatformOrganizationsWriteUseCase.IsValidUpdateInput(Input(name: string.Empty)));
    }

    // ── the notification payload (organizations.ts:221-227) ──────────────────────────────────────

    [Fact]
    public void BuildSuspensionNotification_reproduces_the_TS_copy_verbatim()
    {
        var org = Guid.NewGuid();
        var notification = PlatformOrganizationsWriteUseCase.BuildSuspensionNotification(Row(org, "Acme"));

        Assert.Equal(org, notification.OrganizationId);
        Assert.Equal("warning", notification.Type);
        // Unaccented "Organizacion" is what the TS actually writes; correcting the spelling here would be a
        // silent content change in a user-visible string.
        Assert.Equal("Organizacion suspendida: Acme", notification.Title);
        Assert.Equal("platform", notification.Module);
        Assert.Equal("/platform/organizations", notification.ActionUrl);
        Assert.Null(notification.Message);
        Assert.Null(notification.EntityType);
        Assert.Null(notification.EntityId);
    }

    // ── the notify/no-notify branch, over a fake repository ──────────────────────────────────────

    [Fact]
    public async Task SuspendAsync_notifies_platform_owners_only_when_suspending()
    {
        var repository = new RecordingRepository();
        var useCase = new PlatformOrganizationsWriteUseCase(repository, TimeProvider.System);

        await useCase.SuspendAsync(Guid.NewGuid(), suspend: true, Guid.NewGuid(), CancellationToken.None);
        Assert.Single(repository.Notifications);

        await useCase.SuspendAsync(Guid.NewGuid(), suspend: false, Guid.NewGuid(), CancellationToken.None);
        // organizations.ts:220 — `if (input.suspend)`. Un-suspending notifies nobody.
        Assert.Single(repository.Notifications);
    }

    [Fact]
    public async Task SuspendAsync_does_not_notify_when_the_organization_does_not_exist()
    {
        var repository = new RecordingRepository { Row = null };
        var useCase = new PlatformOrganizationsWriteUseCase(repository, TimeProvider.System);

        Assert.Null(await useCase.SuspendAsync(Guid.NewGuid(), suspend: true, Guid.NewGuid(), CancellationToken.None));
        Assert.Empty(repository.Notifications);
    }

    [Fact]
    public async Task UpdateAsync_hands_the_repository_the_serialized_changes_payload()
    {
        // The bytes are built in the use case, not the repository, precisely so this assertion can exist
        // without a database.
        var repository = new RecordingRepository();
        var useCase = new PlatformOrganizationsWriteUseCase(repository, TimeProvider.System);

        await useCase.UpdateAsync(Guid.NewGuid(), Input(name: "Acme", isActive: false), Guid.NewGuid(), CancellationToken.None);

        Assert.Equal("""{"name":"Acme","isActive":false}""", repository.LastChangesJson);
    }

    private static PlatformOrganizationRow Row(Guid id, string name) =>
        new(id.ToString(), name, "acme", null, null, "trial", null, null, true, DateTime.UnixEpoch, DateTime.UnixEpoch, null);

    private sealed class RecordingRepository : IPlatformOrganizationsWriteRepository
    {
        private static readonly Guid DefaultId = Guid.Parse("dddddddd-dddd-dddd-dddd-dddddddddddd");

        public PlatformOrganizationRow? Row { get; init; } =
            new(DefaultId.ToString(), "Acme", "acme", null, null, "trial", null, null, true, DateTime.UnixEpoch, DateTime.UnixEpoch, null);

        public string? LastChangesJson { get; private set; }

        public List<PlatformOwnerNotification> Notifications { get; } = [];

        public Task<PlatformOrganizationRow?> UpdateAsync(
            Guid id,
            PlatformOrganizationUpdateInput input,
            string changesJson,
            Guid actorId,
            DateTime now,
            CancellationToken cancellationToken)
        {
            LastChangesJson = changesJson;
            return Task.FromResult(Row);
        }

        public Task<PlatformOrganizationRow?> SuspendAsync(
            Guid id,
            bool suspend,
            Guid actorId,
            DateTime now,
            CancellationToken cancellationToken) => Task.FromResult(Row);

        public Task NotifyPlatformOwnersAsync(PlatformOwnerNotification notification, CancellationToken cancellationToken)
        {
            Notifications.Add(notification);
            return Task.CompletedTask;
        }
    }
}
