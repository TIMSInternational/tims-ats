using Tims.Application.PlatformOrganizations;
using Tims.Infrastructure.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>
/// Phase-5 slice 20 (issue #76) — the platform organizations WRITE repository against a real Postgres.
///
/// <para><b>The reason this file exists is the fail-closed mutation proof.</b> Federico decided on #76 that
/// the C# audit write diverges from TS's <c>.catch(() =&gt; {})</c> and fails the operation. That claim is
/// only worth anything if the audit INSERT and the org UPDATE share ONE transaction — a fail-closed audit
/// that throws AFTER the update commits leaves the organization modified and unaudited, which is precisely
/// the state the decision exists to forbid, while every unit test stays green. So the two
/// <c>fails_closed…</c> tests below run the same code path against a database with no <c>audit_logs</c>
/// table and assert the organization row is BYTE-FOR-BYTE what it was, with a passing control either
/// side.</para>
///
/// <para>These also prove something the port could plausibly have got wrong for a different reason: that a
/// cross-org platform-owner write CAN run under <see cref="Tims.Infrastructure.TenantScope"/>. The
/// slice-19 READER is deliberately unscoped, so it would have been natural to make the writer unscoped
/// too and lean on the prod role being BYPASSRLS. Every write here runs as NOBYPASSRLS <c>app_tenant</c>
/// under the production policies.</para>
/// </summary>
[Collection("PlatformOrganizationsWrite")]
public sealed class PlatformOrganizationsWriteRepositoryTests(PlatformOrganizationsWriteFixture fixture)
{
    private static readonly DateTime Now = new(2026, 8, 10, 12, 0, 0, DateTimeKind.Unspecified);

    // ── update: the happy path, under real RLS ───────────────────────────────────────────────────

    [Fact]
    public async Task UpdateAsync_writes_only_the_present_fields_and_one_audit_row()
    {
        var org = await SeedOrganizationAsync("Update Target", "trial", """{"locale":"es","timezone":"America/Bogota"}""");
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsWriteRepository(db);

        var input = new PlatformOrganizationUpdateInput("Renamed", "professional", null, null);
        var row = await repository.UpdateAsync(
            org,
            input,
            PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson(input),
            PlatformOrganizationsWriteFixture.Actor,
            Now,
            CancellationToken.None);

        Assert.NotNull(row);
        Assert.Equal("Renamed", row!.Name);
        Assert.Equal("professional", row.Plan);

        var stored = await fixture.ReadOrganizationAsync(org);
        Assert.Equal("Renamed", stored!.Name);
        Assert.Equal("professional", stored.Plan);
        // `isActive` and `settings` were ABSENT — COALESCE must have left both alone. An implementation
        // that wrote defaults would silently deactivate the org and wipe its locale/timezone.
        Assert.True(stored.IsActive);
        Assert.Equal("""{"locale": "es", "timezone": "America/Bogota"}""", stored.Settings);
        Assert.Equal(Now, stored.UpdatedAt);

        var audit = Assert.Single(await fixture.ReadAuditRowsAsync(org));
        Assert.Equal("org_updated", audit.Action);
        Assert.Equal("organization", audit.Entity);
        Assert.Equal(org.ToString(), audit.EntityId);
        Assert.Equal(PlatformOrganizationsWriteFixture.Actor, audit.ActorId);
        // The stored jsonb is a STRING scalar holding the JSON text, matching what Prisma writes when it is
        // handed JSON.stringify(...) — not an object.
        Assert.Equal("string", audit.ChangesType);
        Assert.Equal("""{"name":"Renamed","plan":"professional"}""", audit.ChangesText);
    }

    [Fact]
    public async Task UpdateAsync_replaces_the_settings_column_rather_than_merging_it()
    {
        var org = await SeedOrganizationAsync("Settings Target", "trial", """{"locale":"es","timezone":"America/Bogota"}""");
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsWriteRepository(db);

        var input = new PlatformOrganizationUpdateInput(null, null, null, new PlatformOrganizationSettingsInput("en", null, null));
        await repository.UpdateAsync(
            org, input, PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson(input),
            PlatformOrganizationsWriteFixture.Actor, Now, CancellationToken.None);

        // Prisma REPLACES a Json column; the pre-existing timezone is gone. Destructive and surprising, and
        // reproduced deliberately — narrowing it during a port makes a step-5 parity diff uninterpretable.
        // Tracked as #201; THIS ASSERTION INVERTS when that lands.
        var stored = await fixture.ReadOrganizationAsync(org);
        Assert.Equal("""{"locale": "en"}""", stored!.Settings);
    }

