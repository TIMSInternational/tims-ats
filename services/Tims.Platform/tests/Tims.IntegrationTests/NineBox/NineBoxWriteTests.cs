using Tims.Domain.NineBox;
using Tims.Infrastructure.NineBox;

namespace Tims.IntegrationTests.NineBox;

/// <summary>
/// Phase-5 Slice 15 Testcontainers proof (real Postgres + real RLS session-subquery policy + the real UNIQUEs, NEVER
/// mocked) of the nine-box calibration WRITE data path — direct repository + use case under TenantScope. Covers: the
/// createCalibration full-row + nested-member INSERT; the memberIds cross-tenant hardening (INV-4, bite); the vote
/// membership+identity anchor (INV-1) + upsert idempotency (INV-2) + evaluatedUser-in-org (INV-3); the
/// addCalibrationMember dedup 23505 → Conflict with NO second row (INV-5); the removeCalibrationMember count-0 → 404
/// + cross-org RLS (INV-6); the finalize conditional update + cross-org (INV-7); tenant isolation (INV-9). Every op
/// runs UNDER TenantScope (SET LOCAL ROLE app_tenant + org GUC → RLS).
/// </summary>
[Collection("NineBoxWrite")]
public sealed class NineBoxWriteTests(NineBoxWriteFixture fixture)
{
    private static readonly DateTimeOffset Now = new(2026, 6, 15, 12, 0, 0, TimeSpan.Zero);

    private string Org => NineBoxWriteFixture.OrgA.ToString();

    private NineBoxWriteRepository Repo() => new(fixture.NewWriteContext());

    // ── createCalibration: full session INSERT + nested member rows (status='draft'/'invited', createdById=caller) ──
    [Fact]
    public async Task CreateCalibration_inserts_session_and_members()
    {
        var input = new CreateCalibrationInput(
            NineBoxWriteFixture.Period, Now,
            new[] { NineBoxWriteFixture.M1Id, NineBoxWriteFixture.M2Id });
        var result = await Repo().CreateCalibrationAsync(
            Org, NineBoxWriteFixture.OrgAdminId, input, Now, CancellationToken.None);

        Assert.Equal(CreateCalibrationOutcome.Created, result.Outcome);
        var session = result.Session!;
        Assert.True(Guid.TryParse(session.Id, out var sessionId));
        Assert.Equal(Org, session.OrganizationId);
        Assert.Equal(NineBoxWriteFixture.Period, session.Period);
        Assert.Equal("draft", session.Status);
        Assert.Equal(NineBoxWriteFixture.OrgAdminId.ToString(), session.CreatedById);
        Assert.Equal(Now, session.ScheduledAt);
        Assert.Null(session.CompletedAt);
        Assert.Equal(Now, session.CreatedAt);
        Assert.Equal(Now, session.UpdatedAt);
        // Full member rows (id/sessionId/userId/status/createdAt), one per memberId, status='invited'.
        Assert.Equal(2, session.Members.Count);
        Assert.All(session.Members, m =>
        {
            Assert.Equal(session.Id, m.SessionId);
            Assert.Equal("invited", m.Status);
            Assert.Equal(Now, m.CreatedAt);
        });
        Assert.Contains(session.Members, m => m.UserId == NineBoxWriteFixture.M1Id.ToString());
        Assert.Contains(session.Members, m => m.UserId == NineBoxWriteFixture.M2Id.ToString());
        Assert.True(await fixture.SessionExistsAsync(sessionId));
        Assert.Equal(2, await fixture.CountMembersAsync(sessionId));
    }

    // ── createCalibration with NO memberIds → session only, 0 members ──
    [Fact]
    public async Task CreateCalibration_without_members_inserts_empty_session()
    {
        var input = new CreateCalibrationInput(NineBoxWriteFixture.Period, null, Array.Empty<Guid>());
        var result = await Repo().CreateCalibrationAsync(
            Org, NineBoxWriteFixture.OrgAdminId, input, Now, CancellationToken.None);

        Assert.Equal(CreateCalibrationOutcome.Created, result.Outcome);
        Assert.Empty(result.Session!.Members);
        Assert.Null(result.Session.ScheduledAt);
        Assert.Equal(0, await fixture.CountMembersAsync(Guid.Parse(result.Session.Id)));
    }

