import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

// #200 — SQL-injection guard for the C# platform service.
//
// WHY. `tests/security/sql-injection.test.ts` and the CI "No unsafe SQL patterns" grep only ever looked at
// TypeScript. In EF Core / Npgsql the safe and the unsafe call read almost identically:
//
//   db.Database.ExecuteSqlInterpolatedAsync($"UPDATE t SET x = {value}")  // parameterized — safe
//   db.Database.ExecuteSqlRawAsync($"UPDATE t SET x = '{value}'")         // string interpolation — INJECTION
//
// and the second compiles, reads naturally, and passed every gate. Every C# slice adds hand-written SQL (native
// enum casts, COALESCE partial updates, unnest batch inserts), so the sink count only grows.
//
// WHAT IS A SINK. The SQL-text argument of:
//   • ExecuteSqlRaw / ExecuteSqlRawAsync / FromSqlRaw / SqlQueryRaw<T>   (EF Core "Raw" family)
//   • new NpgsqlCommand(…) / new NpgsqlBatchCommand(…)                     (first constructor argument)
//   • … CommandText = …                                                     (any assignment)
// The `…Interpolated` EF variants and `FromSql`/`SqlQuery`/`ExecuteSql` (FormattableString overloads) bind their
// holes as parameters and are NOT sinks.
//
// WHAT FAILS. The SQL text must be a plain (non-interpolated) string literal, or an identifier whose declaration in
// the same file is one (`const string sql = """…"""`, `var sql = "…"`). Anything else fails: an interpolated
// string ($"…", $"""…""", $@"…"), a concatenation (`+`), a call that BUILDS the text (string.Join/Format/Concat,
// a helper), or an identifier that cannot be traced to a literal. Constructed SQL that is genuinely safe (it only
// splices compile-time constants) is allowed by EXACT file:line below, each with its justification — so the next
// constructed statement has to be argued for in review rather than slipping through a loosened pattern.
//
// LIMITS, stated so nobody over-reads a green run: this is a lexical scan, not a data-flow analysis. It resolves
// an identifier only to its declaration in the same file, and does not follow later reassignment.

const ROOT = join(__dirname, '..', '..');
const SCAN_ROOT = 'services';
const SKIP_DIRS = new Set(['bin', 'obj', 'tests', 'node_modules', '.git']);

/**
 * Constructed SQL known to be safe, by `file:line` of the SINK. A line shift fails the test on purpose: the entry
 * must be re-checked, not silently carried. A stale entry (no longer a violation) also fails.
 */
