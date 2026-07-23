using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Tims.Application.NineBox;
using Tims.Domain.NineBox;

namespace Tims.Infrastructure.NineBox;

/// <summary>
/// EF implementation of <see cref="INineBoxWriteRepository"/> — a faithful port of the data steps of the 5 TS
/// <c>ninebox</c> mutations (inline <c>prisma.*</c> in the router). Every operation runs UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC → RLS). Client-set id (<c>Guid.NewGuid()</c>) +
/// createdAt/updatedAt (explicit) — Prisma <c>@default(uuid())</c> / <c>@default(now())</c> / <c>@updatedAt</c> are
/// client-side.
///
/// TENANCY: calibration_members/votes have NO organization_id — the tenant guard is the RLS session-subquery WITH
/// CHECK (EXISTS session WHERE session_id AND org = GUC). Every member/vote INSERT runs under TenantScope so the
/// WITH CHECK passes (the session is in-org). Provenance/anti-forgery: createdById = caller (session), voter_id =
/// caller (vote — NEVER from input), status='draft'/'invited'/'finalized' — all server-side.
/// </summary>
public sealed class NineBoxWriteRepository(NineBoxWriteDbContext db) : INineBoxWriteRepository
{
    // The real Prisma @@unique([sessionId, userId]) constraint name (calibration_members) — the addCalibrationMember
    // dedup 409 must trip ONLY this (a PK collision / future index must propagate, succession M2 lesson).
    private const string MemberUniqueConstraint = "calibration_members_session_id_user_id_key";

    // The real Prisma @@unique([sessionId, evaluatedUserId, voterId]) constraint name (calibration_votes) — the
    // vote upsert's ON CONFLICT target.
    private const string VoteUniqueConstraint = "calibration_votes_session_id_evaluated_user_id_voter_id_key";

    private readonly NineBoxWriteDbContext _db = db;

    public async Task<CreateCalibrationResult> CreateCalibrationAsync(
        string organizationId, Guid createdById, CreateCalibrationInput input, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Cross-tenant hardening (succession H1 lesson): the nested calibration_members insert below writes memberIds
        // VERBATIM. RLS only guards the SESSION linkage, NOT the member user_id, so an org-scoped creator could
        // otherwise seed a cross-tenant member. Validate every DISTINCT memberId is a user in the caller's org (this
        // same-txn lookup is RLS-filtered to the org) BEFORE the insert — a cross-org/nonexistent id ⇒ MemberNotInOrg
        // (→ 400), nothing written (the scope disposes WITHOUT commit → rollback). Fixed in BOTH stacks (ninebox.ts).
        if (input.MemberIds.Count > 0)
        {
            var distinct = input.MemberIds.Distinct().ToList();
            var found = await _db.Users.AsNoTracking()
                .Where(u => distinct.Contains(u.Id) && u.OrganizationId == orgId)
                .Select(u => u.Id)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);
            if (found.Count != distinct.Count)
            {
                return new CreateCalibrationResult(CreateCalibrationOutcome.MemberNotInOrg, null);
            }
        }

        var session = new CalibrationSessionWriteEntity
        {
            // Prisma @default(uuid()) is client-side generation — mint the id here (Prisma parity).
            Id = Guid.NewGuid(),
            OrganizationId = orgId,
            Period = input.Period,
            // Provenance: status is ALWAYS 'draft' on create; createdById is ALWAYS the caller (never from input).
            Status = "draft",
            ScheduledAt = input.ScheduledAt is { } scheduled ? ToTimestamp(scheduled) : null,
            // completedAt is never set on create (Prisma leaves it NULL until finalizeCalibration).
            CompletedAt = null,
            CreatedById = createdById,
            // Prisma @default(now()) / @updatedAt are client-side — set both explicitly (parity + NOT NULL safety).
            CreatedAt = nowTs,
            UpdatedAt = nowTs,
        };
        _db.CalibrationSessions.Add(session);

