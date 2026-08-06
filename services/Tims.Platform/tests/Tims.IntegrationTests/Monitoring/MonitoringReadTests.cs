using Tims.Application.Monitoring;
using Tims.Domain.Access;
using Tims.Infrastructure.Monitoring;

namespace Tims.IntegrationTests.Monitoring;

/// <summary>
/// Phase-5 Q0b slice 1 (issue #100) direct-repository + use-case tests against REAL Postgres and REAL
/// RLS — no mocks. Every call runs UNDER TenantScope (SET LOCAL ROLE app_tenant + org GUC), so these
/// prove both that the EF queries fetch the right rows AND that RLS + the explicit org filter isolate
/// the tenant: OrgB seeds DIFFERENT values on every table, so a cross-org bleed changes OrgA's numbers
/// rather than hiding behind a shared zero.
///
/// The pure kernels are exhaustively golden-tested in the unit suite; here we verify the DB wiring, the
/// filter clauses, the ordering quirks, the scopeWhereFor('actionPlan') row drop, and — importantly —
/// what an EMPTY organization prints.
/// </summary>
[Collection("MonitoringRead")]
public sealed class MonitoringReadTests(MonitoringReadFixture fixture)
{
    private readonly MonitoringReadFixture _fixture = fixture;

    private MonitoringReadRepository NewRepo() => new(_fixture.NewReadContext());

    private MonitoringReadUseCase NewUseCase() => new(NewRepo());

    // ── getExecutiveKpis ─────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ExecutiveKpis_OrgA_countsMatchTheFilterClauses()
    {
        var counts = await NewRepo().GetExecutiveKpiCountsAsync(MonitoringReadFixture.OrgA.ToString(), CancellationToken.None);

        Assert.Equal(MonitoringReadFixture.OrgATotalEmployees, counts.TotalUsers);        // inactive user excluded
        Assert.Equal(MonitoringReadFixture.OrgAActiveVacancies, counts.ActiveVacancies);  // draft + soft-deleted excluded
        Assert.Equal(MonitoringReadFixture.OrgAPendingAdjustments, counts.PendingAdjustments);
        Assert.Equal(MonitoringReadFixture.OrgAActiveSurveys, counts.ActiveSurveys);
        Assert.Equal(MonitoringReadFixture.OrgAOpenAlerts, counts.OpenAlerts);            // the dismissed alert excluded
    }

    [Fact]
    public async Task ExecutiveKpis_OrgA_subFloorPendingAdjustments_areSuppressed()
    {
        // 3 pending is a sub-floor COUNT over the §21-restricted salary_adjustments population. Any
        // monitoring:read holder would otherwise learn the exact figure.
        var view = await NewUseCase().GetExecutiveKpisAsync(MonitoringReadFixture.OrgA.ToString(), CancellationToken.None);

        Assert.Null(view.PendingAdjustments);
        Assert.True(view.PendingAdjustmentsSuppressed);
        // The non-restricted KPIs are NOT floored — suppression must not leak sideways.
        Assert.Equal(MonitoringReadFixture.OrgATotalEmployees, view.TotalEmployees);
        Assert.Equal(MonitoringReadFixture.OrgAActiveVacancies, view.ActiveVacancies);
    }

    [Fact]
    public async Task ExecutiveKpis_OrgB_atFloorPendingAdjustments_areVisible_andIsolatedFromOrgA()
    {
        var view = await NewUseCase().GetExecutiveKpisAsync(MonitoringReadFixture.OrgB.ToString(), CancellationToken.None);

        Assert.Equal(MonitoringReadFixture.OrgBPendingAdjustments, view.PendingAdjustments); // 5 == the floor
        Assert.False(view.PendingAdjustmentsSuppressed);
        // RLS isolation: OrgB's own, DIFFERENT totals — an OrgA bleed would inflate these.
        Assert.Equal(MonitoringReadFixture.OrgBTotalEmployees, view.TotalEmployees);
        Assert.Equal(1, view.ActiveVacancies);
        Assert.Equal(1, view.ActiveSurveys);
        Assert.Equal(1, view.OpenAlerts);
    }

