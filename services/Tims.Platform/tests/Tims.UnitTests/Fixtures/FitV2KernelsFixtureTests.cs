using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using Tims.Domain.FitEngine;
using Xunit;

namespace Tims.UnitTests.Fixtures;

/// <summary>
/// Golden cases for the FIT v2 kernels (contracts/fit-v2-fixtures/*.json). Unlike the v1 fit-engine fixtures
/// there is NO TS oracle: FIT v2 exists only in C# (the survival rule). The expectations were derived by hand
/// from the rules in <see cref="FitV2Kernels"/>'s summary, and each case name states the arithmetic, so a
/// change to a rule shows up as a reviewed fixture edit rather than a silent drift. The v1 fixtures
/// (contracts/fit-engine-fixtures) are untouched and still pass: FIT v1 is byte-identical.
/// </summary>
public sealed class FitV2KernelsFixtureTests
{
    private static JsonArray Cases(string file) =>
        JsonNode.Parse(File.ReadAllText(Path.Combine(AppContext.BaseDirectory, "fit-v2-fixtures", file)))!
            ["cases"]!.AsArray();

    private static void AssertCase(string file, JsonNode c, JsonNode? actual)
    {
        var expected = c["expected"];
        Assert.True(
            JsonNode.DeepEquals(expected, actual),
            $"{file}: {c["name"]} — expected {expected?.ToJsonString() ?? "null"} got {actual?.ToJsonString() ?? "null"}");
    }

    [Fact]
    public void ParseAssessmentRequirements()
    {
        foreach (var c in Cases("parse-assessment-requirements.json"))
        {
            var parsed = FitV2Kernels.ParseAssessmentRequirements(c!["input"]!["raw"]);
            JsonNode? actual = parsed is null ? null : new JsonArray(parsed.Select(RequirementToJson).ToArray());
            AssertCase("parse-assessment-requirements.json", c, actual);
        }
    }

    [Fact]
    public void InstrumentKernels()
    {
        foreach (var c in Cases("instrument-kernels.json"))
        {
            var input = c!["input"]!;
            JsonNode? actual = input["kernel"]!.GetValue<string>() switch
            {
                "meetOrExceed" => FitV2Kernels.MeetOrExceed(
                    input["value"]!.GetValue<double>(), input["minimum"]!.GetValue<double>()),
                "cefrLadder" => FitV2Kernels.CefrLadder(
                    FitV2Kernels.CefrOrdinal(input["achieved"]!.GetValue<string>())!.Value,
                    FitV2Kernels.CefrOrdinal(input["required"]!.GetValue<string>())!.Value),
                "itciaLadder" => FitV2Kernels.ItciaLadder(
                    input["achieved"]!.GetValue<int>(), input["required"]!.GetValue<int>()),
                "cefrOrdinal" => FitV2Kernels.CefrOrdinal(input["label"]!.GetValue<string>()) is { } ordinal
                    ? JsonValue.Create(ordinal)
                    : null,
                "isEnglish" => FitV2Kernels.IsEnglish(input["label"]!.GetValue<string>()),
                var other => throw new InvalidOperationException($"unknown kernel {other}"),
            };
            AssertCase("instrument-kernels.json", c, actual);
        }
    }

    [Fact]
    public void DeriveLanguageScoreV2()
    {
        foreach (var c in Cases("language-score-v2.json"))
        {
            var input = c!["input"]!;
            var requirements = FitEngineKernels.ParseRequirements(input["requirements"]);
            bool? covered = input["englishCovered"] is JsonValue v ? v.GetValue<bool>() : null;
            var (score, used) = FitV2Kernels.DeriveLanguageScoreV2(input["languages"], requirements, covered);
            var actual = new JsonObject
            {
                ["score"] = score is { } s ? JsonValue.Create(s) : null,
                ["usedAssessment"] = used,
            };
            AssertCase("language-score-v2.json", c, actual);
        }
    }

    [Fact]
    public void Evaluate()
    {
        foreach (var c in Cases("evaluate.json"))
        {
            var input = c!["input"]!;
            var fitRequirements = input["fitRequirements"];
            var requirements = FitV2Kernels.ParseAssessmentRequirements(fitRequirements);
            Assert.NotNull(requirements);

            var evaluation = FitV2Kernels.Evaluate(
                requirements,
                input["results"]!.AsArray().Select(r => ParseResult(r!)).ToList(),
                FitEngineKernels.ParseWeights(input["weights"]),
                FitEngineKernels.ParseRequirements(fitRequirements),
                input["languages"]);

            var actual = new JsonObject
            {
                ["assessment"] = evaluation.AssessmentScore is { } a ? JsonValue.Create(a) : null,
                ["languages"] = evaluation.LanguagesScore is { } l ? JsonValue.Create(l) : null,
                ["reviewPending"] = evaluation.ReviewPending,
                ["entries"] = new JsonArray(evaluation.Entries.Select(e => (JsonNode)FitV2Kernels.EntryToJson(e)).ToArray()),
            };
            AssertCase("evaluate.json", c, actual);
        }
    }

    private static JsonNode RequirementToJson(AssessmentRequirement r) => new JsonObject
    {
        ["instrument"] = r.Instrument,
        ["use"] = r.Use,
        ["min"] = FitV2Kernels.MinimumToJson(r.Min),
        ["weight"] = r.Weight is { } w ? JsonValue.Create(w) : null,
        ["reason"] = r.Reason,
    };

    private static InstrumentResult ParseResult(JsonNode r) => new(
        r["instrument"]!.GetValue<string>(),
        r["resultId"]!.GetValue<string>(),
        r["source"]!.GetValue<string>(),
        r["integrity"]!.GetValue<string>() switch
        {
            "valid" => ResultIntegrity.Valid,
            "needs_review" => ResultIntegrity.NeedsReview,
            var other => throw new InvalidOperationException($"unknown integrity {other}"),
        },
        r["completedAt"] is JsonValue at
            ? DateTimeOffset.Parse(at.GetValue<string>(), CultureInfo.InvariantCulture)
            : null,
        Number(r, "normalizedScore"),
        Number(r, "globalPercentile"),
        r["cefr"] is JsonValue cefr ? cefr.GetValue<string>() : null,
        r["level"] is JsonValue level ? level.GetValue<int>() : null,
        r["contentVersion"] is JsonValue cv ? cv.GetValue<string>() : null,
        r["normVersion"] is JsonValue nv ? nv.GetValue<string>() : null);

    private static double? Number(JsonNode r, string key) =>
        r[key] is JsonValue v && v.GetValueKind() == JsonValueKind.Number ? v.GetValue<double>() : null;
}