    // ── INV-4 (H1-class, bite): a cross-org memberId → MemberNotInOrg, NO session/members written (atomic) ──
    [Fact]
    public async Task CreateCalibration_cross_org_member_is_rejected_and_nothing_written()
    {
        var sessionsBefore = await CountSessionsAsync();
        // Mb is an OrgB user. Under the OrgA TenantScope the users lookup is RLS-filtered to OrgA → Mb is invisible →
        // the count mismatch rejects the whole create (the RLS-only-on-session-linkage gap the hardening closes).
        var input = new CreateCalibrationInput(
            NineBoxWriteFixture.Period, null,
            new[] { NineBoxWriteFixture.M1Id, NineBoxWriteFixture.MbId });
        var result = await Repo().CreateCalibrationAsync(
            Org, NineBoxWriteFixture.OrgAdminId, input, Now, CancellationToken.None);

        Assert.Equal(CreateCalibrationOutcome.MemberNotInOrg, result.Outcome);
        Assert.Null(result.Session);
        // Nothing written — the session count is unchanged (atomic rollback).
        Assert.Equal(sessionsBefore, await CountSessionsAsync());
    }

    // ── createCalibration: a nonexistent memberId → MemberNotInOrg (in-org lookup misses) ──
    [Fact]
    public async Task CreateCalibration_nonexistent_member_is_rejected()
    {
        var input = new CreateCalibrationInput(
            NineBoxWriteFixture.Period, null, new[] { NineBoxWriteFixture.MissingUserId });
        var result = await Repo().CreateCalibrationAsync(
            Org, NineBoxWriteFixture.OrgAdminId, input, Now, CancellationToken.None);
        Assert.Equal(CreateCalibrationOutcome.MemberNotInOrg, result.Outcome);
    }

    // ── INV-1 + INV-2: a member's vote INSERTs then UPDATEs in place (idempotent, no dup row); voter_id = caller ──
    [Fact]
    public async Task SubmitVote_member_upserts_in_place()
    {
        var first = new SubmitCalibrationVoteInput(
            NineBoxWriteFixture.SessVoteRepo, NineBoxWriteFixture.E1Id, "core_player", "solid");
        var r1 = await Repo().SubmitCalibrationVoteAsync(
            Org, NineBoxWriteFixture.CommitteeId, first, Now, CancellationToken.None);

        Assert.Equal(SubmitCalibrationVoteOutcome.Upserted, r1.Outcome);
        var vote = r1.Vote!;
        Assert.Equal(NineBoxWriteFixture.SessVoteRepo.ToString(), vote.SessionId);
        Assert.Equal(NineBoxWriteFixture.E1Id.ToString(), vote.EvaluatedUserId);
        // voter_id is ALWAYS the caller (Committee) — never input.
        Assert.Equal(NineBoxWriteFixture.CommitteeId.ToString(), vote.VoterId);
        Assert.Equal("core_player", vote.Quadrant);
        Assert.Equal("solid", vote.Justification);

        // A 2nd vote (same session, evaluated, voter) UPDATEs in place — the SAME row id, new quadrant, no dup.
        var second = new SubmitCalibrationVoteInput(
            NineBoxWriteFixture.SessVoteRepo, NineBoxWriteFixture.E1Id, "star", "improved");
        var r2 = await Repo().SubmitCalibrationVoteAsync(
            Org, NineBoxWriteFixture.CommitteeId, second, Now, CancellationToken.None);
        Assert.Equal(SubmitCalibrationVoteOutcome.Upserted, r2.Outcome);
        Assert.Equal(vote.Id, r2.Vote!.Id); // SAME row (upsert, not a new insert)
        Assert.Equal("star", r2.Vote.Quadrant);
        Assert.Equal(1, await fixture.CountVotesAsync(
            NineBoxWriteFixture.SessVoteRepo, NineBoxWriteFixture.E1Id, NineBoxWriteFixture.CommitteeId));
    }

