using System.Text.Json.Serialization;

namespace Tims.Domain.People;

/// <summary>What a tenant people picker is choosing someone for.</summary>
public enum AssignablePurpose
{
    InterviewEvaluator,
    VacancyApprover,
    OfferApprover,
}

/// <summary>
/// The permission the CALLER must hold to open a picker, plus the permission an assignable person must
/// hold to be offered at all (null = any active member of the organization). Approver pickers list only
/// people the server's approve step can accept, so a picker never proposes someone the write will reject.
/// </summary>
public sealed record AssignablePurposeRule(
    string CallerModule,
    string CallerAction,
    string? EligibilityModule,
    string? EligibilityAction);

public static class AssignablePurposes
{
    public const int DefaultLimit = 25;
    public const int MaxLimit = 50;
    public const int MaxSearchLength = 100;

    private static readonly Dictionary<string, AssignablePurpose> ByWireName = new(StringComparer.Ordinal)
    {
        ["interview_evaluator"] = AssignablePurpose.InterviewEvaluator,
        ["vacancy_approver"] = AssignablePurpose.VacancyApprover,
        ["offer_approver"] = AssignablePurpose.OfferApprover,
    };

    /// <summary>Parses the exact snake_case wire value; anything else (including casing drift) is rejected.</summary>
    public static bool TryParse(string? value, out AssignablePurpose purpose)
    {
        purpose = default;
        return value is not null && ByWireName.TryGetValue(value, out purpose);
    }

    public static AssignablePurposeRule RuleFor(AssignablePurpose purpose) => purpose switch
    {
        // interview.schedule only requires the evaluators to be members of the organization.
        AssignablePurpose.InterviewEvaluator => new("interview", "create", null, null),
        AssignablePurpose.VacancyApprover => new("vacancy", "create", "vacancy", "approve"),
        AssignablePurpose.OfferApprover => new("offer", "create", "offer", "approve"),
        _ => throw new ArgumentOutOfRangeException(nameof(purpose), purpose, null),
    };
}

/// <summary>The minimal directory projection a picker needs — no phone, login, MFA or ownership fields.</summary>
public sealed record AssignablePerson(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? AvatarUrl,
    IReadOnlyList<string> RoleSlugs);

public sealed record AssignablePeopleResult(IReadOnlyList<AssignablePerson> People);
