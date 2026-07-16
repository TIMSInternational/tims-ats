namespace Tims.Domain.Access;

/// <summary>
/// The 21 recruitment/people entities that carry a per-entity scope policy, ported 1:1
/// from the <c>ScopedEntity</c> union + <c>ENTITIES</c> set in
/// packages/api/src/access/entity-policies.ts. Members are PascalCase; the wire form
/// (<see cref="ScopedEntities.ToWire"/>) is the camelCase TS string.
/// </summary>
public enum ScopedEntity
{
    Vacancy,
    Candidate,
    Application,
    Interview,
    Offer,
    AssessmentAssignment,
    Okr,
    CoachingSession,
    Feedback,
    OnboardingPlan,
    Enrollment,
    Certificate,
    NineBoxEvaluation,
    Successor,
    CriticalRole,
    EmployeeCompensation,
    SalaryAdjustment,
    Team,
    ActionPlan,
    LeaderCommitment,
    Commitment,
}

public static class ScopedEntities
{
    /// <summary>The wire/DB string form (camelCase), matching the TS <c>ScopedEntity</c> union values.</summary>
    public static string ToWire(this ScopedEntity entity) => entity switch
    {
        ScopedEntity.Vacancy => "vacancy",
        ScopedEntity.Candidate => "candidate",
        ScopedEntity.Application => "application",
        ScopedEntity.Interview => "interview",
        ScopedEntity.Offer => "offer",
        ScopedEntity.AssessmentAssignment => "assessmentAssignment",
        ScopedEntity.Okr => "okr",
        ScopedEntity.CoachingSession => "coachingSession",
        ScopedEntity.Feedback => "feedback",
        ScopedEntity.OnboardingPlan => "onboardingPlan",
        ScopedEntity.Enrollment => "enrollment",
        ScopedEntity.Certificate => "certificate",
        ScopedEntity.NineBoxEvaluation => "nineBoxEvaluation",
        ScopedEntity.Successor => "successor",
        ScopedEntity.CriticalRole => "criticalRole",
        ScopedEntity.EmployeeCompensation => "employeeCompensation",
        ScopedEntity.SalaryAdjustment => "salaryAdjustment",
        ScopedEntity.Team => "team",
        ScopedEntity.ActionPlan => "actionPlan",
        ScopedEntity.LeaderCommitment => "leaderCommitment",
        ScopedEntity.Commitment => "commitment",
        _ => throw new ArgumentOutOfRangeException(nameof(entity), entity, "Unknown ScopedEntity"),
    };

    /// <summary>
    /// Mirrors the TS <c>ENTITIES</c> set membership test: a known camelCase wire string
    /// parses to its enum member; anything else returns false ("never trust DB strings").
    /// </summary>
    public static bool TryParse(string? value, out ScopedEntity entity)
    {
        switch (value)
        {
            case "vacancy": entity = ScopedEntity.Vacancy; return true;
            case "candidate": entity = ScopedEntity.Candidate; return true;
            case "application": entity = ScopedEntity.Application; return true;
            case "interview": entity = ScopedEntity.Interview; return true;
            case "offer": entity = ScopedEntity.Offer; return true;
            case "assessmentAssignment": entity = ScopedEntity.AssessmentAssignment; return true;
            case "okr": entity = ScopedEntity.Okr; return true;
            case "coachingSession": entity = ScopedEntity.CoachingSession; return true;
            case "feedback": entity = ScopedEntity.Feedback; return true;
            case "onboardingPlan": entity = ScopedEntity.OnboardingPlan; return true;
            case "enrollment": entity = ScopedEntity.Enrollment; return true;
            case "certificate": entity = ScopedEntity.Certificate; return true;
            case "nineBoxEvaluation": entity = ScopedEntity.NineBoxEvaluation; return true;
            case "successor": entity = ScopedEntity.Successor; return true;
            case "criticalRole": entity = ScopedEntity.CriticalRole; return true;
            case "employeeCompensation": entity = ScopedEntity.EmployeeCompensation; return true;
            case "salaryAdjustment": entity = ScopedEntity.SalaryAdjustment; return true;
            case "team": entity = ScopedEntity.Team; return true;
            case "actionPlan": entity = ScopedEntity.ActionPlan; return true;
            case "leaderCommitment": entity = ScopedEntity.LeaderCommitment; return true;
            case "commitment": entity = ScopedEntity.Commitment; return true;
            default: entity = ScopedEntity.Vacancy; return false;
        }
    }
}
