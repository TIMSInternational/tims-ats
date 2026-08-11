using Microsoft.EntityFrameworkCore;
using Tims.Application.PlatformOrganizations;
using Tims.Infrastructure;
using Tims.Infrastructure.OrgProvisioning;
using Tims.Infrastructure.PlatformOrganizations;

namespace Tims.IntegrationTests.PlatformOrganizations;

/// <summary>
/// Phase-5 slice 21 (issue #76) — the platform organization CREATE repository against a real Postgres.
///
/// <para><b>These are the first executable characterization <c>createOrganization</c> has ever had.</b>
/// Grepping the TS repo for it across <c>*.test.ts</c>/<c>*.spec.ts</c> returns nothing; the only
/// test-encoded behaviour that exists anywhere is <c>tests/organization/signup-defaults.test.ts</c>, which
/// covers the two provisioning helpers and which the structure/entitlement assertions here deliberately
/// mirror.</para>
///
/// <para><b>Three claims are proved by construction rather than asserted in prose.</b> (1) The audit write
/// is FAIL-CLOSED: the same code path against a database with no <c>audit_logs</c> table must leave ALL
/// SEVEN tables untouched, with a passing control on the healthy database so the proof cannot be vacuous.
/// (2) A notify failure PROPAGATES while everything the transaction wrote stays committed — the recorded
/// divergence from TS, which would leave no audit row at all. (3) A platform-owner CREATION can run under
/// <see cref="TenantScope"/> opened on an organization that does not exist yet, and the
/// <c>business_units.organization_id</c> column — which has NO foreign key in production — is protected by
/// <c>WITH CHECK</c> and nothing else.</para>
/// </summary>
[Collection("PlatformOrganizationsCreate")]
public sealed class PlatformOrganizationsCreateRepositoryTests(PlatformOrganizationsCreateFixture fixture)
{
    private static readonly DateTime Now = new(2026, 8, 11, 12, 0, 0, DateTimeKind.Unspecified);

    // ── R1: the happy path, under real RLS, on the NEW organization's scope ──────────────────────

    [Fact]
    public async Task CreateAsync_returns_the_full_row_and_stores_exactly_what_the_TS_writes()
    {
        var input = NewInput(name: "Acme Holdings", plan: "trial");
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);

        var result = await CreateAsync(repository, input);

        Assert.Equal(CreateOrganizationOutcome.Created, result.Outcome);
        var row = result.Row!;
        var orgId = Guid.Parse(row.Id);

        // The TS `organization.create` carries no `select:`, so it resolves to the FULL row.
        Assert.Equal("Acme Holdings", row.Name);
        Assert.Equal(input.Slug, row.Slug);
        Assert.Equal("trial", row.Plan);
        Assert.Equal(input.AdminEmail, row.BillingEmail);
        Assert.True(row.IsActive);
        Assert.Null(row.Domain);
        Assert.Null(row.Logo);
        Assert.Null(row.DeletedAt);
        Assert.Equal("{}", row.Settings!.ToJsonString());
        Assert.Equal(Now, row.UpdatedAt);

