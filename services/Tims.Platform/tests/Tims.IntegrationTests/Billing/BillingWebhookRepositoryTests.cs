using Npgsql;
using Tims.Domain.Billing;
using Tims.Infrastructure.Billing;

namespace Tims.IntegrationTests.Billing;

/// <summary>
/// Phase-5 Slice 4 Testcontainers proof (real Postgres, native enums, real RLS + FORCE — NEVER mocked) of the
/// PRIVILEGED Stripe-webhook write: the upsert lands on the privileged connection with no org GUC (past FORCE
/// RLS); apply outcomes (insert / update-on-newer / duplicate / stale) match the pure kernels; the unknown
/// price never downgrades; <c>organizations.plan</c> is mirrored only when the plan is known; org resolution +
/// linkCustomer are faithful; a tenant-scoped writer without the GUC is fail-closed (RLS-necessity bite); the
/// per-org advisory lock serializes same-org and frees different orgs; concurrent applies converge to one row.
/// </summary>
public sealed class BillingWebhookRepositoryTests(BillingWebhookFixture fixture) : IClassFixture<BillingWebhookFixture>
{
    private static readonly DateTimeOffset NewerEvent = new(2021, 7, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset OlderEvent = new(2021, 1, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset PeriodStart = new(2021, 7, 1, 0, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset PeriodEnd = new(2021, 8, 1, 0, 0, 0, TimeSpan.Zero);

    private BillingWebhookRepository Repo() => new(fixture.NewWebhookContext());

    private static SubscriptionSyncFields Fields(
        string subscriptionId, string? plan, string status,
        DateTimeOffset? periodStart = null, DateTimeOffset? periodEnd = null, DateTimeOffset? cancelledAt = null) =>
        new()
        {
            StripeSubscriptionId = subscriptionId,
            Plan = plan,
            Status = status,
            CurrentPeriodStart = periodStart,
            CurrentPeriodEnd = periodEnd,
            CancelledAt = cancelledAt,
        };

    // ---- insert a NEW subscription on the privileged connection, past FORCE RLS, native enum write ----------
    [Fact]
    public async Task Apply_inserts_a_new_subscription_on_the_privileged_connection()
    {
        var org = BillingWebhookFixture.OrgInsert;

        var outcome = await Repo().ApplySubscriptionAsync(
            org.ToString(), "cus_new",
            Fields("sub_new", "professional", "active", PeriodStart, PeriodEnd), NewerEvent, CancellationToken.None);

        Assert.Equal(ApplyOutcome.Applied, outcome);
        Assert.Equal(1, await fixture.CountSubscriptionsAsync(org));

        var row = await fixture.GetSubscriptionAsync(org);
        Assert.NotNull(row);
        Assert.Equal("sub_new", row!.StripeSubscriptionId);
        Assert.Equal("cus_new", row.StripeCustomerId);
        Assert.Equal("professional", row.Plan);
        Assert.Equal("active", row.Status);
        Assert.Equal(PeriodStart.UtcDateTime, row.CurrentPeriodStart);
        Assert.Equal(PeriodEnd.UtcDateTime, row.CurrentPeriodEnd);
        Assert.Equal(NewerEvent.UtcDateTime, row.LastStripeEventAt);
        Assert.Null(row.CancelledAt);
    }

    // ---- update an existing subscription on a newer event + mirror the KNOWN plan onto organizations --------
    [Fact]
    public async Task Apply_updates_existing_and_mirrors_known_plan()
    {
        var org = BillingWebhookFixture.OrgUpdate; // seeded starter/active, org.plan trial

        var outcome = await Repo().ApplySubscriptionAsync(
            org.ToString(), "cus_update",
            Fields("sub_update", "professional", "past_due", PeriodStart, PeriodEnd, cancelledAt: PeriodEnd),
            NewerEvent, CancellationToken.None);

        Assert.Equal(ApplyOutcome.Applied, outcome);
        Assert.Equal(1, await fixture.CountSubscriptionsAsync(org)); // upsert never duplicates on the unique org

        var row = await fixture.GetSubscriptionAsync(org);
        Assert.Equal("professional", row!.Plan);
        Assert.Equal("past_due", row.Status);
        Assert.Equal(PeriodEnd.UtcDateTime, row.CancelledAt);
        Assert.Equal(NewerEvent.UtcDateTime, row.LastStripeEventAt);
        Assert.Equal("professional", await fixture.GetOrgPlanAsync(org)); // mirror applied (was trial)
    }

    // ---- unknown price (plan null) NEVER downgrades the stored plan NOR the org.plan mirror -----------------
    [Fact]
    public async Task Apply_unknown_price_does_not_downgrade_plan_or_org()
    {
        var org = BillingWebhookFixture.OrgNoDowngrade; // seeded professional/active, org.plan professional

        var outcome = await Repo().ApplySubscriptionAsync(
            org.ToString(), "cus_nodown",
            Fields("sub_nodown", plan: null, "past_due"), NewerEvent, CancellationToken.None);

        Assert.Equal(ApplyOutcome.Applied, outcome);

        var row = await fixture.GetSubscriptionAsync(org);
        Assert.Equal("professional", row!.Plan); // plan UNCHANGED (no downgrade on unknown price)
        Assert.Equal("past_due", row.Status); // status DID update
        Assert.Equal("professional", await fixture.GetOrgPlanAsync(org)); // org mirror SKIPPED (plan null)
    }

    // ---- a DIFFERENT non-cancelled subscription is a duplicate → writes NOTHING -----------------------------
    [Fact]
    public async Task Apply_duplicate_writes_nothing()
    {
        var org = BillingWebhookFixture.OrgDuplicate; // seeded sub_current/professional/active

        var outcome = await Repo().ApplySubscriptionAsync(
            org.ToString(), "cus_dup2",
            Fields("sub_new_duplicate", "starter", "active"), NewerEvent, CancellationToken.None);

        Assert.Equal(ApplyOutcome.Duplicate, outcome);

        var row = await fixture.GetSubscriptionAsync(org);
        Assert.Equal("sub_current", row!.StripeSubscriptionId); // unchanged — the good subscription is intact
        Assert.Equal("professional", row.Plan);
    }

    // ---- a strictly OLDER out-of-order delivery is stale → writes NOTHING ------------------------------------
    [Fact]
    public async Task Apply_stale_event_writes_nothing()
    {
        var org = BillingWebhookFixture.OrgStale; // seeded starter/active, last event 2021-06-01

        var outcome = await Repo().ApplySubscriptionAsync(
            org.ToString(), "cus_stale",
            Fields("sub_stale", "professional", "cancelled"), OlderEvent, CancellationToken.None);

        Assert.Equal(ApplyOutcome.Stale, outcome);

        var row = await fixture.GetSubscriptionAsync(org);
        Assert.Equal("active", row!.Status); // unchanged — the older event was dropped
        Assert.Equal("starter", row.Plan);
    }

    // ---- org resolution by the recorded unique columns ------------------------------------------------------
    [Fact]
    public async Task Resolves_org_by_subscription_and_by_customer()
    {
        var repo = Repo();
        Assert.Equal(
            BillingWebhookFixture.OrgResolve.ToString(),
            await repo.FindOrgIdBySubscriptionAsync("sub_resolve", CancellationToken.None));
        Assert.Equal(
            BillingWebhookFixture.OrgResolve.ToString(),
            await repo.FindOrgIdByCustomerAsync("cus_resolve", CancellationToken.None));
        Assert.Null(await repo.FindOrgIdBySubscriptionAsync("sub_unknown", CancellationToken.None));
        Assert.Null(await repo.FindOrgIdByCustomerAsync("cus_unknown", CancellationToken.None));
    }

    // ---- linkCustomer inserts a row (Prisma defaults) when none exists --------------------------------------
    [Fact]
    public async Task LinkCustomer_inserts_when_no_row()
    {
        var org = BillingWebhookFixture.OrgLinkNew;

        await Repo().LinkCustomerAsync(org.ToString(), "cus_linknew", CancellationToken.None);

        Assert.Equal(1, await fixture.CountSubscriptionsAsync(org));
        var row = await fixture.GetSubscriptionAsync(org);
        Assert.Equal("cus_linknew", row!.StripeCustomerId);
        Assert.Equal("trial", row.Plan); // Prisma @default
        Assert.Equal("trialing", row.Status); // Prisma @default
        Assert.Null(row.StripeSubscriptionId);
    }

    // ---- linkCustomer overwrites the customer id on an existing row, leaving everything else ----------------
    [Fact]
    public async Task LinkCustomer_updates_existing_customer_only()
    {
        var org = BillingWebhookFixture.OrgLinkExisting; // seeded sub_link/starter/active, cus_old

        await Repo().LinkCustomerAsync(org.ToString(), "cus_relinked", CancellationToken.None);

        var row = await fixture.GetSubscriptionAsync(org);
        Assert.Equal("cus_relinked", row!.StripeCustomerId); // updated
        Assert.Equal("sub_link", row.StripeSubscriptionId); // untouched
        Assert.Equal("starter", row.Plan); // untouched
        Assert.Equal("active", row.Status); // untouched
    }

    // ---- an explicit-org write never touches another org's row (tenant isolation by explicit scoping) -------
    [Fact]
    public async Task Apply_does_not_touch_other_orgs()
    {
        var orgB = BillingWebhookFixture.OrgB;
        var before = await fixture.GetSubscriptionAsync(orgB);

        await Repo().ApplySubscriptionAsync(
            BillingWebhookFixture.OrgResolve.ToString(), "cus_resolve",
            Fields("sub_resolve", "professional", "active"), NewerEvent, CancellationToken.None);

        var after = await fixture.GetSubscriptionAsync(orgB);
        Assert.Equal(before!.StripeSubscriptionId, after!.StripeSubscriptionId);
        Assert.Equal(before.Plan, after.Plan);
        Assert.Equal(before.Status, after.Status);
    }

    // ---- RLS-necessity BITE: the privileged write lands where a tenant-role writer (no GUC) is blocked ------
    [Fact]
    public async Task Privileged_write_lands_where_tenant_role_without_guc_is_blocked()
    {
        var org = BillingWebhookFixture.OrgRls;

        // Privileged repo write succeeds (superuser bypasses FORCE RLS, no GUC) — models the prod BYPASSRLS role.
        var outcome = await Repo().ApplySubscriptionAsync(
            org.ToString(), "cus_rls", Fields("sub_rls", "starter", "active"), NewerEvent, CancellationToken.None);
        Assert.Equal(ApplyOutcome.Applied, outcome);
        Assert.NotNull(await fixture.GetSubscriptionAsync(org));

        // The SAME INSERT as the NOLOGIN/NOBYPASSRLS app_tenant role with NO org GUC set is fail-closed: the
        // RLS WITH CHECK (org = NULL) rejects it. This is why the webhook MUST run on the privileged connection.
        await using var connection = await fixture.OpenSuperuserConnectionAsync();
        await using (var setRole = connection.CreateCommand())
        {
            setRole.CommandText = "SET ROLE app_tenant";
            await setRole.ExecuteNonQueryAsync();
        }

        await using var insert = connection.CreateCommand();
        insert.CommandText =
            """
            INSERT INTO subscriptions (id, organization_id, stripe_subscription_id, plan, status)
            VALUES (gen_random_uuid(), @org, 'sub_tenant_blocked', 'starter'::"OrgPlan", 'active'::"SubscriptionStatus")
            """;
        insert.Parameters.AddWithValue("org", Guid.Parse("10000000-0000-0000-0000-0000000000bb"));
        var ex = await Assert.ThrowsAsync<PostgresException>(() => insert.ExecuteNonQueryAsync());
        Assert.Equal(PostgresErrorCodes.InsufficientPrivilege, ex.SqlState); // RLS policy violation (42501)
    }

    // ---- the per-org advisory lock serializes the SAME org and frees DIFFERENT orgs -------------------------
    [Fact]
    public async Task Advisory_lock_serializes_same_org_and_frees_different_orgs()
    {
        var org = BillingWebhookFixture.OrgConcurrent.ToString();
        var otherOrg = BillingWebhookFixture.OrgB.ToString();

        // conn1 holds the transaction-scoped advisory lock for `org`.
        await using var conn1 = await fixture.OpenSuperuserConnectionAsync();
        await using var tx1 = await conn1.BeginTransactionAsync();
        await using (var lock1 = conn1.CreateCommand())
        {
            lock1.Transaction = tx1;
            lock1.CommandText = "SELECT pg_advisory_xact_lock(hashtext(@org))";
            lock1.Parameters.AddWithValue("org", org);
            await lock1.ExecuteNonQueryAsync();
        }

        // conn2 cannot take the SAME org lock (try → false) but CAN take a different org's (try → true).
        await using var conn2 = await fixture.OpenSuperuserConnectionAsync();
        await using var tx2 = await conn2.BeginTransactionAsync();
        await using (var trySame = conn2.CreateCommand())
        {
            trySame.Transaction = tx2;
            trySame.CommandText = "SELECT pg_try_advisory_xact_lock(hashtext(@org))";
            trySame.Parameters.AddWithValue("org", org);
            Assert.False((bool)(await trySame.ExecuteScalarAsync())!);
        }

        await using (var tryOther = conn2.CreateCommand())
        {
            tryOther.Transaction = tx2;
            tryOther.CommandText = "SELECT pg_try_advisory_xact_lock(hashtext(@org))";
            tryOther.Parameters.AddWithValue("org", otherOrg);
            Assert.True((bool)(await tryOther.ExecuteScalarAsync())!);
        }
    }

    // ---- concurrent applies for a brand-new org converge to exactly ONE row (lock + unique org) -------------
    [Fact]
    public async Task Concurrent_applies_for_a_new_org_converge_to_one_row()
    {
        var org = BillingWebhookFixture.OrgConcurrent.ToString();
        var fields = Fields("sub_concurrent", "starter", "active", PeriodStart, PeriodEnd);

        // Eight identical deliveries in parallel. The per-org advisory lock serializes read-decide-write even
        // though the row does not exist yet (a FOR UPDATE can't lock a missing row); the unique organization_id
        // + ON CONFLICT guarantees exactly one row and no unique-violation crash.
        var tasks = Enumerable.Range(0, 8)
            .Select(_ => Repo().ApplySubscriptionAsync(org, "cus_concurrent", fields, NewerEvent, CancellationToken.None))
            .ToArray();
        var outcomes = await Task.WhenAll(tasks);

        Assert.All(outcomes, o => Assert.Equal(ApplyOutcome.Applied, o));
        Assert.Equal(1, await fixture.CountSubscriptionsAsync(BillingWebhookFixture.OrgConcurrent));
        var row = await fixture.GetSubscriptionAsync(BillingWebhookFixture.OrgConcurrent);
        Assert.Equal("sub_concurrent", row!.StripeSubscriptionId);
        Assert.Equal("active", row.Status);
    }
}
