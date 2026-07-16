namespace Tims.Domain.Identity;

/// <summary>
/// The minimal portal-candidate shape the identity plane resolves over: the candidate's id, its
/// org, and the trust-anchor email. Mirrors the TS candidate-portal resolution
/// (repositories/candidate-portal.repository.ts → <c>findActiveCandidate</c>), which selects only
/// <c>{ id }</c> for an ACTIVE, non-deleted candidate matching (organizationId, email). Carries no
/// PII beyond the email the session already presented — never notes, tags, scores, or CV content.
///
/// A candidate is org-scoped: the SAME email can be a candidate in multiple orgs, so resolution is
/// keyed on BOTH email and organizationId. Unlike <see cref="AppUserRow"/> a candidate carries NO
/// roles and is NEVER a platform owner — <see cref="CandidateRow"/> deliberately has no such fields.
/// </summary>
public sealed record CandidateRow(string Id, string OrganizationId, string Email);
