using Tims.Domain.Access;

namespace Tims.Domain.People;

/// <summary>What a tenant people picker is choosing someone for.</summary>
public enum AssignablePurpose
{
    InterviewEvaluator,
    VacancyApprover,
    OfferApprover,
}

/// <summary>
/// The permission the CALLER must hold to open a picker — the permission of the mutation the picker feeds —
/// plus the permission an assignable person must hold to be offered at all (null = any active member of the
/// organization; see <see cref="AssignablePurposes.CallerScopeAllows"/>). Eligibility is PERMISSION-based
/// only: it is not scope-aware. A scope-limited approver (e.g. a leader holding offer:approve at team scope)
/// is listed even for a record outside their scope; the submit step re-checks each approver's scope against
/// the specific record and rejects the submission with a user-visible error instead of storing an approver
/// who could never act.
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

    /// <remarks>
    /// Caller gates follow the tRPC mutation each picker feeds:
    /// <list type="bullet">
    ///   <item><description>interview_evaluator → interview:create (<c>interview.schedule</c>). The evaluators modal
    ///   feeds <c>interview.addEvaluator</c>, which needs interview:update; not split, because the org-wide callers
    ///   <see cref="CallerScopeAllows"/> admits hold both in seed-access-matrix.ts (super_admin, hr_admin,
    ///   recruiter) — the two only differ at team/unit scope, which is refused here anyway.</description></item>
    ///   <item><description>vacancy_approver → vacancy:update (<c>vacancy.submitForApproval</c>).</description></item>
    ///   <item><description>offer_approver → offer:create (<c>offer.submitForApproval</c> accepts offer:update OR
    ///   offer:create; every matrix holder of offer:update also holds offer:create).</description></item>
    /// </list>
    /// interview.schedule only requires the evaluators to be members of the organization.
    /// </remarks>
    public static AssignablePurposeRule RuleFor(AssignablePurpose purpose) => purpose switch
    {
        AssignablePurpose.InterviewEvaluator => new("interview", "create", null, null),
        AssignablePurpose.VacancyApprover => new("vacancy", "update", "vacancy", "approve"),
        AssignablePurpose.OfferApprover => new("offer", "create", "offer", "approve"),
        _ => throw new ArgumentOutOfRangeException(nameof(purpose), purpose, null),
    };

    /// <summary>
    /// Whether the caller's resolved scope for the picker permission is enough to see the list. A purpose with no
    /// eligibility permission lists EVERY active member of the organization — the whole staff directory — so it
    /// requires an org-wide (organization/company) grant: a team/unit-scoped holder (leader, committee, hrbp for
    /// interview:create) is refused rather than shown people outside their scope. Filtering to the caller's team or
    /// unit instead would silently hide evaluators the mutation accepts (interview.schedule takes any org member).
    /// Approver purposes list only holders of the approve permission, which a narrow-scoped submitter (hrbp for
    /// vacancy:update) legitimately needs to choose from, so any granted scope suffices there.
    /// </summary>
    public static bool CallerScopeAllows(AssignablePurposeRule rule, AccessScope callerScope) =>
        rule.EligibilityModule is not null || callerScope is AccessScope.Organization or AccessScope.Company;
}

/// <summary>
/// The minimal directory projection a picker needs — no phone, login, MFA, ownership or role fields.
/// <c>avatarUrl</c> is always emitted (null when absent), matching the contract's required + nullable shape.
/// </summary>
public sealed record AssignablePerson(
    Guid Id,
    string FirstName,
    string LastName,
    string Email,
    string? AvatarUrl);

public sealed record AssignablePeopleResult(IReadOnlyList<AssignablePerson> People);
