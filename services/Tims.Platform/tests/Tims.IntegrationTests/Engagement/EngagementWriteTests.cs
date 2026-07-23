using System.Text.Json.Nodes;
using Tims.Domain.Access;
using Tims.Domain.Engagement;
using Tims.Infrastructure.Access;
using Tims.Infrastructure.Engagement;

namespace Tims.IntegrationTests.Engagement;

/// <summary>
/// Phase-5 Slice 16 Testcontainers proof (real Postgres + real RLS + the real UNIQUE, NEVER mocked) of the
/// engagement WRITE data path — direct repository + scope primitives under TenantScope. Covers: the createSurvey
/// full-row INSERT + jsonb round-trip (INV-7); activateSurvey preserve-else-now (INV-5); the identity-anchored
/// submitSurveyResponse (userId = caller, INV-3) + the dedup 23505 → CONFLICT with NO second row (INV-4) + the
/// inactive-survey → SurveyNotActive path; createActionPlan / updateActionPlan(reassign) cross-org responsibleId
/// backstop (INV-2, the H1 fix); the updateActionPlan partial update + dueDate tri-state (INV-6); cross-org RLS
/// isolation (INV-8); the assertScoped('actionPlan') by-id IDOR probe (INV-6, the NEW probe root); and the
/// assertSubjectInScope write-rule (INV-3 primitive). Every op runs UNDER TenantScope.
/// </summary>
[Collection("EngagementWrite")]
public sealed class EngagementWriteTests(EngagementWriteFixture fixture)
{
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 12, 30, 45, 123, TimeSpan.Zero);

    private string Org => EngagementWriteFixture.OrgA.ToString();

    private EngagementWriteRepository Repo() => new(fixture.NewWriteContext());

    private static JsonArray Questions(string text = "q1") =>
        (JsonArray)JsonNode.Parse($"[{{\"text\":\"{text}\",\"type\":\"scale\",\"required\":true}}]")!;

    // Org-scope guard = the MatchAll predicate → "TRUE" (org/company callers see every in-org plan; the repo's
    // scope-atomic FOR UPDATE re-check is a no-op for them). Used by all non-narrow-scope repo update tests.
    private static readonly (string Sql, IReadOnlyList<object> Params) OrgGuard = BuildGuard(ScopePredicate.MatchAll);

    private static (string Sql, IReadOnlyList<object> Params) BuildGuard(ScopePredicate predicate)
    {
        var translated = ScopePredicateSqlTranslator.Translate("action_plans", predicate);
        return (translated.Sql, translated.Parameters);
    }

    // A narrow (team) scope guard built via the REAL EfAnchorLoader + ScopeWhereFor path (the same call the endpoint
    // makes): TeamLead's team = {TeamLead, M1, M2} → predicate responsible_id ∈ that set. Bites the FOR UPDATE re-check.
    private async Task<(string Sql, IReadOnlyList<object> Params)> TeamGuardAsync()
    {
        await using var anchors = Anchors(EngagementWriteFixture.OrgA, EngagementWriteFixture.TeamLeadId);
        var predicate = await ScopeWhereFor.BuildAsync(
            ScopedEntity.ActionPlan, AccessScope.Team, anchors, EngagementWriteFixture.TeamLeadId.ToString());
        return BuildGuard(predicate);
    }

    // ── createSurvey: full-row INSERT (org, createdById=caller, status='draft', responseCount 0, jsonb round-trip) ──
    [Fact]
    public async Task CreateSurvey_inserts_full_row_with_caller_and_draft_defaults()
    {
        var input = new CreateSurveyInput("Clima Q3", "climate", Questions("Ambiente?"), null, null, null);
        var row = await Repo().CreateSurveyAsync(Org, EngagementWriteFixture.OrgAdminId, input, Now, CancellationToken.None);

        Assert.True(Guid.TryParse(row.Id, out var id));
        Assert.Equal(Org, row.OrganizationId);
        Assert.Equal("Clima Q3", row.Title);
        Assert.Equal("climate", row.Type);
        Assert.Equal("draft", row.Status);           // hard-coded on create
        Assert.Equal(0, row.ResponseCount);          // Prisma default
        Assert.Equal(EngagementWriteFixture.OrgAdminId.ToString(), row.CreatedById); // provenance = caller
        Assert.Null(row.TargetGroups);
        Assert.Null(row.StartsAt);
        Assert.Equal(Now, row.CreatedAt);
        Assert.Equal(Now, row.UpdatedAt);
        // jsonb round-trip: the stored questions echo the input array byte-faithfully.
        Assert.Contains("\"text\":\"Ambiente?\"", row.Questions.ToJsonString());
        Assert.True(await fixture.SurveyExistsAsync(id));
        Assert.Equal("draft", await fixture.GetSurveyStatusAsync(id));
    }

    // ── createSurvey: targetGroups stored opaque (round-trip) + startsAt/endsAt truncated to ms (Date parity) ──
    [Fact]
    public async Task CreateSurvey_stores_targetGroups_opaque_and_dates()
    {
        var tg = (JsonObject)JsonNode.Parse("{\"companyIds\":[\"c0c00000-0000-0000-0000-000000000001\"]}")!;
        var startsAt = new DateTimeOffset(2026, 7, 1, 8, 0, 0, TimeSpan.Zero);
        var input = new CreateSurveyInput("Targeted", "pulse", Questions(), tg, startsAt, null);
        var row = await Repo().CreateSurveyAsync(Org, EngagementWriteFixture.OrgAdminId, input, Now, CancellationToken.None);

        Assert.NotNull(row.TargetGroups);
        Assert.Contains("companyIds", row.TargetGroups!.ToJsonString());
        Assert.Equal(startsAt, row.StartsAt);
    }

    // ── activateSurvey: an existing startsAt is PRESERVED (INV-5) ──
    [Fact]
    public async Task ActivateSurvey_preserves_existing_startsAt()
    {
        var before = await fixture.GetSurveyStartsAtAsync(EngagementWriteFixture.SvRepoActPreset);
        var result = await Repo().ActivateSurveyAsync(Org, EngagementWriteFixture.SvRepoActPreset, Now, CancellationToken.None);

        Assert.NotNull(result);
        Assert.Equal("active", result!.Status);
        Assert.Equal(EngagementWriteFixture.SvRepoActPreset.ToString(), result.Id);
        Assert.Equal("active", await fixture.GetSurveyStatusAsync(EngagementWriteFixture.SvRepoActPreset));
        // startsAt unchanged (2019 preset, NOT stamped to Now).
        Assert.Equal(before, await fixture.GetSurveyStartsAtAsync(EngagementWriteFixture.SvRepoActPreset));
    }

    // ── activateSurvey: a null startsAt is STAMPED to now (INV-5) ──
    [Fact]
    public async Task ActivateSurvey_stamps_now_when_startsAt_null()
    {
        Assert.Null(await fixture.GetSurveyStartsAtAsync(EngagementWriteFixture.SvRepoActNull));
        var result = await Repo().ActivateSurveyAsync(Org, EngagementWriteFixture.SvRepoActNull, Now, CancellationToken.None);

        Assert.NotNull(result);
        var stamped = await fixture.GetSurveyStartsAtAsync(EngagementWriteFixture.SvRepoActNull);
        Assert.NotNull(stamped);
        Assert.Equal(Now.UtcDateTime, stamped);
    }

    // ── activateSurvey: cross-org survey is RLS-hidden → null (INV-8) ──
    [Fact]
    public async Task ActivateSurvey_cross_org_is_null()
    {
        Assert.Null(await Repo().ActivateSurveyAsync(Org, EngagementWriteFixture.SvOrgB, Now, CancellationToken.None));
        Assert.Equal("active", await fixture.GetSurveyStatusAsync(EngagementWriteFixture.SvOrgB)); // untouched
    }

    // ── submitSurveyResponse: creates a row with userId = the caller ALWAYS (INV-3 identity anchor) ──
    [Fact]
    public async Task SubmitSurveyResponse_stamps_caller_userId()
    {
        var answers = (JsonObject)JsonNode.Parse("{\"q1\":4}")!;
        var input = new SubmitSurveyResponseInput(EngagementWriteFixture.SvRepoSubmit, answers);
        // The caller is M1; even if the body carried a userId it would be ignored (there is no userId input).
        var result = await Repo().SubmitSurveyResponseAsync(
            Org, EngagementWriteFixture.M1Id, input, Now, CancellationToken.None);

        Assert.Equal(SubmitSurveyResponseOutcome.Created, result.Outcome);
        Assert.NotNull(result.Row);
        Assert.Equal(Now, result.Row!.SubmittedAt);
        // Exactly one (survey, caller) row — proving the response is anchored to M1, not any input.
        Assert.Equal(1, await fixture.CountResponsesAsync(EngagementWriteFixture.SvRepoSubmit, EngagementWriteFixture.M1Id));
    }

    // ── submitSurveyResponse: an inactive (draft) survey → SurveyNotActive (the clean-404 improvement) ──
    [Fact]
    public async Task SubmitSurveyResponse_inactive_survey_is_SurveyNotActive()
    {
        var input = new SubmitSurveyResponseInput(
            EngagementWriteFixture.SvDraftInactive, (JsonObject)JsonNode.Parse("{\"q1\":4}")!);
        var result = await Repo().SubmitSurveyResponseAsync(
            Org, EngagementWriteFixture.M1Id, input, Now, CancellationToken.None);

        Assert.Equal(SubmitSurveyResponseOutcome.SurveyNotActive, result.Outcome);
        Assert.Null(result.Row);
        Assert.Equal(0, await fixture.CountResponsesAsync(EngagementWriteFixture.SvDraftInactive, EngagementWriteFixture.M1Id));
    }

    // ── submitSurveyResponse dedup: a 2nd response by the same caller → CONFLICT, NO second row (INV-4) ──
    [Fact]
    public async Task SubmitSurveyResponse_duplicate_is_conflict_and_creates_no_second_row()
    {
        // RepoSubmitDup already seeds (survey, OrgAdmin). A fresh submit by OrgAdmin must trip the real UNIQUE.
        var input = new SubmitSurveyResponseInput(
            EngagementWriteFixture.SvRepoSubmitDup, (JsonObject)JsonNode.Parse("{\"q1\":5}")!);
        var result = await Repo().SubmitSurveyResponseAsync(
            Org, EngagementWriteFixture.OrgAdminId, input, Now, CancellationToken.None);

        Assert.Equal(SubmitSurveyResponseOutcome.Conflict, result.Outcome);
        Assert.Null(result.Row);
        Assert.Equal(1, await fixture.CountResponsesAsync(EngagementWriteFixture.SvRepoSubmitDup, EngagementWriteFixture.OrgAdminId));
    }

    // ── submitSurveyResponse: a cross-org survey is RLS-hidden → SurveyNotActive (INV-8) ──
    [Fact]
    public async Task SubmitSurveyResponse_cross_org_survey_is_SurveyNotActive()
    {
        var input = new SubmitSurveyResponseInput(EngagementWriteFixture.SvOrgB, (JsonObject)JsonNode.Parse("{\"q1\":4}")!);
        var result = await Repo().SubmitSurveyResponseAsync(
            Org, EngagementWriteFixture.M1Id, input, Now, CancellationToken.None);
        Assert.Equal(SubmitSurveyResponseOutcome.SurveyNotActive, result.Outcome);
    }

    // ── createActionPlan: full-row INSERT (org, status='pending') for an in-org responsible ──
    [Fact]
    public async Task CreateActionPlan_inserts_full_row_pending()
    {
        var input = new CreateActionPlanInput("Mejorar clima", EngagementWriteFixture.M1Id, "Ambiente", "notas", null);
        var row = await Repo().CreateActionPlanAsync(Org, input, Now, CancellationToken.None);

        Assert.NotNull(row);
        Assert.True(Guid.TryParse(row!.Id, out var id));
        Assert.Equal(Org, row.OrganizationId);
        Assert.Equal("Mejorar clima", row.Title);
        Assert.Equal(EngagementWriteFixture.M1Id.ToString(), row.ResponsibleId);
        Assert.Equal("Ambiente", row.Area);
        Assert.Equal("notas", row.Notes);
        Assert.Equal("pending", row.Status);
        Assert.Null(row.Actions);   // never set on create
        Assert.Null(row.DueDate);
        Assert.True(await fixture.ActionPlanExistsAsync(id));
    }

    // ── H1 (INV-2): createActionPlan with a cross-org responsibleId → null (→ 403), NO row created ──
    [Fact]
    public async Task CreateActionPlan_cross_org_responsible_is_null_and_no_insert()
    {
        // Mb1 is an OrgB user. Under the OrgA TenantScope the users lookup is RLS-filtered to OrgA → not found → the
        // org/company-scope assertSubjectInScope no-op would have let this through; the repo backstop rejects it.
        var input = new CreateActionPlanInput("Cross Org", EngagementWriteFixture.Mb1Id, null, null, null);
        var row = await Repo().CreateActionPlanAsync(Org, input, Now, CancellationToken.None);
        Assert.Null(row);
    }

    // ── updateActionPlan: partial update — provided fields applied, ABSENT optional keys SKIPPED (never nulled) ──
    [Fact]
    public async Task UpdateActionPlan_applies_provided_and_skips_absent()
    {
        // Change title + status; notes ABSENT (must survive as 'keep me'); dueDate ABSENT (stays NULL).
        var input = new UpdateActionPlanInput(
            Title: "Nuevo titulo", HasTitle: true,
            Notes: null, HasNotes: false,
            Status: "in_progress", HasStatus: true,
            ResponsibleId: null,
            DueDate: null, HasDueDate: false);
        var result = await Repo().UpdateActionPlanAsync(
            Org, EngagementWriteFixture.ApRepoUpdate, input, OrgGuard.Sql, OrgGuard.Params, Now, CancellationToken.None);

        Assert.Equal(UpdateActionPlanOutcome.Updated, result.Outcome);
        Assert.Equal("Nuevo titulo", result.Row!.Title);
        Assert.Equal("in_progress", result.Row.Status);
        Assert.Equal("keep me", result.Row.Notes);   // UNCHANGED (absent key skipped)
        Assert.Equal("Nuevo titulo", await fixture.GetActionPlanTitleAsync(EngagementWriteFixture.ApRepoUpdate));
        Assert.Equal("keep me", await fixture.GetActionPlanNotesAsync(EngagementWriteFixture.ApRepoUpdate));
        Assert.Null(await fixture.GetActionPlanDueDateAsync(EngagementWriteFixture.ApRepoUpdate)); // absent → unchanged
    }

    // ── updateActionPlan dueDate tri-state (INV-6): absent=unchanged, value=set, null=clear ──
    [Fact]
    public async Task UpdateActionPlan_dueDate_tristate_set_then_clear()
    {
        var newDue = new DateTimeOffset(2027, 3, 3, 0, 0, 0, TimeSpan.Zero);

        // (a) set: HasDueDate=true, value → the column becomes newDue.
        var set = await Repo().UpdateActionPlanAsync(
            Org, EngagementWriteFixture.ApRepoDueClear,
            new UpdateActionPlanInput(null, false, null, false, null, false, null, newDue, HasDueDate: true),
            OrgGuard.Sql, OrgGuard.Params, Now, CancellationToken.None);
        Assert.Equal(UpdateActionPlanOutcome.Updated, set.Outcome);
        Assert.Equal(newDue.UtcDateTime, await fixture.GetActionPlanDueDateAsync(EngagementWriteFixture.ApRepoDueClear));

        // (b) clear: HasDueDate=true, DueDate=null → the column becomes NULL (the resolver's tri-state null-clear).
        var cleared = await Repo().UpdateActionPlanAsync(
            Org, EngagementWriteFixture.ApRepoDueClear,
            new UpdateActionPlanInput(null, false, null, false, null, false, null, null, HasDueDate: true),
            OrgGuard.Sql, OrgGuard.Params, Now, CancellationToken.None);
        Assert.Equal(UpdateActionPlanOutcome.Updated, cleared.Outcome);
        Assert.Null(cleared.Row!.DueDate);
        Assert.Null(await fixture.GetActionPlanDueDateAsync(EngagementWriteFixture.ApRepoDueClear));
    }

    // ── H1 (INV-2): updateActionPlan reassign to a cross-org responsibleId → ResponsibleNotInOrg (403), no change ──
    [Fact]
    public async Task UpdateActionPlan_reassign_cross_org_is_ResponsibleNotInOrg_and_no_change()
    {
        var input = new UpdateActionPlanInput(
            null, false, null, false, null, false,
            ResponsibleId: EngagementWriteFixture.Mb1Id, // OrgB user
            DueDate: null, HasDueDate: false);
        var result = await Repo().UpdateActionPlanAsync(
            Org, EngagementWriteFixture.ApRepoReassign, input, OrgGuard.Sql, OrgGuard.Params, Now, CancellationToken.None);

        Assert.Equal(UpdateActionPlanOutcome.ResponsibleNotInOrg, result.Outcome);
        Assert.Null(result.Row);
        // responsible_id UNCHANGED (still M1) — no cross-org reassignment persisted.
        Assert.Equal(EngagementWriteFixture.M1Id, await fixture.GetActionPlanResponsibleAsync(EngagementWriteFixture.ApRepoReassign));
    }

    // ── updateActionPlan: a valid in-org reassignment succeeds ──
    [Fact]
    public async Task UpdateActionPlan_reassign_in_org_succeeds()
    {
        var input = new UpdateActionPlanInput(
            null, false, null, false, null, false,
            ResponsibleId: EngagementWriteFixture.M2Id, // in-org
            DueDate: null, HasDueDate: false);
        var result = await Repo().UpdateActionPlanAsync(
            Org, EngagementWriteFixture.ApRepoReassign, input, OrgGuard.Sql, OrgGuard.Params, Now, CancellationToken.None);

        Assert.Equal(UpdateActionPlanOutcome.Updated, result.Outcome);
        Assert.Equal(EngagementWriteFixture.M2Id.ToString(), result.Row!.ResponsibleId);
    }

    // ── updateActionPlan: a cross-org row is RLS-hidden → NotFound (INV-8) ──
    [Fact]
    public async Task UpdateActionPlan_cross_org_row_is_NotFound()
    {
        var input = new UpdateActionPlanInput("HACK", true, null, false, null, false, null, null, false);
        var result = await Repo().UpdateActionPlanAsync(
            Org, EngagementWriteFixture.ApOrgB, input, OrgGuard.Sql, OrgGuard.Params, Now, CancellationToken.None);
        Assert.Equal(UpdateActionPlanOutcome.NotFound, result.Outcome);
        Assert.Equal("OrgB Plan", await fixture.GetActionPlanTitleAsync(EngagementWriteFixture.ApOrgB)); // untouched
    }

    // ── Codex HIGH (both stacks): updateActionPlan is scope-ATOMIC. A plan whose responsible left the caller's narrow
    //    scope AFTER the probe (concurrent reassignment) is rejected by the repo's FOR UPDATE scope re-check → 404,
    //    no mutation. Without the guard the update would apply (a bare update-by-{id,org}) — this bites that regression. ──
    [Fact]
    public async Task UpdateActionPlan_scope_atomic_guard_out_of_scope_row_is_NotFound_and_no_change()
    {
        // Team subject set = {TeamLead, M1, M2}; ApScopeGuardOut's responsible is M3 (in-org, NOT in the set) — the
        // post-probe race state. The repo's scoped FOR UPDATE re-check must reject it.
        var guard = await TeamGuardAsync();
        var input = new UpdateActionPlanInput("SHOULD-NOT-APPLY", true, null, false, null, false, null, null, false);

        var result = await Repo().UpdateActionPlanAsync(
            Org, EngagementWriteFixture.ApScopeGuardOut, input, guard.Sql, guard.Params, Now, CancellationToken.None);

        Assert.Equal(UpdateActionPlanOutcome.NotFound, result.Outcome);
        Assert.Equal("ScopeGuardOut", await fixture.GetActionPlanTitleAsync(EngagementWriteFixture.ApScopeGuardOut)); // unchanged
    }

    // ── The positive path: a plan whose responsible IS in the caller's narrow scope passes the atomic guard → Updated. ──
    [Fact]
    public async Task UpdateActionPlan_scope_atomic_guard_in_scope_row_updates()
    {
        // ApScopeGuardIn's responsible is M1 (a member of TeamLead's team) → the scoped FOR UPDATE re-check matches.
        var guard = await TeamGuardAsync();
        var input = new UpdateActionPlanInput("Scoped-OK", true, null, false, null, false, null, null, false);

        var result = await Repo().UpdateActionPlanAsync(
            Org, EngagementWriteFixture.ApScopeGuardIn, input, guard.Sql, guard.Params, Now, CancellationToken.None);

        Assert.Equal(UpdateActionPlanOutcome.Updated, result.Outcome);
        Assert.Equal("Scoped-OK", result.Row!.Title);
        Assert.Equal("Scoped-OK", await fixture.GetActionPlanTitleAsync(EngagementWriteFixture.ApScopeGuardIn));
    }

    // ── INV-6: the assertScoped('actionPlan') by-id IDOR probe (the NEW probe root this slice) ──
    [Fact]
    public async Task Probe_actionPlan_passes_for_in_scope_row()
    {
        // ApInScope's responsible is M1 (a member of TeamLead's team) → in team scope → the probe passes (no throw).
        await using var anchors = Anchors(EngagementWriteFixture.OrgA, EngagementWriteFixture.TeamLeadId);
        await Probe().AssertScopedAsync(
            ScopedEntity.ActionPlan, EngagementWriteFixture.ApInScope, AccessScope.Team, anchors,
            EngagementWriteFixture.OrgA, EngagementWriteFixture.TeamLeadId, CancellationToken.None);
    }

    [Fact]
    public async Task Probe_actionPlan_throws_NotFound_for_out_of_scope_row()
    {
        // ApOutScope's responsible is M3 (NOT in TeamLead's team) → out of scope → 404 (never confirms the id exists).
        await using var anchors = Anchors(EngagementWriteFixture.OrgA, EngagementWriteFixture.TeamLeadId);
        var ex = await Assert.ThrowsAsync<ScopedNotFoundException>(() => Probe().AssertScopedAsync(
            ScopedEntity.ActionPlan, EngagementWriteFixture.ApOutScope, AccessScope.Team, anchors,
            EngagementWriteFixture.OrgA, EngagementWriteFixture.TeamLeadId, CancellationToken.None));
        Assert.Equal("Plan de accion no encontrado", ex.Message);
    }

    [Fact]
    public async Task Probe_actionPlan_throws_NotFound_for_cross_org_row()
    {
        // ApOrgB belongs to OrgB; probed under OrgA → RLS hides it AND the org filter excludes it → 404.
        await using var anchors = Anchors(EngagementWriteFixture.OrgA, EngagementWriteFixture.TeamLeadId);
        await Assert.ThrowsAsync<ScopedNotFoundException>(() => Probe().AssertScopedAsync(
            ScopedEntity.ActionPlan, EngagementWriteFixture.ApOrgB, AccessScope.Team, anchors,
            EngagementWriteFixture.OrgA, EngagementWriteFixture.TeamLeadId, CancellationToken.None));
    }

    // ── INV-3 (primitive): assertSubjectInScope gates the responsibleId of create/updateActionPlan ──
    [Fact]
    public async Task SubjectInScope_allows_a_team_member_and_denies_an_outsider()
    {
        await using var anchors = Anchors(EngagementWriteFixture.OrgA, EngagementWriteFixture.TeamLeadId);
        var lead = EngagementWriteFixture.TeamLeadId.ToString();

        Assert.True(await SubjectInScope.IsSatisfiedAsync(
            AccessScope.Team, anchors, lead, EngagementWriteFixture.M1Id.ToString(), CancellationToken.None));
        Assert.False(await SubjectInScope.IsSatisfiedAsync(
            AccessScope.Team, anchors, lead, EngagementWriteFixture.M3Id.ToString(), CancellationToken.None));
    }

    private ScopedProbe Probe() => new(new TestAnchorContextFactory(fixture.ConnectionString));

    private EfAnchorLoader Anchors(Guid org, Guid user) =>
        new(new AnchorDbContext(AnchorProbeFixture.BuildOptions(fixture.ConnectionString)), org, user);
}