    // ── Parity F1: a re-vote that OMITS justification PRESERVES the prior value (COALESCE), never NULLs it ──
    // (evaluated = M1, distinct from the idempotency test's E1, so the two tests don't share a vote row.)
    [Fact]
    public async Task SubmitVote_revote_without_justification_preserves_prior()
    {
        var first = new SubmitCalibrationVoteInput(
            NineBoxWriteFixture.SessVoteRepo, NineBoxWriteFixture.M1Id, "core_player", "keep me");
        var r1 = await Repo().SubmitCalibrationVoteAsync(
            Org, NineBoxWriteFixture.CommitteeId, first, Now, CancellationToken.None);
        Assert.Equal(SubmitCalibrationVoteOutcome.Upserted, r1.Outcome);
        Assert.Equal("keep me", r1.Vote!.Justification);

        // The re-vote changes only the quadrant and OMITS justification (null = absent, exactly as the endpoint
        // passes an absent key — an explicit JSON null is rejected → 400 upstream). TS Prisma skips undefined and
        // preserves; C# must COALESCE, not overwrite with NULL.
        var revote = new SubmitCalibrationVoteInput(
            NineBoxWriteFixture.SessVoteRepo, NineBoxWriteFixture.M1Id, "star", null);
        var r2 = await Repo().SubmitCalibrationVoteAsync(
            Org, NineBoxWriteFixture.CommitteeId, revote, Now, CancellationToken.None);
        Assert.Equal(SubmitCalibrationVoteOutcome.Upserted, r2.Outcome);
        Assert.Equal("star", r2.Vote!.Quadrant);        // quadrant updated
        Assert.Equal("keep me", r2.Vote.Justification); // justification PRESERVED, not nulled
        Assert.Equal("keep me", await fixture.GetVoteJustificationAsync(
            NineBoxWriteFixture.SessVoteRepo, NineBoxWriteFixture.M1Id, NineBoxWriteFixture.CommitteeId));
    }

    // ── INV-1 (bite): a non-member (even the org-admin) → NotMember; a seeded member's vote is NOT overwritten ──
    [Fact]
    public async Task SubmitVote_org_admin_non_member_cannot_forge_or_overwrite()
    {
        // SessVoteForge has a seeded vote Committee → E1 ('star'). OrgAdmin is NOT a member of any session.
        var input = new SubmitCalibrationVoteInput(
            NineBoxWriteFixture.SessVoteForge, NineBoxWriteFixture.E1Id, "risk", "forged");
        var result = await Repo().SubmitCalibrationVoteAsync(
            Org, NineBoxWriteFixture.OrgAdminId, input, Now, CancellationToken.None);

        Assert.Equal(SubmitCalibrationVoteOutcome.NotMember, result.Outcome);
        Assert.Null(result.Vote);
        // OrgAdmin wrote NOTHING under its own voter_id.
        Assert.Equal(0, await fixture.CountVotesAsync(
            NineBoxWriteFixture.SessVoteForge, NineBoxWriteFixture.E1Id, NineBoxWriteFixture.OrgAdminId));
        // Committee's original vote is UNTOUCHED (still 'star') — an org-admin cannot overwrite another member's vote.
        Assert.Equal("star", await fixture.GetVoteQuadrantAsync(
            NineBoxWriteFixture.SessVoteForge, NineBoxWriteFixture.E1Id, NineBoxWriteFixture.CommitteeId));
    }

    // ── INV-3 (preserved Codex hardening): a cross-org evaluatedUserId → EvaluatedNotFound, no vote ──
    [Fact]
    public async Task SubmitVote_cross_org_evaluated_user_is_not_found()
    {
        var input = new SubmitCalibrationVoteInput(
            NineBoxWriteFixture.SessVoteEval, NineBoxWriteFixture.MbId, "star", null);
        var result = await Repo().SubmitCalibrationVoteAsync(
            Org, NineBoxWriteFixture.CommitteeId, input, Now, CancellationToken.None);

        Assert.Equal(SubmitCalibrationVoteOutcome.EvaluatedNotFound, result.Outcome);
        Assert.Equal(0, await fixture.CountVotesAsync(
            NineBoxWriteFixture.SessVoteEval, NineBoxWriteFixture.MbId, NineBoxWriteFixture.CommitteeId));
    }

