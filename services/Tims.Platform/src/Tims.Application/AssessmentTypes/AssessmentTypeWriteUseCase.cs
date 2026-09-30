using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Tims.Application.AssessmentTypes;

/// <summary>
/// Tenant authoring of assessment types (F13): create / update / deactivate for the caller's organization. There is
/// no TS writer to port — before this slice the only surface was the read-only tRPC <c>assessment.listTypes</c> — so
/// this is greenfield C# (the survival rule: new endpoints never go to <c>packages/api</c>).
///
/// <para>The body parsers are pure and live here so they unit-test without a host: strict object (unknown key → 400),
/// bounded strings, integer-only duration. The <c>code</c> column (NOT NULL, <c>@@unique([organizationId, code])</c>)
/// is DERIVED from the name — accent-folded, lower-cased, non-alphanumerics collapsed to <c>_</c>.</para>
///
/// <para><b>What is a duplicate.</b> Only the NAME, compared case-insensitively against the org's ACTIVE types, is a
/// 409 ("Existente" vs "EXISTENTE"). Names that differ by accents or punctuation ("Lógica" vs "Logica", "A-B" vs
/// "A B") are DIFFERENT names: they derive the same base code, and <see cref="PickFreeCode"/> suffixes it
/// (<c>logica_2</c>) → 200. A deactivated type does not reserve its name (there is no reactivate endpoint; one added
/// later must re-check the name against active types), but it keeps its code, so a new type reusing the name gets a
/// suffixed code.</para>
/// </summary>
public sealed class AssessmentTypeWriteUseCase(IAssessmentTypeWriteRepository repository)
{
    public const int MaxNameLength = 120;
    public const int MaxDescriptionLength = 2000;
    public const int MaxCodeLength = 60;
    public const int MinDuration = 1;
    public const int MaxDuration = 600;
    public const int MaxCodeSuffix = 100;

    private static readonly HashSet<string> AllowedKeys = new(StringComparer.Ordinal) { "name", "description", "duration" };

    private readonly IAssessmentTypeWriteRepository _repository = repository;

    public Task<AssessmentTypeWriteResult> CreateAsync(
        Guid organizationId, Guid actorId, AssessmentTypeCreateInput input, DateTime now, CancellationToken cancellationToken) =>
        _repository.CreateAsync(organizationId, actorId, input, now, cancellationToken);

    public Task<AssessmentTypeWriteResult> UpdateAsync(
        Guid organizationId, Guid actorId, Guid id, AssessmentTypeUpdateInput input, DateTime now,
        CancellationToken cancellationToken) =>
        _repository.UpdateAsync(organizationId, actorId, id, input, now, cancellationToken);

    public Task<AssessmentTypeWriteResult> DeactivateAsync(
        Guid organizationId, Guid actorId, Guid id, DateTime now, CancellationToken cancellationToken) =>
        _repository.DeactivateAsync(organizationId, actorId, id, now, cancellationToken);

    /// <summary>Parses a create body. Returns false (→ 400) on any shape/bound violation.</summary>
    public static bool TryParseCreate(JsonNode? node, out AssessmentTypeCreateInput input)
    {
        input = new AssessmentTypeCreateInput(string.Empty, string.Empty, null, null);
        if (!TryReadFields(node, out var fields) || !fields.TryGetValue("name", out var nameNode))
        {
            return false;
        }

        if (!TryParseName(nameNode, out var name) || DeriveCode(name) is not { } code)
        {
            return false;
        }

        string? description = null;
        if (fields.TryGetValue("description", out var descriptionNode) && !TryParseDescription(descriptionNode, out description))
        {
            return false;
        }

        int? duration = null;
        if (fields.TryGetValue("duration", out var durationNode) && !TryParseDuration(durationNode, out duration))
        {
            return false;
        }

        input = new AssessmentTypeCreateInput(name, code, description, duration);
        return true;
    }

    /// <summary>Parses a partial-update body. At least one field is required; name cannot be null.</summary>
    public static bool TryParseUpdate(JsonNode? node, out AssessmentTypeUpdateInput input)
    {
        input = new AssessmentTypeUpdateInput(null, false, null, false, null);
        if (!TryReadFields(node, out var fields) || fields.Count == 0)
        {
            return false;
        }

        string? name = null;
        if (fields.TryGetValue("name", out var nameNode) && !TryParseName(nameNode, out name))
        {
            return false;
        }

        if (name is not null && DeriveCode(name) is null)
        {
            return false;
        }

        var hasDescription = fields.TryGetValue("description", out var descriptionNode);
        string? description = null;
        if (hasDescription && !TryParseDescription(descriptionNode, out description))
        {
            return false;
        }

        var hasDuration = fields.TryGetValue("duration", out var durationNode);
        int? duration = null;
        if (hasDuration && !TryParseDuration(durationNode, out duration))
        {
            return false;
        }

        input = new AssessmentTypeUpdateInput(name, hasDescription, description, hasDuration, duration);
        return true;
    }

