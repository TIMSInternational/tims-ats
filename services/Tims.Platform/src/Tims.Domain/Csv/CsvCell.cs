using System.Text.RegularExpressions;

namespace Tims.Domain.Csv;

/// <summary>
/// Port of packages/shared/src/csv.ts (csvCell/csvRow) — RFC-4180 cell quoting + spreadsheet
/// formula-injection defense (CWE-1236). Neutralize a leading =/+/-/@/tab/CR (Excel/Sheets
/// execute these as a formula), then double-quote and escape embedded quotes. Golden-fixtured
/// against the TS implementation via contracts/audit-fixtures/export-audit-logs-csv.json.
/// </summary>
public static partial class CsvCell
{
    [GeneratedRegex(@"^[=+\-@\t\r]")]
    private static partial Regex LeadingFormulaChar();

    public static string Escape(string? value)
    {
        var raw = value ?? string.Empty;
        var neutralized = LeadingFormulaChar().IsMatch(raw) ? $"'{raw}" : raw;
        return $"\"{neutralized.Replace("\"", "\"\"")}\"";
    }

    public static string Row(IEnumerable<string?> values) => string.Join(',', values.Select(Escape));
}
