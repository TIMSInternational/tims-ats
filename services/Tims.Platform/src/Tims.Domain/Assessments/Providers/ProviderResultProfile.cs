using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Tims.Domain.Assessments.Providers;

/// <summary>
/// The shape behind a provider result, for the HR results view: per instrument, the values the provider reported in
/// the result's <c>scores</c> (the full projection the connector stores). Only the fields the view draws leave, each
/// bounded; nothing interpretive (no narrative, no item, no key) is ever part of it. Exactly one member is set.
/// </summary>
public sealed record ProviderResultProfile(
    LiaProfile? Lia = null,
    EnglishProfile? English = null,
    PersonalityProfile? Personality = null,
    PcaProfile? Pca = null);

/// <summary>LIA: the global percentile and level, the norm status, and one percentile per administered subtest.</summary>
public sealed record LiaProfile(
    double? GlobalPercentile, string? GlobalLevel, string? NormStatus, IReadOnlyList<LiaSubtestScore> Subtests);

public sealed record LiaSubtestScore(string Subtest, double? Percentile, string? Level, string? Completion);

/// <summary>English: the overall CEFR level and score, and each skill's (a skill not assessed says why).</summary>
public sealed record EnglishProfile(string? OverallCefr, double? OverallScorePct, IReadOnlyList<EnglishSkillScore> Skills);

public sealed record EnglishSkillScore(string Skill, bool Assessed, string? Cefr, double? ScorePct, string? NotAssessedReason);

/// <summary>Personality: the questionnaire variant and its four bipolar dimensions (counts per pole, clarity).</summary>
public sealed record PersonalityProfile(string? Variant, IReadOnlyList<PersonalityDimensionScore> Dimensions);

public sealed record PersonalityDimensionScore(
    string Dimension,
    string FirstPole,
    string SecondPole,
    int FirstCount,
    int SecondCount,
    string? PreferredPole,
    int ClarityPct,
    bool Balanced);

/// <summary>PCA (DISC): the three graphs (0–100 per factor), which one is primary, and the competency levels (1–4).</summary>
public sealed record PcaProfile(
    string? PrimaryGraph, IReadOnlyList<DiscGraphScore> Graphs, IReadOnlyList<PcaCompetencyScore> Competencies);

public sealed record DiscGraphScore(string Graph, int D, int I, int S, int C);

public sealed record PcaCompetencyScore(string Code, string Name, int Level, int ScaleMax);

/// <summary>Parses a stored <c>scores</c> jsonb into a <see cref="ProviderResultProfile"/>. Never throws.</summary>
public static partial class ProviderResultProfiles
{
    public const int MaxSubtests = 10;
    public const int MaxSkills = 10;
    public const int MaxDimensions = 8;
    public const int MaxGraphs = 3;
    public const int MaxCompetencies = 40;
    public const int MaxNameLength = 120;

    private static readonly HashSet<string> Cefr = new(StringComparer.Ordinal) { "A1", "A2", "B1", "B2", "C1", "C2" };

    [GeneratedRegex("^[a-z][a-z0-9_]{0,39}$")]
    private static partial Regex Key();

    [GeneratedRegex("^[a-z0-9][a-z0-9:_-]{0,79}$")]
    private static partial Regex Code();

    [GeneratedRegex("^[A-Z]$")]
    private static partial Regex Pole();

    /// <summary>The profile of <paramref name="instrument"/>'s result, or null when it has none the view can draw.</summary>
    public static ProviderResultProfile? Parse(string instrument, string? scoresJson)
    {
        if (string.IsNullOrWhiteSpace(scoresJson))
        {
            return null;
        }

        JsonObject? root;
        try
        {
            root = JsonNode.Parse(scoresJson) as JsonObject;
        }
        catch (JsonException)
        {
            return null;
        }

        if (root is null)
        {
            return null;
        }

        return instrument switch
        {
            ProviderInstruments.Lia => Lia(root) is { } lia ? new ProviderResultProfile(Lia: lia) : null,
            ProviderInstruments.English => English(root) is { } en ? new ProviderResultProfile(English: en) : null,
            ProviderInstruments.Personality => Personality(root) is { } p ? new ProviderResultProfile(Personality: p) : null,
            ProviderInstruments.Pca => Pca(root) is { } pca ? new ProviderResultProfile(Pca: pca) : null,
            _ => null,
        };
    }

    private static LiaProfile? Lia(JsonObject root)
    {
        var global = root["global"] as JsonObject;
        var subtests = Items(root["subtests"], MaxSubtests, node =>
            KeyOf(node["subtest"]) is { } key
                ? new LiaSubtestScore(key, Percent(node["percentile"]), LevelCode(node["level"]), KeyOf(node["completion"]))
                : null);
        var percentile = Percent(global?["percentile"]);
        if (percentile is null && subtests.Count == 0)
        {
            return null;
        }

        return new LiaProfile(percentile, LevelCode(global?["level"]), KeyOf(root["norm_status"]), subtests);
    }

