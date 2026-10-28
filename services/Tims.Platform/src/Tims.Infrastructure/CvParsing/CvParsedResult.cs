using System.Text.Encodings.Web;
using System.Text.Json;

namespace Tims.Infrastructure.CvParsing;

/// <summary>
/// The .NET counterpart of the TypeScript cv-parser contract, matched EXACTLY:
/// <c>packages/ai/src/invoke.ts</c> extracts <c>/\{[\s\S]*\}/</c> (first <c>{</c>
/// to last <c>}</c>), <c>JSON.parse</c>s it and validates it with
/// <c>cvParserOutputSchema</c> (<c>packages/ai/src/agents/cv-parser.ts</c>, Zod's
/// default strip mode). Every key is required; strings and numbers are unbounded
/// and may be empty; unknown keys are dropped at every level; an all-empty CV is
/// valid with confidence 0. Both sides run the shared fixtures in
/// <c>contracts/cv-parser-fixtures/</c>, so a divergence fails CI on either side.
///
/// Deliberate, documented differences that cannot change an accept/reject
/// decision for real model output: the model text is capped at 256k characters
/// (the call is capped at 2048 output tokens), nesting at 256 levels, and a lone
/// UTF-16 surrogate escape is rejected (PostgreSQL <c>jsonb</c> cannot store one,
/// so the TS path also fails to persist it).
/// </summary>
public sealed class CvParsedResult
{
    public const int MaxModelTextCharacters = 256_000;
    private static readonly string[] Fields =
        ["name", "email", "phone", "skills", "experience", "education", "languages", "summary"];
    private static readonly JsonWriterOptions WriterOptions = new()
    {
        // jsonb storage, never HTML: keep non-ASCII CV text readable and compact.
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping
    };

    private CvParsedResult(string parsedJson, string educationJson, string languagesJson)
    {
        ParsedJson = parsedJson;
        EducationJson = educationJson;
        LanguagesJson = languagesJson;
    }

    /// <summary>The document's <c>parsed_data</c>, shaped exactly like the TS service writes it.</summary>
    public string ParsedJson { get; }
    public string EducationJson { get; }
    public string LanguagesJson { get; }