    // ── a nonexistent evaluatedUserId → EvaluatedNotFound ──
    [Fact]
    public async Task SubmitVote_nonexistent_evaluated_user_is_not_found()
    {
        var input = new SubmitCalibrationVoteInput(
            NineBoxWriteFixture.SessVoteEval, NineBoxWriteFixture.MissingUserId, "star", null);
        var result = await Repo().SubmitCalibrationVoteAsync(
            Org, NineBoxWriteFixture.CommitteeId, input, Now, CancellationToken.None);
        Assert.Equal(SubmitCalibrationVoteOutcome.EvaluatedNotFound, result.Outcome);
    }

    // ── INV-9: a cross-org session → SessionNotFound (RLS hides the OrgB session under the OrgA GUC) ──
    [Fact]
    public async Task SubmitVote_cross_org_session_is_not_found()
    {
        var input = new SubmitCalibrationVoteInput(
            NineBoxWriteFixture.SessOrgB, NineBoxWriteFixture.E1Id, "star", null);
        var result = await Repo().SubmitCalibrationVoteAsync(
            Org, NineBoxWriteFixture.CommitteeId, input, Now, CancellationToken.None);
        Assert.Equal(SubmitCalibrationVoteOutcome.SessionNotFound, result.Outcome);
    }

    // ── addCalibrationMember: INSERT → Created {id} ──
    [Fact]
    public async Task AddMember_inserts_and_returns_id()
    {
        var result = await Repo().AddCalibrationMemberAsync(
            Org, NineBoxWriteFixture.SessAddOk, NineBoxWriteFixture.M2Id, Now, CancellationToken.None);

        Assert.Equal(AddCalibrationMemberOutcome.Created, result.Outcome);
        Assert.True(Guid.TryParse(result.MemberId, out _));
        Assert.True(await fixture.MemberExistsAsync(NineBoxWriteFixture.SessAddOk, NineBoxWriteFixture.M2Id));
    }

    // ── addCalibrationMember: a cross-org userId → UserNotFound (RLS-filtered users lookup misses) ──
    [Fact]
    public async Task AddMember_cross_org_user_is_not_found()
    {
        var result = await Repo().AddCalibrationMemberAsync(
            Org, NineBoxWriteFixture.SessAddOk, NineBoxWriteFixture.MbId, Now, CancellationToken.None);
        Assert.Equal(AddCalibrationMemberOutcome.UserNotFound, result.Outcome);
        Assert.False(await fixture.MemberExistsAsync(NineBoxWriteFixture.SessAddOk, NineBoxWriteFixture.MbId));
    }

    // ── addCalibrationMember: a nonexistent session → SessionNotFound ──
    [Fact]
    public async Task AddMember_missing_session_is_not_found()
    {
        var result = await Repo().AddCalibrationMemberAsync(
            Org, NineBoxWriteFixture.MissingSessionId, NineBoxWriteFixture.M1Id, Now, CancellationToken.None);
        Assert.Equal(AddCalibrationMemberOutcome.SessionNotFound, result.Outcome);
    }

    // ── INV-5 (bite): a duplicate (session, user) → Conflict (23505, constraint-specific), NO second row ──
    [Fact]
    public async Task AddMember_duplicate_is_conflict_and_creates_no_second_row()
    {
        // SessAddDup already seeds member M1. A fresh add of the same pair must trip the real UNIQUE.
        var result = await Repo().AddCalibrationMemberAsync(
            Org, NineBoxWriteFixture.SessAddDup, NineBoxWriteFixture.M1Id, Now, CancellationToken.None);

        Assert.Equal(AddCalibrationMemberOutcome.Conflict, result.Outcome);
        Assert.Null(result.MemberId);
        // Still exactly one (SessAddDup, M1) member — the failed INSERT rolled back atomically.
        Assert.Equal(1, await CountMembersForPairAsync(NineBoxWriteFixture.SessAddDup, NineBoxWriteFixture.M1Id));
    }

