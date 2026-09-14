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

    public DateTime? CompletedAt { get; set; }
}

/// <summary>assessment_results — 1-1 on assignment_id; normalizedScore is nullable.</summary>
public sealed class FitAssessmentResultWriteEntity
{
    public Guid Id { get; set; }

    public Guid AssignmentId { get; set; }

    public double? NormalizedScore { get; set; }
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
