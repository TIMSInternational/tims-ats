// tests/security/i18n-no-hardcoded-strings.test.ts
//
// i18n enforcement gate: fails when a user-facing string is hardcoded in an
// apps/web component instead of going through the i18n dictionary (`t.*`).
// Matches the repo's source-scan tripwire convention (node env, reads source
// as text). Runs in CI's vitest job + the local /gate.
//
// Detected leak vectors:
//   A. literal first arg to toast(...)          -> toast('Guardado')
//   B. literal placeholder/title/aria-label     -> placeholder="Buscar..."
//   C. JSX text node literals, multi-line-aware -> <span>No hay\n  datos</span>
//   D. ternary branches, both string literals   -> {cond ? 'A' : 'B'}
//   E. literal arg to a setError/setMessage-style setter -> setError('Algo fallo')
//
// Known residual blind spot (2026-07-01 widening): JS TEMPLATE LITERALS with
// interpolation (`` `Hola ${name}` ``) are not scanned — reliably parsing
// interpolated text without a real JSX/AST parser isn't worth the false-positive
// risk. A genuine JSX-aware AST scan would close this; out of scope for this
// lightweight text-scan tripwire.
//
// To accept a specific exception, add its EXACT trimmed string to ALLOWLIST
// (technical tokens, symbols, format hints). Keep this list short and reviewed.
// For pre-existing debt this scanner newly surfaces that's out of scope for
// the current fix, grandfather it into KNOWN_DEBT by file:line (not by text).
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { resolve, join } from 'path';

const ROOT = resolve(__dirname, '../..');
const SCAN_DIRS = ['apps/web/app', 'apps/web/components'];

// Files/dirs excluded from the scan (dev/preview tooling that renders raw
// single-language template content, not a localized product surface).
const EXCLUDE_PATHS = ['apps/web/app/(admin)/platform/email-preview/'];

