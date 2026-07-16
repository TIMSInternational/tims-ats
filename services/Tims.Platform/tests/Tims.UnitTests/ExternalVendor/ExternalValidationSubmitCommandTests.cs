using System.Text.Json.Nodes;
using Tims.Domain.ExternalVendor;

namespace Tims.UnitTests.ExternalVendor;

/// <summary>
/// Bounds proofs for <see cref="ExternalValidationSubmitCommand.Create"/> — the C# port of the Zod
/// <c>ExternalValidationSubmitInput</c>. Pins the status enum, the result-must-be-a-JSON-object rule, the
/// 100_000 serialized-length bound (matched to TS <c>JSON.stringify(r).length</c>), and the 5000-char
/// notes bound. Every rejection throws <see cref="ExternalValidationInvalidCommandException"/> (→ 400).
/// </summary>
public sealed class ExternalValidationSubmitCommandTests
{
    private static JsonObject Obj() => new() { ["k"] = "v" };

    [Theory]
    [InlineData("passed")]
    [InlineData("failed")]
    public void Accepts_the_two_valid_statuses(string status)
    {
        var command = ExternalValidationSubmitCommand.Create(status, Obj(), notes: null);
        Assert.Equal(status, command.Status);
    }

    [Theory]
    [InlineData("PASSED")]
    [InlineData("pending")]
    [InlineData("approved")]
    [InlineData("")]
    [InlineData(null)]
    public void Rejects_any_other_status(string? status)
    {
        var ex = Assert.Throws<ExternalValidationInvalidCommandException>(
            () => ExternalValidationSubmitCommand.Create(status, Obj(), notes: null));
        Assert.Contains("status", ex.Message);
    }

    [Fact]
    public void Rejects_a_null_result()
    {
        Assert.Throws<ExternalValidationInvalidCommandException>(
            () => ExternalValidationSubmitCommand.Create("passed", result: null, notes: null));
    }

    [Fact]
    public void Rejects_a_non_object_result_array()
    {
        var array = new JsonArray(1, 2, 3);
        var ex = Assert.Throws<ExternalValidationInvalidCommandException>(
            () => ExternalValidationSubmitCommand.Create("passed", array, notes: null));
        Assert.Contains("object", ex.Message);
    }

    [Fact]
    public void Rejects_a_scalar_result()
    {
        Assert.Throws<ExternalValidationInvalidCommandException>(
            () => ExternalValidationSubmitCommand.Create("passed", JsonValue.Create(7), notes: null));
    }

    // ---- result serialized-length bound: <= 100_000 accepted, 100_001 rejected --------------------
    // The serialized form is `{"k":"<pad>"}` = pad.Length + 8 characters (ASCII, no escaping).
    private static JsonObject ResultOfSerializedLength(int totalLength)
    {
        var pad = new string('a', totalLength - 8);
        return new JsonObject { ["k"] = pad };
    }

    [Fact]
    public void Accepts_a_result_at_the_100k_boundary()
    {
        var command = ExternalValidationSubmitCommand.Create("passed", ResultOfSerializedLength(100_000), notes: null);
        Assert.Equal(100_000, command.SerializeResult().Length);
    }

    [Fact]
    public void Rejects_a_result_one_char_over_the_100k_boundary()
    {
        var ex = Assert.Throws<ExternalValidationInvalidCommandException>(
            () => ExternalValidationSubmitCommand.Create("passed", ResultOfSerializedLength(100_001), notes: null));
        Assert.Contains("too large", ex.Message);
    }

