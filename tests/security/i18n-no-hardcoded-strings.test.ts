// tests/security/i18n-no-hardcoded-strings.test.ts
//
// i18n enforcement gate: fails when a user-facing string is hardcoded in an
// apps/web component instead of going through the i18n dictionary (`t.*`).
// Matches the repo's source-scan tripwire convention (node env, reads source
// as text). Runs in CI's vitest job + the local /gate.
//
// Detected leak vectors (the ones found leaking in the audit):
//   A. literal first arg to toast(...)        -> toast('Guardado')
//   B. literal placeholder/title/aria-label   -> placeholder="Buscar..."
//   C. multi-word JSX text node literals      -> <span>No hay datos</span>
//
// To accept a specific exception, add its EXACT trimmed string to ALLOWLIST
// (technical tokens, symbols, format hints). Keep this list short and reviewed.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(__dirname, '../..');
const SCAN_DIRS = ['apps/web/app', 'apps/web/components'];

// Files/dirs excluded from the scan (dev/preview tooling that renders raw
// single-language template content, not a localized product surface).
const EXCLUDE_PATHS = ['apps/web/app/(admin)/platform/email-preview/'];

// Exact trimmed literals that are allowed (not user-facing prose, or
// intentionally locale-invariant). Keep minimal + reviewed.
const ALLOWLIST = new Set<string>([
  'TIMS ATS', // product brand name
  'PCA vs. JCA', // psychometric instrument codes (locale-invariant)
  'JCA vs. PCA',
  'Algo salió mal', // global-error.tsx root boundary renders OUTSIDE I18nProvider — hardcoded fallback by necessity
  // route-error.tsx scoped boundaries: hardcoded by necessity — an error boundary must not
  // depend on I18nProvider, which may itself be the failure it is catching.
  'Ocurrió un error inesperado. Intenta de nuevo.',
  'Reintentar',
]);

// Tells that a `>...<` capture is actually a JS expression fragment caught
// across comparison/logic operators (e.g. `{a >= 0.95 && cr}`), not prose.
function looksLikeCode(t: string): boolean {
  if (/(&&|\|\||=>|>=|<=|===|!==|\?\?|\$\{|`|\bfunction\b)/.test(t)) return true;
  if (/\[\s*\d/.test(t)) return true; // array index e.g. r[1]
  if (/(^|\s)=\s/.test(t)) return true; // bare assignment/comparison `= 0.95`
  if (/&#\d/.test(t)) return true; // html entity (raw template bullets)
  if (/^[=<>!&|?*/+\-.]/.test(t.trim())) return true; // starts with an operator
  if (/\bas\s+[A-Z]/.test(t)) return true; // TS cast e.g. `x as Array`, `as Record`
  if (/;/.test(t)) return true; // statement separator e.g. `; notes: Record`
  if (/\)\./.test(t)) return true; // method/property access `).foo` caught across `>...<`
  return false;
}

function walk(dir: string, acc: string[] = []): string[] {
  let entries: string[] = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (p.endsWith('.tsx') && !p.includes('.test.')) acc.push(p);
  }
  return acc;
}

// A literal looks like user-facing prose if it has a letter and at least one
// ASCII space or Spanish accent — single tokens / symbols / classNames don't.
function looksLikeProse(s: string): boolean {
  const t = s.trim();
  if (t.length < 2) return false;
  if (ALLOWLIST.has(t)) return false;
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(t)) return false; // needs a letter
  if (looksLikeCode(t)) return false; // JS expression fragment, not prose
  // multi-word OR contains a Spanish accent (single accented word still prose)
  return /\s/.test(t) || /[áéíóúñ¿¡ÁÉÍÓÚÑ]/.test(t);
}

interface Violation { file: string; line: number; vector: string; text: string }

function scanFile(rel: string): Violation[] {
  const src = readFileSync(resolve(ROOT, rel), 'utf8');
  const lines = src.split('\n');
  const out: Violation[] = [];
  lines.forEach((raw, i) => {
    const line = raw;
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('import ')) return;

    // Vector A: toast('literal') / toast("literal") (not toast(t. / toast(`)
    const toastM = line.match(/\btoast\(\s*(['"])(.*?)\1/);
    if (toastM && looksLikeProse(toastM[2])) {
      out.push({ file: rel, line: i + 1, vector: 'toast', text: toastM[2] });
    }

    // Vector B: literal text attributes
    const attrRe = /\b(placeholder|title|aria-label)\s*=\s*(['"])(.*?)\2/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(line)) !== null) {
      if (looksLikeProse(am[3])) out.push({ file: rel, line: i + 1, vector: am[1], text: am[3] });
    }

    // Vector C: JSX text node literal  >text<  (multi-word / accented prose)
    const textRe = />\s*([^<>{}\n][^<>{}\n]*?)\s*</g;
    let tm: RegExpExecArray | null;
    while ((tm = textRe.exec(line)) !== null) {
      const txt = tm[1];
      if (looksLikeProse(txt)) out.push({ file: rel, line: i + 1, vector: 'jsx-text', text: txt });
    }
  });
  return out;
}

// Absolute gate: the debt has been swept to zero, so ANY hardcoded user-facing
// literal in apps/web (outside the allowlist) fails CI. Route new text through
// t.*; for a genuinely locale-invariant token (brand, acronym, provider-less
// boundary), add the exact string to ALLOWLIST above with a reason.
describe('i18n: no hardcoded user-facing strings in apps/web components', () => {
  const files = SCAN_DIRS.flatMap((d) => walk(resolve(ROOT, d)).map((f) => f.replace(ROOT + '/', '')))
    .filter((f) => !EXCLUDE_PATHS.some((ex) => f.startsWith(ex)));
  const violations = files.flatMap(scanFile);

  it('all user-facing text is routed through t.* (zero hardcoded literals)', () => {
    if (violations.length > 0) {
      // eslint-disable-next-line no-console
      console.log(`\n[i18n] ${violations.length} hardcoded literal(s) — route through t.* (or allowlist if locale-invariant):`);
      for (const v of violations.slice(0, 100)) {
        console.log(`  ${v.file}:${v.line} [${v.vector}] ${JSON.stringify(v.text)}`); // eslint-disable-line no-console
      }
    }
    expect(violations).toEqual([]);
  });
});
