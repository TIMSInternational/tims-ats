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
// ours — decides where statements begin and end. The event trigger logs the tag of EVERY DDL command at
// ddl_command_start together with the server's top-level command tag (jsonlog `ps`), so each statement is
// classified by the server, not by reading its text:
//
//   - a top-level CREATE FUNCTION/PROCEDURE (ps = tag) is verified from proconfig. It is UNVERIFIED if it
//     started but did not complete (a type it needs is missing), or if its text contains `create` AND
//     `function|procedure` a SECOND time — a body that creates routines when called (tier-1 round 4);
//   - a routine created INSIDE another statement (ps = DO, SELECT, CALL, ...) is dynamic: which declarations
//     such code runs depends on database state, so it is UNVERIFIED even though what ran is checked (round 2);
//   - any other DDL statement (CREATE TRIGGER ... EXECUTE FUNCTION, GRANT ... ON FUNCTION, ALTER FUNCTION,
//     COMMENT ON FUNCTION) cannot create a routine when it runs, so it is not text-checked;
//   - every remaining statement — DO, SELECT, CALL, or one that failed before the server ran it — whose text
//     contains the substrings `create` and `function` or `procedure` anywhere, in any case, is UNVERIFIED: a
//     routine on a path the scratch database did not take (a DO block that failed first, an untaken IF, a
//     loop) cannot be checked (rounds 1, 2, 4).
// The text checks are SUBSTRING tests on what the server received — comments, literals and escape sequences
// such as E'CREATE\nFUNCTION' included — so they can only over-report, which fails closed. A keyword spelled
// out of fragments or character codes ('FUNC' || 'TION', chr(70)) evades them; see the gate script header.
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
const ROUTINE = new Set(['CREATE FUNCTION', 'CREATE PROCEDURE']);
const count = (text, re) => (text.match(re) ?? []).length;

/**
 * @typedef {{ tag: string, ps: string }} Start
 * @typedef {{ text: string, starts: Start[], ends: { pinned: boolean, ident: string }[], errors: string[] }} Stmt
 */
/** @type {Stmt[]} */
const statements = [];
/** @type {Map<string, Stmt>} current statement per backend session */
const current = new Map();
const syntax = [];

for (const raw of readFileSync(logPath, 'utf8').split('\n')) {
  if (!raw.trim()) continue;
  /** @type {{ dbname?: string, session_id?: string, error_severity?: string, state_code?: string, message?: string, ps?: string }} */
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
    const stmt = { text, starts: [], ends: [], errors: [] };
    statements.push(stmt);
    current.set(session, stmt);
    continue;
  }
  const stmt = current.get(session);
  if (e.error_severity === 'LOG' && msg.startsWith(MARK)) {
    const rest = msg.slice(MARK.length);
    if (!stmt) continue;
    if (rest.startsWith('start:')) stmt.starts.push({ tag: rest.slice('start:'.length), ps: e.ps ?? '' });
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
const unverified = (s, why) => {
  console.log(`UNVERIFIED ${label}: ${why}${s.errors[0] ? ` — ${first(s.errors[0])}` : ''} [in: ${first(s.text)}]`);
  violations += 1;
};
for (const s of statements) {
  for (const end of s.ends) {
    console.log(`${end.pinned ? 'PINNED    ' : 'UNPINNED  '} ${label}: ${end.ident}`);
    if (!end.pinned) violations += 1;
  }
  const routineStarts = s.starts.filter((st) => ROUTINE.has(st.tag));
  // The statement's own DDL tag, as the server reported it (ps equals the tag only at top level).
  const topTag = s.starts.find((st) => st.ps === st.tag)?.tag ?? null;
  const creates = count(s.text, /create/gi);
  const routines = count(s.text, /function|procedure/gi);

  if (routineStarts.length > s.ends.length) {
    unverified(s, 'a CREATE FUNCTION/PROCEDURE did not complete, so its search_path could not be read');
  } else if (routineStarts.some((st) => !ROUTINE.has(st.ps))) {
    const outer = [...new Set(routineStarts.filter((st) => !ROUTINE.has(st.ps)).map((st) => st.ps || '?'))].join('/');
    unverified(s, `a routine was created by dynamic SQL inside a top-level ${outer} statement; which declarations run depends on database state, so create it with a top-level CREATE statement`);
  } else if (topTag !== null && ROUTINE.has(topTag)) {
    if (creates >= 2 && routines >= 2) {
      unverified(s, 'the routine body itself mentions creating a routine (it would create one when called), which cannot be checked here');
    }
  } else if (topTag === null && creates >= 1 && routines >= 1) {
    unverified(s, 'the statement mentions CREATE and FUNCTION/PROCEDURE but created no routine at top level; a path the scratch database did not take cannot be checked');
  }
}
for (const m of syntax) {
  console.log(`SYNTAX     ${label}: ${first(m)} (a routine inside an unparseable statement would go unchecked)`);
  violations += 1;
}
process.exit(violations > 0 ? 1 : 0);