    [Fact]
    public async Task UpdateAsync_returns_null_and_writes_nothing_for_an_unknown_organization()
    {
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsWriteRepository(db);

        var row = await repository.UpdateAsync(
            PlatformOrganizationsWriteFixture.MissingOrg,
            new PlatformOrganizationUpdateInput("Ghost", null, null, null),
            """{"name":"Ghost"}""",
            PlatformOrganizationsWriteFixture.Actor,
            Now,
            CancellationToken.None);

        Assert.Null(row);
        // No organization, no audit row — the FK would have rejected it anyway, but the point is that the
        // repository returns before adding one rather than relying on the constraint.
        Assert.Empty(await fixture.ReadAuditRowsAsync(PlatformOrganizationsWriteFixture.MissingOrg));
    }

    // ── suspend ──────────────────────────────────────────────────────────────────────────────────

    [Theory]
    [InlineData(true, false, "org_suspended")]
    [InlineData(false, true, "org_activated")]
    public async Task SuspendAsync_flips_is_active_and_names_the_direction_in_the_action(
        bool suspend, bool expectedActive, string expectedAction)
    {
        var org = await SeedOrganizationAsync($"Suspend {expectedAction}", "trial", "{}");
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsWriteRepository(db);

        var row = await repository.SuspendAsync(org, suspend, PlatformOrganizationsWriteFixture.Actor, Now, CancellationToken.None);

        Assert.NotNull(row);
        Assert.Equal(expectedActive, row!.IsActive);
        Assert.Equal(expectedActive, (await fixture.ReadOrganizationAsync(org))!.IsActive);

        var audit = Assert.Single(await fixture.ReadAuditRowsAsync(org));
        Assert.Equal(expectedAction, audit.Action);
        // organizations.ts:230-237 sets NO `changes` key for this audit — the action carries the direction.
        Assert.Null(audit.ChangesType);
    }

    // ── THE MUTATION PROOF: make the audit insert fail, assert the org is untouched ──────────────

    [Fact]
    public async Task UpdateAsync_fails_closed_leaving_the_organization_unchanged_when_the_audit_write_fails()
    {
        var before = await fixture.ReadOrganizationAsync(
            PlatformOrganizationsWriteFixture.OrgA, fixture.MissingAuditTableConnectionString);
        Assert.NotNull(before);

        await using var db = fixture.NewContext(fixture.MissingAuditTableConnectionString);
        var repository = new PlatformOrganizationsWriteRepository(db);

        var input = new PlatformOrganizationUpdateInput("Should Not Persist", "enterprise", false, null);
        await Assert.ThrowsAnyAsync<Exception>(() => repository.UpdateAsync(
            PlatformOrganizationsWriteFixture.OrgA,
            input,
            PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson(input),
            PlatformOrganizationsWriteFixture.Actor,
            Now,
            CancellationToken.None));

        var after = await fixture.ReadOrganizationAsync(
            PlatformOrganizationsWriteFixture.OrgA, fixture.MissingAuditTableConnectionString);

        // Every column, not just the name: a partial commit is exactly the failure this guards against.
        Assert.Equal(before, after);
    }

    [Fact]
    public async Task SuspendAsync_fails_closed_leaving_the_organization_unchanged_when_the_audit_write_fails()
    {
        var before = await fixture.ReadOrganizationAsync(
            PlatformOrganizationsWriteFixture.OrgB, fixture.MissingAuditTableConnectionString);
        Assert.NotNull(before);
        Assert.True(before!.IsActive);

        await using var db = fixture.NewContext(fixture.MissingAuditTableConnectionString);
        var repository = new PlatformOrganizationsWriteRepository(db);

        await Assert.ThrowsAnyAsync<Exception>(() => repository.SuspendAsync(
            PlatformOrganizationsWriteFixture.OrgB, suspend: true, PlatformOrganizationsWriteFixture.Actor, Now, CancellationToken.None));

        var after = await fixture.ReadOrganizationAsync(
            PlatformOrganizationsWriteFixture.OrgB, fixture.MissingAuditTableConnectionString);
        Assert.Equal(before, after);
    }

