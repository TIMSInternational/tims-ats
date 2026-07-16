namespace Tims.UnitTests.Fixtures;

// DTOs mirroring the golden fixture JSON shapes (contracts/access-fixtures/*.json).
// Deserialized case-insensitively (see Fx.Options).

internal sealed record GrantDto(string Role, string Module, string Action, string Scope);

internal sealed record ExpectedDecision(bool Allowed, string? Scope, List<string>? Roles);

// --- resolve-access.json --------------------------------------------------------------
internal sealed record ResolveRoot(string Description, List<ResolveCase> Cases);
internal sealed record ResolveCase(
    string Name, List<GrantDto> Grants, string Module, string Action, ExpectedDecision Expected);

// --- build-access.json ----------------------------------------------------------------
internal sealed record BuildRoot(string Description, List<BuildCase> Cases);
internal sealed record PrincipalDto(List<string> Roles, string? OrganizationId, bool IsPlatformOwner);
internal sealed record BuildCase(
    string Name,
    PrincipalDto Principal,
    List<GrantDto> Grants,
    string Module,
    string Action,
    ExpectedDecision? Expected,
    string? ExpectThrow);

// --- require-org-scope.json -----------------------------------------------------------
internal sealed record OrgScopeRoot(string Description, List<OrgScopeCase> Cases);
internal sealed record OrgScopeCase(string Name, string Scope, bool Expected);

// --- external-scope.json --------------------------------------------------------------
internal sealed record ExternalRoot(string Description, List<ExternalCase> Cases);
internal sealed record ExternalCase(
    string Name, string? RequiredScope, List<string> Scopes, bool AlwaysEnforceScope, bool Expected);

// --- k-anon-min5.json -----------------------------------------------------------------
internal sealed record KAnonRoot(string Description, List<SuppressCase> SuppressCases, List<GroupCase> GroupCases);
internal sealed record SuppressCase(string Name, int Count, ExpectedSuppress Expected);
internal sealed record ExpectedSuppress(bool Suppressed, int? Count);
internal sealed record GroupCase(string Name, List<string> Keys, List<ExpectedGroup> Expected);
internal sealed record ExpectedGroup(string Key, int? Count, bool Suppressed);

// --- eval360-min3.json ----------------------------------------------------------------
internal sealed record Eval360Root(string Description, List<Eval360Case> Cases);
internal sealed record Eval360Case(string Name, List<Row360> Rows, List<ExpectedBucket> Expected);
internal sealed record Row360(string AssignmentId, string Relationship, string CompetencyKey, int Rating, string? Comment);
internal sealed record ExpectedBucket(
    string Relationship, int RaterCount, List<ExpectedCompetency> Competencies, List<string>? Comments);
internal sealed record ExpectedCompetency(string CompetencyKey, double Average);
