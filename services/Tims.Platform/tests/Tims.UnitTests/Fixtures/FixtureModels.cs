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

// --- scope-where.json -----------------------------------------------------------------
internal sealed record ScopeWhereRoot(string Description, List<ScopeWhereCase> Cases);
internal sealed record AnchorArraysDto(
    List<string> LedTeamIds,
    List<string> UnitIds,
    List<string> TeamMemberIds,
    List<string> UnitMemberIds,
    List<string> PanelInterviewIds);
internal sealed record ScopeWhereCase(
    string Name,
    string Entity,
    string Scope,
    string UserId,
    AnchorArraysDto? Anchors,
    System.Text.Json.Nodes.JsonNode? Expected,
    string? ExpectError);

// --- subject-in-scope.json ------------------------------------------------------------
internal sealed record SubjectInScopeRoot(string Description, List<SubjectInScopeCase> Cases);
internal sealed record SubjectInScopeCase(
    string Name,
    string Scope,
    string UserId,
    string TargetUserId,
    List<string> TeamMembers,
    List<string> UnitMembers,
    bool HasAnchors,
    bool Expected);

// --- field-classification.json (access-fixtures) --------------------------------------
internal sealed record FieldClassificationRoot(string Description, List<FieldClassificationCase> Cases);
internal sealed record FieldClassificationCase(
    string Name, string Kind, List<string> Roles, string Entity, List<string> Expected);

// --- assessment-result-v1.json (external-fixtures) ------------------------------------
internal sealed record V1Root(string Description, List<V1Case> Cases);
internal sealed record V1Case(string Name, V1InputRow Input, V1Expected Expected);
internal sealed record V1InputRow(
    string Id,
    string AssignmentId,
    double? RawScore,
    double? NormalizedScore,
    double? Percentile,
    System.Text.Json.Nodes.JsonNode? Interpretation,
    System.Text.Json.Nodes.JsonNode? Breakdown,
    string? ModelVersion,
    DateTimeOffset ScoredAt,
    V1InputAssignment Assignment);
internal sealed record V1InputAssignment(
    string CandidateId,
    string VacancyId,
    string Status,
    DateTimeOffset AssignedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    DateTimeOffset? ExpiresAt,
    V1InputType? AssessmentType);
internal sealed record V1InputType(string Name);
internal sealed record V1Expected(
    string SchemaVersion,
    string AssignmentId,
    string CandidateId,
    string VacancyId,
    string? AssessmentType,
    string Status,
    DateTimeOffset AssignedAt,
    DateTimeOffset? StartedAt,
    DateTimeOffset? CompletedAt,
    DateTimeOffset? ExpiresAt,
    DateTimeOffset ScoredAt,
    double? RawScore,
    double? NormalizedScore,
    double? Percentile,
    System.Text.Json.Nodes.JsonNode? Interpretation,
    System.Text.Json.Nodes.JsonNode? Breakdown,
    string? ModelVersion);

// --- validation-result-v1.json (external-fixtures) ------------------------------------
internal sealed record ValidationV1Root(string Description, List<ValidationV1Case> Cases);
internal sealed record ValidationV1Case(string Name, ValidationV1Input Input, ValidationV1Expected Expected);
internal sealed record ValidationV1Input(string Id, string Status, DateTimeOffset CompletedAt);
internal sealed record ValidationV1Expected(string SchemaVersion, string Id, string Status, DateTimeOffset CompletedAt);

// --- eval360-min3.json ----------------------------------------------------------------
internal sealed record Eval360Root(string Description, List<Eval360Case> Cases);
internal sealed record Eval360Case(string Name, List<Row360> Rows, List<ExpectedBucket> Expected);
internal sealed record Row360(string AssignmentId, string Relationship, string CompetencyKey, int Rating, string? Comment);
internal sealed record ExpectedBucket(
    string Relationship, int RaterCount, List<ExpectedCompetency> Competencies, List<string>? Comments);
internal sealed record ExpectedCompetency(string CompetencyKey, double Average);