    private static EnglishProfile? English(JsonObject root)
    {
        var overall = root["overall"] as JsonObject;
        var skills = Items(root["skills"], MaxSkills, node =>
        {
            if (KeyOf(node["skill"]) is not { } key)
            {
                return null;
            }

            var assessed = node["assessed"] is JsonValue v && v.TryGetValue<bool>(out var b) && b;
            return new EnglishSkillScore(
                key, assessed, assessed ? CefrOf(node["cefr"]) : null, assessed ? Percent(node["score_pct"]) : null,
                assessed ? null : KeyOf(node["not_assessed_reason"]));
        });
        var cefr = CefrOf(overall?["cefr"]);
        if (cefr is null && skills.Count == 0)
        {
            return null;
        }

        return new EnglishProfile(cefr, Percent(overall?["score_pct"]), skills);
    }

    private static PersonalityProfile? Personality(JsonObject root)
    {
        var dimensions = Items(root["dimensions"], MaxDimensions, node =>
        {
            if (KeyOf(Text(node["dimension_id"])?.ToLowerInvariant()) is not { } id
                || PoleOf(node["first_pole"]) is not { } first
                || PoleOf(node["second_pole"]) is not { } second
                || first == second)
            {
                return null;
            }

            var preferred = PoleOf(node["preferred_pole"]);
            return new PersonalityDimensionScore(
                id,
                first,
                second,
                Int(node["first_count"], 0, 1000) ?? 0,
                Int(node["second_count"], 0, 1000) ?? 0,
                preferred == first || preferred == second ? preferred : null,
                Int(node["clarity_pct"], 0, 100) ?? 0,
                node["balanced"] is JsonValue bv && bv.TryGetValue<bool>(out var balanced) && balanced);
        });
        return dimensions.Count == 0 ? null : new PersonalityProfile(KeyOf(root["variant"]), dimensions);
    }

    private static PcaProfile? Pca(JsonObject root)
    {
        var disc = root["disc"] as JsonObject;
        var graphs = Items(disc?["graphs"], MaxGraphs, node =>
            KeyOf(node["graph"]) is { } graph
            && Int(node["d"], 0, 100) is { } d && Int(node["i"], 0, 100) is { } i
            && Int(node["s"], 0, 100) is { } s && Int(node["c"], 0, 100) is { } c
                ? new DiscGraphScore(graph, d, i, s, c)
                : null);
        var competencies = Items(root["competencies"], MaxCompetencies, node =>
        {
            var code = Text(node["code"]);
            var name = Text(node["name"]);
            var level = Int((node["level"] as JsonObject)?["ordinal"], 1, 4);
            return code is not null && Code().IsMatch(code) && !string.IsNullOrWhiteSpace(name) && level is { } l
                ? new PcaCompetencyScore(code, Truncate(name.Trim(), MaxNameLength), l, Int(node["scale_max"], 1, 4) ?? 4)
                : null;
        });
        if (graphs.Count == 0 && competencies.Count == 0)
        {
            return null;
        }

        var primary = KeyOf(disc?["primary_graph"]);
        return new PcaProfile(graphs.Any(g => g.Graph == primary) ? primary : null, graphs, competencies);
    }

    // ── bounded readers ─────────────────────────────────────────────────────────────────────

    private static List<T> Items<T>(JsonNode? node, int max, Func<JsonObject, T?> read)
        where T : class
    {
        var list = new List<T>();
        if (node is not JsonArray array)
        {
            return list;
        }

        foreach (var item in array)
        {
            if (list.Count == max)
            {
                break;
            }

            if (item is JsonObject obj && Safe(() => read(obj)) is { } value)
            {
                list.Add(value);
            }
        }

        return list;
    }

    private static T? Safe<T>(Func<T?> read)
        where T : class
    {
        try
        {
            return read();
        }
        catch (Exception e) when (e is InvalidOperationException or FormatException or JsonException)
        {
            return null;
        }
    }

    private static string? Text(JsonNode? node) =>
        node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static string? KeyOf(JsonNode? node) => KeyOf(Text(node));

    private static string? KeyOf(string? value) => value is not null && Key().IsMatch(value) ? value : null;

    private static string? PoleOf(JsonNode? node) => Text(node) is { } p && Pole().IsMatch(p) ? p : null;

    private static string? LevelCode(JsonNode? level) => KeyOf((level as JsonObject)?["code"]);

    private static string? CefrOf(JsonNode? cefr) =>
        Text((cefr as JsonObject)?["code"]) is { } code && Cefr.Contains(code) ? code : null;

    private static double? Percent(JsonNode? node) =>
        Number(node) is { } n && n is >= 0 and <= 100 ? Math.Round(n, 1) : null;

    private static int? Int(JsonNode? node, int min, int max) =>
        Number(node) is { } n && n >= min && n <= max ? (int)Math.Round(n, MidpointRounding.AwayFromZero) : null;

    private static double? Number(JsonNode? node)
    {
        if (node is not JsonValue v)
        {
            return null;
        }

        if (v.TryGetValue<double>(out var d))
        {
            return double.IsFinite(d) ? d : null;
        }

        return v.TryGetValue<string>(out var s)
            && double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            && double.IsFinite(parsed)
                ? parsed
                : null;
    }

    private static string Truncate(string value, int max) => value.Length <= max ? value : value[..max];
}
