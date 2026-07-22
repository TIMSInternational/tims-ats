using Tims.Domain.Access;
using Tims.Infrastructure.Evaluation360;

namespace Tims.IntegrationTests.Evaluation360;

/// <summary>
/// Phase-5 Slice 7 direct-repository tests (real Postgres + real RLS): each call runs UNDER TenantScope
/// (SET LOCAL ROLE app_tenant + org GUC), so these prove the EF queries fetch the right rows, that the native
/// enum filters translate, that RLS + the explicit org filter isolate the tenant, and — the CRITICAL bite —
/// that the self-service reads are HARD-FILTERED on the caller's own user id. RaterA and RaterB share OrgA, so
/// RLS passes both their rows for either caller; only the rater_user_id/subject_user_id filter separates them —
/// neutralizing it would make A's queries return B's rows, flipping the identity-anchoring assertions below.
/// The min-3 anonymity kernel is exhaustively golden-tested in the unit suite; here we prove it end-to-end from
/// real submitted responses.
/// </summary>
[Collection("Evaluation360Read")]
public sealed class Evaluation360ReadTests(Evaluation360ReadFixture fixture)
{
    private readonly Evaluation360ReadFixture _fixture = fixture;

    private Evaluation360ReadRepository NewRepo() => new(_fixture.NewReadContext());

    private static string OrgA => Evaluation360ReadFixture.OrgA.ToString();
    private static string OrgB => Evaluation360ReadFixture.OrgB.ToString();
    private static string RaterA => Evaluation360ReadFixture.RaterAId.ToString();
    private static string RaterB => Evaluation360ReadFixture.RaterBId.ToString();
    private static string OrgAdmin => Evaluation360ReadFixture.OrgAdminId.ToString();

    // ---- listCycles: org-scoped, newest first, RLS-isolated -------------------------------------------
    [Fact]
    public async Task ListCycles_OrgA_returnsFourCycles_newestFirst_underRls()
    {
        var cycles = await NewRepo().ListCyclesAsync(OrgA, CancellationToken.None);

        Assert.Equal(4, cycles.Count); // Open, Published A, Published B, Closed (OrgB's is RLS-hidden)
        Assert.Equal("Open Cycle", cycles[0].Name); // created_at desc
        Assert.All(cycles, c => Assert.DoesNotContain("OrgB", c.Name));
        Assert.Contains(cycles, c => c.Status == "published" && c.Name == "Published Cycle A");
    }

    [Fact]
    public async Task ListCycles_OrgB_isIsolated_toItsOwnSingleCycle()
    {
        var cycles = await NewRepo().ListCyclesAsync(OrgB, CancellationToken.None);
        Assert.Single(cycles);
        Assert.Equal("OrgB Published", cycles[0].Name);
    }

    // ---- getCycleProgress counts + the caller-own-subject EXCLUSION -----------------------------------
    [Fact]
    public async Task ProgressCounts_OpenCycle_excludingNonSubject_countsBothPeers()
    {
        // Exclude the org-admin (not a subject in the open cycle) → nothing dropped → 2 pending peers (A→S1, B→S2).
        var rows = await NewRepo().GetProgressCountsAsync(
            OrgA, Evaluation360ReadFixture.OpenCycle.ToString(), OrgAdmin, CancellationToken.None);

        var peer = rows.Where(r => r.Relationship == "peer").Sum(r => r.Count);
        Assert.Equal(2, peer);
    }

    [Fact]
    public async Task ProgressCounts_OpenCycle_excludingSubject1_dropsSubject1sAssignments()
    {
        // Excluding Subject1 drops A's peer(→S1), the manager(→S1) and the self(→S1); only B's peer(→S2) remains.
        var rows = await NewRepo().GetProgressCountsAsync(
            OrgA, Evaluation360ReadFixture.OpenCycle.ToString(), Evaluation360ReadFixture.Subject1.ToString(), CancellationToken.None);

        Assert.Equal(1, rows.Where(r => r.Relationship == "peer").Sum(r => r.Count));
        Assert.Equal(0, rows.Where(r => r.Relationship == "manager").Sum(r => r.Count));
        Assert.Equal(0, rows.Where(r => r.Relationship == "self").Sum(r => r.Count));
    }

    // ---- IDENTITY ANCHORING: myRaterTasks returns ONLY the caller's tasks (the rater hard-filter bite) --
    [Fact]
    public async Task FindRaterTasks_RaterA_returnsOnlyAsTask_notRaterBs()
    {
        var tasks = await NewRepo().FindRaterTasksAsync(OrgA, RaterA, CancellationToken.None);

        Assert.Single(tasks);
        Assert.Equal("Sam", tasks[0].SubjectFirstName);        // A rates Subject1 (Sam)
        Assert.Equal("peer", tasks[0].Relationship);
        Assert.All(tasks, t => Assert.NotEqual("Sue", t.SubjectFirstName)); // never B's task (Subject2 = Sue)
    }

    [Fact]
    public async Task FindRaterTasks_RaterB_returnsOnlyBsTask()
    {
        var tasks = await NewRepo().FindRaterTasksAsync(OrgA, RaterB, CancellationToken.None);
        Assert.Single(tasks);
        Assert.Equal("Sue", tasks[0].SubjectFirstName);
    }