    public static bool TryParse(string? modelText, out CvParsedResult? result)
    {
        result = null;
        if (modelText is null || modelText.Length > MaxModelTextCharacters) return false;
        // JS: text.match(/\{[\s\S]*\}/) — leftmost '{', greedy to the LAST '}'.
        var start = modelText.IndexOf('{');
        var end = modelText.LastIndexOf('}');
        if (start < 0 || end < start) return false;
        try
        {
            using var document = JsonDocument.Parse(modelText.AsMemory(start, end - start + 1),
                new JsonDocumentOptions
                {
                    MaxDepth = 256,
                    AllowTrailingCommas = false,
                    CommentHandling = JsonCommentHandling.Disallow
                });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !NullableString(root, "name") || !NullableString(root, "email") ||
                !NullableString(root, "phone") || !NullableString(root, "summary") ||
                !StringArray(root, "skills") || !StringArray(root, "languages") ||
                !ObjectArray(root, "experience", Experience) ||
                !ObjectArray(root, "education", Education)) return false;

            // TS: Object.values(data).filter(v => v !== null && (Array.isArray(v) ? v.length > 0 : true))
            var filled = Fields.Count(field =>
            {
                var value = Property(root, field);
                return value.ValueKind != JsonValueKind.Null &&
                    (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > 0);
            });

            var parsedJson = Write(writer =>
            {
                writer.WriteStartObject();
                WriteNullableString(writer, root, "name");
                WriteNullableString(writer, root, "email");
                WriteNullableString(writer, root, "phone");
                WriteStringArray(writer, root, "skills");
                writer.WritePropertyName("experience");
                WriteObjects(writer, Property(root, "experience"), ["company", "title", "startYear", "endYear", "description"]);
                writer.WritePropertyName("education");
                WriteObjects(writer, Property(root, "education"), ["institution", "degree", "year"]);
                WriteStringArray(writer, root, "languages");
                WriteNullableString(writer, root, "summary");
                writer.WriteNumber("confidence", Math.Min(filled / 8.0, 1));
                writer.WriteString("modelVersion", "haiku");
                writer.WriteBoolean("parsed", true);
                writer.WriteEndObject();
            });
            var educationJson = Write(writer =>
                WriteObjects(writer, Property(root, "education"), ["institution", "degree", "year"]));
            var languagesJson = Write(writer => WriteStrings(writer, Property(root, "languages")));
            result = new CvParsedResult(parsedJson, educationJson, languagesJson);
            return true;
        }
        catch (JsonException) { return false; }
        catch (InvalidOperationException) { return false; }
        catch (ArgumentException) { return false; }
    }

    /// <summary>JSON.parse semantics: for a repeated key, the LAST occurrence wins.</summary>
    private static JsonElement Property(JsonElement obj, string name)
    {
        JsonElement found = default;
        var seen = false;
        foreach (var property in obj.EnumerateObject())
        {
            if (property.NameEquals(name)) { found = property.Value; seen = true; }
        }
        return seen ? found : default;
    }

    private static bool Has(JsonElement obj, string name, out JsonElement value)
    {
        value = Property(obj, name);
        return value.ValueKind != JsonValueKind.Undefined;
    }

    // z.string().nullable() — key required, any string (including empty) or null.
    private static bool NullableString(JsonElement obj, string name) =>
        Has(obj, name, out var value) && value.ValueKind is JsonValueKind.String or JsonValueKind.Null;

    // z.number().nullable() — key required, any JSON number or null.
    private static bool NullableNumber(JsonElement obj, string name) =>
        Has(obj, name, out var value) && value.ValueKind is JsonValueKind.Number or JsonValueKind.Null;

    private static bool RequiredString(JsonElement obj, string name) =>
        Has(obj, name, out var value) && value.ValueKind == JsonValueKind.String;

    // z.array(z.string()) — any length, any strings (including empty).
    private static bool StringArray(JsonElement obj, string name) =>
        Has(obj, name, out var value) && value.ValueKind == JsonValueKind.Array &&
        value.EnumerateArray().All(item => item.ValueKind == JsonValueKind.String);

    private static bool ObjectArray(JsonElement obj, string name, Func<JsonElement, bool> item) =>
        Has(obj, name, out var value) && value.ValueKind == JsonValueKind.Array &&
        value.EnumerateArray().All(element => element.ValueKind == JsonValueKind.Object && item(element));

    private static bool Experience(JsonElement item) =>
        RequiredString(item, "company") && RequiredString(item, "title") &&
        NullableNumber(item, "startYear") && NullableNumber(item, "endYear") &&
        NullableString(item, "description");

    private static bool Education(JsonElement item) =>
        RequiredString(item, "institution") && RequiredString(item, "degree") && NullableNumber(item, "year");

    private static string Write(Action<Utf8JsonWriter> write)
    {
        using var output = new MemoryStream();
        using (var writer = new Utf8JsonWriter(output, WriterOptions)) write(writer);
        return System.Text.Encoding.UTF8.GetString(output.ToArray());
    }

    private static void WriteNullableString(Utf8JsonWriter writer, JsonElement obj, string name)
    {
        writer.WritePropertyName(name);
        Property(obj, name).WriteTo(writer);
    }

    private static void WriteStringArray(Utf8JsonWriter writer, JsonElement obj, string name)
    {
        writer.WritePropertyName(name);
        WriteStrings(writer, Property(obj, name));
    }

    private static void WriteStrings(Utf8JsonWriter writer, JsonElement array)
    {
        writer.WriteStartArray();
        foreach (var item in array.EnumerateArray()) item.WriteTo(writer);
        writer.WriteEndArray();
    }

    /// <summary>
    /// JavaScript number semantics, as the TypeScript path applies them (JSON.parse to a double, then
    /// JSON.stringify): the literal is rounded to the nearest IEEE-754 double (9007199254740993 becomes
    /// 9007199254740992), and an overflow to Infinity is written as null. Writing the original literal
    /// instead persisted different data than the TS parser and could hand PostgreSQL a number it cannot
    /// store (tier-1 review).
    /// </summary>
    private static void WriteJsNumber(Utf8JsonWriter writer, JsonElement value)
    {
        var number = double.Parse(value.GetRawText(), System.Globalization.NumberStyles.Float,
            System.Globalization.CultureInfo.InvariantCulture);
        if (double.IsFinite(number)) writer.WriteNumberValue(number == 0 ? 0 : number);
        else writer.WriteNullValue();
    }

    /// <summary>Zod strip mode: only the schema's keys survive, in schema order.</summary>
    private static void WriteObjects(Utf8JsonWriter writer, JsonElement array, string[] keys)
    {
        writer.WriteStartArray();
        foreach (var item in array.EnumerateArray())
        {
            writer.WriteStartObject();
            foreach (var key in keys)
            {
                writer.WritePropertyName(key);
                var value = Property(item, key);
                if (value.ValueKind == JsonValueKind.Number) WriteJsNumber(writer, value);
                else value.WriteTo(writer);
            }
            writer.WriteEndObject();
        }
        writer.WriteEndArray();
    }
}
