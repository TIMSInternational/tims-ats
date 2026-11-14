namespace Tims.Infrastructure.FitEngine;

/// <summary>
/// Write-side EF entities for the FIT-engine slice — the READ projections <c>computeForVacancy</c> needs
/// (candidates / vacancies / job_profiles / assessment_assignments / assessment_results / ai_interview_sessions /
/// applications) plus <c>role_family_weight_profiles</c> for the profile find. The two UPSERTS
/// (<c>fit_scores</c>, <c>role_family_weight_profiles</c>) are raw <c>INSERT … ON CONFLICT</c> SQL, so
/// <c>fit_scores</c> needs no EF map here at all. <c>ai_interview_sessions.status</c> (a native enum) is
/// deliberately NOT mapped — only <c>fit_score</c>/<c>created_at</c> are read, so no unmapped-enum
/// materialisation (TRAP 3) can occur.
/// </summary>
public sealed class FitCandidateWriteEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    /// <summary>Read ONLY by the #312/#313 consent guard's normalized-email match (never projected out).</summary>
    public string Email { get; set; } = null!;

    public int? YearsExperience { get; set; }

    public string? Education { get; set; }

    public string? Languages { get; set; }

    public DateTime? DeletedAt { get; set; }
}

/// <summary>vacancies — roleFamily + soft-delete guard.</summary>
public sealed class FitVacancyWriteEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string? RoleFamily { get; set; }

    public DateTime? DeletedAt { get; set; }
}

/// <summary>job_profiles — the 1-1 vacancy profile carrying fitRequirements.</summary>
public sealed class FitJobProfileWriteEntity
{
    public Guid Id { get; set; }

    public Guid VacancyId { get; set; }

    public string? FitRequirements { get; set; }
}

/// <summary>assessment_assignments — the latest-completed lookup key set.</summary>
public sealed class FitAssessmentAssignmentWriteEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid CandidateId { get; set; }

    public Guid VacancyId { get; set; }

    /// <summary>Read ONLY by the FIT v2 native-quiz adapter (integrity: anything but 'completed' needs review).</summary>
    public string Status { get; set; } = null!;

    /// <summary>Read ONLY by the FIT v2 native-quiz adapter: which quiz (each quiz is judged on its own latest result).</summary>
    public Guid AssessmentTypeId { get; set; }

    public DateTime? CompletedAt { get; set; }
}

/// <summary>assessment_results — 1-1 on assignment_id; normalizedScore is nullable.</summary>
public sealed class FitAssessmentResultWriteEntity
{
    public Guid Id { get; set; }

    /// <summary>Read ONLY by the FIT v2 native-quiz adapter's explicit tenant filter.</summary>
    public Guid OrganizationId { get; set; }

    public Guid AssignmentId { get; set; }

    public double? NormalizedScore { get; set; }

    /// <summary>
    /// The jsonb <c>breakdown</c>, read ONLY by the FIT v2 native-quiz adapter for <c>pendingManual</c> (question ids
    /// awaiting manual grading). The TS submission writes <c>{ autoScored, pendingManual }</c> and completes the
    /// assignment in the same transaction, with <c>normalized_score</c> over the auto-scored questions only.
    /// </summary>
    public string? Breakdown { get; set; }
}

/// <summary>
/// proctoring_sessions — FIT v2 reads only <c>severity</c> (max of the staff-flagged events: low/medium/high/
/// critical), 1-1 on assignment_id. A high or critical session makes the result "needs review".
/// </summary>
public sealed class FitProctoringSessionReadEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid AssignmentId { get; set; }

    public string? Severity { get; set; }

    /// <summary>
    /// The review-completion signal (migration 20261109100000_fit_v2_integrity): unreviewed | clear | concern |
    /// inconclusive. Only <c>clear</c> releases a high/critical session's result.
    /// </summary>
    public string ReviewStatus { get; set; } = null!;
}

/// <summary>ai_interview_sessions — fitScore + createdAt only (status, a native enum, deliberately unmapped).</summary>
public sealed class FitAiInterviewSessionWriteEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid CandidateId { get; set; }

    public Guid VacancyId { get; set; }

    public int? FitScore { get; set; }

    public DateTime CreatedAt { get; set; }
}

/// <summary>applications — the active-pipeline candidate-id source (status is a plain String column).</summary>
public sealed class FitApplicationWriteEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid CandidateId { get; set; }

    public Guid VacancyId { get; set; }

    public string Status { get; set; } = null!;
}

/// <summary>
/// data_consents — the #312/#313 consent-guard subset (read-only here; CandidateConsentDbContext is the C# writer).
/// withdrawn_at is <c>timestamp</c> (TRAP 11), only ever compared to NULL.
/// </summary>
public sealed class FitDataConsentReadEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid SubjectUserId { get; set; }

    public string ConsentType { get; set; } = null!;

    public DateTime? WithdrawnAt { get; set; }
}