    [Fact]
    public async Task FindRaterTasks_OrgAdmin_isEmpty_notEveryonesTasks()
    {
        // The org-admin is a rater of NOTHING. A match-all (scope) query would return every pending task in the
        // org; the identity hard-filter returns only the admin's own → empty. Proves scope is NOT used here.
        var tasks = await NewRepo().FindRaterTasksAsync(OrgA, OrgAdmin, CancellationToken.None);
        Assert.Empty(tasks);
    }

    // ---- IDENTITY ANCHORING: myReportCycles returns ONLY the caller's subject-cycles -------------------
    [Fact]
    public async Task FindPublishedCyclesForSubject_RaterA_returnsOnlyCycleA_notCycleB_notClosed()
    {
        var cycles = await NewRepo().FindPublishedCyclesForSubjectAsync(OrgA, RaterA, CancellationToken.None);

        Assert.Single(cycles);
        Assert.Equal("Published Cycle A", cycles[0].Name);
        Assert.All(cycles, c => Assert.NotEqual("Published Cycle B", c.Name)); // B's cycle never leaks to A
        Assert.All(cycles, c => Assert.NotEqual("Closed Cycle", c.Name));      // not-published excluded
    }

    [Fact]
    public async Task FindPublishedCyclesForSubject_RaterB_returnsOnlyCycleB()
    {
        var cycles = await NewRepo().FindPublishedCyclesForSubjectAsync(OrgA, RaterB, CancellationToken.None);
        Assert.Single(cycles);
        Assert.Equal("Published Cycle B", cycles[0].Name);
    }

    // ---- myReport gates: published-only + subject-membership ------------------------------------------
    [Fact]
    public async Task FindPublishedCycle_publishedCycle_isFound_closedCycle_isNull()
    {
        Assert.NotNull(await NewRepo().FindPublishedCycleAsync(
            OrgA, Evaluation360ReadFixture.PublishedCycleA.ToString(), CancellationToken.None));
        // Closed cycle is NOT published → null → the endpoint's NOT_FOUND (published-only gate).
        Assert.Null(await NewRepo().FindPublishedCycleAsync(
            OrgA, Evaluation360ReadFixture.ClosedCycle.ToString(), CancellationToken.None));
    }

    [Fact]
    public async Task SubjectHasAssignmentInCycle_subjectGate_bites()
    {
        // RaterA IS a subject of Cycle A; RaterB is NOT → the subject gate distinguishes them (identity anchor).
        Assert.True(await NewRepo().SubjectHasAssignmentInCycleAsync(
            OrgA, Evaluation360ReadFixture.PublishedCycleA.ToString(), RaterA, CancellationToken.None));
        Assert.False(await NewRepo().SubjectHasAssignmentInCycleAsync(
            OrgA, Evaluation360ReadFixture.PublishedCycleA.ToString(), RaterB, CancellationToken.None));
    }

    // ---- min-3 anonymity END-TO-END: real submitted responses → kernel → suppress-by-omission ----------
    [Fact]
    public async Task ReportRows_PublishedCycleA_min3_showsSelfManagerPeer_omitsDirectReport()
    {
        var rows = await NewRepo().FindReportRowsAsync(
            OrgA, Evaluation360ReadFixture.PublishedCycleA.ToString(), RaterA, CancellationToken.None);

        // 7 submitted responses (self, manager, 3 peers, 2 direct_reports).
        Assert.Equal(7, rows.Count);

        var buckets = Eval360Aggregate.Aggregate360Report(rows);
        Assert.Equal(new[] { "self", "manager", "peer" }, buckets.Select(b => b.Relationship).ToArray());

        var self = buckets.Single(b => b.Relationship == "self");
        Assert.Equal(1, self.RaterCount);
        Assert.Equal(4d, self.Competencies.Single(c => c.CompetencyKey == "communication").Average);
        Assert.Equal(new[] { "self note" }, self.Comments);

        var peer = buckets.Single(b => b.Relationship == "peer");
        Assert.Equal(3, peer.RaterCount);
        Assert.Equal(4d, peer.Competencies.Single(c => c.CompetencyKey == "communication").Average); // (3+4+5)/3
        Assert.Null(peer.Comments); // peer comments NEVER surfaced

        // direct_report has only 2 raters → OMITTED entirely (no bucket, anti-differencing).
        Assert.DoesNotContain(buckets, b => b.Relationship == "direct_report");
    }

    [Fact]
    public async Task ReportRows_neverExposeRaterUserId_onlyAssignmentId()
    {
        // The projection selects assignmentId (never rater_user_id). Assert no rater's user id string appears.
        var rows = await NewRepo().FindReportRowsAsync(
            OrgA, Evaluation360ReadFixture.PublishedCycleA.ToString(), RaterA, CancellationToken.None);

        var raterIds = new[]
        {
            "d0000000-0000-0000-0000-000000000010", // manager
            "d0000000-0000-0000-0000-000000000011", // peers
            "d0000000-0000-0000-0000-000000000012",
            "d0000000-0000-0000-0000-000000000013",
        };
        foreach (var row in rows)
        {
            Assert.DoesNotContain(row.AssignmentId, raterIds);
        }
    }

    // ---- cross-org RLS isolation on a self-service subject read ---------------------------------------
    [Fact]
    public async Task FindPublishedCyclesForSubject_OrgB_isIsolated()
    {
        var orgBUser = Guid.Parse("c0000000-0000-0000-0000-0000000000c1").ToString();
        var cycles = await NewRepo().FindPublishedCyclesForSubjectAsync(OrgB, orgBUser, CancellationToken.None);
        Assert.Single(cycles);
        Assert.Equal("OrgB Published", cycles[0].Name);
    }
}