const ALLOWLIST: Record<string, string> = {
  'services/Tims.Platform/src/Tims.Infrastructure/Access/ScopedProbe.cs:58':
    'Scope-predicate composition: the table/column identifiers come from ScopeProbeRegistry constants via ScopePredicateSqlTranslator, and every id/value is a bound @pN/@ids/@org Npgsql parameter (parsed with Guid.Parse).',
  'services/Tims.Platform/src/Tims.Infrastructure/Compensation/CompensationReadRepository.cs:193':
    'Column list chosen from fixed literals by entitlement booleans (§21 select-for); every value is a bound Npgsql parameter. Plus the scope-predicate composition (registry identifiers, bound values).',
  'services/Tims.Platform/src/Tims.Infrastructure/Compensation/CompensationReadRepository.cs:336':
    'Column list chosen from fixed literals by entitlement booleans (§21 select-for); every value is a bound Npgsql parameter. The optional JOIN is a fixed literal.',
  'services/Tims.Platform/src/Tims.Infrastructure/Compensation/CompensationReadRepository.cs:536':
    'Column list chosen from fixed literals by entitlement booleans (§21 select-for); every value is a bound Npgsql parameter.',
  'services/Tims.Platform/src/Tims.Infrastructure/Engagement/EngagementReadRepository.cs:470':
    'Scope-predicate composition: the table/column identifiers come from ScopeProbeRegistry constants via ScopePredicateSqlTranslator, and every id/value is a bound @pN/@ids/@org Npgsql parameter (parsed with Guid.Parse).',
  'services/Tims.Platform/src/Tims.Infrastructure/Engagement/EngagementWriteRepository.cs:311':
    'Scope-predicate composition: the table/column identifiers come from ScopeProbeRegistry constants via ScopePredicateSqlTranslator, and every id/value is a bound @pN/@ids/@org Npgsql parameter (parsed with Guid.Parse).',
  'services/Tims.Platform/src/Tims.Infrastructure/Monitoring/MonitoringReadRepository.cs:267':
    'Scope-predicate composition: the table/column identifiers come from ScopeProbeRegistry constants via ScopePredicateSqlTranslator, and every id/value is a bound @pN/@ids/@org Npgsql parameter (parsed with Guid.Parse).',
  'services/Tims.Platform/src/Tims.Infrastructure/NineBox/NineBoxReadRepository.cs:236':
    'Scope-predicate composition: the table/column identifiers come from ScopeProbeRegistry constants via ScopePredicateSqlTranslator, and every id/value is a bound @pN/@ids/@org Npgsql parameter (parsed with Guid.Parse). Optional filters are fixed literal fragments with bound values.',
  'services/Tims.Platform/src/Tims.Infrastructure/NineBox/NineBoxReadRepository.cs:618':
    'Scope-predicate composition: the table/column identifiers come from ScopeProbeRegistry constants via ScopePredicateSqlTranslator, and every id/value is a bound @pN/@ids/@org Npgsql parameter (parsed with Guid.Parse).',
  'services/Tims.Platform/src/Tims.Infrastructure/Succession/SuccessionReadRepository.cs:576':
    'Scope-predicate composition: the table/column identifiers come from ScopeProbeRegistry constants via ScopePredicateSqlTranslator, and every id/value is a bound @pN/@ids/@org Npgsql parameter (parsed with Guid.Parse). idClause is a fixed literal fragment.',
  'services/Tims.Platform/src/Tims.Infrastructure/Succession/SuccessionReadRepository.cs:635':
    'Column list chosen from fixed literals by entitlement booleans (§21 select-for); every value is a bound Npgsql parameter. Plus the scope-predicate composition.',
  'services/Tims.Platform/src/Tims.Infrastructure/TeamIntel/TeamIntelReadRepository.cs:202':
    'Scope-predicate composition: the table/column identifiers come from ScopeProbeRegistry constants via ScopePredicateSqlTranslator, and every id/value is a bound @pN/@ids/@org Npgsql parameter (parsed with Guid.Parse).',
  'services/Tims.Platform/src/Tims.Infrastructure/Fx/FxRateWriteRepository.cs:62':
    'UNION over table names from the private CurrencyTables constant, each filtered through to_regclass first; no caller value reaches the text.',
  'services/Tims.Platform/src/Tims.Infrastructure/NineBox/NineBoxWriteRepository.cs:185':
    'Raw interpolated literal whose only hole is a compile-time const constraint name; every value is an Npgsql parameter.',
  'services/Tims.Platform/src/Tims.Infrastructure/Notification/NotificationWriteRepository.cs:222':
    'Column list and @placeholders are built only from a fixed set of known column names chosen by HasValue checks; every value is an Npgsql parameter.',
};

// ── Lexer helpers ────────────────────────────────────────────────────────────────────────────────────────────

