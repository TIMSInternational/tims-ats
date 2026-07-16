using System.Text.Json;

namespace Tims.Domain.Identity;

/// <summary>
/// Ported 1:1 from packages/api/src/access/external-auth.ts (<c>parseScopes</c>). Parses the raw
/// JSON <c>scopes</c> column. Returns a clean string list for a valid JSON array of strings — an
/// EMPTY array is VALID ("no per-key narrowing", an intentional state). Returns null for any
/// MALFORMED value (not a JSON array, an array with a non-string element, or unparseable JSON) so
/// the caller can FAIL CLOSED — a corrupted scopes value must never silently broaden a key to the
/// full role grant.
/// </summary>
public static class ApiKeyScopes
{
    public static IReadOnlyList<string>? ParseScopes(string? rawJson)
    {
        if (rawJson is null)
        {
            return null;
        }

        JsonDocument document;
        try
        {
            document = JsonDocument.Parse(rawJson);
        }
        catch (JsonException)
        {
            return null;
        }

        using (document)
        {
            if (document.RootElement.ValueKind != JsonValueKind.Array)
            {
                return null;
            }

            var scopes = new List<string>();
            foreach (var element in document.RootElement.EnumerateArray())
            {
                if (element.ValueKind != JsonValueKind.String)
                {
                    return null;
                }

                scopes.Add(element.GetString()!);
            }

            return scopes;
        }
    }
}