// Known pre-existing debt, grandfathered by exact `file:line` location (NOT by
// text — so the same string appearing at a NEW, un-reviewed location is still
// caught). Discovered 2026-07-01 when the scanner below was widened to catch
// multi-line JSX text and ternary/setter string literals — these are real
// hardcoded strings in ADMIN-ONLY internal pages (dashboards, platform/org
// management, interview room, offer letters, pipeline, talent pools,
// succession), out of scope for the specific bug this widening was built to
// fix (candidate/auth-facing entry flows — login, register, accept-invitation,
// offer e-signature, public careers portal — all already fixed and covered).
// Follow-up: burn this list down to zero; remove an entry here as you migrate
// the string to `t.*` in both es.json and en.json.
// Keyed by file:line:vector (not just file:line) — two different violations
// can legitimately land on the same line (e.g. a ternary's two branches are
// now anchored to each branch's own line, but a jsx-text and a ternary vector
// could still coincide), so the vector disambiguates them.
const KNOWN_DEBT = new Set<string>([
  'apps/web/app/(admin)/dashboard/activity-feed.tsx:103:ternary',
  'apps/web/app/(admin)/dashboard/charts/customer-health.tsx:45:jsx-text',
  'apps/web/app/(admin)/dashboard/charts/plan-distribution.tsx:93:jsx-text',
  'apps/web/app/(admin)/dashboard/charts/revenue-by-customer.tsx:67:jsx-text',
  'apps/web/app/(admin)/dashboard/customer-table.tsx:165:jsx-text',
  'apps/web/app/(admin)/people/onboarding/onboarding-panels.tsx:106:ternary',
  'apps/web/app/(admin)/people/onboarding/onboarding-panels.tsx:167:jsx-text',
  'apps/web/app/(admin)/people/onboarding/onboarding-panels.tsx:185:jsx-text',
  'apps/web/app/(admin)/people/onboarding/onboarding-table.tsx:159:jsx-text',
  'apps/web/app/(admin)/people/performance/feedback-panel.tsx:130:jsx-text',
  'apps/web/app/(admin)/people/performance/feedback-panel.tsx:178:jsx-text',
  'apps/web/app/(admin)/platform/organizations/[id]/sections/activity-section.tsx:57:jsx-text',
  'apps/web/app/(admin)/platform/organizations/[id]/sections/billing-section.tsx:99:jsx-text',
  'apps/web/app/(admin)/platform/organizations/[id]/sections/billing-section.tsx:102:jsx-text',
  'apps/web/app/(admin)/platform/organizations/[id]/sections/overview-section.tsx:183:jsx-text',
  'apps/web/app/(admin)/platform/organizations/[id]/sections/users-section.tsx:123:jsx-text',
  'apps/web/app/(admin)/platform/organizations/org-actions-dropdown.tsx:28:ternary',
  'apps/web/app/(admin)/platform/users/invite-wizard.tsx:119:jsx-text',
  'apps/web/app/(admin)/platform/users/invite-wizard.tsx:172:jsx-text',
  'apps/web/app/(admin)/platform/users/invite-wizard.tsx:188:jsx-text',
  'apps/web/app/(admin)/recruitment/interviews/[id]/room/page.tsx:100:jsx-text',
  'apps/web/app/(admin)/recruitment/interviews/[id]/room/scorecard-panel.tsx:108:jsx-text',
  'apps/web/app/(admin)/recruitment/interviews/[id]/room/video-area.tsx:81:ternary',
  'apps/web/app/(admin)/recruitment/interviews/[id]/room/video-controls.tsx:63:ternary',
  'apps/web/app/(admin)/recruitment/interviews/[id]/room/video-controls.tsx:70:ternary',
  'apps/web/app/(admin)/recruitment/interviews/schedule-modal.fields.tsx:171:ternary',
  'apps/web/app/(admin)/recruitment/offers/_components/offer-detail-view.parts.tsx:86:jsx-text',
  'apps/web/app/(admin)/recruitment/offers/_components/offer-detail-view.parts.tsx:96:ternary',
  'apps/web/app/(admin)/recruitment/offers/_components/offer-letter-modal.tsx:51:jsx-text',
  'apps/web/app/(admin)/recruitment/offers/_components/offer-letter.tsx:43:jsx-text',
  'apps/web/app/(admin)/recruitment/offers/_components/offer-letter.tsx:74:jsx-text',
  'apps/web/app/(admin)/recruitment/offers/_components/offer-letter.tsx:178:jsx-text',
  'apps/web/app/(admin)/recruitment/offers/_components/offer-letter.tsx:196:jsx-text',
  'apps/web/app/(admin)/recruitment/offers/_components/offer-letter.tsx:199:jsx-text',
  'apps/web/app/(admin)/recruitment/offers/_components/offer-validations.tsx:174:jsx-text',
  'apps/web/app/(admin)/recruitment/offers/_components/signing-link-modal.tsx:88:jsx-text',
  'apps/web/app/(admin)/recruitment/pipeline/add-candidate-modal.tsx:197:ternary',
  'apps/web/app/(admin)/recruitment/pipeline/add-candidate-modal.tsx:220:ternary',
  'apps/web/app/(admin)/recruitment/pipeline/pipeline-list-view.tsx:133:jsx-text',
  'apps/web/app/(admin)/recruitment/pipeline/pipeline-list-view.tsx:137:jsx-text',
  'apps/web/app/(admin)/recruitment/talent-pools/talent-pool-filters.tsx:163:jsx-text',
  'apps/web/app/(admin)/recruitment/talent-pools/talent-pool-filters.tsx:166:jsx-text',
  'apps/web/app/(admin)/recruitment/talent-pools/talent-pool-table.tsx:137:jsx-text',
  'apps/web/app/(admin)/recruitment/vacancies/create-modal.tsx:166:ternary',
  'apps/web/app/(admin)/talent/succession/exit-simulator.tsx:106:ternary',
  'apps/web/app/(admin)/talent/succession/exit-simulator.tsx:122:ternary',
]);

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
  if (looksLikeClassName(t)) return true; // conditional Tailwind className string, not prose
  // Conditional-render boundary, e.g. `) : q.isError ? (` or `) : isNew(vacancy.createdAt) ? (`
  // — extremely common React pattern (`{q.isLoading ? (<A/>) : q.isError ? (<B/>) : (<C/>)}`)
  // that a multi-line-aware scan now sees as text sandwiched between two tags.
  if (/^[\s)]*:\s*!?[\w.?()]+\s*\?\s*\(?[\s)]*$/.test(t)) return true;
  // Object-literal boundary caught across two JSX-element VALUES in a plain
  // object (e.g. `Record<string, ReactNode>` maps of icons/labels), shaped
  // like `,\n  video:` — requires BOTH a leading comma AND a trailing bare
  // colon (not either alone: real prose can legitimately end with a colon,
  // e.g. "Expected format:", so that alone must not be treated as code).
  if (/^,/.test(t) && /:\s*$/.test(t)) return true;
  // Method call / TS type-guard fragment, e.g. `.filter(`, `r is Record`.
  if (/\.\w+\(/.test(t) || /\bis\s+[A-Z]\w*/.test(t)) return true;
  // Object-literal key:'value' shape caught when a `<`/`>` glyph is used as a
  // literal DATA value elsewhere in the file (e.g. `{ gt: '>', lt: '<' }`),
  // not as JSX markup — a scanner distinguishing that reliably needs a real
  // JSX parser; this is the pragmatic text-scan approximation.
  if (/\b\w+:\s*['"]/.test(t)) return true;
  // Bare dotted identifier / property access with no spaces, e.g. `k.length`,
  // `r.progress` — never real prose (real text has spaces or is a single word).
  if (/^[a-zA-Z_$][\w$]*\.[\w$.]+$/.test(t)) return true;
  return false;
}

// A conditional string is a Tailwind/CSS class list — not prose — when every
// space-separated token is class-token-shaped AND at least one token matches
// a common Tailwind utility prefix. Ternaries picking between two className
// strings are extremely common in this codebase (`cond ? 'bg-x' : 'bg-y'`).
function looksLikeClassName(t: string): boolean {
  const tokens = t.trim().split(/\s+/);
  if (tokens.length === 0 || tokens[0] === '') return false;
  const allClassShaped = tokens.every((tok) => /^[a-zA-Z0-9:/#.\-[\]]+$/.test(tok));
  if (!allClassShaped) return false;
  return tokens.some((tok) =>
    /^(bg-|text-|border|w-|h-|p[xytlbr]?-|m[xytlbr]?-|rounded|flex|grid|hover:|focus:|active:|disabled:|shadow|gap-|space-|items-|justify-|transition|opacity-|cursor-|absolute|relative|inline|block|font-|leading-|tracking-|z-|overflow-|max-w|min-w)/.test(tok),
  );
}

// Byte-offset -> 1-based line number, for whole-file (multi-line-aware) scans.
function buildLineIndex(src: string): number[] {
  const offsets: number[] = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') offsets.push(i + 1);
  return offsets;
}
function lineForIndex(offsets: number[], index: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
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

  // Per-line vectors — these arguments are single-line in practice.
  lines.forEach((line, i) => {
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

    // Vector E: literal arg to a setter that clearly carries a user-facing
    // message (setError/setMessage-style names), e.g. setError('Algo fallo').
    const setterRe = /\bset[A-Z]\w*(?:Error|Message)\w*\(\s*(['"])(.*?)\1\s*\)/g;
    let sm: RegExpExecArray | null;
    while ((sm = setterRe.exec(line)) !== null) {
      if (looksLikeProse(sm[2]!)) out.push({ file: rel, line: i + 1, vector: 'setter-literal', text: sm[2]! });
    }
  });

  // Whole-file, multi-line-aware vectors — this codebase's prettier-style
  // formatting routinely puts JSX text and ternary branches on their own
  // line, invisible to a per-line scan.
  const offsets = buildLineIndex(src);

  // Vector C: JSX text node literal `>...<`, now spanning newlines — this
  // codebase's prettier-style formatting routinely puts JSX text on its own
  // line between a tag on one line and its closing tag on the next, which a
  // per-line scan (the prior implementation) can never see. Uses `d` (indices)
  // so the reported line is where the TEXT itself starts (after skipping the
  // tag's `>` and any leading whitespace/newlines), not the tag's own line.
  const textRe = />\s*([^<>{}][^<>{}]*?)\s*</gd;
  let tm: RegExpExecArray | null;
  while ((tm = textRe.exec(src)) !== null) {
    const txt = tm[1]!.trim();
    if (looksLikeProse(txt)) {
      const groupStart = (tm as unknown as { indices: Array<[number, number] | undefined> }).indices[1]![0];
      const leadingWs = tm[1]!.match(/^\s*/)![0].length;
      out.push({ file: rel, line: lineForIndex(offsets, groupStart + leadingWs), vector: 'jsx-text', text: txt });
    }
  }

  // Vector D: ternary branches that are both plain string literals — catches
  // `{cond ? 'A' : 'B'}` embedded directly in JSX and `setX(cond ? 'A' : 'B')`.
  // Uses `d` (indices) so each branch reports ITS OWN line, not the `?` line
  // (a multiline ternary otherwise gets both branches mis-anchored to the
  // condition's line).
  const ternaryRe = /\?\s*(['"])((?:(?!\1)[\s\S])*?)\1\s*:\s*(['"])((?:(?!\3)[\s\S])*?)\3/gd;
  let nm: RegExpExecArray | null;
  while ((nm = ternaryRe.exec(src)) !== null) {
    const indices = (nm as unknown as { indices: Array<[number, number] | undefined> }).indices;
    if (looksLikeProse(nm[2]!)) out.push({ file: rel, line: lineForIndex(offsets, indices[2]![0]), vector: 'ternary', text: nm[2]! });
    if (looksLikeProse(nm[4]!)) out.push({ file: rel, line: lineForIndex(offsets, indices[4]![0]), vector: 'ternary', text: nm[4]! });
  }

  return out;
}

// Gate: any hardcoded user-facing literal in apps/web (outside the allowlist
// and KNOWN_DEBT) fails CI. Route new text through t.*; for a genuinely
// locale-invariant token (brand, acronym, provider-less boundary), add the
// exact string to ALLOWLIST above with a reason. For pre-existing debt this
// scanner newly catches, add the file:line to KNOWN_DEBT with a reason —
// don't widen ALLOWLIST for that (it would hide the same string everywhere).
describe('i18n: no hardcoded user-facing strings in apps/web components', () => {
  const files = SCAN_DIRS.flatMap((d) => walk(resolve(ROOT, d)).map((f) => f.replace(ROOT + '/', '')))
    .filter((f) => !EXCLUDE_PATHS.some((ex) => f.startsWith(ex)));
  const violations = files.flatMap(scanFile).filter((v) => !KNOWN_DEBT.has(`${v.file}:${v.line}:${v.vector}`));

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
