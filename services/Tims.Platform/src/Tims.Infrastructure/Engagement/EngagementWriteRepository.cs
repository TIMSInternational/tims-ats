using System.Text.Json.Nodes;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Npgsql;
using Tims.Application.Engagement;
using Tims.Domain.Engagement;

namespace Tims.Infrastructure.Engagement;

/// <summary>
/// EF implementation of <see cref="IEngagementWriteRepository"/> — a faithful port of the data steps of the 5 TS
/// <c>engagement</c> mutations (inline <c>db.*</c> in the router). Every operation runs UNDER
/// <see cref="TenantScope"/> (SET LOCAL ROLE app_tenant + org GUC → RLS) with an EXPLICIT <c>organizationId</c>
/// filter/value (defense-in-depth). Client-set id (<c>Guid.NewGuid()</c>) + createdAt/updatedAt/submittedAt (all
/// explicit) — Prisma <c>@default(uuid())</c> / <c>@default(now())</c> / <c>@updatedAt</c> are client-side.
/// submitSurveyResponse stamps <c>userId = caller</c> server-side (identity anchor, engagement.ts:277) and maps the
/// <c>@@unique([surveyId, userId])</c> violation (23505) → <see cref="SubmitSurveyResponseOutcome.Conflict"/>. The
/// survey active-gate not-found → <see cref="SubmitSurveyResponseOutcome.SurveyNotActive"/> (the documented clean-404
/// improvement over the TS plain-Error 500). createActionPlan / updateActionPlan(reassign) prove the
/// <c>responsibleId</c> is in the caller's org BEFORE the write (the H1 backstop — assertSubjectInScope no-ops for
/// org/company scope). activate/update load the tracked row {id, org} — null ⇒ null (TOCTOU → 404 at the caller).
/// </summary>
public sealed class EngagementWriteRepository(EngagementWriteDbContext db) : IEngagementWriteRepository
{
    private const string SurveyResponseUniqueConstraint = "survey_responses_survey_id_user_id_key";

    private readonly EngagementWriteDbContext _db = db;