    /// <summary>
    /// Accent-folds, lower-cases and collapses every non-[a-z0-9] run to a single <c>_</c>; trims edge underscores and
    /// caps at <see cref="MaxCodeLength"/>. Returns null when nothing alphanumeric survives (e.g. a name of only
    /// punctuation) — the caller treats that as invalid input.
    /// </summary>
    public static string? DeriveCode(string name)
    {
        var decomposed = name.Normalize(NormalizationForm.FormD);
        var builder = new StringBuilder(decomposed.Length);
        var lastWasSeparator = true;
        foreach (var ch in decomposed)
        {
            if (CharUnicodeInfo.GetUnicodeCategory(ch) == UnicodeCategory.NonSpacingMark)
            {
                continue;
            }

            var lower = char.ToLowerInvariant(ch);
            if (lower is >= 'a' and <= 'z' or >= '0' and <= '9')
            {
                builder.Append(lower);
                lastWasSeparator = false;
            }
            else if (!lastWasSeparator)
            {
                builder.Append('_');
                lastWasSeparator = true;
            }
        }

        var code = builder.ToString().Trim('_');
        if (code.Length > MaxCodeLength)
        {
            code = code[..MaxCodeLength].TrimEnd('_');
        }

        return code.Length == 0 ? null : code;
    }

    /// <summary>First free code among <c>base</c>, <c>base_2</c> … <c>base_100</c>; null if all are taken.</summary>
    public static string? PickFreeCode(string baseCode, IReadOnlyCollection<string> existingCodes)
    {
        var taken = new HashSet<string>(existingCodes, StringComparer.Ordinal);
        if (!taken.Contains(baseCode))
        {
            return baseCode;
        }

        for (var suffix = 2; suffix <= MaxCodeSuffix; suffix++)
        {
            var candidate = $"{baseCode}_{suffix}";
            if (!taken.Contains(candidate))
            {
                return candidate;
            }
        }

        return null;
    }

    /// <summary>ISO-8601 UTC with milliseconds and trailing Z — the JS <c>toISOString()</c> shape.</summary>
    public static string FormatTimestamp(DateTime value) =>
        DateTime.SpecifyKind(value, DateTimeKind.Utc).ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", CultureInfo.InvariantCulture);

    // Strict object: every key must be known. JsonObject materialises its dictionary lazily and throws
    // ArgumentException on a duplicate key at first READ (TRAP 5) — caught here so it is a 400, not a 500.
    private static bool TryReadFields(JsonNode? node, out Dictionary<string, JsonNode?> fields)
    {
        fields = new Dictionary<string, JsonNode?>(StringComparer.Ordinal);
        if (node is not JsonObject obj)
        {
            return false;
        }

        try
        {
            foreach (var (key, value) in obj)
            {
                if (!AllowedKeys.Contains(key))
                {
                    return false;
                }

                fields[key] = value;
            }
        }
        catch (ArgumentException)
        {
            return false;
        }

        return true;
    }

    private static bool TryParseName(JsonNode? node, out string name)
    {
        name = string.Empty;
        if (!TryGetString(node, out var raw))
        {
            return false;
        }

        name = raw.Trim();
        return name.Length is > 0 and <= MaxNameLength;
    }

    private static bool TryParseDescription(JsonNode? node, out string? description)
    {
        description = null;
        if (node is null)
        {
            return true;
        }

        if (!TryGetString(node, out var raw))
        {
            return false;
        }

        var trimmed = raw.Trim();
        if (trimmed.Length > MaxDescriptionLength)
        {
            return false;
        }

        description = trimmed.Length == 0 ? null : trimmed;
        return true;
    }

    private static bool TryParseDuration(JsonNode? node, out int? duration)
    {
        duration = null;
        if (node is null)
        {
            return true;
        }

        if (node is not JsonValue value || value.GetValueKind() != JsonValueKind.Number
            || !value.TryGetValue<decimal>(out var number) || number != decimal.Truncate(number)
            || number < MinDuration || number > MaxDuration)
        {
            return false;
        }

        duration = (int)number;
        return true;
    }

    private static bool TryGetString(JsonNode? node, out string value)
    {
        value = string.Empty;
        if (node is not JsonValue json || json.GetValueKind() != JsonValueKind.String
            || !json.TryGetValue<string>(out var text))
        {
            return false;
        }

        value = text;
        return true;
    }
}
