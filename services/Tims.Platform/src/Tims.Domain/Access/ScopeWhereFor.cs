namespace Tims.Domain.Access;

/// <summary>
/// Thrown when a narrow scope (own/team/unit) is resolved without an anchor loader
/// (an org-less user). The TS <c>scopeWhereFor</c> raises <c>TRPCError({ code: 'FORBIDDEN' })</c>
/// here (entity-policies.ts) — fail closed, never silently unscoped. This is the C#
/// equivalent, pinned by the golden fixtures as an <c>expectError: "FORBIDDEN"</c> case.
/// </summary>
public sealed class ScopeAnchorMissingException : Exception
{
    public ScopeAnchorMissingException()
        : base("Sin contexto de organizacion para alcance restringido") { }
}

/// <summary>
/// Pure, loader-injected port of <c>scopeWhereFor</c>
/// (packages/api/src/access/entity-policies.ts): the ONE place that knows each
/// recruitment/people entity's anchor relations. Async and taking an
/// <see cref="IAnchorLoader"/> exactly as the TS function is async and takes the
/// <c>AnchorLoader</c> — which keeps this port faithful AND unit-testable with a stub
/// loader (zero DB). Returns a <see cref="ScopePredicate"/> whose JSON is byte-identical
/// to the Prisma <c>where</c> fragment TS emits.
///
/// organization/company scope → <see cref="ScopePredicate.MatchAll"/> (<c>{}</c>), the
/// deploy-safety invariant (pre-seed grants are org-equivalent, so this is behavior-neutral
/// until seed-access --apply runs) — and no anchor is consulted.
/// </summary>
public static class ScopeWhereFor
{
    public static async Task<ScopePredicate> BuildAsync(
        ScopedEntity entity,
        AccessScope scope,
        IAnchorLoader? anchors,
        string userId,
        CancellationToken ct = default)
    {
        // organization/company → {} early return, no anchor calls (deploy-safety invariant).
        if (scope is AccessScope.Organization or AccessScope.Company)
        {
            return ScopePredicate.MatchAll;
        }

        // Narrow scope (own/team/unit) but no anchor loader (org-less user) — fail closed.
        if (anchors is null)
        {
            throw new ScopeAnchorMissingException();
        }

        // --- shared fragment builders (mirror the TS locals) --------------------------------
        async Task<ScopePredicate> VacancyFragmentAsync() => scope switch
        {
            AccessScope.Team => new ScopePredicate.Or(new ScopePredicate[]
            {
                new ScopePredicate.FieldIn("teamId", await anchors.LedTeamIdsAsync(ct)),
                new ScopePredicate.FieldEquals("assignedTo", userId),
            }),
            AccessScope.Unit => new ScopePredicate.FieldIn("businessUnitId", await anchors.UnitIdsAsync(ct)),
            _ => new ScopePredicate.Or(new ScopePredicate[] // own
            {
                new ScopePredicate.FieldEquals("assignedTo", userId),
                new ScopePredicate.FieldEquals("createdBy", userId),
            }),
        };

        // NESTED vacancy relation filters must exclude soft-deleted vacancies (Codex F5),
        // otherwise a narrow scope could anchor visibility through a deleted vacancy.
        async Task<ScopePredicate> ViaVacancyAsync() => new ScopePredicate.RelationTo(
            "vacancy",
            new ScopePredicate.And(new ScopePredicate[]
            {
                await VacancyFragmentAsync(),
                new ScopePredicate.FieldEquals("deletedAt", null),
            }));

        // People entities anchor on the row's EMPLOYEE-user FIELD: own → scalar equality;
        // team → teamMemberIds `in`-list; unit → unitMemberIds `in`-list.
        async Task<ScopePredicate> SubjectAsync(string field) => scope switch
        {
            AccessScope.Own => new ScopePredicate.FieldEquals(field, userId),
            AccessScope.Team => new ScopePredicate.FieldIn(field, await anchors.TeamMemberIdsAsync(ct)),
            _ => new ScopePredicate.FieldIn(field, await anchors.UnitMemberIdsAsync(ct)), // unit
        };

        return entity switch
        {
            ScopedEntity.Vacancy => await VacancyFragmentAsync(),

            // No direct anchor on Candidate — visibility flows from the vacancies the user
            // can see, via that candidate's applications.
            ScopedEntity.Candidate => new ScopePredicate.RelationSome("applications", await ViaVacancyAsync()),

            // Panel arm: an assigned evaluator sees their interviews regardless of team; a
            // leader also sees team-vacancy interviews.
            ScopedEntity.Interview => scope == AccessScope.Own
                ? new ScopePredicate.RelationSome("evaluators", new ScopePredicate.FieldEquals("userId", userId))
                : new ScopePredicate.Or(new ScopePredicate[]
                {
                    await ViaVacancyAsync(),
                    new ScopePredicate.RelationSome("evaluators", new ScopePredicate.FieldEquals("userId", userId)),
                }),

            ScopedEntity.Application or ScopedEntity.Offer or ScopedEntity.AssessmentAssignment
                => await ViaVacancyAsync(),

            // People entities anchored on userId.
            ScopedEntity.Okr or ScopedEntity.Enrollment or ScopedEntity.Certificate
                or ScopedEntity.NineBoxEvaluation or ScopedEntity.Successor
                or ScopedEntity.EmployeeCompensation or ScopedEntity.SalaryAdjustment
                => await SubjectAsync("userId"),

            // Subject = coached employee; the coach (leaderId) always sees their sessions.
            ScopedEntity.CoachingSession => new ScopePredicate.Or(new ScopePredicate[]
            {
                await SubjectAsync("employeeId"),
                new ScopePredicate.FieldEquals("leaderId", userId),
            }),

            // Subject = committed employee; the creator (coach) always sees what they created.
            ScopedEntity.Commitment => new ScopePredicate.Or(new ScopePredicate[]
            {
                await SubjectAsync("employeeId"),
                new ScopePredicate.FieldEquals("createdById", userId),
            }),

            // Subject = recipient (toUserId); the giver (fromUserId) always sees what they authored.
            ScopedEntity.Feedback => new ScopePredicate.Or(new ScopePredicate[]
            {
                await SubjectAsync("toUserId"),
                new ScopePredicate.FieldEquals("fromUserId", userId),
            }),

            // Subject = new hire (userId); the assigned buddy always sees the plan.
            ScopedEntity.OnboardingPlan => new ScopePredicate.Or(new ScopePredicate[]
            {
                await SubjectAsync("userId"),
                new ScopePredicate.FieldEquals("buddyId", userId),
            }),

            // Anchored on the (nullable) current holder — an unfilled role is hidden from
            // narrow scopes (Prisma `in` never matches NULL; fail-narrow).
            ScopedEntity.CriticalRole => await SubjectAsync("currentHolderId"),

            // Teams the user leads (team/own) or the teams of their assigned units (unit).
            ScopedEntity.Team => scope == AccessScope.Unit
                ? new ScopePredicate.FieldIn("businessUnitId", await anchors.UnitIdsAsync(ct))
                : new ScopePredicate.FieldIn("id", await anchors.LedTeamIdsAsync(ct)),

            ScopedEntity.ActionPlan => await SubjectAsync("responsibleId"),

            ScopedEntity.LeaderCommitment => await SubjectAsync("leaderId"),

            // Enum-typed so unreachable, but keep the fail-closed default (matches the TS
            // `Entidad sin politica de alcance` guard).
            _ => throw new InvalidOperationException($"Entidad sin politica de alcance: {entity}"),
        };
    }
}
