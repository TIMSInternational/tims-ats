using Npgsql;
using Tims.Application.Assessments.Providers;
using Tims.Infrastructure.Assessments.Providers;

namespace Tims.IntegrationTests.Assessments;

/// <summary>
/// The D17 poller's lease against the real migration and RLS: two pollers never hold the same attempt, a row another
/// poller is claiming is skipped (never waited for), an expired lease is reclaimable, a release is conditional on its
/// owner, and only stale, mapped attempts outside every other workflow are claimable. Each test owns its organization.
/// </summary>
[Collection("AssessmentProviderRls")]
public sealed class AssessmentProviderPollLeaseTests(AssessmentProviderSchemaFixture fixture)
{
    private async Task<Guid> OrgAsync()
    {
        var org = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO organizations (id, name, slug) VALUES ('{org}', 'Poll', 'poll-{org:N}');
             INSERT INTO assessment_provider_bindings (id, organization_id, provider, provider_tenant_id, enabled_instruments, default_locale)
             VALUES ('{org}', '{org}', 'tims-assessments', gen_random_uuid(), ARRAY['lia'], 'es');
             """);
        return org;
    }

    // An attempt last written `age` ago (database clock). Every column the predicate reads is spelled out.
    private async Task<Guid> AttemptAsync(
        Guid org, string state = "in_progress", string age = "1 hour", string extra = "", string extraValues = "")
    {
        var attempt = Guid.NewGuid();
        await fixture.ExecuteAsync(
            $"""
             INSERT INTO assessment_provider_attempts (id, organization_id, binding_id, candidate_id, vacancy_id, instrument, state,
                 purpose, job_relatedness_reason, locale, time_multiplier, provider_subject_id, provider_assignment_id,
                 instrument_version, content_version, assigned_by_id, expires_at, created_at, updated_at{extra})
             VALUES ('{attempt}', '{org}', '{org}', gen_random_uuid(), gen_random_uuid(), 'lia', '{state}', 'selection',
                 'Análisis de datos', 'es', 1, gen_random_uuid(), gen_random_uuid(), '1.0', 'content-1', gen_random_uuid(),
                 now() + interval '7 days', now() - interval '{age}', now() - interval '{age}'{extraValues})
             """);
        return attempt;
    }

    private async Task<IReadOnlyList<Guid>> ClaimAsync(Guid org, Guid owner, int max = 25, CancellationToken cancellationToken = default)
    {
        await using var db = fixture.NewContext();
        var claimed = await new AssessmentProviderRepository(db).ClaimPollableAttemptsAsync(org, owner, max, cancellationToken);
        return claimed.Select(c => c.Attempt.Id).ToList();
    }

    private async Task ReleaseAsync(Guid org, Guid attempt, Guid owner)
    {
        await using var db = fixture.NewContext();
        await new AssessmentProviderRepository(db).ReleasePollLeaseAsync(org, attempt, owner, CancellationToken.None);
    }

    private async Task<string?> LeaseAsync(Guid attempt) => (string?)await fixture.ScalarAsync(
        $"SELECT coalesce(poll_lease_owner::text, '-') || '|' || (last_polled_at IS NOT NULL)::text FROM assessment_provider_attempts WHERE id = '{attempt}'");

    [Fact]
    public async Task Two_pollers_claiming_at_once_never_hold_the_same_attempt()
    {
        var org = await OrgAsync();
        var attempts = new List<Guid>();
        for (var i = 0; i < 12; i++)
        {
            attempts.Add(await AttemptAsync(org));
        }

        var (a, b) = (Guid.NewGuid(), Guid.NewGuid());
        var claims = await Task.WhenAll(ClaimAsync(org, a, 12), ClaimAsync(org, b, 12));

        Assert.Empty(claims[0].Intersect(claims[1]));
        Assert.Equal(attempts.Order(), claims[0].Concat(claims[1]).Order());
        foreach (var attempt in claims[0])
        {
            Assert.StartsWith(a.ToString(), await LeaseAsync(attempt), StringComparison.Ordinal);
        }

        // While the leases live, nobody else gets any of them.
        Assert.Empty(await ClaimAsync(org, Guid.NewGuid()));
    }

    [Fact]
    public async Task A_row_another_poller_is_claiming_is_skipped_not_waited_for()
    {
        var org = await OrgAsync();
        var locked = await AttemptAsync(org);
        var free = await AttemptAsync(org);

        await using var other = new NpgsqlConnection(fixture.ConnectionString);
        await other.OpenAsync();
        await using var transaction = await other.BeginTransactionAsync();
        await using (var lockRow = new NpgsqlCommand(
            $"SELECT id FROM assessment_provider_attempts WHERE id = '{locked}' FOR UPDATE", other, transaction))
        {
            await lockRow.ExecuteScalarAsync();
        }

        using var budget = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        var claimed = await ClaimAsync(org, Guid.NewGuid(), cancellationToken: budget.Token);

        Assert.Equal([free], claimed);
        await transaction.RollbackAsync();
    }

    [Fact]
    public async Task An_expired_lease_is_reclaimable_and_only_its_owner_releases_it()
    {
        var org = await OrgAsync();
        var attempt = await AttemptAsync(org);
        var (dead, live) = (Guid.NewGuid(), Guid.NewGuid());
        Assert.Equal([attempt], await ClaimAsync(org, dead));

        // The first poller died: its lease runs out (database clock).
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET poll_lease_until = now() - interval '1 second' WHERE id = '{attempt}'");
        Assert.Equal([attempt], await ClaimAsync(org, live));

        await ReleaseAsync(org, attempt, dead); // a late release by the dead owner changes nothing
        Assert.Equal($"{live}|false", await LeaseAsync(attempt));

        await ReleaseAsync(org, attempt, live);
        Assert.Equal("-|true", await LeaseAsync(attempt));
        Assert.Empty(await ClaimAsync(org, Guid.NewGuid())); // just polled: not stale again yet
    }

    [Fact]
    public async Task Only_stale_mapped_attempts_outside_every_other_workflow_are_claimable()
    {
        var org = await OrgAsync();
        var stale = await AttemptAsync(org, "launched", "20 minutes");
        var revision = await AttemptAsync(org, "result_ready", "7 hours", ", completed_at", ", now() - interval '1 day'");
        await AttemptAsync(org, "in_progress", "1 minute");                                                      // fresh
        await AttemptAsync(org, "result_ready", "1 hour", ", completed_at", ", now() - interval '1 day'");      // revision read too recent
        await AttemptAsync(org, "result_ready", "40 days", ", completed_at", ", now() - interval '40 days'");   // outside the window
        await AttemptAsync(org, "voided");                                                                       // terminal
        await AttemptAsync(org, "in_progress", "1 hour", ", withdrawal_state", ", 'pending'");                 // the #312 cascade owns it
        await AttemptAsync(org, "in_progress", "1 hour", ", provider_erasure_requested_at", ", now()");        // erasure requested
        await AttemptAsync(org, "created", "1 hour", ", last_polled_at", ", now() - interval '1 minute'");      // polled a minute ago
        var expired = await AttemptAsync(org, "created", "1 hour");
        await fixture.ExecuteAsync(
            $"UPDATE assessment_provider_attempts SET expires_at = now() - interval '8 days' WHERE id = '{expired}'"); // long expired

        await using (var db = fixture.NewContext())
        {
            Assert.Contains(org, await new AssessmentProviderRepository(db).ListOrganizationsWithPollableAttemptsAsync(1000, CancellationToken.None));
        }

        Assert.Equal(new[] { stale, revision }.Order(), (await ClaimAsync(org, Guid.NewGuid())).Order());

        await using (var db = fixture.NewContext())
        {
            Assert.DoesNotContain(org, await new AssessmentProviderRepository(db).ListOrganizationsWithPollableAttemptsAsync(1000, CancellationToken.None));
        }
    }

    [Fact]
    public async Task A_claim_is_tenant_scoped_and_returns_the_bindings_provider_tenant()
    {
        var org = await OrgAsync();
        var otherOrg = await OrgAsync();
        var mine = await AttemptAsync(org);
        await AttemptAsync(otherOrg);
        var tenant = (Guid)(await fixture.ScalarAsync($"SELECT provider_tenant_id FROM assessment_provider_bindings WHERE id = '{org}'"))!;

        await using var db = fixture.NewContext();
        var claimed = await new AssessmentProviderRepository(db).ClaimPollableAttemptsAsync(org, Guid.NewGuid(), 25, CancellationToken.None);

        var only = Assert.Single(claimed);
        Assert.Equal((mine, tenant), (only.Attempt.Id, only.ProviderTenantId));
    }

    [Fact]
    public async Task Missing_consents_are_set_on_an_open_attempt_and_unknown_purposes_dropped()
    {
        var org = await OrgAsync();
        var open = await AttemptAsync(org, "created");
        var closed = await AttemptAsync(org, "voided");

        await using (var db = fixture.NewContext())
        {
            var repository = new AssessmentProviderRepository(db);
            await repository.SetMissingConsentsAsync(org, open, ["voice", "assessment", "bogus"], CancellationToken.None);
            await repository.SetMissingConsentsAsync(org, closed, ["assessment"], CancellationToken.None);
        }

        Assert.Equal("{assessment,voice}", (string?)await fixture.ScalarAsync(
            $"SELECT missing_consents::text FROM assessment_provider_attempts WHERE id = '{open}'"));
        Assert.Equal("{}", (string?)await fixture.ScalarAsync(
            $"SELECT missing_consents::text FROM assessment_provider_attempts WHERE id = '{closed}'"));
    }
}