    // ---- non-ASCII parity with TS JSON.stringify (UTF-16 length, NOT byte count) -------------------
    // 50_000 'é' chars: TS JSON.stringify keeps each as 1 UTF-16 unit (length 50_008, ACCEPTED). A default
    // STJ writer would escape each to é (6 chars → 300_008, would REJECT). Accepting this proves the
    // command counts length the SAME way TS does (UnsafeRelaxedJsonEscaping), not the default STJ escaping.
    [Fact]
    public void Counts_non_ascii_as_one_utf16_unit_matching_TS_JSON_stringify()
    {
        var payload = new JsonObject { ["k"] = new string('é', 50_000) };

        var command = ExternalValidationSubmitCommand.Create("passed", payload, notes: null);

        Assert.Equal(50_008, command.SerializeResult().Length);
    }

    [Fact]
    public void Accepts_notes_at_the_5000_boundary()
    {
        var command = ExternalValidationSubmitCommand.Create("passed", Obj(), notes: new string('n', 5000));
        Assert.Equal(5000, command.Notes!.Length);
    }

    [Fact]
    public void Rejects_notes_over_the_5000_boundary()
    {
        var ex = Assert.Throws<ExternalValidationInvalidCommandException>(
            () => ExternalValidationSubmitCommand.Create("passed", Obj(), notes: new string('n', 5001)));
        Assert.Contains("notes", ex.Message);
    }

    [Fact]
    public void Allows_absent_notes()
    {
        var command = ExternalValidationSubmitCommand.Create("failed", Obj(), notes: null);
        Assert.Null(command.Notes);
    }

    // ---- FIX 2: the raw-body Create(JsonNode?) mirrors z...optional() — undefined OK, null REJECTED ----

    private static JsonNode Body(string json) => JsonNode.Parse(json)!;

    // ABSENT notes (undefined) → accepted, notes null (the column is left untouched).
    [Fact]
    public void Body_with_absent_notes_is_accepted_and_notes_null()
    {
        var command = ExternalValidationSubmitCommand.Create(Body("""{"status":"passed","result":{"cleared":true}}"""));
        Assert.Null(command.Notes);
        Assert.Equal("passed", command.Status);
    }

    // PRESENT `notes: null` → REJECTED (z.string().optional() accepts undefined, NOT null). This is the
    // distinction a nullable binding silently loses (absent and present-null both collapse to null).
    [Fact]
    public void Body_with_present_null_notes_is_rejected()
    {
        var ex = Assert.Throws<ExternalValidationInvalidCommandException>(
            () => ExternalValidationSubmitCommand.Create(Body("""{"status":"passed","result":{"x":1},"notes":null}""")));
        Assert.Contains("notes", ex.Message);
    }

    [Fact]
    public void Body_with_present_string_notes_is_accepted()
    {
        var command = ExternalValidationSubmitCommand.Create(Body("""{"status":"failed","result":{"x":1},"notes":"ok"}"""));
        Assert.Equal("ok", command.Notes);
    }

    [Fact]
    public void Body_with_non_string_notes_is_rejected()
    {
        Assert.Throws<ExternalValidationInvalidCommandException>(
            () => ExternalValidationSubmitCommand.Create(Body("""{"status":"passed","result":{"x":1},"notes":5}""")));
    }

    [Theory]
    [InlineData("""{"result":{"x":1}}""")] // status absent
    [InlineData("""{"status":null,"result":{"x":1}}""")] // status present-null
    [InlineData("""{"status":"passed"}""")] // result absent
    [InlineData("""{"status":"passed","result":null}""")] // result present-null
    [InlineData("""{"status":"passed","result":[1,2]}""")] // result non-object
    [InlineData("""[1,2,3]""")] // body not an object
    public void Body_missing_or_wrong_typed_required_fields_is_rejected(string json)
    {
        Assert.Throws<ExternalValidationInvalidCommandException>(
            () => ExternalValidationSubmitCommand.Create(Body(json)));
    }

    // A JSON `null` literal body / no body at all → rejected (no null body).
    [Fact]
    public void Null_body_is_rejected()
    {
        Assert.Throws<ExternalValidationInvalidCommandException>(
            () => ExternalValidationSubmitCommand.Create((JsonNode?)null));
    }
}
