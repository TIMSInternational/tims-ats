using System.Text.Json.Nodes;
using Tims.Domain.Validation;

namespace Tims.UnitTests.Validation;

/// <summary>
/// Pins the Zod-parity bounds + partial-update semantics of <see cref="StaffValidationUpdateCommand"/>
/// (the staff updateValidation input). Bites: the 4-value status enum; result OPTIONAL (absent → skip,
/// present must be an object within 100000, present-null/array/scalar rejected); notes OPTIONAL (absent →
/// skip, present ≤5000, present-null/non-string rejected); body must be a JSON object.
/// </summary>
public sealed class StaffValidationUpdateCommandTests
{
    private static StaffValidationUpdateCommand Create(string json) =>
        StaffValidationUpdateCommand.Create(JsonNode.Parse(json));

    private static void AssertInvalid(string json) =>
        Assert.Throws<StaffValidationInvalidCommandException>(() => Create(json));

    [Theory]
    [InlineData("pending", false)]
    [InlineData("passed", true)]
    [InlineData("failed", true)]
    [InlineData("waived", true)]
    public void Valid_statuses_parse_and_set_completing(string status, bool completing)
    {
        var command = Create($$"""{ "status": "{{status}}" }""");
        Assert.Equal(status, command.Status);
        Assert.Equal(completing, command.IsCompleting);
        // No result / notes in the body → not provided → the columns are left untouched.
        Assert.False(command.ResultProvided);
        Assert.False(command.NotesProvided);
    }

    [Fact]
    public void Result_and_notes_present_are_provided_and_serialized()
    {
        var command = Create("""{ "status": "passed", "result": { "score": 9, "flag": true }, "notes": "ok" }""");
        Assert.True(command.ResultProvided);
        Assert.Equal("{\"score\":9,\"flag\":true}", command.ResultJson);
        Assert.True(command.NotesProvided);
        Assert.Equal("ok", command.Notes);
    }

    [Fact]
    public void Empty_string_notes_is_provided_not_skipped()
    {
        // An explicit "" is present (a valid string) → written; distinct from an ABSENT notes (skip).
        var command = Create("""{ "status": "failed", "notes": "" }""");
        Assert.True(command.NotesProvided);
        Assert.Equal(string.Empty, command.Notes);
    }

    [Theory]
    [InlineData("""{ "status": "approved" }""")]        // not in the enum
    [InlineData("""{ "status": null }""")]              // present-null
    [InlineData("""{ }""")]                              // absent status
    [InlineData("""{ "status": 1 }""")]                 // non-string status
    public void Invalid_status_is_rejected(string json) => AssertInvalid(json);

    [Theory]
    [InlineData("""{ "status": "passed", "result": null }""")]      // present-null
    [InlineData("""{ "status": "passed", "result": [1,2] }""")]     // array
    [InlineData("""{ "status": "passed", "result": "x" }""")]       // scalar
    public void Non_object_result_is_rejected(string json) => AssertInvalid(json);

    [Theory]
    [InlineData("""{ "status": "passed", "notes": null }""")]       // present-null
    [InlineData("""{ "status": "passed", "notes": 5 }""")]          // non-string
    public void Non_string_notes_is_rejected(string json) => AssertInvalid(json);

    [Theory]
    [InlineData("[]")]
    [InlineData("null")]
    [InlineData("\"x\"")]
    public void Non_object_body_is_rejected(string json) => AssertInvalid(json);

    [Fact]
    public void Oversized_result_is_rejected()
    {
        var big = new string('a', StaffValidationUpdateCommand.MaxResultSerializedLength);
        AssertInvalid($$"""{ "status": "passed", "result": { "x": "{{big}}" } }""");
    }

    [Fact]
    public void Oversized_notes_is_rejected()
    {
        var big = new string('a', StaffValidationUpdateCommand.MaxNotesLength + 1);
        AssertInvalid($$"""{ "status": "passed", "notes": "{{big}}" }""");
    }
}