    [Fact]
    public async Task ExecutiveKpis_EMPTY_org_returnsHonestZeroes_notSuppression()
    {
        // The empty-database question. OrgC has one user (its own reader) and NOTHING else. A 0
        // pendingAdjustments must pass through UNsuppressed — a zero bucket identifies nobody, and
        // flagging it would dress "no data" up as a privacy control.
        var view = await NewUseCase().GetExecutiveKpisAsync(MonitoringReadFixture.OrgC.ToString(), CancellationToken.None);

        Assert.Equal(1, view.TotalEmployees);
        Assert.Equal(0, view.ActiveVacancies);
        Assert.Equal(0, view.PendingAdjustments);
        Assert.False(view.PendingAdjustmentsSuppressed);
        Assert.Equal(0, view.ActiveSurveys);
        Assert.Equal(0, view.OpenAlerts);
        Assert.Equal(0d, view.TurnoverRate);
        Assert.Equal(0, view.TerminationsLast12m);
    }

    // ── getModuleHealth ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ModuleHealth_OrgA_bandsPerModule_dismissedAlertExcluded()
    {
        var rows = await NewUseCase().GetModuleHealthAsync(MonitoringReadFixture.OrgA.ToString(), CancellationToken.None);

        Assert.Equal(8, rows.Count);
        Assert.Equal(1, rows.Single(r => r.Module == "recruitment").ActiveAlerts);
        Assert.Equal("warning", rows.Single(r => r.Module == "recruitment").Status);
        Assert.Equal(3, rows.Single(r => r.Module == "dei").ActiveAlerts);
        Assert.Equal("critical", rows.Single(r => r.Module == "dei").Status);
        // engagement has 1 ACTIVE + 1 DISMISSED → 1, warning (not 2, not critical).
        Assert.Equal(1, rows.Single(r => r.Module == "engagement").ActiveAlerts);
        Assert.Equal("warning", rows.Single(r => r.Module == "engagement").Status);
        Assert.Equal("healthy", rows.Single(r => r.Module == "people").Status);
    }

    [Fact]
    public async Task ModuleHealth_EMPTY_org_returnsEightHonestZeroRows()
    {
        var rows = await NewUseCase().GetModuleHealthAsync(MonitoringReadFixture.OrgC.ToString(), CancellationToken.None);

        Assert.Equal(8, rows.Count);
        Assert.All(rows, r =>
        {
            Assert.Equal(0, r.ActiveAlerts);
            Assert.Equal("healthy", r.Status);
        });
    }

    [Fact]
    public async Task ModuleHealth_OrgB_isIsolated_seesOnlyItsOwnModule()
    {
        var rows = await NewUseCase().GetModuleHealthAsync(MonitoringReadFixture.OrgB.ToString(), CancellationToken.None);

        Assert.Equal(1, rows.Single(r => r.Module == "people").ActiveAlerts); // OrgB's only alert
        Assert.Equal(0, rows.Single(r => r.Module == "dei").ActiveAlerts);    // OrgA's 3 must NOT bleed
    }

    // ── getActiveAlerts ──────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task ActiveAlerts_OrgA_orderedBySeverityDescLexicographically_thenCreatedAtDesc()
    {
        // `severity` is a plain TEXT column, so `ORDER BY severity DESC` is LEXICOGRAPHIC:
        // 'warning' > 'info' > 'critical'. That is NOT a severity ranking — it is what the live TS
        // reader does, and the port reproduces it. Pinning it here means a future "fix" has to be a
        // deliberate, cross-stack decision rather than a silent reordering of an exec dashboard.
        var page = await NewRepo().GetActiveAlertsAsync(
            MonitoringReadFixture.OrgA.ToString(), null, null, 1, 20, CancellationToken.None);

        Assert.Equal(5, page.Total);
        Assert.Equal(new[] { "AL4", "AL2", "AL1", "AL5", "AL3" }, page.Items.Select(i => i.Title).ToArray());
        Assert.Equal(1, page.Page);
        Assert.Equal(20, page.Limit);
    }