        var stored = await fixture.ReadOrganizationAsync(orgId);
        Assert.Equal("Acme Holdings", stored!.Name);
        Assert.Equal("trial", stored.Plan);
        Assert.Equal(input.AdminEmail, stored.BillingEmail);
        // Columns the TS never sends: the DB defaults/NULLs are the parity target.
        Assert.Equal("{}", stored.Settings);
        Assert.True(stored.IsActive);
        Assert.Null(stored.Domain);
        Assert.Null(stored.Logo);
        Assert.Null(stored.DeletedAt);
        Assert.Equal(Now, stored.UpdatedAt);
    }

    // ── R2: the provisioned structure (org-provisioning.ts:13-34) ────────────────────────────────

    [Fact]
    public async Task CreateAsync_provisions_one_company_one_business_unit_and_one_team()
    {
        var input = NewInput(name: "Estructura SAS");
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);

        var orgId = Guid.Parse((await CreateAsync(repository, input)).Row!.Id);

        var company = Assert.Single(await fixture.ReadCompaniesAsync(orgId));
        // The company is named after the ORGANIZATION and its country is hard-coded 'CO' regardless of the
        // tenant. Both are real defects in the TS and both are reproduced, not fixed.
        Assert.Equal("Estructura SAS", company.Name);
        Assert.Equal("CO", company.Country);
        Assert.Equal(orgId, company.OrganizationId);
        // Everything else is a DB default the TS never sends.
        Assert.Equal("USD", company.Currency);
        Assert.Equal("America/Bogota", company.Timezone);
        Assert.Equal("es", company.Language);
        Assert.True(company.IsActive);
        Assert.Equal(Now, company.UpdatedAt);

        var businessUnit = Assert.Single(await fixture.ReadBusinessUnitsAsync(orgId));
        Assert.Equal("General", businessUnit.Name);
        Assert.Equal(company.Id, businessUnit.CompanyId);
        Assert.Equal(orgId, businessUnit.OrganizationId);
        Assert.Equal(Now, businessUnit.UpdatedAt);

        var team = Assert.Single(await fixture.ReadTeamsAsync(orgId));
        Assert.Equal("Equipo General", team.Name);
        Assert.Equal(businessUnit.Id, team.BusinessUnitId);
        Assert.Equal(orgId, team.OrganizationId);
        Assert.Equal(Now, team.UpdatedAt);
    }

    // ── R3: entitlements (org-provisioning.ts:47-67) ─────────────────────────────────────────────

    [Fact]
    public async Task CreateAsync_grants_the_ats_base_bundle_and_never_an_addon()
    {
        // N is a SEED fact, not a code fact — the port hardcodes no count anywhere, and production may hold
        // a different catalogue.
        //
        // DRIFT WARNING, stated honestly: PlatformOrganizationsCreateFixture.AtsBaseModules is a HAND-TYPED
        // C# MIRROR of ATS_BASE_MODULES (seed-entitlements.ts:22-25), and the fixture types the same seven
        // codes out twice more in its plan_modules seeds. C# cannot import a TS constant, so a mirror is
        // unavoidable — but do NOT read this as the drift protection signup-defaults.test.ts:3 has, which
        // genuinely `import`s the exported list. If a module is added to or removed from ATS_BASE_MODULES,
        // the TS test fails immediately and this one stays green across the stale copies.
        var input = NewInput(plan: "enterprise");
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);

        var orgId = Guid.Parse((await CreateAsync(repository, input)).Row!.Id);

        var entitlements = await fixture.ReadEntitlementsAsync(orgId);
        Assert.Equal(
            PlatformOrganizationsCreateFixture.AtsBaseModules.OrderBy(m => m, StringComparer.Ordinal),
            entitlements.Select(e => e.ModuleCode));

        // The org's own `plan` is ignored entirely — an enterprise org still gets exactly the ats-base
        // bundle (org-provisioning.ts:36-46, the INVU precedent).
        Assert.All(entitlements, e =>
        {
            Assert.True(e.Enabled);
            Assert.Equal("plan", e.Source);
            // Module.defaultUnitPrice is deliberately NOT copied by the TS, so a metered module
            // (ai_screening) is granted with a NULL price. Reproduced.
            Assert.Null(e.UnitPrice);
            Assert.Equal(Now, e.UpdatedAt);
        });

        // `limit` is PROPAGATED PER MODULE from plan_modules (org-provisioning.ts:53,63), not blanket-NULLed.
        // The fixture caps ai_screening at 5000 and leaves the other six NULL precisely so this assertion can
        // tell the two apart — with an all-NULL catalogue, `Limit = null` in the writer would be invisible.
        Assert.Equal(
            PlatformOrganizationsCreateFixture.AtsBaseModuleLimits.OrderBy(kv => kv.Key, StringComparer.Ordinal),
            entitlements.Select(e => new KeyValuePair<string, int?>(e.ModuleCode, e.Limit)));

        foreach (var addon in PlatformOrganizationsCreateFixture.AddonModules)
        {
            Assert.DoesNotContain(entitlements, e => e.ModuleCode == addon);
        }

        // The `plan_code = 'ats-base'` FILTER, not merely its value. The catalogue holds a second plan
        // (`growth`) whose one module is reachable through no other route, so an unfiltered catalogue read
        // would grant it — the set equality above already fails, and this says why in one line.
        Assert.DoesNotContain(
            entitlements, e => e.ModuleCode == PlatformOrganizationsCreateFixture.OtherPlanOnlyModule);
    }

    // ── R4: the role (organizations.ts:133-135) ──────────────────────────────────────────────────

    [Fact]
    public async Task CreateAsync_creates_one_system_role_with_no_permissions_and_no_members()
    {
        var input = NewInput();
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);

        var orgId = Guid.Parse((await CreateAsync(repository, input)).Row!.Id);

        var role = Assert.Single(await fixture.ReadRolesAsync(orgId));
        Assert.Equal("Super Administrador", role.Name);
        Assert.Equal("super_admin", role.Slug);
        Assert.True(role.IsSystem);
        // `description` is never sent and `is_active` keeps its DB default.
        Assert.Null(role.Description);
        Assert.True(role.IsActive);
        Assert.Equal(Now, role.UpdatedAt);

        // A "Super Administrador" that grants nothing to nobody: the TS writes no role_permissions and no
        // user_roles rows. Reproduced deliberately, and BOTH halves are asserted — the role_permissions half
        // is the one a future "improvement" would break, since a system role with zero permissions is the
        // most obviously wrong-looking thing in this port and is nevertheless exactly what TS writes.
        //
        // Global counts, and that is the strongest form available: the create context maps NEITHER table, so
        // no code path in this slice can increment either. A non-zero count here means something started
        // writing them, which is the whole question.
        Assert.Equal(0, await CountAsync("SELECT count(*) FROM user_roles"));
        Assert.Equal(0, await fixture.CountRolePermissionsAsync());
    }

    // ── R5 / R6: the subscription (organizations.ts:137-144) ─────────────────────────────────────

    [Fact]
    public async Task CreateAsync_opens_a_trialing_subscription_ending_in_fourteen_days_for_the_trial_plan()
    {
        var input = NewInput(plan: "trial");
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);

        var orgId = Guid.Parse((await CreateAsync(repository, input)).Row!.Id);

        var subscription = await fixture.ReadSubscriptionAsync(orgId);
        Assert.NotNull(subscription);
        Assert.Equal("trial", subscription!.Plan);
        Assert.Equal("trialing", subscription.Status);
        Assert.Equal(Now.AddDays(14), subscription.TrialEndsAt);
        // Stripe and period columns are never sent.
        Assert.Null(subscription.StripeCustomerId);
        Assert.Null(subscription.StripeSubscriptionId);
        Assert.Null(subscription.CurrentPeriodStart);
        Assert.Null(subscription.CurrentPeriodEnd);
        Assert.Equal(Now, subscription.UpdatedAt);
    }

    [Theory]
    [InlineData("starter")]
    [InlineData("professional")]
    [InlineData("enterprise")]
    public async Task CreateAsync_opens_an_active_subscription_with_no_trial_end_for_every_other_plan(string plan)
    {
        var input = NewInput(plan: plan);
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);

        var result = await CreateAsync(repository, input);
        var orgId = Guid.Parse(result.Row!.Id);

        var subscription = await fixture.ReadSubscriptionAsync(orgId);
        Assert.Equal(plan, subscription!.Plan);
        Assert.Equal("active", subscription.Status);
        Assert.Null(subscription.TrialEndsAt);

        // organizations.plan FOR A NON-TRIAL PLAN, asserted here because nowhere else does. It is written by
        // a SEPARATE raw statement from subscriptions.plan (PlatformOrganizationsCreateRepository — two
        // INSERTs, two `{plan}::"OrgPlan"` casts), so the subscription assertions above cannot see it, and
        // every other test in this slice creates a `trial` org. Without this, hard-coding the organizations
        // INSERT to 'trial' passes the entire suite while every downstream reader of organizations.plan
        // (listOrganizations' filter/sort, BillingWebhookRepository, the platform grid) sees a trial org that
        // is billed as enterprise. The ownership checker cannot see the raw SQL that would have done it
        // (#199) and the parity harness is not registered for this surface (#208).
        Assert.Equal(plan, result.Row!.Plan);
        Assert.Equal(plan, (await fixture.ReadOrganizationAsync(orgId))!.Plan);
    }

    // ── R7 / R8: the audit row and its exact bytes ───────────────────────────────────────────────

    [Fact]
    public async Task CreateAsync_writes_one_org_created_audit_row_with_the_TS_payload_byte_for_byte()
    {
        var input = NewInput(name: "Auditada", plan: "starter");
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);

        var orgId = Guid.Parse((await CreateAsync(repository, input)).Row!.Id);

        var audit = Assert.Single(await fixture.ReadAuditRowsAsync(orgId));
        Assert.Equal("org_created", audit.Action);
        Assert.Equal("organization", audit.Entity);
        // `entityId` is Prisma `String?` = TEXT, not uuid — the TS passes the same uuid string.
        Assert.Equal(orgId.ToString(), audit.EntityId);
        Assert.Equal(PlatformOrganizationsCreateFixture.Actor, audit.ActorId);
        // The stored jsonb is a STRING scalar holding the JSON text, matching what Prisma writes when it is
        // handed JSON.stringify(...) — not an object. jsonb re-orders and re-spaces object keys; it
        // preserves a string scalar verbatim, which is why key order is part of the value.
        Assert.Equal("string", audit.ChangesType);
        Assert.Equal(
            $$"""{"name":"Auditada","slug":"{{input.Slug}}","plan":"starter"}""",
            audit.ChangesText);
        // adminEmail and billingEmail are ABSENT from the payload — organizations.ts:164 is a hard-coded
        // object literal, not the Zod parse output.
        Assert.DoesNotContain("adminEmail", audit.ChangesText!, StringComparison.Ordinal);
        Assert.DoesNotContain("billingEmail", audit.ChangesText, StringComparison.Ordinal);
    }

    [Fact]
    public async Task CreateAsync_stores_non_ascii_and_html_sensitive_characters_unescaped()
    {
        // The UnsafeRelaxedJsonEscaping pin at the PERSISTENCE layer, not just in the unit test. The .NET
        // default encoder would store "Fundación & Más <>"; JSON.stringify — and
        // therefore every existing TS audit row — stores the characters literally.
        var input = NewInput(name: "Fundación & Más <>");
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);

        var orgId = Guid.Parse((await CreateAsync(repository, input)).Row!.Id);

        var audit = Assert.Single(await fixture.ReadAuditRowsAsync(orgId));
        Assert.Contains("Fundación & Más <>", audit.ChangesText!, StringComparison.Ordinal);
        Assert.DoesNotContain("\\u", audit.ChangesText, StringComparison.Ordinal);
    }

    // ── R9: RLS. The positive control, then the one column that has no foreign key ───────────────

    [Fact]
    public async Task BusinessUnit_organization_id_is_protected_by_WITH_CHECK_and_nothing_else()
    {
        // POSITIVE half: every test above already runs the whole seven-table create as NOBYPASSRLS
        // app_tenant under TenantScope opened on an organization that does not exist yet. That is genuinely
        // new territory — slice 20's fixture only ever proved the policies for an UPDATE.
        var input = NewInput();
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);
        var orgId = Guid.Parse((await CreateAsync(repository, input)).Row!.Id);
        var company = Assert.Single(await fixture.ReadCompaniesAsync(orgId));

        // NEGATIVE half. business_units.organization_id has NO foreign key in production, so a wrong value
        // is caught by WITH CHECK or by nothing at all: without a scope it would commit silently and the
        // rows would be permanently invisible to the tenant.
        await using var probe = fixture.NewContext(fixture.ConnectionString);
        await using var scope = await TenantScope.BeginAsync(probe, orgId, CancellationToken.None);

        probe.Set<BusinessUnitWriteEntity>().Add(new BusinessUnitWriteEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = PlatformOrganizationsCreateFixture.OtherOrg,
            CompanyId = company.Id,
            Name = "Smuggled",
            UpdatedAt = Now,
        });

        var thrown = await Assert.ThrowsAnyAsync<Exception>(() => probe.SaveChangesAsync(CancellationToken.None));
        Assert.Contains("row-level security", thrown.ToString(), StringComparison.OrdinalIgnoreCase);
    }

    // ── R10: the billingEmail fallback (organizations.ts:119, JS `||` not `??`) ──────────────────

    [Theory]
    [InlineData(null, "admin@tims.test")]
    [InlineData("", "admin@tims.test")]
    [InlineData("billing@tims.test", "billing@tims.test")]
    public async Task CreateAsync_falls_back_to_the_admin_email_for_an_absent_or_empty_billing_email(
        string? billingEmail, string expected)
    {
        // The empty-string case is the `||`-not-`??` reproduction. Zod's `.email()` already rejects '' at the
        // endpoint, so the two are behaviourally equivalent behind it — reproduced rather than assumed,
        // because a `??` here would become a silent divergence if the schema ever relaxed.
        var input = NewInput(adminEmail: "admin@tims.test") with { BillingEmail = billingEmail };
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);

        var orgId = Guid.Parse((await CreateAsync(repository, input)).Row!.Id);

        Assert.Equal(expected, (await fixture.ReadOrganizationAsync(orgId))!.BillingEmail);
    }

    // ── R11: notify PROPAGATES, and the transaction's work survives ──────────────────────────────

    [Fact]
    public async Task A_notify_failure_propagates_but_leaves_the_whole_creation_committed()
    {
        // organizations.ts:149 awaits notify with NO try and NO .catch, so a fan-out failure is a 500 to the
        // operator AFTER the transaction has committed. That half is parity.
        //
        // The other half is the recorded DIVERGENCE, and it is asserted here rather than merely commented:
        // in TS the audit write is the statement AFTER notify, so a notify failure leaves the organization
        // committed with NO org_created audit row. Here the audit row is already committed. Both stacks fail
        // the request; they differ in what is left behind.
        var connectionString = fixture.MissingNotificationsTableConnectionString;
        var input = NewInput(name: "Notify Casualty");
        await using var db = fixture.NewContext(connectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);
        var useCase = new PlatformOrganizationsCreateUseCase(repository, new FixedTimeProvider(Now));

        await Assert.ThrowsAnyAsync<Exception>(() =>
            useCase.CreateAsync(input, PlatformOrganizationsCreateFixture.Actor, CancellationToken.None));

        var stored = await ReadBySlugAsync(input.Slug, connectionString);
        Assert.NotNull(stored);
        var counts = await fixture.CountAllProvisionedRowsAsync(stored!.Value, connectionString);
        Assert.Equal(new PlatformOrganizationsCreateFixture.ProvisionedCounts(1, 1, 1, 1, 1, 1, 7), counts);

        var audit = Assert.Single(await fixture.ReadAuditRowsAsync(stored.Value, connectionString));
        Assert.Equal("org_created", audit.Action);
    }

    // ── R12: the zero-entitlement fail-OPEN (org-provisioning.ts, empty catalogue) ───────────────

    [Fact]
    public async Task An_empty_plan_module_catalogue_commits_an_organization_with_zero_entitlements()
    {
        // The TS loop simply does not execute when `plan_modules` holds no ats-base rows, and the
        // transaction commits. Fail-OPEN, reproduced: an org with no entitlements is a valid TS outcome and
        // must be a valid C# outcome.
        await fixture.ClearPlanModulesAsync();
        try
        {
            var input = NewInput(name: "Sin Entitlements");
            await using var db = fixture.NewContext(fixture.ConnectionString);
            var repository = new PlatformOrganizationsCreateRepository(db);

            var result = await CreateAsync(repository, input);
            Assert.Equal(CreateOrganizationOutcome.Created, result.Outcome);

            var orgId = Guid.Parse(result.Row!.Id);
            var counts = await fixture.CountAllProvisionedRowsAsync(orgId);
            Assert.Equal(new PlatformOrganizationsCreateFixture.ProvisionedCounts(1, 1, 1, 1, 1, 1, 0), counts);
            Assert.Single(await fixture.ReadAuditRowsAsync(orgId));
        }
        finally
        {
            await fixture.RestorePlanModulesAsync();
        }
    }

    // ── R13: duplicate slug → SlugTaken, with nothing written ───────────────────────────────────

    [Fact]
    public async Task A_duplicate_slug_returns_SlugTaken_and_writes_absolutely_nothing()
    {
        var input = NewInput(name: "Primera");
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);

        Assert.Equal(CreateOrganizationOutcome.Created, (await CreateAsync(repository, input)).Outcome);

        // Global counts, not per-org: the second attempt generates an id internally and discards it, so a
        // per-org count would be trivially zero and the assertion vacuous.
        var countsBefore = await fixture.CountAllRowsAsync();
        var auditBefore = await fixture.CountAuditRowsAsync("org_created");

        await using var second = fixture.NewContext(fixture.ConnectionString);
        var retry = new PlatformOrganizationsCreateRepository(second);
        var result = await CreateAsync(retry, input with { Name = "Segunda" });

        // DELIBERATE DIVERGENCE: TS has no P2002 handling, so a duplicate slug leaks raw Prisma text as a
        // 500 into the operator's modal. Only the NAMED organizations_slug_key constraint is mapped here.
        Assert.Equal(CreateOrganizationOutcome.SlugTaken, result.Outcome);
        Assert.Null(result.Row);
        Assert.Equal(countsBefore, await fixture.CountAllRowsAsync());
        Assert.Equal(auditBefore, await fixture.CountAuditRowsAsync("org_created"));
    }

    // ── R13b: the DISCRIMINATING half of IsSlugConflict — anything else must PROPAGATE ──────────

    [Fact]
    public async Task A_unique_violation_that_is_not_the_slug_key_propagates_instead_of_becoming_SlugTaken()
    {
        // R13 above proves the positive half. This is the half that makes the guard a guard: the repository
        // matches organizations_slug_key BY NAME, and a future unique index, a primary-key collision on the
        // client-generated uuid, or (as here) org_entitlements_organization_id_module_code_key must NOT be
        // mislabeled as the documented duplicate-slug 409.
        //
        // Without this, "simplify" IsSlugConflict to a bare SqlState: UniqueViolation match and every test in
        // the slice stays green — while an operator whose slug is fine gets told "slug_taken".
        await fixture.IntroduceDuplicateAtsBaseModuleAsync();
        try
        {
            var countsBefore = await fixture.CountAllRowsAsync();
            var input = NewInput(name: "Entitlement Collision");
            await using var db = fixture.NewContext(fixture.ConnectionString);
            var repository = new PlatformOrganizationsCreateRepository(db);

            var thrown = await Assert.ThrowsAnyAsync<Exception>(() => CreateAsync(repository, input));

            // It PROPAGATED — it did not return SlugTaken — and it names the OTHER constraint.
            Assert.Contains(
                "org_entitlements_organization_id_module_code_key", thrown.ToString(), StringComparison.Ordinal);
            Assert.DoesNotContain("organizations_slug_key", thrown.ToString(), StringComparison.Ordinal);

            // ...and the transaction still rolled everything back, so this is a clean 500, not a partial org.
            Assert.Equal(countsBefore, await fixture.CountAllRowsAsync());
            Assert.Null(await ReadBySlugAsync(input.Slug));
        }
        finally
        {
            await fixture.RestorePlanModulesAsync();
        }
    }

    // ── R14 / R15: THE MUTATION PROOF, in both directions ───────────────────────────────────────

    [Fact]
    public async Task CreateAsync_fails_closed_leaving_all_seven_tables_untouched_when_the_audit_write_fails()
    {
        // Direction 1. The same code path against a database with no `audit_logs` table. Asserting only that
        // `organizations` is empty would stay green on a PARTIAL commit — which is exactly the failure this
        // guard exists to prevent — so all seven counts are snapshotted.
        var connectionString = fixture.MissingAuditTableConnectionString;
        var before = await fixture.CountAllRowsAsync(connectionString);

        await using var db = fixture.NewContext(connectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);

        var input = NewInput(name: "Should Not Persist");
        await Assert.ThrowsAnyAsync<Exception>(() => CreateAsync(repository, input));

        Assert.Equal(before, await fixture.CountAllRowsAsync(connectionString));
        Assert.Null(await ReadBySlugAsync(input.Slug, connectionString));
    }

    [Fact]
    public async Task The_control_for_the_mutation_proof_writes_all_seven_tables_on_the_healthy_database()
    {
        // Direction 2, the anti-vacuity control. Without it, the fail-closed test above would also be green
        // if CreateAsync wrote nothing at all, ever.
        var before = await fixture.CountAllRowsAsync();

        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);

        var input = NewInput(name: "Should Persist");
        var orgId = Guid.Parse((await CreateAsync(repository, input)).Row!.Id);

        var after = await fixture.CountAllRowsAsync();
        Assert.Equal(before.Organizations + 1, after.Organizations);
        Assert.Equal(before.Companies + 1, after.Companies);
        Assert.Equal(before.BusinessUnits + 1, after.BusinessUnits);
        Assert.Equal(before.Teams + 1, after.Teams);
        Assert.Equal(before.Roles + 1, after.Roles);
        Assert.Equal(before.Subscriptions + 1, after.Subscriptions);
        Assert.Equal(before.Entitlements + PlatformOrganizationsCreateFixture.AtsBaseModules.Length, after.Entitlements);
        Assert.Single(await fixture.ReadAuditRowsAsync(orgId));
    }

    // ── the notification fan-out ──────────────────────────────────────────────────────────────────

    [Fact]
    public async Task NotifyPlatformOwnersAsync_inserts_one_row_per_platform_owner_across_organizations()
    {
        var input = NewInput(name: "Notificada");
        await using var db = fixture.NewContext(fixture.ConnectionString);
        var repository = new PlatformOrganizationsCreateRepository(db);
        var useCase = new PlatformOrganizationsCreateUseCase(repository, new FixedTimeProvider(Now));

        var result = await useCase.CreateAsync(input, PlatformOrganizationsCreateFixture.Actor, CancellationToken.None);
        var orgId = Guid.Parse(result.Row!.Id);

        var notifications = await fixture.ReadNotificationsAsync(orgId);

        // Both platform owners, and they are in DIFFERENT organizations — the fan-out is cross-org, which is
        // why it cannot run inside the new org's TenantScope.
        Assert.Equal(2, notifications.Count);
        Assert.Contains(notifications, n => n.UserId == PlatformOrganizationsCreateFixture.Actor);
        Assert.Contains(notifications, n => n.UserId == PlatformOrganizationsCreateFixture.OwnerTwo);
        Assert.DoesNotContain(notifications, n => n.UserId == PlatformOrganizationsCreateFixture.NonOwner);

        Assert.All(notifications, n =>
        {
            Assert.Equal("success", n.Type);
            // Unaccented "organizacion" is what the TS actually writes.
            Assert.Equal("Nueva organizacion creada: Notificada", n.Title);
            Assert.Equal("platform", n.Module);
            Assert.Equal("/platform/organizations", n.ActionUrl);
        });
    }

    // ── helpers ──────────────────────────────────────────────────────────────────────────────────

    /// <summary>A unique slug per call — <c>organizations_slug_key</c> is global and there is no teardown.</summary>
    private static PlatformOrganizationCreateInput NewInput(
        string name = "Nueva Org",
        string? slug = null,
        string plan = "trial",
        string adminEmail = "admin@tims.test",
        string? billingEmail = null) =>
        new(name, slug ?? Guid.NewGuid().ToString(), plan, adminEmail, billingEmail);

    private static Task<CreateOrganizationResult> CreateAsync(
        PlatformOrganizationsCreateRepository repository, PlatformOrganizationCreateInput input) =>
        repository.CreateAsync(
            input,
            PlatformOrganizationsCreateUseCase.BuildCreateChangesJson(input),
            PlatformOrganizationsCreateFixture.Actor,
            Now,
            CancellationToken.None);

    private async Task<Guid?> ReadBySlugAsync(string slug, string? connectionString = null)
    {
        await using var connection = new Npgsql.NpgsqlConnection(connectionString ?? fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT id FROM organizations WHERE slug = @slug";
        command.Parameters.AddWithValue("slug", slug);
        var value = await command.ExecuteScalarAsync();
        return value is Guid id ? id : null;
    }

    private async Task<long> CountAsync(string sql)
    {
        await using var connection = new Npgsql.NpgsqlConnection(fixture.ConnectionString);
        await connection.OpenAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = sql;
        return (long)(await command.ExecuteScalarAsync())!;
    }

    /// <summary>
    /// A <see cref="TimeProvider"/> pinned to the test's single <c>now</c>, so use-case-driven tests assert
    /// the same timestamps the repository-driven ones do.
    ///
    /// <para>It deliberately yields a <c>Kind=Utc</c> instant, which is the PRODUCTION shape:
    /// <c>PlatformOrganizationsCreateUseCase</c> passes <c>timeProvider.GetUtcNow().UtcDateTime</c> down.
    /// The direct-repository tests pass a <c>Kind=Unspecified</c> value instead, so between them the two
    /// shapes cover both sides of Npgsql's <c>timestamp without time zone</c> kind check — a mismatch there
    /// is invisible to unit tests and throws only against a real Postgres.</para>
    /// </summary>
    private sealed class FixedTimeProvider(DateTime utcNow) : TimeProvider
    {
        public override DateTimeOffset GetUtcNow() => new(DateTime.SpecifyKind(utcNow, DateTimeKind.Utc));
    }
}
