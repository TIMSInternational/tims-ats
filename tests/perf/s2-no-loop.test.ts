/**
 * Tripwire: verifies that getUserGrowth and getMrrTrend in platform/dashboard.ts
 * do NOT contain `await db.` inside a for-loop or .map() call, and that they
 * use `$queryRaw` (not `$queryRawUnsafe`).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const dashboardPath = resolve(
  __dirname,
  '../../packages/api/src/routers/platform/dashboard.ts',
);
const src = readFileSync(dashboardPath, 'utf-8');

// Extract the source of getUserGrowth and getMrrTrend procedures
function extractProcedure(source: string, name: string): string {
  const startPattern = `${name}: platformProcedure`;
  const start = source.indexOf(startPattern);
  if (start === -1) throw new Error(`Procedure ${name} not found`);
  // Find the next top-level procedure or end of router by scanning for the
  // closing brace at the same nesting depth
  let depth = 0;
  let i = start;
  let firstBrace = false;
  while (i < source.length) {
    if (source[i] === '{') { depth++; firstBrace = true; }
    if (source[i] === '}') {
      depth--;
      if (firstBrace && depth === 0) return source.slice(start, i + 1);
    }
    i++;
  }
  return source.slice(start);
}

describe('s2-no-loop tripwire: platform/dashboard.ts', () => {
  it('getUserGrowth: no await db. inside for( or .map(', () => {
    const body = extractProcedure(src, 'getUserGrowth');
    // Must not contain a for-loop that has await db. inside it
    expect(body).not.toMatch(/for\s*\([^)]*\)[^}]*await\s+db\./s);
    // Must not contain .map( that has await db. inside it
    expect(body).not.toMatch(/\.map\s*\([^)]*=>[^)]*await\s+db\./s);
  });

  it('getMrrTrend: no await db. inside for( or .map(', () => {
    const body = extractProcedure(src, 'getMrrTrend');
    expect(body).not.toMatch(/for\s*\([^)]*\)[^}]*await\s+db\./s);
    expect(body).not.toMatch(/\.map\s*\([^)]*=>[^)]*await\s+db\./s);
  });

  it('getUserGrowth: uses $queryRaw (not $queryRawUnsafe)', () => {
    const body = extractProcedure(src, 'getUserGrowth');
    // $queryRaw followed by the generic type or backtick (tagged template)
    expect(body).toMatch(/\$queryRaw[<`]/);
    expect(body).not.toMatch(/\$queryRawUnsafe/);
  });

  it('getMrrTrend: uses $queryRaw (not $queryRawUnsafe)', () => {
    const body = extractProcedure(src, 'getMrrTrend');
    expect(body).toMatch(/\$queryRaw[<`]/);
    expect(body).not.toMatch(/\$queryRawUnsafe/);
  });

  // FIX 3 — camelCase column name guard.
  // Raw SQL in $queryRaw tagged templates must use snake_case DB column names.
  // A quoted identifier matching "someCamelCase" (lower letter followed by
  // upper letter inside double-quotes) is a Prisma field name, not a DB column,
  // and will throw `column "..." does not exist` at runtime.
  it('getUserGrowth: $queryRaw SQL contains no camelCase quoted identifiers', () => {
    const body = extractProcedure(src, 'getUserGrowth');
    // Extract the raw SQL template literal (between the backticks)
    const sqlMatch = body.match(/\$queryRaw<[^>]*>`([\s\S]*?)`/);
    if (!sqlMatch) throw new Error('Could not extract $queryRaw SQL from getUserGrowth');
    const sql = sqlMatch[1];
    // No "word containing an uppercase letter in a camelCase position"
    expect(sql).not.toMatch(/"[a-z][a-zA-Z]*[A-Z][a-zA-Z]*"/);
  });

  it('getMrrTrend: $queryRaw SQL contains no camelCase quoted identifiers', () => {
    const body = extractProcedure(src, 'getMrrTrend');
    const sqlMatch = body.match(/\$queryRaw<[^>]*>`([\s\S]*?)`/);
    if (!sqlMatch) throw new Error('Could not extract $queryRaw SQL from getMrrTrend');
    const sql = sqlMatch[1];
    expect(sql).not.toMatch(/"[a-z][a-zA-Z]*[A-Z][a-zA-Z]*"/);
  });
});