    // ── removeCalibrationMember: DELETE → Deleted; the row is gone ──
    [Fact]
    public async Task RemoveMember_deletes_and_returns_success()
    {
        var result = await Repo().RemoveCalibrationMemberAsync(
            Org, NineBoxWriteFixture.SessRemoveOk, NineBoxWriteFixture.M1Id, CancellationToken.None);

        Assert.Equal(RemoveCalibrationMemberOutcome.Deleted, result.Outcome);
        Assert.False(await fixture.MemberExistsAsync(NineBoxWriteFixture.SessRemoveOk, NineBoxWriteFixture.M1Id));
    }

    // ── removeCalibrationMember: a non-member (count 0) → MemberNotFound ──
    [Fact]
    public async Task RemoveMember_non_member_is_member_not_found()
    {
        // M2 is NOT a member of SessRemoveOk → the delete affects 0 rows → 404.
        var result = await Repo().RemoveCalibrationMemberAsync(
            Org, NineBoxWriteFixture.SessRemoveOk, NineBoxWriteFixture.M2Id, CancellationToken.None);
        Assert.Equal(RemoveCalibrationMemberOutcome.MemberNotFound, result.Outcome);
    }

    // ── INV-6: a cross-org session → SessionNotFound (RLS hides it), the OrgB member untouched ──
    [Fact]
    public async Task RemoveMember_cross_org_session_is_not_found_and_untouched()
    {
        var result = await Repo().RemoveCalibrationMemberAsync(
            Org, NineBoxWriteFixture.SessOrgB, NineBoxWriteFixture.MbId, CancellationToken.None);
        Assert.Equal(RemoveCalibrationMemberOutcome.SessionNotFound, result.Outcome);
        Assert.True(await fixture.MemberExistsAsync(NineBoxWriteFixture.SessOrgB, NineBoxWriteFixture.MbId)); // RLS hid it
    }

    // ── INV-7: finalize sets finalized + completedAt and returns the full session row ──
    [Fact]
    public async Task Finalize_sets_finalized_and_completed_at()
    {
        var row = await Repo().FinalizeCalibrationAsync(
            Org, NineBoxWriteFixture.SessFinalizeOk, Now, CancellationToken.None);

        Assert.NotNull(row);
        Assert.Equal(NineBoxWriteFixture.SessFinalizeOk.ToString(), row!.Id);
        Assert.Equal("finalized", row.Status);
        Assert.Equal(Now, row.CompletedAt);
        Assert.Equal(Now, row.UpdatedAt);
        Assert.Equal("finalized", await fixture.GetSessionStatusAsync(NineBoxWriteFixture.SessFinalizeOk));
        Assert.True(await fixture.SessionHasCompletedAtAsync(NineBoxWriteFixture.SessFinalizeOk));
    }

    // ── INV-7: finalize of a cross-org session → null (RLS/org filter hides it), untouched ──
    [Fact]
    public async Task Finalize_cross_org_is_null_and_untouched()
    {
        Assert.Null(await Repo().FinalizeCalibrationAsync(
            Org, NineBoxWriteFixture.SessOrgB, Now, CancellationToken.None));
        Assert.Equal("draft", await fixture.GetSessionStatusAsync(NineBoxWriteFixture.SessOrgB)); // untouched
    }

    // ── finalize of a nonexistent session → null (count 0 → 404 at the endpoint) ──
    [Fact]
    public async Task Finalize_missing_session_is_null()
    {
        Assert.Null(await Repo().FinalizeCalibrationAsync(
            Org, NineBoxWriteFixture.MissingSessionId, Now, CancellationToken.None));
    }

    private async Task<int> CountSessionsAsync()
    {
        await using var connection = await fixture.OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*)::int FROM calibration_sessions";
        return (int)(await command.ExecuteScalarAsync())!;
    }

    private async Task<int> CountMembersForPairAsync(Guid sessionId, Guid userId)
    {
        await using var connection = await fixture.OpenSuperuserConnectionAsync();
        await using var command = connection.CreateCommand();
        command.CommandText = "SELECT COUNT(*)::int FROM calibration_members WHERE session_id = @s AND user_id = @u";
        command.Parameters.AddWithValue("s", sessionId);
        command.Parameters.AddWithValue("u", userId);
        return (int)(await command.ExecuteScalarAsync())!;
    }
}
