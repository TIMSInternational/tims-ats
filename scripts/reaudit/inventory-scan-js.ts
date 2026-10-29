/** The JS/TS (Vitest, Playwright) half of the inventory scan. Rules and blind spots: inventory-scan.ts. */
import ts from 'typescript';
import { leftovers, type FileScan, type InventoryEntry, type InventorySource, type Span } from './inventory-common';
import { SLUG_RE, tagIds } from './status';

const TEST_ROOTS = new Set(['it', 'test']);
const DESCRIBE_ROOTS = new Set(['describe', 'suite']);
const MODIFIERS = new Set([
  'only',
  'skip',
  'todo',
  'fails',
  'fail',
  'fixme',
  'slow',
  'concurrent',
  'sequential',
  'shuffle',
  'skipIf',
  'runIf',
  'each',
  'for',
  'serial',
  'parallel',
]);
/** Statement-level calls in a describe body that cannot declare tests. */
const INERT_ROOTS = new Set([
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'vi',
  'expect',
  'onTestFinished',
  'onTestFailed',
]);

interface Callee {
  root: string;
  props: string[];
}

function calleeOf(expr: ts.Expression): Callee | null {
  const props: string[] = [];
  let e: ts.Expression = expr;
  for (;;) {
    if (ts.isIdentifier(e)) return { root: e.text, props: props.reverse() };
    if (ts.isPropertyAccessExpression(e)) {
      props.push(e.name.text);
      e = e.expression;
    } else if (ts.isCallExpression(e))
      e = e.expression; // it.skipIf(x)(...), test.each(t)(...)
    else return null;
  }
}

type Kind = 'test' | 'describe';

function kindOf(c: Callee): Kind | null {
  if (DESCRIBE_ROOTS.has(c.root)) return c.props.every((p) => MODIFIERS.has(p)) ? 'describe' : null;
  if (!TEST_ROOTS.has(c.root)) return null;
  if (c.props[0] === 'describe') return c.props.slice(1).every((p) => MODIFIERS.has(p)) ? 'describe' : null;
  return c.props.every((p) => MODIFIERS.has(p)) ? 'test' : null;
}

const isFnLiteral = (n: ts.Node | undefined): boolean => !!n && (ts.isArrowFunction(n) || ts.isFunctionExpression(n));
/** A test body: a function literal or a reference to one. */
const isStringish = (n: ts.Node): boolean =>
  ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n) || ts.isTemplateExpression(n);
/**
 * Could be a test body: anything but a string, number, boolean, null or object literal (the title,
 * a reason, details). A function literal, a reference (`fn`, `checks.mustDeny`) or a call that returns
 * one all count, so a declaration is never missed because of how its body is written.
 */
const isBodyLike = (n: ts.Node): boolean =>
  !isStringish(n) &&
  !ts.isNumericLiteral(n) &&
  !ts.isObjectLiteralExpression(n) &&
  n.kind !== ts.SyntaxKind.TrueKeyword &&
  n.kind !== ts.SyntaxKind.FalseKeyword &&
  n.kind !== ts.SyntaxKind.NullKeyword;
/** Playwright's in-describe annotations: test.skip/fixme/fail/slow([condition][, reason]). Never a test. */
const ANNOTATIONS = new Set(['skip', 'fixme', 'fail', 'slow']);
function isAnnotation(c: Callee, args: ts.NodeArray<ts.Expression>): boolean {
  if (!ANNOTATIONS.has(c.props[c.props.length - 1] ?? '')) return false;
  // A titled call (`it.skip('x')`) is a test without a readable body, not an annotation. Later
  // arguments need no check: a call with a body-like one is already a declaration.
  return !(args.length > 0 && isStringish(args[0] as ts.Expression));
}
/** test.<prop> statements in a describe body that cannot declare tests. */
const INERT_TEST_PROPS = new Set(['use', 'beforeEach', 'afterEach', 'beforeAll', 'afterAll', 'setTimeout', 'describe']);