    public async Task<SurveyRow> CreateSurveyAsync(
        string organizationId, Guid callerId, CreateSurveyInput input, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        var entity = new SurveyWriteEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = orgId,
            Title = input.Title,
            Type = input.Type,
            Status = "draft",
            Questions = input.Questions.ToJsonString(),
            // targetGroups is stored as opaque jsonb WITHOUT in-org validation (spec §2.2 LOW — a faithful port).
            TargetGroups = input.TargetGroups?.ToJsonString(),
            StartsAt = input.StartsAt is { } s ? ToTimestamp(s) : null,
            EndsAt = input.EndsAt is { } e ? ToTimestamp(e) : null,
            ResponseCount = 0,
            // Anti-forgery: createdById is ALWAYS the resolved caller (engagement.ts:101), never from input.
            CreatedById = callerId,
            CreatedAt = nowTs,
            UpdatedAt = nowTs,
        };

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        _db.Surveys.Add(entity);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        // Echo the in-memory jsonb nodes (the input) — matches Prisma returning the created row's questions/targetGroups.
        return ToSurveyRow(entity, input.Questions, input.TargetGroups);
    }

    public async Task<ActivateSurveyResult?> ActivateSurveyAsync(
        string organizationId, Guid surveyId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // findFirst {id, org} — null ⇒ 404 (missing / cross-org, RLS-hidden). Loaded tracked so the update carries the
        // same {id AND organization_id} guard (a concurrent org change can't slip; RLS also guards org).
        var entity = await _db.Surveys
            .FirstOrDefaultAsync(s => s.Id == surveyId && s.OrganizationId == orgId, cancellationToken)
            .ConfigureAwait(false);
        if (entity is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return null;
        }

        entity.Status = "active";
        // startsAt = existing.startsAt ?? now (preserve a prior startsAt, else stamp now) — engagement.ts:117.
        entity.StartsAt ??= nowTs;
        entity.UpdatedAt = nowTs;
        try
        {
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Concurrently deleted between load and SaveChanges (TOCTOU) → the same 404, never a 500.
            return null;
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new ActivateSurveyResult(entity.Id.ToString(), entity.Status);
    }

    public async Task<SubmitSurveyResponseResult> SubmitSurveyResponseAsync(
        string organizationId, Guid callerId, SubmitSurveyResponseInput input, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Existence/active gate: surveys {id, org, status='active'} — absent ⇒ SurveyNotActive. Documented port
        // improvement: the TS surfaces this as a plain-Error 500; the C# maps it to a clean, leak-free 404.
        var active = await _db.Surveys
            .AsNoTracking()
            .AnyAsync(
                s => s.Id == input.SurveyId && s.OrganizationId == orgId && s.Status == "active", cancellationToken)
            .ConfigureAwait(false);
        if (!active)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new SubmitSurveyResponseResult(SubmitSurveyResponseOutcome.SurveyNotActive, null);
        }

        var entity = new SurveyResponseWriteEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = orgId,
            SurveyId = input.SurveyId,
            // IDENTITY anchor: userId is ALWAYS the resolved caller (engagement.ts:277), NEVER from input — an
            // org-admin cannot forge another user's response.
            UserId = callerId,
            Answers = input.Answers.ToJsonString(),
            SubmittedAt = nowTs,
        };

        _db.SurveyResponses.Add(entity);

        try
        {
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateException ex) when (IsUniqueViolation(ex))
        {
            // TS P2002 (unique surveyId,userId) → CONFLICT "Ya respondiste esta encuesta". Atomic: the scope disposes
            // WITHOUT commit → the INSERT rolls back, so NO duplicate row is created.
            return new SubmitSurveyResponseResult(SubmitSurveyResponseOutcome.Conflict, null);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new SubmitSurveyResponseResult(
            SubmitSurveyResponseOutcome.Created,
            new SubmitSurveyResponseRow(entity.Id.ToString(), ToUtc(entity.SubmittedAt)));
    }

    public async Task<ActionPlanWriteRow?> CreateActionPlanAsync(
        string organizationId, CreateActionPlanInput input, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // H1 (both-stacks hardening): assertSubjectInScope no-ops for organization/company scope, so an org-scoped
        // caller could otherwise persist a cross-tenant responsibleId (a bare FK to users — the FK checks EXISTS in
        // ANY org; RLS WITH CHECK on action_plans guards only organization_id). Prove the responsible user is in the
        // caller's org AUTHORITATIVELY here — this same-txn lookup is RLS-filtered to the org, so a cross-org
        // responsibleId returns false ⇒ null (→ 403). Fixed in BOTH stacks (engagement.ts) to keep parity + ship the
        // prod hardening.
        if (!await ResponsibleInOrgAsync(orgId, input.ResponsibleId, cancellationToken).ConfigureAwait(false))
        {
            return null;
        }

        var entity = new ActionPlanWriteEntity
        {
            Id = Guid.NewGuid(),
            OrganizationId = orgId,
            Title = input.Title,
            ResponsibleId = input.ResponsibleId,
            Area = input.Area,
            Status = "pending",
            DueDate = input.DueDate is { } d ? ToTimestamp(d) : null,
            // actions has no create input (Prisma leaves it NULL).
            Actions = null,
            Notes = input.Notes,
            CreatedAt = nowTs,
            UpdatedAt = nowTs,
        };

        _db.ActionPlans.Add(entity);
        await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return ToActionPlanRow(entity);
    }

    public async Task<UpdateActionPlanResult> UpdateActionPlanAsync(
        string organizationId, Guid actionPlanId, UpdateActionPlanInput input,
        string scopePredicateSql, IReadOnlyList<object> scopeParameters, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var orgId = Guid.Parse(organizationId);
        var nowTs = ToTimestamp(now);

        await using var scope = await TenantScope.BeginAsync(_db, orgId, cancellationToken).ConfigureAwait(false);

        // Codex HIGH (both stacks): the endpoint's assertScoped probe and this UPDATE previously ran in SEPARATE
        // transactions — a concurrent reassignment could move the row's responsible_id out of the caller's narrow
        // scope BETWEEN the probe and the write, and the write (reloading by id+org only) would still apply. Re-check
        // the caller's scope predicate ATOMICALLY here with FOR UPDATE, on THIS TenantScope txn: a concurrent
        // reassignment is either already visible (predicate → 0 rows → 404) or blocks on the row lock until we commit.
        // The predicate is the caller's materialized subject set (built in the endpoint from the SAME scope + anchors
        // as the probe; org/company scope → TRUE, a no-op). Mirrors the nine-box vote atomic guard (#172).
        if (!await RowInScopeForUpdateAsync(orgId, actionPlanId, scopePredicateSql, scopeParameters, cancellationToken)
                .ConfigureAwait(false))
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new UpdateActionPlanResult(UpdateActionPlanOutcome.NotFound, null);
        }

        // H1 (both-stacks): a reassignment must target a user in the caller's org (assertSubjectInScope no-ops for
        // org/company scope). Validate BEFORE the UPDATE — not-in-org ⇒ ResponsibleNotInOrg (→ 403), no reassignment
        // persisted. Fixed in BOTH stacks (engagement.ts).
        if (input.ResponsibleId is { } responsibleId
            && !await ResponsibleInOrgAsync(orgId, responsibleId, cancellationToken).ConfigureAwait(false))
        {
            return new UpdateActionPlanResult(UpdateActionPlanOutcome.ResponsibleNotInOrg, null);
        }

        var entity = await _db.ActionPlans
            .FirstOrDefaultAsync(a => a.Id == actionPlanId && a.OrganizationId == orgId, cancellationToken)
            .ConfigureAwait(false);
        if (entity is null)
        {
            await scope.CommitAsync(cancellationToken).ConfigureAwait(false);
            return new UpdateActionPlanResult(UpdateActionPlanOutcome.NotFound, null);
        }

        // TS spread `data: { title?, notes?, status?, responsibleId?, ...dueDate-tri-state }` — an ABSENT optional key
        // is skipped by Prisma (never nulled); dueDate: absent = unchanged, null = CLEAR, value = set (engagement.ts:559).
        if (input.HasTitle)
        {
            entity.Title = input.Title!;
        }

        if (input.HasNotes)
        {
            entity.Notes = input.Notes;
        }

        if (input.HasStatus)
        {
            entity.Status = input.Status!;
        }

        if (input.ResponsibleId is { } newResponsible)
        {
            entity.ResponsibleId = newResponsible;
        }

        if (input.HasDueDate)
        {
            entity.DueDate = input.DueDate is { } dueDate ? ToTimestamp(dueDate) : null;
        }

        entity.UpdatedAt = nowTs;
        try
        {
            await _db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (DbUpdateConcurrencyException)
        {
            // Concurrently deleted between load and SaveChanges (TOCTOU) → 404, never a 500.
            return new UpdateActionPlanResult(UpdateActionPlanOutcome.NotFound, null);
        }

        await scope.CommitAsync(cancellationToken).ConfigureAwait(false);

        return new UpdateActionPlanResult(UpdateActionPlanOutcome.Updated, ToActionPlanRow(entity));
    }

    // The H1 in-org existence check on responsibleId — RLS-filtered to the caller's org under the active TenantScope,
    // with an explicit organization_id filter (defense-in-depth). A cross-org id returns false.
    private Task<bool> ResponsibleInOrgAsync(Guid orgId, Guid responsibleId, CancellationToken cancellationToken) =>
        _db.Users.AsNoTracking()
            .AnyAsync(u => u.Id == responsibleId && u.OrganizationId == orgId, cancellationToken);

    // Atomic in-scope row lock (Codex HIGH) — SELECT 1 ... FOR UPDATE re-evaluating the caller's scope predicate
    // against the row's CURRENT responsible_id, on THIS repo's TenantScope connection/transaction (the identical
    // primitive to ScopedProbe, but FOR UPDATE and inside the write txn). Identifiers are fixed ("action_plans" +
    // the registry columns baked into scopePredicateSql — never user input); every id/value is a bound parameter
    // (@id / @org / @p0…). Returns false → the row is out of the caller's scope or gone (→ 404, no mutation).
    private async Task<bool> RowInScopeForUpdateAsync(
        Guid orgId, Guid actionPlanId, string scopePredicateSql, IReadOnlyList<object> scopeParameters,
        CancellationToken cancellationToken)
    {
        var sql = "SELECT 1 FROM action_plans t "
            + "WHERE t.id = @id AND t.organization_id = @org "
            + $"AND ({scopePredicateSql}) FOR UPDATE";

        var connection = (NpgsqlConnection)_db.Database.GetDbConnection();
        var transaction = (NpgsqlTransaction)_db.Database.CurrentTransaction!.GetDbTransaction();

        await using var command = new NpgsqlCommand(sql, connection, transaction);
        command.Parameters.AddWithValue("id", actionPlanId);
        command.Parameters.AddWithValue("org", orgId);
        for (var i = 0; i < scopeParameters.Count; i++)
        {
            command.Parameters.AddWithValue($"p{i}", scopeParameters[i]);
        }

        return await command.ExecuteScalarAsync(cancellationToken).ConfigureAwait(false) is not null;
    }

    // Match ONLY the survey_responses (survey_id, user_id) unique constraint — a future/unexpected unique index or a
    // PK collision must NOT be mislabeled as the documented duplicate-response 409 (it must propagate).
    private static bool IsUniqueViolation(DbUpdateException ex) =>
        ex.InnerException is PostgresException
        {
            SqlState: PostgresErrorCodes.UniqueViolation,
            ConstraintName: SurveyResponseUniqueConstraint,
        };

    private static SurveyRow ToSurveyRow(SurveyWriteEntity e, JsonNode questions, JsonNode? targetGroups) => new(
        e.Id.ToString(),
        e.OrganizationId.ToString(),
        e.Title,
        e.Type,
        e.Status,
        questions,
        targetGroups,
        ToUtcNullable(e.StartsAt),
        ToUtcNullable(e.EndsAt),
        e.ResponseCount,
        e.CreatedById.ToString(),
        ToUtc(e.CreatedAt),
        ToUtc(e.UpdatedAt));

    private static ActionPlanWriteRow ToActionPlanRow(ActionPlanWriteEntity e) => new(
        e.Id.ToString(),
        e.OrganizationId.ToString(),
        e.Title,
        e.ResponsibleId.ToString(),
        e.Area,
        e.Status,
        ToUtcNullable(e.DueDate),
        e.Actions is null ? null : JsonNode.Parse(e.Actions),
        e.Notes,
        ToUtc(e.CreatedAt),
        ToUtc(e.UpdatedAt));

    // Prisma `timestamp(3) without time zone` stores UTC wall-clock; Npgsql rejects a Kind=Utc DateTime for it, so
    // bind the UTC wall-clock as Unspecified-kind. Truncate to whole MILLISECONDS first so the value C# persists ==
    // what a JS `new Date()` (ms precision) persists (matches the succession/compensation staff writes).
    private static DateTime ToTimestamp(DateTimeOffset value)
    {
        var utc = value.UtcDateTime;
        return DateTime.SpecifyKind(utc.AddTicks(-(utc.Ticks % TimeSpan.TicksPerMillisecond)), DateTimeKind.Unspecified);
    }

    // Re-kind a persisted Unspecified wall-clock UTC value to UTC so the shared Node-ISO converter emits `…fffZ`.
    private static DateTimeOffset ToUtc(DateTime value) => new(DateTime.SpecifyKind(value, DateTimeKind.Utc));

    private static DateTimeOffset? ToUtcNullable(DateTime? value) => value is { } v ? ToUtc(v) : null;
}
