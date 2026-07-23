using Microsoft.EntityFrameworkCore;
using Npgsql;
using Tims.Application.Evaluation360;
using Tims.Domain.Evaluation360;

namespace Tims.Infrastructure.Evaluation360;

/// <summary>
/// EF implementation of <see cref="IEvaluation360WriteRepository"/> — a faithful port of the write methods of the TS
/// <c>evaluation360.repository.ts</c>. Every operation runs UNDER <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant
/// + org GUC → RLS) with an EXPLICIT <c>organizationId</c> filter (defense-in-depth). The transitions + the submit
/// claim are guarded conditional <c>ExecuteUpdateAsync</c> (count 0 ⇒ the caller maps to CONFLICT — the TOCTOU guard).
/// assignRaters runs the status re-check + org-membership validation + the skipDuplicates ON CONFLICT insert in ONE
/// transaction; submitRatings runs the atomic claim + the 6-response insert in ONE transaction. The self-service
/// methods HARD-FILTER on <c>raterUserId</c> (= the caller) so an org-scoped admin can never write on another rater's
/// behalf.
/// </summary>
public sealed class Evaluation360WriteRepository(Evaluation360WriteDbContext db) : IEvaluation360WriteRepository
{
    private readonly Evaluation360WriteDbContext _db = db;

    public async Task<CreateCycleResult> CreateCycleAsync(
        string organizationId, Guid createdById, string name, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        var entity = new ReviewCycleWriteEntity
        {
            // Prisma @default(uuid()) is client-side generation — mint the id here (Prisma parity).
            Id = Guid.NewGuid(),
            OrganizationId = orgId,
            Name = name,
            Status = ReviewCycleStatusPg.Draft,
            OpensAt = null,
            ClosesAt = null,
            PublishedAt = null,
            CreatedById = createdById,
            // Prisma @default(now()) / @updatedAt are client-side — set both explicitly (parity + NOT NULL safety).
            CreatedAt = nowTs,
            UpdatedAt = nowTs,
        };

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        _db.ReviewCycles.Add(entity);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        // The repo select is { id, name, status, createdAt } — status is the DB label, createdAt the persisted ms-UTC.
        return new CreateCycleResult(entity.Id.ToString(), name, ReviewCycleStatusPg.Draft.Label(), ToUtc(nowTs));
    }