        // Persist the SESSION first (same tx, NOT committed). The calibration_members WITH CHECK is the session-
        // subquery RLS policy (EXISTS session WHERE session_id AND org = GUC) — the member insert only passes once the
        // session row is visible. EF has no navigation between these entities to force the order, so a single
        // SaveChanges could batch the members BEFORE the session (→ 42501). Two SaveChanges in the SAME TenantScope
        // transaction guarantee order + keep atomicity (a member failure still rolls the whole tx back).
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        // Nested calibration_members.create per memberId (status='invited', createdAt=now). Order preserved for the
        // include: { members: true } return (input order).
        var members = input.MemberIds
            .Select(userId => new CalibrationMemberWriteEntity
            {
                Id = Guid.NewGuid(),
                SessionId = session.Id,
                UserId = userId,
                Status = "invited",
                CreatedAt = nowTs,
            })
            .ToList();
        if (members.Count > 0)
        {
            _db.CalibrationMembers.AddRange(members);
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        var memberRows = members.Select(ToMemberRow).ToList();
        return new CreateCalibrationResult(CreateCalibrationOutcome.Created, ToSessionWithMembers(session, memberRows));
    }

    public async Task<SubmitCalibrationVoteResult> SubmitCalibrationVoteAsync(
        string organizationId, Guid voterId, SubmitCalibrationVoteInput input, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // (a) The session must exist within the caller's org (RLS + explicit org filter). NOT_FOUND otherwise — does
        //     not confirm the id to outsiders (ninebox.ts:367-373).
        var sessionExists = await _db.CalibrationSessions.AsNoTracking()
            .AnyAsync(s => s.Id == input.SessionId && s.OrganizationId == orgId, cancellationToken)
            .ConfigureAwait(false);
        if (!sessionExists)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new SubmitCalibrationVoteResult(SubmitCalibrationVoteOutcome.SessionNotFound, null);
        }