interface Segment {
  /** null = dynamic. '' = no title (anonymous Playwright describe). */
  title: string | null;
  /** Ids from `{ tag }` (playwright); null = a tag option the scan cannot read. */
  optionIds: string[];
  /** Offset of the declaring call in the file. */
  at: number;
}

interface Ctx {
  file: string;
  source: InventorySource;
  sf: ts.SourceFile;
  consumed: Span[];
  out: FileScan;
}

function staticText(n: ts.Expression | undefined): string | null {
  if (n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))) return n.text;
  return null;
}

function consume(ctx: Ctx, n: ts.Node): void {
  ctx.consumed.push({ start: n.getStart(ctx.sf), end: n.end });
}

/** Playwright `{ tag: '@x' | ['@x', ...] }` option ids. A tag option it cannot read is unattributable. */
function optionIds(ctx: Ctx, details: ts.Expression | undefined, line: number): string[] {
  if (!details || !ts.isObjectLiteralExpression(details)) return [];
  const ids: string[] = [];
  for (const p of details.properties) {
    if (!p.name || !ts.isIdentifier(p.name) || p.name.text !== 'tag') continue;
    const value = ts.isPropertyAssignment(p) ? p.initializer : undefined;
    const items = value && ts.isArrayLiteralExpression(value) ? [...value.elements] : value ? [value] : [];
    const texts = items.map((i) => staticText(i));
    if (!value || texts.some((t) => t === null)) {
      ctx.out.unattributable.push(`${ctx.file}:${line}`);
      continue;
    }
    consume(ctx, value);
    for (const t of texts as string[]) {
      const m = /^@finding:(.*)$/.exec(t);
      if (m && SLUG_RE.test(m[1] as string) && !ids.includes(m[1] as string)) ids.push(m[1] as string);
    }
  }
  return ids;
}

/** The ids a test with this title path binds (a dynamic segment contributes nothing it can see). */
function pathIds(ctx: Ctx, path: readonly Segment[]): string[] {
  const titles = path.map((s) => s.title ?? '').join(' ');
  let ids: string[];
  if (ctx.source === 'playwright') {
    ids = [];
    // Playwright reads title tags as /@\S+/ over the title path joined by " ".
    for (const t of titles.match(/@\S+/g) ?? []) {
      const id = t.startsWith('@finding:') ? t.slice('@finding:'.length) : '';
      if (SLUG_RE.test(id) && !ids.includes(id)) ids.push(id);
    }
  } else ids = tagIds(titles);
  for (const s of path) for (const id of s.optionIds) if (!ids.includes(id)) ids.push(id);
  return ids;
}

function evidenceName(ctx: Ctx, path: readonly Segment[]): string | null {
  if (path.some((s) => s.title === null)) return null;
  const titles = path.map((s) => s.title as string);
  return ctx.source === 'playwright' ? titles.filter((t) => t !== '').join(' › ') : titles.join(' ');
}

/** `at` is the offset of the declaration: it, not the line, tells two declarations apart. */
function emit(ctx: Ctx, ids: readonly string[], at: number, name: string | null, why?: string): void {
  const line = ctx.sf.getLineAndCharacterOfPosition(at).line + 1;
  for (const id of ids) {
    const e: InventoryEntry = { id, source: ctx.source, file: ctx.file, line, offset: at, name };
    if (name === null) e.why = why ?? 'the test title is built at runtime';
    ctx.out.entries.push(e);
  }
}

