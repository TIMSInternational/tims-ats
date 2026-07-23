using System.Globalization;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Tims.Domain.Json;

/// <summary>
/// The canonical JS value-coercion helpers the pure suppression kernels rely on to replicate JavaScript
/// <c>Number()</c> / <c>parseInt(…,10)</c> / <c>Boolean()</c> / <c>Object.values()[0]</c> semantics over the raw
/// jsonb <c>answers</c> values — so contributor counts, averages, and k-anon thresholds are byte-identical to the
/// live TS <c>.map(Number)</c> / <c>.filter(Boolean)</c> paths. Extracted from the engagement kernels (Phase-5
/// Slice 11) so the engagement AND DEI (Slice 11b) kernels share ONE definition, golden-fixtured on both stacks.
/// </summary>
public static class JsValue
{
    /// <summary>Object.values(obj)[0] — the first property value (empty object ⇒ null).</summary>
    public static JsonNode? FirstValue(JsonObject obj)
    {
        foreach (var kv in obj)
        {
            return kv.Value;
        }

        return null;
    }

    /// <summary>The string key a JS <c>obj[q.text]</c> lookup uses: string values verbatim; a non-string value is
    /// coerced via its JSON text (JS String() coercion), matching <c>q.text as string</c> at runtime.</summary>
    public static string StringKey(JsonNode? node) => node?.GetValueKind() == JsonValueKind.String
        ? node.GetValue<string>()
        : node?.ToJsonString() ?? "undefined";

    /// <summary>JS <c>Boolean(x)</c>: null/undefined/false → false; "" → false; 0 → false; else true.</summary>
    public static bool Truthy(JsonNode? node)
    {
        if (node is null)
        {
            return false;
        }

        return node.GetValueKind() switch
        {
            JsonValueKind.Null => false,
            JsonValueKind.False => false,
            JsonValueKind.True => true,
            JsonValueKind.String => node.GetValue<string>().Length > 0,
            JsonValueKind.Number => node.GetValue<double>() != 0,
            _ => true, // object / array
        };
    }

    /// <summary>JS <c>Number(x)</c> for a PRESENT value (a C#-null node = present JSON null → Number(null) = 0).</summary>
    public static double Number(JsonNode? node)
    {
        if (node is null)
        {
            return 0; // Number(null) = 0
        }

        return node.GetValueKind() switch
        {
            JsonValueKind.Null => 0,
            JsonValueKind.True => 1,
            JsonValueKind.False => 0,
            JsonValueKind.Number => node.GetValue<double>(),
            JsonValueKind.String => StringToNumber(node.GetValue<string>()),
            _ => double.NaN, // object / array → NaN
        };
    }

    /// <summary>JS <c>Number(obj?.[key])</c>: an ABSENT key is undefined → NaN; a present (incl. JSON-null) value →
    /// Number(v).</summary>
    public static double NumberOfKey(JsonObject obj, string key) =>
        obj.TryGetPropertyValue(key, out var node) ? Number(node) : double.NaN;

    // JS Number(string) — FAITHFUL port (Codex Slice-11 M1): trim; "" → 0; ±Infinity; 0x/0o/0b integer literals
    // (NO sign permitted); else a decimal/scientific StrDecimalLiteral → value, else NaN.
    private static double StringToNumber(string s)
    {
        var t = s.Trim();
        if (t.Length == 0)
        {
            return 0;
        }

        if (t is "Infinity" or "+Infinity")
        {
            return double.PositiveInfinity;
        }

        if (t == "-Infinity")
        {
            return double.NegativeInfinity;
        }

        // Radix-prefixed integer literals: JS Number() parses 0x/0o/0b WITHOUT a sign; empty digit run → NaN.
        if (t.Length > 2 && t[0] == '0')
        {
            var radix = char.ToLowerInvariant(t[1]) switch { 'x' => 16, 'o' => 8, 'b' => 2, _ => 0 };
            if (radix != 0)
            {
                return TryParseRadix(t.AsSpan(2), radix, out var rv) ? rv : double.NaN;
            }
        }

        return double.TryParse(t, NumberStyles.Float, CultureInfo.InvariantCulture, out var d) ? d : double.NaN;
    }

    // JS radix-integer parse for 0x/0o/0b (accumulated as double to match JS Number's IEEE-754 result on large
    // magnitudes). Any digit outside the radix (or an empty run) → NaN, matching Number().
    private static bool TryParseRadix(ReadOnlySpan<char> digits, int radix, out double value)
    {
        value = 0;
        if (digits.Length == 0)
        {
            return false;
        }

        double acc = 0;
        foreach (var c in digits)
        {
            var dv = c switch
            {
                >= '0' and <= '9' => c - '0',
                >= 'a' and <= 'f' => c - 'a' + 10,
                >= 'A' and <= 'F' => c - 'A' + 10,
                _ => -1,
            };
            if (dv < 0 || dv >= radix)
            {
                return false;
            }

            acc = (acc * radix) + dv;
        }

        value = acc;
        return true;
    }

    /// <summary>JS <c>parseInt(s, 10)</c>: skip leading whitespace, optional sign, read the leading decimal-digit
    /// run; no digits → NaN.</summary>
    public static double ParseInt(string s)
    {
        var i = 0;
        var n = s.Length;
        while (i < n && char.IsWhiteSpace(s[i]))
        {
            i++;
        }

        var sign = 1;
        if (i < n && (s[i] == '+' || s[i] == '-'))
        {
            if (s[i] == '-')
            {
                sign = -1;
            }

            i++;
        }

        var start = i;
        while (i < n && s[i] >= '0' && s[i] <= '9')
        {
            i++;
        }

        if (i == start)
        {
            return double.NaN;
        }

        return sign * double.Parse(s[start..i], CultureInfo.InvariantCulture);
    }
}