    [Fact]
    public async Task The_control_for_the_mutation_proof_commits_on_the_healthy_database()
    {
        // The same UpdateAsync call SHAPE against a database that DOES have audit_logs. Not literally the
        // same row — the fail-closed tests use the seeded OrgA/OrgB on the no-audit database, this one a
        // fresh org on the healthy one. What it establishes is that those two are not vacuous: without it
        // they would also be green if UpdateAsync/SuspendAsync never wrote anything at all.
        var org = await SeedOrganizationAsync("Control", "trial", "{}");
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsWriteRepository(db);

        var input = new PlatformOrganizationUpdateInput("Should Persist", "enterprise", false, null);
        var row = await repository.UpdateAsync(
            org, input, PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson(input),
            PlatformOrganizationsWriteFixture.Actor, Now, CancellationToken.None);

        Assert.NotNull(row);
        var stored = await fixture.ReadOrganizationAsync(org);
        Assert.Equal("Should Persist", stored!.Name);
        Assert.Equal("enterprise", stored.Plan);
        Assert.False(stored.IsActive);
        Assert.Single(await fixture.ReadAuditRowsAsync(org));
    }

    // ── notification fan-out ─────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task NotifyPlatformOwnersAsync_inserts_one_row_per_platform_owner_across_organizations()
    {
        var org = await SeedOrganizationAsync("Notify Target", "trial", "{}");
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsWriteRepository(db);

        var row = await repository.SuspendAsync(org, suspend: true, PlatformOrganizationsWriteFixture.Actor, Now, CancellationToken.None);
        await repository.NotifyPlatformOwnersAsync(
            PlatformOrganizationsWriteUseCase.BuildSuspensionNotification(row!), CancellationToken.None);

        var notifications = await fixture.ReadNotificationsAsync(org);

        // Both platform owners, and they are in DIFFERENT organizations — the fan-out is cross-org, which is
        // why it cannot run inside the suspended org's TenantScope.
        Assert.Equal(2, notifications.Count);
        Assert.Contains(notifications, n => n.UserId == PlatformOrganizationsWriteFixture.Actor);
        Assert.Contains(notifications, n => n.UserId == PlatformOrganizationsWriteFixture.OwnerTwo);
        Assert.DoesNotContain(notifications, n => n.UserId == PlatformOrganizationsWriteFixture.NonOwner);

        Assert.All(notifications, n =>
        {
            Assert.Equal("warning", n.Type);
            Assert.Equal("Organizacion suspendida: Notify Target", n.Title);
            Assert.Equal("platform", n.Module);
            Assert.Equal("/platform/organizations", n.ActionUrl);
        });
    }

    [Fact]
    public async Task UpdateAsync_with_no_fields_at_all_still_updates_and_audits()
    {
        // The `{}`-body case. Every other test binds at least one non-null value, so this is the only one
        // that sends four untyped NULLs through the COALESCE / ::"OrgPlan" / ::jsonb casts and makes
        // Postgres infer each parameter type from context alone.
        var org = await SeedOrganizationAsync("Empty Update", "starter", "{\"locale\":\"es\"}");
        var before = await fixture.ReadOrganizationAsync(org);
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsWriteRepository(db);

        var input = new PlatformOrganizationUpdateInput(null, null, null, null);
        var row = await repository.UpdateAsync(
            org, input, PlatformOrganizationsWriteUseCase.BuildUpdateChangesJson(input),
            PlatformOrganizationsWriteFixture.Actor, Now, CancellationToken.None);

        Assert.NotNull(row);
        var after = await fixture.ReadOrganizationAsync(org);
        Assert.Equal(before!.Name, after!.Name);
        Assert.Equal(before.Plan, after.Plan);
        Assert.Equal(before.Settings, after.Settings);
        Assert.Equal(before.IsActive, after.IsActive);
        // ...but updated_at still moves, because Prisma's @updatedAt would have moved it.
        Assert.Equal(Now, after.UpdatedAt);

        var audit = Assert.Single(await fixture.ReadAuditRowsAsync(org));
        Assert.Equal("{}", audit.ChangesText);
    }

    /// <summary>A fresh organization per test, so the shared container cannot make one test depend on another.</summary>
    private async Task<Guid> SeedOrganizationAsync(string name, string plan, string settings)
    {
        var id = Guid.NewGuid();
        await using var connection = new Npgsql.NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText =
            """
            INSERT INTO organizations (id, name, slug, plan, settings, is_active)
            VALUES (@id, @name, @slug, @plan::"OrgPlan", @settings::jsonb, true)
            """;
        command.Parameters.AddWithValue("id", id);
        command.Parameters.AddWithValue("name", name);
        command.Parameters.AddWithValue("slug", id.ToString());
        command.Parameters.AddWithValue("plan", plan);
        command.Parameters.AddWithValue("settings", settings);
        await command.ExecuteNonQueryAsync();
        return id;
    }
}
