using System.Linq.Expressions;
using Tims.Domain.Access;
using Tims.Infrastructure.ExternalVendor;

namespace Tims.IntegrationTests.ExternalVendor;

/// <summary>
/// FIX 3 (opus M2 → Codex Medium recheck): pins the LIVE EF projection to the classification kernel —
/// NOT a hand-maintained mirror list. EF cannot derive its hardcoded projection from a runtime string
/// list, so this test walks the ACTUAL <see cref="ExternalAssessmentRepository.ProjectionExpression"/>
/// with an <see cref="ExpressionVisitor"/>: it collects every member read DIRECTLY on the read entity,
/// camelCases it to the kernel's field naming (<c>RawScore</c>→<c>rawScore</c>), and intersects that set
/// with the fields the kernel actually registers for <c>assessmentResult</c>. The intersection MUST equal
/// <c>FieldsVisibleTo(["external"], "assessmentResult")</c> — proving the projection selects EXACTLY the
/// external ceiling's scored fields: no non-ceiling classified column is added, and no ceiling column is
/// dropped, regardless of any mirror list. Dropping <c>rawScore</c> from the <c>external</c> role, or
/// dropping a <c>r.RawScore</c> read from the projection, turns this RED. Pure assertion, no container.
/// </summary>
public sealed class ExternalAssessmentProjectionPinTests
{
    // The full TIMS role set — its union is EVERY field the kernel registers for assessmentResult
    // (super_admin alone already grants all rules; the full list is defensive against a future field
    // granted only to a non-super role). Deliberately independent of `external`, so the pin still bites
    // when a field is dropped from the external ceiling while the projection keeps reading it.
    private static readonly string[] AllRoles =
        ["super_admin", "hr_admin", "hrbp", "recruiter", "employee", "external"];

    [Fact]
    public void Projection_selects_exactly_the_external_scored_ceiling()
    {
        var externalCeiling = FieldClassification.FieldsVisibleTo(["external"], "assessmentResult");
        var registeredScoredFields = FieldClassification.FieldsVisibleTo(AllRoles, "assessmentResult");

        // The projection also reads structural anchors (id/assignmentId/scoredAt) + the joined assignment
        // context; intersecting with the kernel's registered classified fields isolates the SCORED columns
        // the projection actually selects on the result entity.
        var projectedScoredFields = ProjectedEntityMemberFields()
            .Intersect(registeredScoredFields, StringComparer.Ordinal)
            .OrderBy(field => field, StringComparer.Ordinal)
            .ToArray();

        Assert.Equal(
            externalCeiling.OrderBy(field => field, StringComparer.Ordinal).ToArray(),
            projectedScoredFields);
    }

    // Walks the ACTUAL EF projection lambda and returns every member read DIRECTLY on the read entity
    // (the lambda parameter), camelCased to the classification-kernel naming.
    private static IReadOnlyCollection<string> ProjectedEntityMemberFields()
    {
        var projection = ExternalAssessmentRepository.ProjectionExpression;
        var collector = new EntityMemberCollector(projection.Parameters[0]);
        collector.Visit(projection.Body);
        return collector.Fields;
    }

    private sealed class EntityMemberCollector(ParameterExpression entityParameter) : ExpressionVisitor
    {
        public HashSet<string> Fields { get; } = new(StringComparer.Ordinal);

        protected override Expression VisitMember(MemberExpression node)
        {
            // Only members read DIRECTLY on the read entity (r.RawScore) — never on a joined navigation
            // (r.Assignment.CandidateId), whose members belong to a DIFFERENT classified entity and must
            // not be counted as this entity's selected fields.
            if (ReferenceEquals(node.Expression, entityParameter))
            {
                Fields.Add(CamelCase(node.Member.Name));
            }

            return base.VisitMember(node);
        }

        private static string CamelCase(string name) =>
            name.Length == 0 ? name : char.ToLowerInvariant(name[0]) + name[1..];
    }
}
