using Tims.Domain.Access;
using Tims.Domain.Identity;

namespace Tims.Domain.People;

/// <summary>What a tenant people picker is choosing someone for.</summary>
public enum AssignablePurpose
{
    InterviewEvaluator,
    VacancyApprover,
    OfferApprover,
    VacancyAssignee,
    /// <summary>A recipient of peer feedback / recognition (protectedProcedure — cross-team by design).</summary>
    Colleague,
    /// <summary>The employee of an OKR, coaching session or commitment (performance:create, subject-scoped).</summary>
    PerformanceSubject,
    /// <summary>The user enrolled in a course (learning.enrollUser — learning:create, subject-scoped).</summary>
    LearningEnrollee,
    /// <summary>The new hire of an onboarding plan (onboarding.create — onboarding:create, subject-scoped).</summary>
    OnboardingHire,
    /// <summary>A proposed successor for a critical role (succession add successor — succession:create, subject-scoped).</summary>
    SuccessionCandidate,
    /// <summary>A 360 subject or rater (evaluation360 assign raters — evaluation360:create, org-wide).</summary>
    Evaluation360Participant,
    /// <summary>A nine-box calibration committee member (ninebox add member — ninebox:update, org-wide).</summary>
    NineBoxCommitteeMember,
    /// <summary>A person placed in the org structure (team member, unit assignee, unit — user:create, org-wide).</summary>
    OrgStructureMember,
}