/** Blank out `//` comment lines (doc comments mention sinks in prose) while preserving offsets and newlines. */
function maskCommentLines(text: string): string {
  return text
    .split('\n')
    .map((line) => (/^\s*\/\//.test(line) ? ' '.repeat(line.length) : line))
    .join('\n');
}

function skipWs(text: string, i: number): number {
  while (i < text.length && /\s/.test(text[i]!)) i++;
  return i;
}

/** End index (exclusive) of a NON-interpolated string literal starting at `i` (at its first `"` or `@`). */
function endOfLiteral(text: string, i: number): number {
  if (text[i] === '@') {
    // verbatim: "" is an escaped quote
    let j = i + 2;
    while (j < text.length) {
      if (text[j] === '"') {
        if (text[j + 1] === '"') {
          j += 2;
          continue;
        }
        return j + 1;
      }
      j++;
    }
    return text.length;
  }
  let quotes = 0;
  while (text[i + quotes] === '"') quotes++;
  if (quotes >= 3) {
    const close = text.indexOf('"'.repeat(quotes), i + quotes);
    return close < 0 ? text.length : close + quotes;
  }
  if (quotes === 2) return i + 2; // empty ""
  let j = i + 1;
  while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
  return j + 1;
}

type Kind = 'literal' | 'interpolated' | 'concat' | 'call' | 'identifier' | 'other' | 'none';

/** Classifies the expression that starts at `i` (the SQL-text argument / right-hand side). */
function classifyExpression(text: string, start: number): { kind: Kind; name?: string } {
  const i = skipWs(text, start);
  const ch = text[i];
  if (ch === undefined || ch === ')') return { kind: 'none' };
  if (ch === '$' || (ch === '@' && text[i + 1] === '$')) return { kind: 'interpolated' };
  if (ch === '"' || (ch === '@' && text[i + 1] === '"')) {
    const after = skipWs(text, endOfLiteral(text, i));
    const next = text[after];
    if (next === '+') return { kind: 'concat' };
    if (next === ',' || next === ')' || next === ';' || next === '}') return { kind: 'literal' };
    if (next === '.') return { kind: 'call' };
    return { kind: 'other' };
  }
  const ident = /^[A-Za-z_][\w.]*/.exec(text.slice(i));
  if (ident) {
    const after = skipWs(text, i + ident[0].length);
    const next = text[after];
    if (next === '(' || next === '<') return { kind: 'call' };
    if (next === '+') return { kind: 'concat' };
    if (next === ',' || next === ')' || next === ';' || next === '}') {
      return { kind: 'identifier', name: ident[0].split('.').pop()! };
    }
    return { kind: 'other' };
  }
  return { kind: 'other' };
}

const SINKS: RegExp[] = [
  /\b(?:ExecuteSqlRaw(?:Async)?|FromSqlRaw|SqlQueryRaw)\s*(?:<[^>()]*>)?\s*\(/g,
  /\bnew\s+Npgsql(?:Batch)?Command\s*\(/g,
  /\bCommandText\s*=(?!=)/g,
];

/** Resolve an identifier to the classification of its literal initializer in the same file, if any. */
function resolveIdentifier(text: string, name: string, useAt: number): Kind {
  const decl = new RegExp(`\\b(?:const\\s+string|string\\??|var)\\s+${name}\\s*=(?!=)`, 'g');
  let best: RegExpExecArray | null = null;
  let fallback: RegExpExecArray | null = null;
  for (let m = decl.exec(text); m; m = decl.exec(text)) {
    if (m.index < useAt) best = m;
    else if (!fallback) fallback = m; // a field declared below its use
  }
  const found = best ?? fallback;
  if (!found) return 'identifier';
  // A `const string` is a compile-time constant by the language's own rules — whatever its spelling (a `+` chain
  // of literals, or a C# 10 constant interpolated string), no runtime value can reach it.
  if (found[0].startsWith('const')) return 'literal';
  const init = classifyExpression(text, found.index + found[0].length).kind;
  return init === 'literal' ? 'literal' : init;
}

interface Violation {
  location: string;
  kind: Kind;
  snippet: string;
}

function scanCSharp(file: string, raw: string): Violation[] {
  const text = maskCommentLines(raw);
  const out: Violation[] = [];
  for (const sink of SINKS) {
    sink.lastIndex = 0;
    for (let m = sink.exec(text); m; m = sink.exec(text)) {
      const argStart = m.index + m[0].length;
      let { kind, name } = classifyExpression(text, argStart);
      if (kind === 'none' || kind === 'literal') continue;
      if (kind === 'identifier') kind = resolveIdentifier(text, name!, m.index);
      if (kind === 'literal') continue;
      const line = text.slice(0, m.index).split('\n').length;
      const snippet = raw.split('\n')[line - 1]!.trim();
      out.push({ location: `${file}:${line}`, kind, snippet });
    }
  }
  return out;
}

// ── Walk ─────────────────────────────────────────────────────────────────────────────────────────────────────

function walk(rel: string, out: string[]): void {
  let entries: string[];
  try {
    entries = readdirSync(join(ROOT, rel));
  } catch {
    return;
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const childRel = `${rel}/${name}`;
    let st;
    try {
      st = statSync(join(ROOT, childRel));
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(childRel, out);
    else if (name.endsWith('.cs')) out.push(childRel);
  }
}

const FILES: string[] = [];
walk(SCAN_ROOT, FILES);
const VIOLATIONS: Violation[] = FILES.flatMap((file) => scanCSharp(file, readFileSync(join(ROOT, file), 'utf8')));

describe('C# SQL-injection guard (#200)', () => {
  describe('the scan is not vacuous', () => {
    it('walks the platform service source (at least 500 .cs files)', () => {
      expect(existsSync(join(ROOT, 'services/Tims.Platform/src'))).toBe(true);
      const n = FILES.filter((f) => f.startsWith('services/Tims.Platform/src/')).length;
      expect(n, `services/Tims.Platform/src contributed ${n} files`).toBeGreaterThanOrEqual(500);
    });

    it('reaches the sinks it is meant to police', () => {
      // Each of these files holds raw SQL today. If the walker stops reaching them every assertion still passes.
      for (const file of [
        'services/Tims.Platform/src/Tims.Infrastructure/TenantScope.cs',
        'services/Tims.Platform/src/Tims.Infrastructure/InterviewJoin/CandidateInterviewJoinRepository.cs',
        'services/Tims.Platform/src/Tims.Infrastructure/Evaluation360/Evaluation360WriteRepository.cs',
      ]) {
        expect(FILES).toContain(file);
      }
    });

    it('excludes test projects (they build fixtures with interpolated DDL by design)', () => {
      expect(FILES.some((f) => f.includes('/tests/'))).toBe(false);
    });
  });

  describe('the classifier is not broken (planted calls)', () => {
    const flagged = (code: string) => scanCSharp('Planted.cs', code).map((v) => v.kind);

    it.each([
      [
        'interpolated EF raw',
        'await db.Database.ExecuteSqlRawAsync($"UPDATE organizations SET name = \'{name}\'");',
        'interpolated',
      ],
      [
        'interpolated raw-string EF raw',
        'db.Database.ExecuteSqlRaw($"""DELETE FROM t WHERE id = \'{id}\'""");',
        'interpolated',
      ],
      ['verbatim interpolated', 'db.Set<T>().FromSqlRaw(@$"SELECT * FROM t WHERE x = {x}");', 'interpolated'],
      ['concatenated EF raw', 'db.Database.ExecuteSqlRaw("DELETE FROM t WHERE id = \'" + id + "\'");', 'concat'],
      ['SqlQueryRaw<T> with a built string', 'db.Database.SqlQueryRaw<int>(string.Format("SELECT {0}", x));', 'call'],
      [
        'NpgsqlCommand with interpolation',
        'new NpgsqlCommand($"SELECT * FROM t WHERE id = {id}", connection);',
        'interpolated',
      ],
      ['CommandText concatenation', 'command.CommandText = "SELECT * FROM t WHERE name = \'" + name + "\'";', 'concat'],
      [
        'CommandText from an interpolated local',
        'var sql = $"SELECT {col} FROM t";\ncommand.CommandText = sql;',
        'interpolated',
      ],
      ['CommandText from an unresolvable member', 'command.CommandText = request.Sql;', 'identifier'],
    ])('flags %s', (_label, code, kind) => {
      expect(flagged(code)).toEqual([kind]);
    });

    it.each([
      ['EF raw with a plain literal', 'await db.Database.ExecuteSqlRawAsync("SET LOCAL ROLE app_tenant", ct);'],
      [
        'EF raw with a const raw string',
        'const string sql = """\nSELECT @a\n""";\nawait db.Database.ExecuteSqlRawAsync(sql, args);',
      ],
      [
        'FormattableString overload',
        'await db.Database.ExecuteSqlInterpolatedAsync($"SELECT set_config(\'x\', {v}, true)");',
      ],
      ['FromSql (FormattableString)', 'db.Set<T>().FromSql($"SELECT * FROM t WHERE id = {id}");'],
      ['NpgsqlCommand with a raw literal', 'new NpgsqlCommand("""\nSELECT 1 WHERE id=@id\n""", connection);'],
      ['parameterless NpgsqlCommand', 'var c = new NpgsqlCommand();'],
      ['a sink named only in a comment', '// never write ExecuteSqlRaw($"…{x}") — use the Interpolated overload'],
    ])('does not flag %s', (_label, code) => {
      expect(flagged(code)).toEqual([]);
    });
  });

  it('every constructed SQL sink in services/ is allowlisted with a justification', () => {
    const unexpected = VIOLATIONS.filter((v) => !(v.location in ALLOWLIST));
    expect(
      unexpected.map((v) => `${v.location} [${v.kind}] ${v.snippet}`),
      'Raw SQL text must be a plain literal. Use a FormattableString overload (ExecuteSqlInterpolated / FromSql / ' +
        'SqlQuery) or bind values as NpgsqlParameters. If the text is constructed ONLY from compile-time constants, ' +
        'add the exact file:line to ALLOWLIST with the reason.',
    ).toEqual([]);
  });

  it('every allowlist entry is still a real sink (no stale exemptions)', () => {
    const live = new Set(VIOLATIONS.map((v) => v.location));
    const stale = Object.keys(ALLOWLIST).filter((loc) => !live.has(loc));
    expect(
      stale,
      'These allowlisted lines are no longer flagged — the code moved or changed; re-review and update.',
    ).toEqual([]);
  });
});