    [Fact]
    public async Task ActiveAlerts_moduleAndSeverityFilters_narrowBothItemsAndTotal()
    {
        var byModule = await NewRepo().GetActiveAlertsAsync(
            MonitoringReadFixture.OrgA.ToString(), "dei", null, 1, 20, CancellationToken.None);
        Assert.Equal(3, byModule.Total);
        Assert.All(byModule.Items, i => Assert.Equal("dei", i.Module));

        var bySeverity = await NewRepo().GetActiveAlertsAsync(
            MonitoringReadFixture.OrgA.ToString(), null, "critical", 1, 20, CancellationToken.None);
        Assert.Equal(2, bySeverity.Total);
        Assert.All(bySeverity.Items, i => Assert.Equal("critical", i.Severity));
    }

    [Fact]
    public async Task ActiveAlerts_pagination_skipsAndKeepsTheUnpagedTotal()
    {
        var page2 = await NewRepo().GetActiveAlertsAsync(
            MonitoringReadFixture.OrgA.ToString(), null, null, 2, 2, CancellationToken.None);

        Assert.Equal(5, page2.Total);         // total is the UNPAGED count
        Assert.Equal(2, page2.Items.Count);
        Assert.Equal(new[] { "AL1", "AL5" }, page2.Items.Select(i => i.Title).ToArray());
    }

    [Fact]
    public async Task ActiveAlerts_EMPTY_org_returnsEmptyPage_notNull()
    {
        var page = await NewRepo().GetActiveAlertsAsync(
            MonitoringReadFixture.OrgC.ToString(), null, null, 1, 20, CancellationToken.None);

        Assert.Empty(page.Items);
        Assert.Equal(0, page.Total);
    }

    // ── getActionPlanAlerts (the one row-scoped read) ────────────────────────────────────────────

    [Fact]
    public async Task ActionPlanAlerts_orgScope_seesBothDueSoonPlans_orderedByDueDateAsc()
    {
        // organization scope → ScopePredicate.MatchAll, exactly as scopeWhereFor returns `{}`.
        var view = await NewUseCase().GetActionPlanAlertsAsync(
            MonitoringReadFixture.OrgA.ToString(), ScopePredicate.MatchAll, CancellationToken.None);

        Assert.Equal(2, view.Total);
        Assert.Equal(MonitoringReadFixture.Ap1.ToString(), view.Items[0].Id); // due +1 day
        Assert.Equal(MonitoringReadFixture.Ap2.ToString(), view.Items[1].Id); // due +2 days
        // The responsible user select is { id, firstName, lastName, avatar } — and nothing else.
        Assert.Equal(MonitoringReadFixture.M1.ToString(), view.Items[0].Responsible.Id);
        Assert.Equal("Mia", view.Items[0].Responsible.FirstName);
        Assert.Equal("a1.png", view.Items[0].Responsible.Avatar);
    }

    [Fact]
    public async Task ActionPlanAlerts_excludesCompleted_farFuture_andNullDueDate()
    {
        // AP3 (completed), AP4 (due +60 days) and AP5 (NULL dueDate) are each excluded by a DIFFERENT
        // clause; the org-scope read above returning exactly 2 rows is what proves all three.
        var view = await NewUseCase().GetActionPlanAlertsAsync(
            MonitoringReadFixture.OrgA.ToString(), ScopePredicate.MatchAll, CancellationToken.None);

        Assert.DoesNotContain(view.Items, i => i.Title.StartsWith("AP3", StringComparison.Ordinal));
        Assert.DoesNotContain(view.Items, i => i.Title.StartsWith("AP4", StringComparison.Ordinal));
        Assert.DoesNotContain(view.Items, i => i.Title.StartsWith("AP5", StringComparison.Ordinal));
    }

    [Fact]
    public async Task ActionPlanAlerts_unitScope_dropsThePlanOutsideTheCallersUnit()
    {
        // The hrbp's unit contains M1 but NOT M4, so scopeWhereFor('actionPlan') → responsibleId IN
        // {unit members} must drop AP2 silently. Neutralising the row filter would flip this to 2.
        var unitScope = new ScopePredicate.FieldIn("responsibleId", new[] { MonitoringReadFixture.M1.ToString() });

        var view = await NewUseCase().GetActionPlanAlertsAsync(
            MonitoringReadFixture.OrgA.ToString(), unitScope, CancellationToken.None);

        Assert.Equal(1, view.Total);
        Assert.Equal(MonitoringReadFixture.Ap1.ToString(), view.Items[0].Id);
    }

