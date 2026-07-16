namespace Tims.Domain.Hris;

/// <summary>
/// A PROVIDER-NEUTRAL raw employee record as pulled from an HRIS source, BEFORE mapping to the
/// canonical <see cref="ExternalEmployee"/>. It is a field-bag: <see cref="ExternalId"/> plus
/// <see cref="Fields"/> keyed by the SOURCE provider's own field names (e.g. BambooHR's
/// <c>firstName</c>/<c>workEmail</c>). Keeping the raw shape provider-neutral is what lets the
/// mapper be DATA-DRIVEN (<see cref="FieldMap"/>) rather than coupled to any one provider's struct —
/// Sprint-1.8 refines which source keys feed which target field by editing the map, never the
/// mapper logic.
///
/// Pure value type — no persistence/HTTP concerns. The Infrastructure connector produces it from the
/// provider payload; <see cref="BambooHrEmployeeMapper"/> consumes it.
/// </summary>
public sealed record HrisSourceEmployee(
    string ExternalId,
    IReadOnlyDictionary<string, string?> Fields);
