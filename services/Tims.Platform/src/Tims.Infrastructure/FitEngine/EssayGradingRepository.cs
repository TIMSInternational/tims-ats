using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using NpgsqlTypes;
using Tims.Application.FitEngine;

namespace Tims.Infrastructure.FitEngine;

/// <summary>
/// Raw-SQL implementation of <see cref="IEssayGradingRepository"/> on the FIT write context (TenantScope for RLS).
/// Writes <c>assessment_responses</c> (points_awarded, is_correct, updated_at) and <c>assessment_results</c>
/// (breakdown.pendingManual / manualGrades, raw_score, normalized_score, updated_at); reads
/// <c>assessment_questions</c>. All three are Prisma-owned; see the ledger note <c>essay_grading_20261108</c>.
/// </summary>
public sealed class EssayGradingRepository(FitEngineWriteDbContext db) : IEssayGradingRepository
{
    private readonly FitEngineWriteDbContext _db = db;

    public async Task<Guid?> GetAssignmentVacancyAsync(
        Guid organizationId, Guid assignmentId, CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);
        var vacancyId = await _db.AssessmentAssignments.AsNoTracking()
            .Where(a => a.Id == assignmentId && a.OrganizationId == organizationId)
            .Select(a => (Guid?)a.VacancyId)
            .FirstOrDefaultAsync(cancellationToken)
            .ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return vacancyId;
    }

    public async Task<IReadOnlyList<PendingEssay>> GetPendingEssaysAsync(
        Guid organizationId, Guid assignmentId, CancellationToken cancellationToken)
    {
        const string sql =
            "SELECT q.id::text, q.prompt, coalesce(resp.free_text, ''), q.points "
            + "FROM assessment_results r "
            + "JOIN assessment_responses resp ON resp.assignment_id = r.assignment_id AND resp.organization_id = @org "
            + "JOIN assessment_questions q ON q.id = resp.question_id AND q.organization_id = @org "
            + "WHERE r.assignment_id = @a AND r.organization_id = @org "
            + "AND jsonb_typeof(r.breakdown -> 'pendingManual') = 'array' "
            + "AND (r.breakdown -> 'pendingManual') ? q.id::text "
            + "ORDER BY q.\"order\", q.id";

        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);
        var essays = new List<PendingEssay>();
        await using (var command = Command(sql))
        {
            command.Parameters.Add(new NpgsqlParameter("org", NpgsqlDbType.Uuid) { Value = organizationId });
            command.Parameters.Add(new NpgsqlParameter("a", NpgsqlDbType.Uuid) { Value = assignmentId });
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            while (await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                essays.Add(new PendingEssay(
                    reader.GetString(0), reader.GetString(1), reader.GetString(2), Convert.ToDouble(reader.GetValue(3))));
            }
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return essays;
    }

    public async Task<EssayGradeOutcome> GradeEssayAsync(
        Guid organizationId, Guid assignmentId, Guid questionId, double points, Guid gradedBy, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        await using var scope = await TenantScope.BeginAsync(_db, organizationId, cancellationToken)
            .ConfigureAwait(false);

        // 1. Lock the result row, then check the essay is still pending on it.
        const string lockSql =
            "SELECT (jsonb_typeof(r.breakdown -> 'pendingManual') = 'array' "
            + "AND (r.breakdown -> 'pendingManual') ? @q::text), "
            + "(SELECT q.points FROM assessment_questions q WHERE q.id = @q AND q.organization_id = @org), "
            + "EXISTS (SELECT 1 FROM assessment_responses resp JOIN assessment_questions q ON q.id = resp.question_id "
            + "WHERE resp.assignment_id = @a AND resp.organization_id = @org AND resp.points_awarded > q.points) "
            + "FROM assessment_results r WHERE r.assignment_id = @a AND r.organization_id = @org FOR UPDATE OF r";
        bool pending;
        double? maxPoints;
        bool questionsChanged;
        await using (var command = Command(lockSql))
        {
            AddIds(command, organizationId, assignmentId, questionId);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                return new EssayGradeOutcome(EssayGradeStatus.NotFound, 0, null);
            }

            pending = !reader.IsDBNull(0) && reader.GetBoolean(0);
            maxPoints = reader.IsDBNull(1) ? null : Convert.ToDouble(reader.GetValue(1));
            questionsChanged = reader.GetBoolean(2);
        }

        // The score is recomputed against the questions' CURRENT points. If a question was edited after submission
        // so that an awarded score now exceeds it, no honest score can be computed (it could pass 100): refuse, and
        // leave the result as it is (still needs review).
        if (questionsChanged)
        {
            return new EssayGradeOutcome(EssayGradeStatus.QuestionsChanged, 0, null);
        }

        if (!pending || maxPoints is null)
        {
            return new EssayGradeOutcome(EssayGradeStatus.NotPending, 0, null);
        }

        if (!double.IsFinite(points) || points < 0 || points > maxPoints.Value)
        {
            return new EssayGradeOutcome(EssayGradeStatus.PointsOutOfRange, 0, null);
        }

        // 2. The response's points (full marks count as correct), then the result: pendingManual minus the essay,
        //    the grade recorded, and the scores recomputed over every scored response (TS computeResult).
        //    Only the RESULT row is locked, so a question's points can change between step 1 and the aggregation
        //    (READ COMMITTED: each statement sees the latest commit). The aggregation is therefore a conditional write
        //    that re-checks, against ITS OWN snapshot, that no awarded score exceeds its question's points and that this
        //    essay's is_correct still matches them. If not, nothing is written (the transaction rolls back) and the grade
        //    is refused as questions_changed, so a stored score never exceeds 100 and the essay stays pending.
        const string responseSql =
            "UPDATE assessment_responses SET points_awarded = @p, is_correct = (@p >= @max), updated_at = @now "
            + "WHERE assignment_id = @a AND question_id = @q AND organization_id = @org";
        await using (var command = Command(responseSql))
        {
            AddIds(command, organizationId, assignmentId, questionId);
            command.Parameters.Add(new NpgsqlParameter("p", NpgsqlDbType.Double) { Value = points });
            command.Parameters.Add(new NpgsqlParameter("max", NpgsqlDbType.Double) { Value = maxPoints.Value });
            command.Parameters.Add(new NpgsqlParameter("now", NpgsqlDbType.Timestamp) { Value = ToTimestamp(now) });
            await command.ExecuteNonQueryAsync(cancellationToken).ConfigureAwait(false);
        }

        const string gradeSql =
            "UPDATE assessment_results r SET "
            + "breakdown = jsonb_set(jsonb_set(r.breakdown, '{pendingManual}', (r.breakdown -> 'pendingManual') - @q::text), "
            + "'{manualGrades}', coalesce(r.breakdown -> 'manualGrades', '{}'::jsonb) || jsonb_build_object(@q::text, "
            + "jsonb_build_object('points', @p, 'gradedBy', @by::text, 'gradedAt', @nowText))), "
            + "raw_score = s.raw, normalized_score = CASE WHEN s.maxp > 0 THEN s.raw / s.maxp * 100 END, "
            + "updated_at = @now "
            + "FROM (SELECT sum(resp.points_awarded) AS raw, sum(q.points)::double precision AS maxp, "
            + "coalesce(bool_or(resp.points_awarded > q.points OR (resp.question_id = @q "
            + "AND resp.is_correct IS DISTINCT FROM (resp.points_awarded >= q.points))), false) AS changed "
            + "FROM assessment_responses resp JOIN assessment_questions q ON q.id = resp.question_id "
            + "WHERE resp.assignment_id = @a AND resp.organization_id = @org AND resp.points_awarded IS NOT NULL) s "
            + "WHERE r.assignment_id = @a AND r.organization_id = @org AND NOT s.changed "
            + "RETURNING jsonb_array_length(r.breakdown -> 'pendingManual'), r.normalized_score";
        int remaining;
        double? normalized;
        await using (var command = Command(gradeSql))
        {
            AddIds(command, organizationId, assignmentId, questionId);
            command.Parameters.Add(new NpgsqlParameter("p", NpgsqlDbType.Double) { Value = points });
            command.Parameters.Add(new NpgsqlParameter("by", NpgsqlDbType.Uuid) { Value = gradedBy });
            command.Parameters.Add(new NpgsqlParameter("now", NpgsqlDbType.Timestamp) { Value = ToTimestamp(now) });
            command.Parameters.Add(new NpgsqlParameter("nowText", NpgsqlDbType.Text) { Value = now.UtcDateTime.ToString("O") });
            await using var reader = await command.ExecuteReaderAsync(cancellationToken).ConfigureAwait(false);
            if (!await reader.ReadAsync(cancellationToken).ConfigureAwait(false))
            {
                // The guard refused: a question changed under the grade. Not committing rolls back the response write.
                return new EssayGradeOutcome(EssayGradeStatus.QuestionsChanged, 0, null);
            }

            remaining = reader.GetInt32(0);
            normalized = reader.IsDBNull(1) ? null : reader.GetDouble(1);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
        return new EssayGradeOutcome(EssayGradeStatus.Graded, remaining, normalized);
    }

    private NpgsqlCommand Command(string sql) =>
        new(sql, (NpgsqlConnection)_db.Database.GetDbConnection(),
            (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction());

    private static void AddIds(NpgsqlCommand command, Guid organizationId, Guid assignmentId, Guid questionId)
    {
        command.Parameters.Add(new NpgsqlParameter("org", NpgsqlDbType.Uuid) { Value = organizationId });
        command.Parameters.Add(new NpgsqlParameter("a", NpgsqlDbType.Uuid) { Value = assignmentId });
        command.Parameters.Add(new NpgsqlParameter("q", NpgsqlDbType.Uuid) { Value = questionId });
    }

    private static DateTime ToTimestamp(DateTimeOffset value)
    {
        var utc = value.UtcDateTime;
        return DateTime.SpecifyKind(utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)), DateTimeKind.Unspecified);
    }
}