    [Fact]
    public async Task ActionPlanAlerts_emptyScopeSet_returnsNothing_failNarrow()
    {
        // An anchor set that floors to [] must match NO rows — never fall open to org-wide.
        var emptyScope = new ScopePredicate.FieldIn("responsibleId", Array.Empty<string>());

        var view = await NewUseCase().GetActionPlanAlertsAsync(
            MonitoringReadFixture.OrgA.ToString(), emptyScope, CancellationToken.None);

        Assert.Equal(0, view.Total);
        Assert.Empty(view.Items);
    }

    [Fact]
    public async Task ActionPlanAlerts_crossOrg_isEmptyUnderRls()
    {
        // OrgB has no action plans; MatchAll must not surface OrgA's.
        var view = await NewUseCase().GetActionPlanAlertsAsync(
            MonitoringReadFixture.OrgB.ToString(), ScopePredicate.MatchAll, CancellationToken.None);

        Assert.Equal(0, view.Total);
    }

    // ── getCrossModuleTrend inputs ───────────────────────────────────────────────────────────────

    [Fact]
    public async Task SurveyResponseCounts_bucketByMonth_andTheUpperBoundIsMidnightNotEndOfDay()
    {
        // June holds SEVEN rows, one of them at 09:00 on the 30th. The window's upper bound is
        // MIDNIGHT on the 30th, so that row is in NO bucket — the live TS quirk, proven against real
        // Postgres rather than argued in a comment.
        var counts = await NewRepo().GetSurveyResponseCountsAsync(
            MonitoringReadFixture.OrgA.ToString(),
            [
                (MonitoringReadFixture.May2026Start, MonitoringReadFixture.May2026End),
                (MonitoringReadFixture.Jun2026Start, MonitoringReadFixture.Jun2026End),
            ],
            CancellationToken.None);

        Assert.Equal([MonitoringReadFixture.OrgAMayResponses, MonitoringReadFixture.OrgAJuneResponses], counts);
    }

    [Fact]
    public async Task AlertCounts_bucketByCreatedAt_withNoStatusFilter()
    {
        // The trend counts alerts CREATED in the month whatever their status — so June is 2 (the
        // active AL5 AND the dismissed AL6), which differs from both openAlerts and the module map.
        var counts = await NewRepo().GetAlertCountsAsync(
            MonitoringReadFixture.OrgA.ToString(),
            [
                (MonitoringReadFixture.May2026Start, MonitoringReadFixture.May2026End),
                (MonitoringReadFixture.Jun2026Start, MonitoringReadFixture.Jun2026End),
            ],
            CancellationToken.None);

        Assert.Equal([MonitoringReadFixture.OrgAMayAlertsCreated, MonitoringReadFixture.OrgAJuneAlertsCreated], counts);
    }

    [Fact]
    public async Task HeadcountCounts_areCUMULATIVE_notPerMonthBuckets()
    {
        // TS filters `createdAt: { lte: monthEnd }` with NO lower bound. By May 2026 all 7 active
        // OrgA users exist; a bucketed implementation would return 0 for both months instead.
        var counts = await NewRepo().GetHeadcountCountsAsync(
            MonitoringReadFixture.OrgA.ToString(),
            [
                (MonitoringReadFixture.May2026Start, MonitoringReadFixture.May2026End),
                (MonitoringReadFixture.Jun2026Start, MonitoringReadFixture.Jun2026End),
            ],
            CancellationToken.None);

        Assert.Equal([MonitoringReadFixture.OrgATotalEmployees, MonitoringReadFixture.OrgATotalEmployees], counts);
    }

