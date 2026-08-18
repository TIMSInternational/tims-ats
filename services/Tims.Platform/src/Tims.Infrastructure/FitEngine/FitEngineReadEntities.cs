namespace Tims.Infrastructure.FitEngine;

/// <summary>
/// Read-side EF entities for the FIT-engine slice — subset column maps only (no navigation properties, per the
/// slice convention). Jsonb columns are strings; timestamps are pinned <c>timestamp</c> (Unspecified-kind
/// wall-clock UTC).
/// </summary>
public sealed class FitScoreReadEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public Guid CandidateId { get; set; }

    public Guid VacancyId { get; set; }

    public double OverallScore { get; set; }

    public string Breakdown { get; set; } = null!;

    public bool IsPartial { get; set; }

    public DateTime CalculatedAt { get; set; }
}

/// <summary>candidates — names only (the ranking/explain joins).</summary>
public sealed class FitCandidateReadEntity
{
    public Guid Id { get; set; }

    public string FirstName { get; set; } = null!;

    public string LastName { get; set; } = null!;
}

/// <summary>vacancies — title only (the explain join).</summary>
public sealed class FitVacancyReadEntity
{
    public Guid Id { get; set; }

    public string Title { get; set; } = null!;
}

/// <summary>role_family_weight_profiles — the list/select projection.</summary>
public sealed class WeightProfileReadEntity
{
    public Guid Id { get; set; }

    public Guid OrganizationId { get; set; }

    public string Name { get; set; } = null!;

    public string Weights { get; set; } = null!;
}