/** Returns how many tests were declared under `node`. */
function walk(ctx: Ctx, node: ts.Node, path: readonly Segment[]): number {
  if (ts.isCallExpression(node)) {
    const callee = calleeOf(node.expression);
    const kind = callee ? kindOf(callee) : null;
    const args = node.arguments;
    const at = node.getStart(ctx.sf);
    const line = ctx.sf.getLineAndCharacterOfPosition(at).line + 1;
    const runtimeTitle = !!callee && (callee.props.includes('each') || callee.props.includes('for'));
    if (kind === 'describe' && args.length >= 1 && !isFnLiteral(args[0])) {
      const title = runtimeTitle ? null : staticText(args[0]);
      if (title !== null) consume(ctx, args[0] as ts.Expression);
      const seg: Segment = { title, optionIds: optionIds(ctx, args.length > 2 ? args[1] : undefined, line), at };
      return describeBody(ctx, [...path, seg], args[args.length - 1]);
    }
    if (kind === 'describe' && args.length >= 1) {
      return describeBody(ctx, [...path, { title: '', optionIds: [], at }], args[args.length - 1]);
    }
    // test(title, [details,] body). Playwright's test.skip(condition, reason) has no body: not a test.
    const declares = args.length >= 2 && !isFnLiteral(args[0]) && args.slice(1).some((a) => isBodyLike(a));
    if (kind === 'test' && callee && !declares && !isAnnotation(callee, args)) {
      // A test call the scanner cannot read (spread arguments, no body, ...): what it binds under the
      // enclosing tags is unknown, so they are UNRESOLVABLE here. Its own literal tags stay leftovers.
      emit(ctx, pathIds(ctx, path), at, null, 'a test call the scanner cannot read');
      return 0;
    }
    if (kind === 'test' && declares) {
      const title = runtimeTitle ? null : staticText(args[0]);
      if (title !== null) consume(ctx, args[0] as ts.Expression);
      const seg: Segment = { title, optionIds: optionIds(ctx, args.length > 2 ? args[1] : undefined, line), at };
      const full = [...path, seg];
      emit(ctx, pathIds(ctx, full), at, evidenceName(ctx, full));
      return 1; // a test body cannot declare tests: not descended
    }
  }
  let n = 0;
  ts.forEachChild(node, (c) => {
    n += walk(ctx, c, path);
  });
  return n;
}

function describeBody(ctx: Ctx, path: readonly Segment[], body: ts.Node | undefined): number {
  const ids = pathIds(ctx, path);
  const at = path[path.length - 1]?.at ?? 0;
  const n = body ? walk(ctx, body, path) : 0;
  if (ids.length === 0) return n;
  if (n === 0) emit(ctx, ids, at, null, 'a tagged describe with no statically visible test');
  const fnBody = body && (ts.isArrowFunction(body) || ts.isFunctionExpression(body)) ? body.body : undefined;
  if (fnBody && ts.isBlock(fnBody)) {
    for (const st of fnBody.statements) {
      let e = ts.isExpressionStatement(st) ? st.expression : undefined;
      if (e && ts.isAwaitExpression(e)) e = e.expression;
      if (!e || !ts.isCallExpression(e)) continue;
      const c = calleeOf(e.expression);
      if (c && (DESCRIBE_ROOTS.has(c.root) || INERT_ROOTS.has(c.root))) continue;
      // test/it calls: declarations and unreadable ones are handled by walk(); only test.<prop>
      // helpers other than the known inert ones (test.use, hooks, test.describe.configure) are suspect.
      if (c && TEST_ROOTS.has(c.root) && (kindOf(c) !== null || INERT_TEST_PROPS.has(c.props[0] ?? ''))) continue;
      emit(
        ctx,
        ids,
        st.getStart(ctx.sf),
        null,
        `the tagged describe calls ${c?.root ?? 'an expression'}(), which may declare tests`,
      );
    }
  }
  return n;
}

export function scanJs(file: string, text: string, source: InventorySource): FileScan {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const ctx: Ctx = { file, source, sf, consumed: [], out: { entries: [], unattributable: [] } };
  walk(ctx, sf, []);
  leftovers(file, text, source, ctx.consumed, ctx.out);
  return ctx.out;
}
