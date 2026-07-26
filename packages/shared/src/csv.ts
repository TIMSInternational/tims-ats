/**
 * RFC-4180 cell + spreadsheet formula-injection defense: neutralize a leading
 * =/+/-/@/tab/CR (Excel/Sheets execute these), then double-quote and escape quotes.
 * Use for ANY CSV export field sourced from tenant-editable data (names, org names)
 * that may be opened in a spreadsheet — csv exports are a standing formula-injection
 * vector (CWE-1236).
 */
export function csvCell(value: string | null | undefined): string {
  const raw = value == null ? '' : String(value);
  const neutralized = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

export function csvRow(values: Array<string | null | undefined>): string {
  return values.map(csvCell).join(',');
}
