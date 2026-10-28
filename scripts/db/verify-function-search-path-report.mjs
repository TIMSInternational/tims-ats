#!/usr/bin/env node
// Reporter for scripts/db/verify-function-search-path.sh (#376). Reads the scratch cluster's jsonlog and prints
// one verdict line per finding for ONE applied file:
//
//   PINNED     <file>: <routine>    a CREATE FUNCTION/PROCEDURE completed and proconfig has search_path=
//   UNPINNED   <file>: <routine>    it completed without one
//   UNVERIFIED <file>: <reason>     a routine-creating statement could not be checked (see below)
//   SYNTAX     <file>: <message>    PostgreSQL could not parse a statement (SQLSTATE 42601)
//
// Everything is attributed per STATEMENT as the server received it (log_statement=all), so psql's lexer — not
// ours — decides where statements begin and end. A statement is UNVERIFIED when:
//   - a CREATE FUNCTION/PROCEDURE started in it but did not complete (a type it needs is missing), or
//   - its text mentions `CREATE [OR REPLACE] FUNCTION|PROCEDURE` more times than the server started such a
//     command while executing it: the routine sits on a path the empty scratch database did not take (a DO
//     block that failed before its EXECUTE, an IF branch that was false). The mention count is a superset
//     check on text the server received — comments and string literals count too — so it can only
//     over-report, which fails closed.
//
// usage: node verify-function-search-path-report.mjs <jsonlog> <nonce> <database> <file-label>
import { readFileSync } from 'node:fs';

const [logPath, nonce, db, label] = process.argv.slice(2);
if (!logPath || !nonce || !db || !label) {
  console.error('usage: verify-function-search-path-report.mjs <jsonlog> <nonce> <database> <file-label>');
  process.exit(2);
}

const MARK = `search-path-gate:${nonce}:${db}:`;
const PSQL_INTERNAL = /^(SAVEPOINT|RELEASE|ROLLBACK TO) pg_psql_temporary_savepoint$/;
const GAP = String.raw`(?:\s|/\*[\s\S]*?\*/|--[^\n]*(?:\n|$))+`;
const CREATE_ROUTINE = new RegExp(String.raw`\bcreate${GAP}(?:or${GAP}replace${GAP})?(?:function|procedure)\b`, 'gi');

/** @typedef {{ text: string, starts: number, ends: { pinned: boolean, ident: string }[], errors: string[] }} Stmt */
/** @type {Stmt[]} */
const statements = [];
/** @type {Map<string, Stmt>} current statement per backend session */
const current = new Map();
const syntax = [];

for (const raw of readFileSync(logPath, 'utf8').split('\n')) {
  if (!raw.trim()) continue;
  /** @type {{ dbname?: string, session_id?: string, error_severity?: string, state_code?: string, message?: string }} */
  let e;
  try {
    e = JSON.parse(raw);
  } catch {
    console.log(`UNVERIFIED ${label}: the server log could not be parsed`);
    process.exit(1);
  }
  if (e.dbname !== db) continue;
  const session = e.session_id ?? '';
  const msg = e.message ?? '';
  if (e.error_severity === 'LOG' && msg.startsWith('statement: ')) {
    const text = msg.slice('statement: '.length);
    if (PSQL_INTERNAL.test(text.trim())) continue;
    const stmt = { text, starts: 0, ends: [], errors: [] };
    statements.push(stmt);
    current.set(session, stmt);
    continue;
  }
  const stmt = current.get(session);
  if (e.error_severity === 'LOG' && msg.startsWith(MARK)) {
    const rest = msg.slice(MARK.length);
    if (!stmt) continue;
    if (rest.startsWith('start:')) stmt.starts += 1;
    else if (rest.startsWith('end:pinned:')) stmt.ends.push({ pinned: true, ident: rest.slice('end:pinned:'.length) });
    else if (rest.startsWith('end:unpinned:')) stmt.ends.push({ pinned: false, ident: rest.slice('end:unpinned:'.length) });
    continue;
  }
  if (e.error_severity === 'ERROR') {
    if (e.state_code === '42601') syntax.push(msg);
    if (stmt) stmt.errors.push(`${e.state_code ?? '?'}: ${msg}`);
  }
}

let violations = 0;
const first = (s) => s.replace(/\s+/g, ' ').trim().slice(0, 100);
for (const s of statements) {
  for (const end of s.ends) {
    console.log(`${end.pinned ? 'PINNED    ' : 'UNPINNED  '} ${label}: ${end.ident}`);
    if (!end.pinned) violations += 1;
  }
  const mentions = (s.text.match(CREATE_ROUTINE) ?? []).length;
  if (s.starts > s.ends.length) {
    console.log(`UNVERIFIED ${label}: a CREATE FUNCTION/PROCEDURE did not complete, so its search_path could not be read — ${first(s.errors[0] ?? 'no error recorded')} [in: ${first(s.text)}]`);
    violations += 1;
  } else if (mentions > s.starts) {
    console.log(`UNVERIFIED ${label}: the statement mentions CREATE FUNCTION/PROCEDURE ${mentions} time(s) but the server started ${s.starts}; a path the scratch database did not take cannot be checked${s.errors[0] ? ` — ${first(s.errors[0])}` : ''} [in: ${first(s.text)}]`);
    violations += 1;
  }
}
for (const m of syntax) {
  console.log(`SYNTAX     ${label}: ${first(m)} (a routine inside an unparseable statement would go unchecked)`);
  violations += 1;
}
process.exit(violations > 0 ? 1 : 0);
