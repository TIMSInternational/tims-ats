using Tims.Application.Evaluation360;
using Tims.Domain.Evaluation360;
using Tims.Infrastructure.Evaluation360;

namespace Tims.IntegrationTests.Evaluation360;

/// <summary>
/// Phase-5 Slice 13 Testcontainers proof (real Postgres + real RLS + the native enums, NEVER mocked) of the
/// evaluation360 WRITE data path — direct repository + use case under TenantScope. Covers: createCycle INSERT; the
/// three guarded transitions + their count-0 CONFLICTs (INV-1 state machine, draft→open→closed→published only);
/// assignRaters (draft/open allowed, closed → cycleNotOpen, missing/foreign-org user → missingUserIds, skipDuplicates
/// count) (INV-2); submitRatings IDENTITY-anchoring — an org-admin CANNOT claim another rater's assignment (INV-3);
/// claim-idempotency + submit-on-non-open-cycle (INV-4); and cross-org RLS isolation (INV-6). Every op runs UNDER
/// TenantScope (SET LOCAL ROLE app_tenant + org GUC).
/// </summary>
[Collection("Evaluation360Write")]
public sealed class Evaluation360WriteTests(Evaluation360WriteFixture fixture)
{
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);

    private static string Org => Evaluation360WriteFixture.OrgA.ToString();

    private Evaluation360WriteRepository Repo() => new(fixture.NewWriteContext());

    private Evaluation360WriteUseCase UseCase() => new(new Evaluation360WriteRepository(fixture.NewWriteContext()));

    private static IReadOnlyList<RatingSubmissionInput> SixRatings() => new[]
    {
        new RatingSubmissionInput("leadership", 4, null),
        new RatingSubmissionInput("communication", 5, "note"),
        new RatingSubmissionInput("collaboration", 3, null),
        new RatingSubmissionInput("execution", 4, null),
        new RatingSubmissionInput("adaptability", 5, null),
        new RatingSubmissionInput("integrity", 4, null),
    };

    // ── createCycle: INSERTs a draft row with createdById = caller ──
    [Fact]
    public async Task Create_inserts_draft_cycle_with_caller()
    {
        var result = await Repo().CreateCycleAsync(
            Org, Evaluation360WriteFixture.OrgAdminId, "Q3 360 Review", Now, CancellationToken.None);

        Assert.Equal("Q3 360 Review", result.Name);
        Assert.Equal("draft", result.Status);
        Assert.True(Guid.TryParse(result.Id, out var id));
        Assert.Equal("draft", await fixture.GetCycleStatusAsync(id));

        await using var connection = await fixture.OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT created_by_id, organization_id FROM review_cycles WHERE id = @id";
        command.Parameters.AddWithValue("id", id);
        await using var reader = await command.ExecuteReaderAsync();
        Assert.True(await reader.ReadAsync());
        Assert.Equal(Evaluation360WriteFixture.OrgAdminId, reader.GetGuid(0));
        Assert.Equal(Evaluation360WriteFixture.OrgA, reader.GetGuid(1));
    }

    // ── state machine: legal transitions succeed; illegal ones ⇒ count 0 (CONFLICT) with NO state change ──
    [Fact]
    public async Task Open_draft_transitions_to_open()
    {
        Assert.True(await Repo().OpenCycleAsync(Org, Evaluation360WriteFixture.CycleOpenOk, Now, CancellationToken.None));
        Assert.Equal("open", await fixture.GetCycleStatusAsync(Evaluation360WriteFixture.CycleOpenOk));
    }

    [Fact]
    public async Task Open_on_non_draft_is_conflict_no_change()
    {
        Assert.False(await Repo().OpenCycleAsync(Org, Evaluation360WriteFixture.CycleOpenConflict, Now, CancellationToken.None));
        Assert.Equal("open", await fixture.GetCycleStatusAsync(Evaluation360WriteFixture.CycleOpenConflict));
    }

    [Fact]
    public async Task Close_open_transitions_to_closed()
    {
        Assert.True(await Repo().CloseCycleAsync(Org, Evaluation360WriteFixture.CycleCloseOk, Now, CancellationToken.None));
        Assert.Equal("closed", await fixture.GetCycleStatusAsync(Evaluation360WriteFixture.CycleCloseOk));
    }

    [Fact]
    public async Task Close_on_non_open_is_conflict_no_change()
    {
        Assert.False(await Repo().CloseCycleAsync(Org, Evaluation360WriteFixture.CycleCloseConflict, Now, CancellationToken.None));
        Assert.Equal("draft", await fixture.GetCycleStatusAsync(Evaluation360WriteFixture.CycleCloseConflict));
    }

    [Fact]
    public async Task Publish_closed_transitions_to_published()
    {
        Assert.True(await Repo().PublishCycleAsync(Org, Evaluation360WriteFixture.CyclePublishOk, Now, CancellationToken.None));
        Assert.Equal("published", await fixture.GetCycleStatusAsync(Evaluation360WriteFixture.CyclePublishOk));
    }

    [Fact]
    public async Task Publish_on_non_closed_is_conflict_no_change()
    {
        Assert.False(await Repo().PublishCycleAsync(Org, Evaluation360WriteFixture.CyclePublishConflict, Now, CancellationToken.None));
        Assert.Equal("open", await fixture.GetCycleStatusAsync(Evaluation360WriteFixture.CyclePublishConflict));
    }

    // ── assignRaters ──
    [Fact]
    public async Task Assign_on_open_creates()
    {
        var result = await UseCase().AssignRatersAsync(
            Org, Evaluation360WriteFixture.CycleAssignOpen, One(Evaluation360WriteFixture.Subject1), Now, CancellationToken.None);

        Assert.Equal(AssignRatersOutcome.Created, result.Outcome);
        Assert.Equal(1, result.Created);
        Assert.Equal(1, await fixture.CountAssignmentsAsync(Evaluation360WriteFixture.CycleAssignOpen));
    }

    [Fact]
    public async Task Assign_on_draft_creates()
    {
        var result = await UseCase().AssignRatersAsync(
            Org, Evaluation360WriteFixture.CycleAssignDraft, One(Evaluation360WriteFixture.Subject1), Now, CancellationToken.None);
        Assert.Equal(AssignRatersOutcome.Created, result.Outcome);
        Assert.Equal(1, result.Created);
    }

    [Fact]
    public async Task Assign_on_closed_is_cycleNotOpen_no_write()
    {
        var result = await UseCase().AssignRatersAsync(
            Org, Evaluation360WriteFixture.CycleAssignClosed, One(Evaluation360WriteFixture.Subject1), Now, CancellationToken.None);
        Assert.Equal(AssignRatersOutcome.CycleNotOpen, result.Outcome);
        Assert.Equal(0, await fixture.CountAssignmentsAsync(Evaluation360WriteFixture.CycleAssignClosed));
    }

    [Fact]
    public async Task Assign_foreign_or_missing_user_is_missingUsers_no_write()
    {
        var assignments = new[]
        {
            new RaterAssignmentInput(Evaluation360WriteFixture.MissingUserId, Evaluation360WriteFixture.RaterAId, "peer"),
        };
        var result = await UseCase().AssignRatersAsync(
            Org, Evaluation360WriteFixture.CycleAssignMissing, assignments, Now, CancellationToken.None);

        Assert.Equal(AssignRatersOutcome.MissingUsers, result.Outcome);
        Assert.Equal(0, await fixture.CountAssignmentsAsync(Evaluation360WriteFixture.CycleAssignMissing));
    }

    [Fact]
    public async Task Assign_foreign_org_rater_is_missingUsers()
    {
        // OrgBUser is an OrgB user — under the OrgA org GUC, RLS hides it → treated as missing (no cross-org assign).
        var assignments = new[]
        {
            new RaterAssignmentInput(Evaluation360WriteFixture.Subject1, Evaluation360WriteFixture.OrgBUserId, "peer"),
        };
        var result = await UseCase().AssignRatersAsync(
            Org, Evaluation360WriteFixture.CycleAssignMissing, assignments, Now, CancellationToken.None);
        Assert.Equal(AssignRatersOutcome.MissingUsers, result.Outcome);
    }

    [Fact]
    public async Task Assign_skipDuplicates_counts_only_new_rows()
    {
        // CycleAssignDup already has (S1 × RaterA). Assigning [(S1×RaterA)=dup, (S2×RaterA)=new] inserts ONLY the new.
        var assignments = new[]
        {
            new RaterAssignmentInput(Evaluation360WriteFixture.Subject1, Evaluation360WriteFixture.RaterAId, "peer"),
            new RaterAssignmentInput(Evaluation360WriteFixture.Subject2, Evaluation360WriteFixture.RaterAId, "peer"),
        };
        var result = await UseCase().AssignRatersAsync(
            Org, Evaluation360WriteFixture.CycleAssignDup, assignments, Now, CancellationToken.None);

        Assert.Equal(AssignRatersOutcome.Created, result.Outcome);
        Assert.Equal(1, result.Created); // the duplicate was skipped, not counted
        Assert.Equal(2, await fixture.CountAssignmentsAsync(Evaluation360WriteFixture.CycleAssignDup)); // 1 seeded + 1 new
    }

    // ── INV-3 IDENTITY-anchoring: an org-admin CANNOT submit/claim on another rater's assignment ──
    [Fact]
    public async Task Submit_orgAdmin_cannot_claim_another_raters_assignment()
    {
        // AssignForgeTarget belongs to RaterA. The org-admin (organization scope) is NOT the rater → the ownership
        // pre-fetch is false → NOT_FOUND, and no write happens (the identity hard-filter, NOT scope).
        var result = await UseCase().SubmitRatingsAsync(
            Org, Evaluation360WriteFixture.OrgAdminId, Evaluation360WriteFixture.AssignForgeTarget, SixRatings(),
            Now, CancellationToken.None);

        Assert.Equal(SubmitRatingsOutcome.NotFound, result.Outcome);
        Assert.Equal("pending", await fixture.GetAssignmentStatusAsync(Evaluation360WriteFixture.AssignForgeTarget));
        Assert.Equal(0, await fixture.CountResponsesAsync(Evaluation360WriteFixture.AssignForgeTarget));
    }

    [Fact]
    public async Task Submit_prefetch_and_claim_are_both_identity_anchored()
    {
        // Belongs is false for both the org-admin AND another rater (RaterB); a direct repo claim by the org-admin
        // also matches 0 rows (the rater_user_id guard), leaving NO responses — proving BOTH the pre-fetch and the
        // claim hard-filter on rater_user_id, not scope.
        Assert.False(await Repo().AssignmentBelongsToRaterAsync(
            Org, Evaluation360WriteFixture.OrgAdminId, Evaluation360WriteFixture.AssignForgeTarget, CancellationToken.None));
        Assert.False(await Repo().AssignmentBelongsToRaterAsync(
            Org, Evaluation360WriteFixture.RaterBId, Evaluation360WriteFixture.AssignForgeTarget, CancellationToken.None));

        Assert.False(await Repo().SubmitRatingsAsync(
            Org, Evaluation360WriteFixture.OrgAdminId, Evaluation360WriteFixture.AssignForgeTarget, SixRatings(),
            Now, CancellationToken.None));
        Assert.Equal("pending", await fixture.GetAssignmentStatusAsync(Evaluation360WriteFixture.AssignForgeTarget));
        Assert.Equal(0, await fixture.CountResponsesAsync(Evaluation360WriteFixture.AssignForgeTarget));
    }

    // ── submit by the OWNING rater: claims + inserts exactly 6 responses ──
    [Fact]
    public async Task Submit_by_owning_rater_claims_and_inserts_six()
    {
        var result = await UseCase().SubmitRatingsAsync(
            Org, Evaluation360WriteFixture.RaterAId, Evaluation360WriteFixture.AssignSubmitOk, SixRatings(),
            Now, CancellationToken.None);

        Assert.Equal(SubmitRatingsOutcome.Submitted, result.Outcome);
        Assert.Equal("submitted", await fixture.GetAssignmentStatusAsync(Evaluation360WriteFixture.AssignSubmitOk));
        Assert.Equal(6, await fixture.CountResponsesAsync(Evaluation360WriteFixture.AssignSubmitOk));
    }

    // ── INV-4 claim-idempotency: a 2nd submit on a claimed assignment ⇒ Conflict, NO duplicate responses ──
    [Fact]
    public async Task Submit_twice_is_conflict_no_duplicate_responses()
    {
        var first = await UseCase().SubmitRatingsAsync(
            Org, Evaluation360WriteFixture.RaterAId, Evaluation360WriteFixture.AssignClaimIdem, SixRatings(),
            Now, CancellationToken.None);
        Assert.Equal(SubmitRatingsOutcome.Submitted, first.Outcome);

        var second = await UseCase().SubmitRatingsAsync(
            Org, Evaluation360WriteFixture.RaterAId, Evaluation360WriteFixture.AssignClaimIdem, SixRatings(),
            Now, CancellationToken.None);
        Assert.Equal(SubmitRatingsOutcome.Conflict, second.Outcome);
        Assert.Equal(6, await fixture.CountResponsesAsync(Evaluation360WriteFixture.AssignClaimIdem)); // still 6, not 12
    }

    [Fact]
    public async Task Submit_on_non_open_cycle_is_conflict()
    {
        // AssignClosedPending is pending but its cycle is CLOSED → the claim guard (cycle open) matches 0 → Conflict.
        var result = await UseCase().SubmitRatingsAsync(
            Org, Evaluation360WriteFixture.RaterAId, Evaluation360WriteFixture.AssignClosedPending, SixRatings(),
            Now, CancellationToken.None);

        Assert.Equal(SubmitRatingsOutcome.Conflict, result.Outcome);
        Assert.Equal("pending", await fixture.GetAssignmentStatusAsync(Evaluation360WriteFixture.AssignClosedPending));
        Assert.Equal(0, await fixture.CountResponsesAsync(Evaluation360WriteFixture.AssignClosedPending));
    }

    // ── INV-6 cross-org RLS: an OrgA caller cannot transition/assign an OrgB cycle ──
    [Fact]
    public async Task Cross_org_transition_is_conflict_no_change()
    {
        // CycleOrgB is OrgB (open). Under the OrgA GUC, RLS hides it → the guarded update matches 0 → false.
        Assert.False(await Repo().CloseCycleAsync(Org, Evaluation360WriteFixture.CycleOrgB, Now, CancellationToken.None));
        Assert.Equal("open", await fixture.GetCycleStatusAsync(Evaluation360WriteFixture.CycleOrgB)); // untouched
    }

    [Fact]
    public async Task Cross_org_assign_is_cycleNotOpen()
    {
        var result = await UseCase().AssignRatersAsync(
            Org, Evaluation360WriteFixture.CycleOrgB, One(Evaluation360WriteFixture.Subject1), Now, CancellationToken.None);
        Assert.Equal(AssignRatersOutcome.CycleNotOpen, result.Outcome); // RLS hides the OrgB cycle → re-check finds none
        Assert.Equal(0, await fixture.CountAssignmentsAsync(Evaluation360WriteFixture.CycleOrgB));
    }

    private static IReadOnlyList<RaterAssignmentInput> One(Guid subjectId) => new[]
    {
        new RaterAssignmentInput(subjectId, Evaluation360WriteFixture.RaterAId, "peer"),
    };
}
