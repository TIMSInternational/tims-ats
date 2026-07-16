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
            // HRIS-synced directory rows (names / work emails / titles) = confidential, so a read/write
            // of external_employee is audit-required and the sync write audits fail-SOFT.
            //
            // C#-ONLY (deliberate, do NOT add to the TS classification.ts or the cross-stack audit golden):
            // HRIS is a greenfield C# domain — the TS product has NO external_employee reader, so injecting
            // this key into classification.ts would seed a dead entry into a stack that never reads the
            // entity (not faithful). The shared golden (contracts/audit-fixtures/*.json) covers only the
            // five entities BOTH stacks have; it stays untouched, and a C#-only unit test pins this entry.
            // This is the correct pattern for every greenfield C# domain: classify in C#; the shared golden
            // covers only shared entities.
            ["external_employee"] = DataClass.Confidential,
        };

    /// <summary>
    /// The entity's headline data-class. Unknown entity → <see cref="DataClass.Internal"/>
    /// (unknown != public), matching the TS <c>dataClassOf</c> default.
    /// </summary>
    public static DataClass Of(string entity) =>
        Headline.TryGetValue(entity, out var dataClass) ? dataClass : DataClass.Internal;
}
