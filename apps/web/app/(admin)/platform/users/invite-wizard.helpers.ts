export type Mode = 'single' | 'bulk';
export type BulkStep = 'upload' | 'map' | 'preview' | 'result';

export interface ParsedRow { email: string; firstName?: string; lastName?: string; role?: string }

export const ROLES = [
  { slug: 'super_admin', label: 'Super Admin' },
  { slug: 'hr_admin', label: 'HR Admin' },
  { slug: 'recruiter', label: 'Recruiter' },
  { slug: 'leader', label: 'Leader' },
  { slug: 'employee', label: 'Employee' },
];

export function parseCSV(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length === 0) return { headers: [], rows: [] };
  const sep = lines[0].includes('\t') ? '\t' : ',';
  const headers = lines[0].split(sep).map(h => h.replace(/^["']|["']$/g, '').trim());
  const rows = lines.slice(1).map(l => l.split(sep).map(c => c.replace(/^["']|["']$/g, '').trim()));
  return { headers, rows };
}

export function autoMap(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  const lower = headers.map(h => h.toLowerCase());
  const patterns: [string, string[]][] = [
    ['email', ['email', 'correo', 'e-mail', 'mail']],
    ['firstName', ['first', 'nombre', 'firstname', 'first_name', 'first name']],
    ['lastName', ['last', 'apellido', 'lastname', 'last_name', 'last name', 'surname']],
    ['role', ['role', 'rol', 'cargo', 'position', 'puesto']],
  ];
  for (const [field, keywords] of patterns) {
    const idx = lower.findIndex(h => keywords.some(k => h.includes(k)));
    if (idx >= 0) map[field] = headers[idx];
  }
  return map;
}