    [Fact]
    public async Task CrossModuleTrend_engagement_isAllOrNothingSuppressed_whenAnyMonthIsSubFloor()
    {
        // The live window is anchored on the runtime `now`, so WHICH seeded months it covers drifts
        // with the calendar. Assert only what is true forever: the series is the right length, and the
        // value/flag pair is always consistent (null exactly when suppressed) — never a leaked count
        // sitting next to suppressed=true.
        var liveWindow = await NewUseCase().GetCrossModuleTrendAsync(
            MonitoringReadFixture.OrgA.ToString(), "engagement", "6m", CancellationToken.None);

        Assert.Equal(6, liveWindow.Data.Count);
        Assert.All(liveWindow.Data, p => Assert.Equal(p.Suppressed, p.Value is null));
        // All-or-nothing: the flag is uniform across the whole series, never per-point.
        Assert.Single(liveWindow.Data.Select(p => p.Suppressed).Distinct());

        // The all-or-nothing behaviour itself is golden-fixtured on both stacks; here we prove the
        // wiring reaches it deterministically, using the seeded sub-floor May bucket + the safe June
        // bucket through the repository (calendar-independent).
        var counts = await NewRepo().GetSurveyResponseCountsAsync(
            MonitoringReadFixture.OrgA.ToString(),
            [
                (MonitoringReadFixture.May2026Start, MonitoringReadFixture.May2026End),
                (MonitoringReadFixture.Jun2026Start, MonitoringReadFixture.Jun2026End),
            ],
            CancellationToken.None);
        var floored = Tims.Domain.Monitoring.MonitoringKernels.ApplyEngagementTrendFloor(["2026-05", "2026-06"], counts);

        Assert.All(floored, p =>
        {
            Assert.True(p.Suppressed);   // May = 3 is sub-floor → the WHOLE series is nulled
            Assert.Null(p.Value);        // …including the perfectly safe June = 6
        });
    }

    [Fact]
    public async Task CrossModuleTrend_turnover_isAFlatZeroSeries_notAnError()
    {
        // `turnover` is not tracked (no Employee model). The TS reader returns zeroes; the port must
        // return the same honest zeroes rather than invent a number or throw.
        var view = await NewUseCase().GetCrossModuleTrendAsync(
            MonitoringReadFixture.OrgA.ToString(), "turnover", "6m", CancellationToken.None);

        Assert.Equal(6, view.Data.Count);
        Assert.All(view.Data, p =>
        {
            Assert.Equal(0, p.Value);
            Assert.False(p.Suppressed);
        });
    }

    [Fact]
    public async Task CrossModuleTrend_periodDrivesTheWindowLength()
    {
        var twelve = await NewUseCase().GetCrossModuleTrendAsync(
            MonitoringReadFixture.OrgA.ToString(), "alerts", "12m", CancellationToken.None);
        var twentyFour = await NewUseCase().GetCrossModuleTrendAsync(
            MonitoringReadFixture.OrgA.ToString(), "alerts", "24m", CancellationToken.None);

        Assert.Equal(12, twelve.Data.Count);
        Assert.Equal(24, twentyFour.Data.Count);
    }

    // ── getAlertRules ────────────────────────────────────────────────────────────────────────────

    [Fact]
    public async Task AlertRules_OrgA_orderedByModuleAsc_withRawJsonbCondition()
    {
        var rules = await NewRepo().GetAlertRulesAsync(MonitoringReadFixture.OrgA.ToString(), CancellationToken.None);

        Assert.Equal(2, rules.Count);
        Assert.Equal(new[] { "dei", "recruitment" }, rules.Select(r => r.Module).ToArray()); // module ASC
        var dei = rules[0];
        Assert.Equal("active_surveys", dei.Condition!["metric"]!.GetValue<string>());
        Assert.Equal("lt", dei.Condition["operator"]!.GetValue<string>());
        Assert.Equal(2, dei.Condition["threshold"]!.GetValue<int>());
        Assert.False(dei.IsActive); // inactive rules are RETURNED (no isActive filter in the TS read)
    }

    [Fact]
    public async Task AlertRules_EMPTY_org_returnsAnEmptyList()
    {
        var rules = await NewRepo().GetAlertRulesAsync(MonitoringReadFixture.OrgC.ToString(), CancellationToken.None);
        Assert.Empty(rules);
    }

    [Fact]
    public async Task AlertRules_OrgB_isIsolated()
    {
        var rules = await NewRepo().GetAlertRulesAsync(MonitoringReadFixture.OrgB.ToString(), CancellationToken.None);

        Assert.Single(rules);
        Assert.Equal("people", rules[0].Module); // OrgA's dei/recruitment rules must NOT bleed
    }
}
