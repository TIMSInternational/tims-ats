namespace Tims.Domain.Audit;

/// <summary>
/// Port of the CLASSIFICATION registry's HEADLINE data-class (packages/api/src/access/classification.ts
/// <c>dataClassOf</c>). WP2.7 needs only the entity-level headline class (the max of its fields) that
/// drives the audit/consent decision — NOT the full per-field <c>fieldsVisibleTo</c> role lists (that is
/// select-for's concern, out of scope here).
///
/// Only the five sensitive entities that resolve above <c>internal</c> are registered; the lookup is
/// case-sensitive (ordinal), matching the TS object-key access. An UNKNOWN entity defaults to
/// <see cref="DataClass.Internal"/> — deliberately NOT <see cref="DataClass.Public"/>: unknown != safe.
/// </summary>
public static class DataClassification
{
    private static readonly IReadOnlyDictionary<string, DataClass> Headline =
        new Dictionary<string, DataClass>(StringComparer.Ordinal)
        {
            // Compensation/Salary + raw psychometrics = restricted (highest sensitivity).
            ["employeeCompensation"] = DataClass.Restricted,
            ["salaryAdjustment"] = DataClass.Restricted,
            ["assessmentResult"] = DataClass.Restricted,
            // DEI demographics + individual engagement responses = confidential.
            ["employeeDemographics"] = DataClass.Confidential,
            ["surveyResponse"] = DataClass.Confidential,
        };

    /// <summary>
    /// The entity's headline data-class. Unknown entity → <see cref="DataClass.Internal"/>
    /// (unknown != public), matching the TS <c>dataClassOf</c> default.
    /// </summary>
    public static DataClass Of(string entity) =>
        Headline.TryGetValue(entity, out var dataClass) ? dataClass : DataClass.Internal;
}