/// <summary>
/// The permission the CALLER must hold to open a picker — the permission of the mutation the picker feeds
/// (null = no permission: any staff member, see <see cref="AssignablePurposes.IsAnyStaffMember"/>) —
/// plus the permission an assignable person must hold to be offered at all (null = any active member of the
/// organization; see <see cref="AssignablePurposes.CallerScopeAllows"/>). <c>SubjectScoped</c> marks a picker
/// whose mutation runs <c>assertSubjectInScope</c> on the picked person: a narrow-scoped caller is then shown
/// only their subject set (own → self, team → members of teams they lead, unit → members of their units)
/// instead of being refused. <c>StaffOnly</c> lists only people holding at least one ACTIVE staff role in the
/// organization, so a non-staff principal (external validator) is never enumerated by a whole-directory picker.
/// The four recruitment purposes predate it and keep listing every active member (interview.schedule and
/// vacancy.create accept any member). Eligibility is PERMISSION-based
/// only: it is not scope-aware. A scope-limited approver (e.g. a leader holding offer:approve at team scope)
/// is listed even for a record outside their scope; the submit step re-checks each approver's scope against
/// the specific record and rejects the submission with a user-visible error instead of storing an approver
/// who could never act.
/// </summary>
public sealed record AssignablePurposeRule(
    string? CallerModule,
    string? CallerAction,
    string? EligibilityModule,
    string? EligibilityAction,
    bool SubjectScoped = false,
    bool StaffOnly = false);

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
        ["vacancy_assignee"] = AssignablePurpose.VacancyAssignee,
        ["colleague"] = AssignablePurpose.Colleague,
        ["performance_subject"] = AssignablePurpose.PerformanceSubject,
        ["learning_enrollee"] = AssignablePurpose.LearningEnrollee,
        ["onboarding_hire"] = AssignablePurpose.OnboardingHire,
        ["succession_candidate"] = AssignablePurpose.SuccessionCandidate,
        ["evaluation360_participant"] = AssignablePurpose.Evaluation360Participant,
        ["ninebox_committee_member"] = AssignablePurpose.NineBoxCommitteeMember,
        ["org_structure_member"] = AssignablePurpose.OrgStructureMember,
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
    ///   <item><description>vacancy_assignee → vacancy:create (the wizard's "hiring manager", written as
    ///   <c>vacancy.create</c>'s <c>assignedTo</c>). Any active member is a valid assignee (org-placement.ts checks
    ///   only that), so there is no eligibility filter — which makes it the staff directory, so
    ///   <see cref="CallerScopeAllows"/> requires org-wide scope (recruiter, hr_admin, super_admin). A team-scoped
    ///   leader creating a vacancy is refused this picker, exactly as the legacy tRPC <c>user.list</c> refuses them.
    ///   It is deliberately NOT <c>vacancy_approver</c>: a hiring manager need not hold vacancy:approve, and that
    ///   purpose is gated on vacancy:update, which a vacancy creator (leader) may lack.</description></item>
    ///   <item><description>colleague → NO permission (<c>performance.submitFeedback</c> / <c>giveRecognition</c> are
    ///   protectedProcedure and deliberately unprobed: peer feedback is company-wide by design, feedback.ts). Any
    ///   resolved STAFF member — or a platform owner with a home organization, privileged like super_admin — may list
    ///   the directory; a principal with no staff role (external) is refused. Also
    ///   used for pickers whose field the mutation accepts as any org member (onboarding buddy, coaching leader).</description></item>
    ///   <item><description>performance_subject → performance:create (createOkr / createCoachingSession / createCommitment,
    ///   each assertSubjectInScope on the employee).</description></item>
    ///   <item><description>learning_enrollee → learning:create (learning.enrollUser, assertSubjectInScope).</description></item>
    ///   <item><description>onboarding_hire → onboarding:create (onboarding.create, assertSubjectInScope on userId).</description></item>
    ///   <item><description>succession_candidate → succession:create (C# AddSuccessor, SubjectInScope on the successor).</description></item>
    ///   <item><description>evaluation360_participant → evaluation360:create (C# AssignRaters; its gate requires org scope).</description></item>
    ///   <item><description>ninebox_committee_member → ninebox:update (C# AddCommitteeMember; org/company scope only).</description></item>
    ///   <item><description>org_structure_member → user:create (team member / unit assignee PUTs, organization.assignUserToUnit;
    ///   the user→unit PUT is user:update, held by exactly the same seed-access-matrix.ts roles at org scope).</description></item>
    /// </list>
    /// interview.schedule only requires the evaluators to be members of the organization.
    /// </remarks>
    public static AssignablePurposeRule RuleFor(AssignablePurpose purpose) => purpose switch
    {
        AssignablePurpose.InterviewEvaluator => new("interview", "create", null, null),
        AssignablePurpose.VacancyApprover => new("vacancy", "update", "vacancy", "approve"),
        AssignablePurpose.OfferApprover => new("offer", "create", "offer", "approve"),
        AssignablePurpose.VacancyAssignee => new("vacancy", "create", null, null),
        AssignablePurpose.Colleague => new(null, null, null, null, StaffOnly: true),
        AssignablePurpose.PerformanceSubject => new("performance", "create", null, null, SubjectScoped: true, StaffOnly: true),
        AssignablePurpose.LearningEnrollee => new("learning", "create", null, null, SubjectScoped: true, StaffOnly: true),
        AssignablePurpose.OnboardingHire => new("onboarding", "create", null, null, SubjectScoped: true, StaffOnly: true),
        AssignablePurpose.SuccessionCandidate => new("succession", "create", null, null, SubjectScoped: true, StaffOnly: true),
        AssignablePurpose.Evaluation360Participant => new("evaluation360", "create", null, null, StaffOnly: true),
        AssignablePurpose.NineBoxCommitteeMember => new("ninebox", "update", null, null, StaffOnly: true),
        AssignablePurpose.OrgStructureMember => new("user", "create", null, null, StaffOnly: true),
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
    /// <remarks>A subject-scoped purpose admits every granted scope: a narrow caller sees only their subject set
    /// (<see cref="NeedsSubjectFilter"/>), which is exactly the set the mutation's assertSubjectInScope accepts.</remarks>
    public static bool CallerScopeAllows(AssignablePurposeRule rule, AccessScope callerScope) =>
        rule.EligibilityModule is not null || rule.SubjectScoped || IsOrgWide(callerScope);

    /// <summary>True when the list must be narrowed to the caller's subject set (a subject-scoped purpose held below org scope).</summary>
    public static bool NeedsSubjectFilter(AssignablePurposeRule rule, AccessScope callerScope) =>
        rule.SubjectScoped && !IsOrgWide(callerScope);

    /// <summary>
    /// The gate for a purpose with no caller permission (<see cref="AssignablePurpose.Colleague"/>): an org user
    /// holding at least one staff role (<see cref="RoleSlugs.AssignableStaffRoles"/>) — never external/candidate —
    /// or a platform owner (privileged everywhere PermissionService decides; the org itself is checked by the caller).
    /// </summary>
    public static bool IsAnyStaffMember(PrincipalType principalType, IEnumerable<string> callerRoles) =>
        principalType == PrincipalType.PlatformOwner
        || (principalType == PrincipalType.OrgUser && RoleSlugs.FilterStaffRoleSlugs(callerRoles).Count > 0);

    private static bool IsOrgWide(AccessScope scope) => scope is AccessScope.Organization or AccessScope.Company;
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