        // (b) The VOTER (the resolved caller — NEVER input; the upsert keys voter_id off the caller so a non-member
        //     can't forge a row) must be a calibration_member of the session (ninebox.ts:376-385). Membership is the
        //     authority, so an org-admin/non-member → 403.
        var isMember = await _db.CalibrationMembers.AsNoTracking()
            .AnyAsync(m => m.SessionId == input.SessionId && m.UserId == voterId, cancellationToken)
            .ConfigureAwait(false);
        if (!isMember)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new SubmitCalibrationVoteResult(SubmitCalibrationVoteOutcome.NotMember, null);
        }

        // (c) The evaluatedUser must be a real member of this org (preserved Codex hardening — an unvalidated FK let
        //     votes target arbitrary/cross-tenant user ids; ninebox.ts:390-396). Deliberately NOT subject-scoped —
        //     committee panels calibrate across teams, MEMBERSHIP is the authority, not the voter's team.
        var evaluatedExists = await _db.Users.AsNoTracking()
            .AnyAsync(u => u.Id == input.EvaluatedUserId && u.OrganizationId == orgId, cancellationToken)
            .ConfigureAwait(false);
        if (!evaluatedExists)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new SubmitCalibrationVoteResult(SubmitCalibrationVoteOutcome.EvaluatedNotFound, null);
        }

        var vote = await UpsertVoteAsync(orgId, input, voterId, nowTs, cancellationToken).ConfigureAwait(false);
        if (vote is null)
        {
            // Codex M1 (TOCTOU): the guarded upsert wrote 0 rows — the voter's membership (or the evaluatedUser's
            // org) vanished between the pre-checks and the atomic write (a concurrent removeCalibrationMember). The
            // vote is NOT recorded → 403 (same as a non-member), no write. Faithful-hardening beyond the TS
            // check-then-upsert race.
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new SubmitCalibrationVoteResult(SubmitCalibrationVoteOutcome.NotMember, null);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new SubmitCalibrationVoteResult(SubmitCalibrationVoteOutcome.Upserted, vote);
    }

    // The atomic guarded vote upsert — a raw parameterized INSERT … SELECT … WHERE EXISTS(member) AND EXISTS(evaluated)
    // … ON CONFLICT ON CONSTRAINT … DO UPDATE (EF has no native upsert; mirror the eval360 raw ON-CONFLICT). Runs on
    // THIS context's connection inside the TenantScope transaction, so the WITH CHECK (session-org) passes.
    // Codex M1: the WHERE EXISTS clauses re-verify committee-membership AND evaluatedUser-in-org ATOMICALLY at write
    // time (not just in the pre-checks) — a concurrent removal/move → the SELECT yields 0 rows → nothing is
    // inserted/updated → RETURNING is empty → null (the caller maps this to 403). voter_id is ALWAYS the caller.
    // Parity F1: on a conflict-UPDATE, justification uses COALESCE(EXCLUDED.justification, existing) so an omitted
    // justification on a re-vote PRESERVES the prior value (Prisma skips `undefined` in an update — TS never nulls it;
    // an explicit JSON null is rejected upstream → 400, so absent is the only null case). Every value is a bound
    // Npgsql parameter — never interpolated (only the const constraint name is).
    private async Task<CalibrationVoteResultRow?> UpsertVoteAsync(
        Guid orgId, SubmitCalibrationVoteInput input, Guid voterId, DateTime nowTs, CancellationToken cancellationToken)
    {
        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction();

        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText =
            $"""
             INSERT INTO calibration_votes
                 (id, session_id, evaluated_user_id, voter_id, quadrant, justification, created_at)
             SELECT @id, @session, @evaluated, @voter, @quadrant, @justification, @created
             WHERE EXISTS (SELECT 1 FROM calibration_members WHERE session_id = @session AND user_id = @voter)
               AND EXISTS (SELECT 1 FROM users WHERE id = @evaluated AND organization_id = @org)
             ON CONFLICT ON CONSTRAINT {VoteUniqueConstraint}
             DO UPDATE SET quadrant = EXCLUDED.quadrant,
                           justification = COALESCE(EXCLUDED.justification, calibration_votes.justification)
             RETURNING id, session_id, evaluated_user_id, voter_id, quadrant, justification, created_at
             """;
        command.Parameters.AddWithValue("id", Guid.NewGuid());
        command.Parameters.AddWithValue("session", input.SessionId);
        command.Parameters.AddWithValue("evaluated", input.EvaluatedUserId);
        command.Parameters.AddWithValue("voter", voterId);
        command.Parameters.AddWithValue("org", orgId);
        command.Parameters.AddWithValue("quadrant", input.Quadrant);
        command.Parameters.AddWithValue("justification", (object?)input.Justification ?? DBNull.Value);
        command.Parameters.AddWithValue("created", nowTs);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
        if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
        {
            return null;
        }

        return new CalibrationVoteResultRow(
            reader.GetGuid(0).ToString(),
            reader.GetGuid(1).ToString(),
            reader.GetGuid(2).ToString(),
            reader.GetGuid(3).ToString(),
            reader.GetString(4),
            reader.IsDBNull(5) ? null : reader.GetString(5),
            ToUtc(reader.GetDateTime(6)));
    }

    public async Task<AddCalibrationMemberResult> AddCalibrationMemberAsync(
        string organizationId, Guid sessionId, Guid userId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var sessionExists = await _db.CalibrationSessions.AsNoTracking()
            .AnyAsync(s => s.Id == sessionId && s.OrganizationId == orgId, cancellationToken)
            .ConfigureAwait(false);
        if (!sessionExists)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new AddCalibrationMemberResult(AddCalibrationMemberOutcome.SessionNotFound, null);
        }

        // The member must be a user in the caller's org (ninebox.ts:438-444 — preserved, NOT the createCalibration gap).
        var userExists = await _db.Users.AsNoTracking()
            .AnyAsync(u => u.Id == userId && u.OrganizationId == orgId, cancellationToken)
            .ConfigureAwait(false);
        if (!userExists)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new AddCalibrationMemberResult(AddCalibrationMemberOutcome.UserNotFound, null);
        }

        var entity = new CalibrationMemberWriteEntity
        {
            Id = Guid.NewGuid(),
            SessionId = sessionId,
            UserId = userId,
            Status = "invited",
            CreatedAt = nowTs,
        };
        _db.CalibrationMembers.Add(entity);

        try
        {
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateException ex) when (IsMemberUniqueViolation(ex))
        {
            // FAITHFUL: TS catches P2002 → CONFLICT "El usuario ya es miembro de este comite". Atomic: the scope
            // disposes WITHOUT commit → the INSERT rolls back, so NO duplicate row is created.
            return new AddCalibrationMemberResult(AddCalibrationMemberOutcome.Conflict, null);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new AddCalibrationMemberResult(AddCalibrationMemberOutcome.Created, entity.Id.ToString());
    }

    public async Task<RemoveCalibrationMemberResult> RemoveCalibrationMemberAsync(
        string organizationId, Guid sessionId, Guid userId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        var sessionExists = await _db.CalibrationSessions.AsNoTracking()
            .AnyAsync(s => s.Id == sessionId && s.OrganizationId == orgId, cancellationToken)
            .ConfigureAwait(false);
        if (!sessionExists)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new RemoveCalibrationMemberResult(RemoveCalibrationMemberOutcome.SessionNotFound);
        }

        // Set-based delete (TS deleteMany) — no tracked-load TOCTOU risk. Under TenantScope the RLS session-subquery
        // USING gates it (the member's session must be in-org). affected 0 ⇒ no such member → 404 "Miembro no encontrado".
        var count = await _db.CalibrationMembers
            .Where(m => m.SessionId == sessionId && m.UserId == userId)
            .ExecuteDeleteAsync(cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new RemoveCalibrationMemberResult(
            count == 0 ? RemoveCalibrationMemberOutcome.MemberNotFound : RemoveCalibrationMemberOutcome.Deleted);
    }

    public async Task<CalibrationSessionRow?> FinalizeCalibrationAsync(
        string organizationId, Guid sessionId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // UNCONDITIONAL update (TS has NO state-machine guard, ninebox.ts:483-492): conditional ExecuteUpdate WHERE
        // {id, org} — count 0 ⇒ null (→ 404 at the caller, a documented improvement over the TS update→P2025→500 on
        // absent/cross-org, exactly the succession removeSuccessor precedent).
        var count = await _db.CalibrationSessions
            .Where(s => s.Id == sessionId && s.OrganizationId == orgId)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(s => s.Status, "finalized")
                    .SetProperty(s => s.CompletedAt, (DateTime?)nowTs)
                    .SetProperty(s => s.UpdatedAt, nowTs),
                cancellationToken)
            .ConfigureAwait(false);
        if (count == 0)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        // The row was just updated (count > 0) → re-read the full scalar row to return (TS update returns the full
        // session). AsNoTracking: ExecuteUpdate is direct SQL (not tracked), so this reads the fresh persisted values.
        // Materialize the entity then map in memory (ToUtc is a custom method EF can't translate in a projection).
        var entity = await _db.CalibrationSessions.AsNoTracking()
            .FirstAsync(s => s.Id == sessionId && s.OrganizationId == orgId, cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return ToSessionRow(entity);
    }

    // Codex M2 (succession): match ONLY the calibration_members (session_id, user_id) unique constraint — a future
    // unique index or a PK collision must NOT be mislabeled as the documented duplicate-member 409 (it must propagate).
    private static bool IsMemberUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: MemberUniqueConstraint,
        };

    private static CalibrationMemberResultRow ToMemberRow(CalibrationMemberWriteEntity e) => new(
        e.Id.ToString(),
        e.SessionId.ToString(),
        e.UserId.ToString(),
        e.Status,
        ToUtc(e.CreatedAt));

    private static CalibrationSessionRow ToSessionRow(CalibrationSessionWriteEntity e) => new(
        e.Id.ToString(),
        e.OrganizationId.ToString(),
        e.Period,
        e.Status,
        e.ScheduledAt is { } scheduled ? ToUtc(scheduled) : null,
        e.CompletedAt is { } completed ? ToUtc(completed) : null,
        e.CreatedById.ToString(),
        ToUtc(e.CreatedAt),
        ToUtc(e.UpdatedAt));

    private static CalibrationSessionWithMembers ToSessionWithMembers(
        CalibrationSessionWriteEntity e, IReadOnlyList<CalibrationMemberResultRow> members) => new(
        e.Id.ToString(),
        e.OrganizationId.ToString(),
        e.Period,
        e.Status,
        e.ScheduledAt is { } scheduled ? ToUtc(scheduled) : null,
        e.CompletedAt is { } completed ? ToUtc(completed) : null,
        e.CreatedById.ToString(),
        ToUtc(e.CreatedAt),
        ToUtc(e.UpdatedAt),
        members);

    // Prisma `timestamp(3) without time zone` stores UTC wall-clock; Npgsql rejects a Kind=Utc DateTime for it, so
    // bind the UTC wall-clock as Unspecified-kind. Truncate to whole MILLISECONDS first so the value C# persists ==
    // what a JS `new Date()` (ms precision) persists (matches the succession/evaluation360 staff writes).
    private static DateTime ToTimestamp(DateTimeOffset value)
    {
        var utc = value.UtcDateTime;
        return DateTime.SpecifyKind(utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)), DateTimeKind.Unspecified);
    }

    // Re-kind a persisted Unspecified wall-clock UTC value to UTC so the shared Node-ISO converter emits `…fffZ`.
    private static DateTimeOffset ToUtc(DateTime value) => new(DateTime.SpecifyKind(value, DateTimeKind.Utc));
}