    // TS openCycle: updateMany {id, org, status:'draft'} set {status:'open', opensAt:now} (+ Prisma @updatedAt). The
    // `Status == 'draft'` predicate is the state-machine gate — count 0 ⇒ CONFLICT (absent, wrong org, or not draft).
    public async Task<bool> OpenCycleAsync(
        string organizationId, Guid cycleId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var count = await _db.ReviewCycles
            .Where(c => c.Id == cycleId && c.OrganizationId == orgId && c.Status == ReviewCycleStatusPg.Draft)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(c => c.Status, ReviewCycleStatusPg.Open)
                    .SetProperty(c => c.OpensAt, (DateTime?)nowTs)
                    .SetProperty(c => c.UpdatedAt, nowTs),
                cancellationToken)
            .ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return count > 0;
    }

    // TS closeCycle: updateMany {id, org, status:'open'} set {status:'closed', closesAt:now}. count 0 ⇒ CONFLICT.
    public async Task<bool> CloseCycleAsync(
        string organizationId, Guid cycleId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var count = await _db.ReviewCycles
            .Where(c => c.Id == cycleId && c.OrganizationId == orgId && c.Status == ReviewCycleStatusPg.Open)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(c => c.Status, ReviewCycleStatusPg.Closed)
                    .SetProperty(c => c.ClosesAt, (DateTime?)nowTs)
                    .SetProperty(c => c.UpdatedAt, nowTs),
                cancellationToken)
            .ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return count > 0;
    }

    // TS publishCycle: updateMany {id, org, status:'closed'} set {status:'published', publishedAt:now}. count 0 ⇒ CONFLICT.
    public async Task<bool> PublishCycleAsync(
        string organizationId, Guid cycleId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);
        var count = await _db.ReviewCycles
            .Where(c => c.Id == cycleId && c.OrganizationId == orgId && c.Status == ReviewCycleStatusPg.Closed)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(c => c.Status, ReviewCycleStatusPg.Published)
                    .SetProperty(c => c.PublishedAt, (DateTime?)nowTs)
                    .SetProperty(c => c.UpdatedAt, nowTs),
                cancellationToken)
            .ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return count > 0;
    }

    public async Task<AssignRatersDbResult> AssignRatersAsync(
        string organizationId,
        Guid cycleId,
        IReadOnlyList<RaterAssignmentInput> assignments,
        IReadOnlyList<string> expectedStatuses,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var expected = expectedStatuses.Select(ParseStatus).ToArray();
        var userIds = assignments
            .SelectMany(a => new[] { a.SubjectUserId, a.RaterUserId })
            .Distinct()
            .ToArray();

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // (1) Status re-check INSIDE the tx (TOCTOU-safe vs a concurrent closeCycle — no separate pre-read to race).
        var cycleOk = await _db.ReviewCycles
            .AnyAsync(
                c => c.Id == cycleId && c.OrganizationId == orgId && expected.Contains(c.Status),
                cancellationToken)
            .ConfigureAwait(false);
        if (!cycleOk)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new AssignRatersDbResult(CycleNotOpen: true, Array.Empty<string>(), Created: 0);
        }

        // (2) Org-membership validation: every distinct subject/rater id must be a users row in THIS org.
        var found = await _db.Users
            .AsNoTracking()
            .Where(u => userIds.Contains(u.Id) && u.OrganizationId == orgId)
            .Select(u => u.Id)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);
        var foundSet = found.ToHashSet();
        var missing = userIds.Where(id => !foundSet.Contains(id)).Select(id => id.ToString()).ToList();
        if (missing.Count > 0)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new AssignRatersDbResult(CycleNotOpen: false, missing, Created: 0);
        }

        // (3) createMany(skipDuplicates) → INSERT … SELECT … FROM unnest(...) ON CONFLICT DO NOTHING; the affected
        // row count is the created count (skipped duplicates are not counted — Postgres/Prisma parity).
        var created = await InsertAssignmentsAsync(orgId, cycleId, assignments, now, cancellationToken).ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new AssignRatersDbResult(CycleNotOpen: false, Array.Empty<string>(), created);
    }

    // Parameterized bulk INSERT with ON CONFLICT DO NOTHING (the Prisma createMany skipDuplicates equivalent). The
    // relationship label is cast to the native enum; status defaults to 'pending'; created_at/updated_at set to now.
    private async Task<int> InsertAssignmentsAsync(
        Guid orgId, Guid cycleId, IReadOnlyList<RaterAssignmentInput> assignments, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var nowTs = ToTimestamp(now);
        var ids = assignments.Select(_ => Guid.NewGuid()).ToArray();
        var subjects = assignments.Select(a => a.SubjectUserId).ToArray();
        var raters = assignments.Select(a => a.RaterUserId).ToArray();
        var relationships = assignments.Select(a => a.Relationship).ToArray();

        const string sql =
            """
            INSERT INTO rater_assignments
                (id, organization_id, cycle_id, subject_user_id, rater_user_id, relationship, status, created_at, updated_at)
            SELECT u.id, @org, @cyc, u.subj, u.rater, u.rel::"RaterRelationship", 'pending'::"RaterAssignmentStatus", @now, @now
            FROM unnest(@ids, @subjects, @raters, @rels) AS u(id, subj, rater, rel)
            ON CONFLICT (cycle_id, subject_user_id, rater_user_id) DO NOTHING
            """;

        return await _db.Database
            .ExecuteSqlRawAsync(
                sql,
                new object[]
                {
                    new NpgsqlParameter("org", orgId),
                    new NpgsqlParameter("cyc", cycleId),
                    new NpgsqlParameter("ids", ids),
                    new NpgsqlParameter("subjects", subjects),
                    new NpgsqlParameter("raters", raters),
                    new NpgsqlParameter("rels", relationships),
                    new NpgsqlParameter("now", nowTs),
                },
                cancellationToken)
            .ConfigureAwait(false);
    }

    public async Task<bool> AssignmentBelongsToRaterAsync(
        string organizationId, Guid raterUserId, Guid assignmentId, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Ownership pre-fetch — org AND rater scoped (a mismatch on ANY is indistinguishable → NOT_FOUND).
        var exists = await _db.RaterAssignments
            .AsNoTracking()
            .AnyAsync(
                a => a.Id == assignmentId && a.OrganizationId == orgId && a.RaterUserId == raterUserId,
                cancellationToken)
            .ConfigureAwait(false);

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return exists;
    }

    public async Task<bool> SubmitRatingsAsync(
        string organizationId,
        Guid raterUserId,
        Guid assignmentId,
        IReadOnlyList<RatingSubmissionInput> ratings,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Atomic claim: guarded on id + org + raterUserId (IDENTITY) + status='pending' + the cycle being OPEN.
        // count 0 ⇒ not claimable (already submitted / cycle not open / not the caller's) → CONFLICT at the caller.
        var claimed = await _db.RaterAssignments
            .Where(a =>
                a.Id == assignmentId &&
                a.OrganizationId == orgId &&
                a.RaterUserId == raterUserId &&
                a.Status == RaterAssignmentStatusPg.Pending &&
                _db.ReviewCycles.Any(c =>
                    c.Id == a.CycleId && c.OrganizationId == orgId && c.Status == ReviewCycleStatusPg.Open))
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(a => a.Status, RaterAssignmentStatusPg.Submitted)
                    .SetProperty(a => a.SubmittedAt, (DateTime?)nowTs)
                    .SetProperty(a => a.UpdatedAt, nowTs),
                cancellationToken)
            .ConfigureAwait(false);

        if (claimed == 0)
        {
            // Nothing was written (the guard matched 0 rows) — dispose without commit → rollback.
            return false;
        }

        // Only after a successful claim, INSERT the responses — within the SAME transaction so a failed insert rolls
        // the status flip back (atomicity).
        var responses = ratings.Select(r => new RaterResponseWriteEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = orgId,
            AssignmentId = assignmentId,
            CompetencyKey = r.CompetencyKey,
            Rating = r.Rating,
            Comment = r.Comment,
            CreatedAt = nowTs,
            UpdatedAt = nowTs,
        }).ToList();

        _db.RaterResponses.AddRange(responses);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return true;
    }

    private static ReviewCycleStatusPg ParseStatus(string label) => label switch
    {
        "draft" => ReviewCycleStatusPg.Draft,
        "open" => ReviewCycleStatusPg.Open,
        "closed" => ReviewCycleStatusPg.Closed,
        "published" => ReviewCycleStatusPg.Published,
        _ => throw new ArgumentOutOfRangeException(nameof(label), label, "unknown ReviewCycleStatus label"),
    };

    // Prisma `timestamp(3) without time zone` stores UTC wall-clock; Npgsql rejects a Kind=Utc DateTime for it, so
    // bind the UTC wall-clock as Unspecified-kind. Truncate to whole MILLISECONDS first so the value C# persists ==
    // what a JS `new Date()` (ms precision) persists (matches the compensation/external staff writes).
    private static DateTime ToTimestamp(DateTimeOffset value)
    {
        var utc = value.UtcDateTime;
        return DateTime.SpecifyKind(utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)), DateTimeKind.Unspecified);
    }

    // Re-kind a persisted Unspecified wall-clock UTC value to UTC so the shared Node-ISO converter emits `…fffZ`.
    private static DateTimeOffset ToUtc(DateTime value) => new(DateTime.SpecifyKind(value, DateTimeKind.Utc));
}
