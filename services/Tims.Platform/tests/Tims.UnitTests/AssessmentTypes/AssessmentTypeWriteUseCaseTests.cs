using System.Text.Json.Nodes;
using Tims.Application.AssessmentTypes;
using Xunit;

namespace Tims.UnitTests.AssessmentTypes;

/// <summary>
/// F13 pure input rules for tenant assessment-type authoring: strict body shape, bounds, integer-only duration,
/// the derived <c>code</c> (accent/case/punctuation folding) and the code-suffix picker.
/// </summary>
public sealed class AssessmentTypeWriteUseCaseTests
{
    private static JsonNode? Parse(string json) => JsonNode.Parse(json);

    [Fact]
    public void Create_ValidBody_TrimsAndDerivesCode()
    {
        Assert.True(AssessmentTypeWriteUseCase.TryParseCreate(
            Parse("""{"name":"  Prueba Lógica  ","description":"  Razonamiento ","duration":45}"""), out var input));
        Assert.Equal("Prueba Lógica", input.Name);
        Assert.Equal("prueba_logica", input.Code);
        Assert.Equal("Razonamiento", input.Description);
        Assert.Equal(45, input.Duration);
    }

    [Fact]
    public void Create_BlankDescription_IsNull_AndOptionalFieldsMayBeAbsentOrNull()
    {
        Assert.True(AssessmentTypeWriteUseCase.TryParseCreate(Parse("""{"name":"X","description":"   "}"""), out var a));
        Assert.Null(a.Description);
        Assert.True(AssessmentTypeWriteUseCase.TryParseCreate(Parse("""{"name":"X","description":null,"duration":null}"""), out var b));
        Assert.Null(b.Description);
        Assert.Null(b.Duration);
    }

    [Theory]
    [InlineData("""{}""")] // name required
    [InlineData("""{"name":""}""")]
    [InlineData("""{"name":"   "}""")]
    [InlineData("""{"name":null}""")]
    [InlineData("""{"name":42}""")]
    [InlineData("""{"name":"!!!"}""")] // nothing alphanumeric → no code
    [InlineData("""{"name":"X","extra":1}""")] // strict keys
    [InlineData("""{"name":"X","organizationId":"11111111-1111-1111-1111-111111111111"}""")] // org is never input
    [InlineData("""{"name":"X","duration":0}""")]
    [InlineData("""{"name":"X","duration":601}""")]
    [InlineData("""{"name":"X","duration":1.5}""")]
    [InlineData("""{"name":"X","duration":"30"}""")]
    [InlineData("""{"name":"X","description":5}""")]
    [InlineData("""[]""")]
    [InlineData("""null""")]
    [InlineData("""{"name":"X","name":"Y"}""")] // duplicate key must be a 400, not a 500
    public void Create_InvalidBodies_AreRejected(string json) =>
        Assert.False(AssessmentTypeWriteUseCase.TryParseCreate(Parse(json), out _));

    [Fact]
    public void Create_NameAndDescriptionBounds()
    {
        var okName = new string('a', AssessmentTypeWriteUseCase.MaxNameLength);
        Assert.True(AssessmentTypeWriteUseCase.TryParseCreate(new JsonObject { ["name"] = okName }, out _));
        Assert.False(AssessmentTypeWriteUseCase.TryParseCreate(new JsonObject { ["name"] = okName + "a" }, out _));
        var longDescription = new string('d', AssessmentTypeWriteUseCase.MaxDescriptionLength + 1);
        Assert.False(AssessmentTypeWriteUseCase.TryParseCreate(
            new JsonObject { ["name"] = "X", ["description"] = longDescription }, out _));
    }

    [Fact]
    public void Update_DistinguishesAbsentFromExplicitNull()
    {
        Assert.True(AssessmentTypeWriteUseCase.TryParseUpdate(Parse("""{"description":null}"""), out var clear));
        Assert.Null(clear.Name);
        Assert.True(clear.HasDescription);
        Assert.Null(clear.Description);
        Assert.False(clear.HasDuration);

        Assert.True(AssessmentTypeWriteUseCase.TryParseUpdate(Parse("""{"name":"Nuevo","duration":30}"""), out var set));
        Assert.Equal("Nuevo", set.Name);
        Assert.False(set.HasDescription);
        Assert.True(set.HasDuration);
        Assert.Equal(30, set.Duration);
    }

    [Theory]
    [InlineData("""{}""")] // at least one field
    [InlineData("""{"name":null}""")] // name cannot be cleared
    [InlineData("""{"name":""}""")]
    [InlineData("""{"isActive":true}""")] // (re)activation is not part of this surface
    [InlineData("""{"code":"x"}""")] // code is immutable
    [InlineData("""{"duration":-1}""")]
    public void Update_InvalidBodies_AreRejected(string json) =>
        Assert.False(AssessmentTypeWriteUseCase.TryParseUpdate(Parse(json), out _));

    [Theory]
    [InlineData("Prueba Técnica", "prueba_tecnica")]
    [InlineData("PRUEBA  técnica!!", "prueba_tecnica")]
    [InlineData("Logística 2026", "logistica_2026")]
    [InlineData("  --Ñandú--  ", "nandu")]
    [InlineData("C#/.NET", "c_net")]
    public void DeriveCode_FoldsAccentsCaseAndPunctuation(string name, string expected) =>
        Assert.Equal(expected, AssessmentTypeWriteUseCase.DeriveCode(name));

    [Fact]
    public void DeriveCode_IsCappedAndNullWhenNothingSurvives()
    {
        var code = AssessmentTypeWriteUseCase.DeriveCode(new string('a', 200));
        Assert.Equal(AssessmentTypeWriteUseCase.MaxCodeLength, code!.Length);
        Assert.Null(AssessmentTypeWriteUseCase.DeriveCode("¿¡!?"));
    }

    [Fact]
    public void PickFreeCode_SuffixesOnlyOnCollision()
    {
        Assert.Equal("logica", AssessmentTypeWriteUseCase.PickFreeCode("logica", ["otro"]));
        Assert.Equal("logica_2", AssessmentTypeWriteUseCase.PickFreeCode("logica", ["logica"]));
        Assert.Equal("logica_3", AssessmentTypeWriteUseCase.PickFreeCode("logica", ["logica", "logica_2"]));
        var all = new List<string> { "x" };
        for (var i = 2; i <= AssessmentTypeWriteUseCase.MaxCodeSuffix; i++)
        {
            all.Add($"x_{i}");
        }

        Assert.Null(AssessmentTypeWriteUseCase.PickFreeCode("x", all));
    }

    [Fact]
    public void FormatTimestamp_IsJsIsoShape()
    {
        var value = new DateTime(2026, 9, 29, 12, 0, 0, DateTimeKind.Unspecified);
        Assert.Equal("2026-09-29T12:00:00.000Z", AssessmentTypeWriteUseCase.FormatTimestamp(value));
    }
}
