using System.Text.Json;

namespace Tims.Infrastructure.CvParsing;

/// <summary>Strict, bounded counterpart of the existing TypeScript cv-parser output schema.</summary>
public sealed class CvParsedResult
{
    private CvParsedResult(string parsedJson, string educationJson, string languagesJson)
    {
        ParsedJson = parsedJson;
        EducationJson = educationJson;
        LanguagesJson = languagesJson;
    }

    public string ParsedJson { get; }
    public string EducationJson { get; }
    public string LanguagesJson { get; }

    public static bool TryParse(string? modelText, out CvParsedResult? result)
    {
        result = null;
        if (string.IsNullOrWhiteSpace(modelText) || modelText.Length > 64_000) return false;
        try
        {
            // Converse can surround JSON with markdown. Accept one object with only
            // whitespace/fences around it, never an arbitrary prefix or second object.
            var text = modelText.Trim();
            if (text.StartsWith("```json", StringComparison.OrdinalIgnoreCase)) text = text[7..].Trim();
            else if (text.StartsWith("```", StringComparison.Ordinal)) text = text[3..].Trim();
            if (text.EndsWith("```", StringComparison.Ordinal)) text = text[..^3].Trim();
            using var document = JsonDocument.Parse(text, new JsonDocumentOptions
            {
                MaxDepth = 12,
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow
            });
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !NullableString(root, "name", 300) ||
                !NullableString(root, "email", 320) ||
                !NullableString(root, "phone", 100) ||
                !NullableString(root, "summary", 4_000) ||
                !StringArray(root, "skills", 100, 200) ||
                !StringArray(root, "languages", 40, 200) ||
                !ExperienceArray(root) || !EducationArray(root)) return false;

            var fields = new[] { "name", "email", "phone", "skills", "experience", "education", "languages", "summary" };
            var filled = fields.Count(field =>
            {
                var value = root.GetProperty(field);
                return value.ValueKind != JsonValueKind.Null &&
                    (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() > 0);
            });
            if (filled == 0) return false;
            using var output = new MemoryStream();
            using (var writer = new Utf8JsonWriter(output))
            {
                writer.WriteStartObject();
                foreach (var field in fields)
                {
                    writer.WritePropertyName(field);
                    root.GetProperty(field).WriteTo(writer);
                }
                writer.WriteNumber("confidence", Math.Min(filled / 8.0, 1));
                writer.WriteString("modelVersion", "haiku");
                writer.WriteBoolean("parsed", true);
                writer.WriteEndObject();
            }
            var parsedJson = System.Text.Encoding.UTF8.GetString(output.ToArray());
            var educationJson = root.GetProperty("education").GetRawText();
            var languagesJson = root.GetProperty("languages").GetRawText();
            if (parsedJson.Length > 64_000 || educationJson.Length > 32_000 || languagesJson.Length > 16_000)
                return false;
            result = new CvParsedResult(parsedJson, educationJson, languagesJson);
            return true;
        }
        catch (JsonException) { return false; }
        catch (InvalidOperationException) { return false; }
    }

    private static bool NullableString(JsonElement root, string name, int max)
    {
        if (!root.TryGetProperty(name, out var value)) return false;
        return value.ValueKind == JsonValueKind.Null ||
            (value.ValueKind == JsonValueKind.String && value.GetString() is { Length: <= 4_000 } text && text.Length <= max);
    }

    private static bool StringArray(JsonElement root, string name, int maxItems, int maxLength)
    {
        if (!root.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array ||
            value.GetArrayLength() > maxItems) return false;
        return value.EnumerateArray().All(item =>
            item.ValueKind == JsonValueKind.String && item.GetString() is { Length: > 0 } text && text.Length <= maxLength);
    }

    private static bool ExperienceArray(JsonElement root)
    {
        if (!root.TryGetProperty("experience", out var value) || value.ValueKind != JsonValueKind.Array ||
            value.GetArrayLength() > 60) return false;
        return value.EnumerateArray().All(item => item.ValueKind == JsonValueKind.Object &&
            RequiredString(item, "company", 300) && RequiredString(item, "title", 300) &&
            NullableYear(item, "startYear") && NullableYear(item, "endYear") &&
            NullableString(item, "description", 2_000));
    }

    private static bool EducationArray(JsonElement root)
    {
        if (!root.TryGetProperty("education", out var value) || value.ValueKind != JsonValueKind.Array ||
            value.GetArrayLength() > 60) return false;
        return value.EnumerateArray().All(item => item.ValueKind == JsonValueKind.Object &&
            RequiredString(item, "institution", 300) && RequiredString(item, "degree", 300) &&
            NullableYear(item, "year"));
    }

    private static bool RequiredString(JsonElement root, string name, int max) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String &&
        value.GetString() is { Length: > 0 } text && text.Length <= max;

    private static bool NullableYear(JsonElement root, string name)
    {
        if (!root.TryGetProperty(name, out var value)) return false;
        return value.ValueKind == JsonValueKind.Null ||
            (value.ValueKind == JsonValueKind.Number && value.TryGetInt32(out var year) && year is >= 1900 and <= 2200);
    }
}
