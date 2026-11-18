// "Invitar organización" creates a NEW organization. One wrong click on it under a slightly different name
// ("Nova Costa Rica" for an existing "Nova") sends an admin into an empty organization (audit finding
// D-15). The modal warns when the typed name resembles an existing organization. Pure, so node tests can
// exercise it.

/** Lower-case, accent-free, alphanumeric words. */
function words(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Legal-form and filler words that make two different organizations look alike ("Grupo X S.A.").
const NOISE: ReadonlySet<string> = new Set([
  'sa',
  's',
  'a',
  'srl',
  'sas',
  'ltda',
  'inc',
  'llc',
  'corp',
  'de',
  'del',
  'la',
  'el',
  'los',
  'las',
  'y',
  'grupo',
  'group',
  'company',
  'compania',
  'empresa',
  'the',
]);

function significant(name: string): string[] {
  return words(name).filter((w) => !NOISE.has(w) && w.length >= 3);
}

/** True when the two names share their whole significant text, or one contains the other's first word. */
export function areOrganizationNamesSimilar(a: string, b: string): boolean {
  const wa = significant(a);
  const wb = significant(b);
  if (wa.length === 0 || wb.length === 0) return false;
  const ja = wa.join(' ');
  const jb = wb.join(' ');
  if (ja === jb) return true;
  return wa.includes(wb[0]!) || wb.includes(wa[0]!);
}

/** Existing organizations whose name resembles `name` (at most `limit`). */
export function findSimilarOrganizations<O extends { readonly name: string }>(
  name: string,
  organizations: readonly O[],
  limit = 3,
): O[] {
  if (name.trim().length < 3) return [];
  return organizations.filter((org) => areOrganizationNamesSimilar(name, org.name)).slice(0, limit);
}
