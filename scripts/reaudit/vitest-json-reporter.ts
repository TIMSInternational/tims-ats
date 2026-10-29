/**
 * Vitest reporter for the re-audit harness: the stock JSON reporter plus what it leaves out.
 *
 *   npx vitest run --reporter=./scripts/reaudit/vitest-json-reporter.ts --outputFile=<abs path>
 *
 * Adds `fails: boolean` to every assertion (true for `test.fails`, whose "pass" means the body threw)
 * and a top-level `reaudit` marker that collect-vitest.ts requires. Assertions are matched to tests by
 * the stock reporter's own order (per file, depth-first); a title mismatch throws, so no report is
 * written and the recorder refuses the run rather than mislabelling a test.
 *
 * The marker also records the run, so the collector can refuse one that was not complete:
 *   filters    every active narrowing of the run Vitest exposes (file filters, -t, --project, --shard,
 *              --tags-filter, --exclude, --changed, --related, --standalone), described; empty = none
 *   allowOnly  whether `.only` was allowed (false under CI=true, where `.only` fails its file)
 *   modules    every test file Vitest's own glob selects for the configured projects, once per project
 */
import type { TestModule } from 'vitest/node';
import { JsonReporter } from 'vitest/reporters';
import { VITEST_REPORT_MARKER } from './collect-vitest';

type Assertion = { title: string; fails?: boolean };
type Report = { reaudit?: unknown; testResults: { assertionResults: Assertion[] }[] };
type RunRecord = { filters: string[]; allowOnly: boolean; modules: string[] };

export default class ReauditVitestJsonReporter extends JsonReporter {
  private failsByFile: { name: string; fails: boolean }[][] = [];
  private run: RunRecord | undefined;

  override async onTestRunEnd(...args: Parameters<JsonReporter['onTestRunEnd']>): Promise<void> {
    const modules = args[0] as readonly TestModule[];
    // children.allTests(): depth-first, definition order — the order the stock reporter lists results in.
    this.failsByFile = modules.map((m) =>
      [...m.children.allTests()].map((t) => ({ name: t.name, fails: t.options.fails === true })),
    );
    this.run = await this.recordRun();
    return super.onTestRunEnd(...args);
  }

  private async recordRun(): Promise<RunRecord> {
    const ctx = this.ctx;
    const c = ctx.config;
    const filters: string[] = [];
    const cliFiles = (ctx as unknown as { filenamePattern?: string[] }).filenamePattern ?? [];
    for (const f of [...new Set([...(c.filters ?? []), ...cliFiles])]) filters.push(`file filter ${f}`);
    if (c.testNamePattern) filters.push(`-t ${String(c.testNamePattern)}`);
    if (c.project.length) filters.push(`--project ${c.project.join(',')}`);
    if (c.shard) filters.push(`--shard ${c.shard.index}/${c.shard.count}`);
    if (c.tagsFilter?.length) filters.push(`--tags-filter ${c.tagsFilter.join(',')}`);
    if (c.cliExclude?.length) filters.push(`--exclude ${c.cliExclude.join(',')}`);
    if (c.changed) filters.push(`--changed ${String(c.changed)}`);
    if (c.related?.length) filters.push(`--related ${c.related.join(',')}`);
    if (c.standalone) filters.push('--standalone');
    const specs = await ctx.globTestSpecifications();
    return { filters, allowOnly: c.allowOnly, modules: specs.map((s) => s.moduleId).sort() };
  }

  override async writeReport(report: string): Promise<void> {
    const r = JSON.parse(report) as Report;
    r.testResults.forEach((file, i) => {
      const tests = this.failsByFile[i] ?? [];
      if (tests.length !== file.assertionResults.length) {
        throw new Error(
          `reaudit reporter: file ${i} has ${file.assertionResults.length} results but ${tests.length} tests`,
        );
      }
      file.assertionResults.forEach((a, j) => {
        const t = tests[j];
        if (!t || t.name !== a.title) throw new Error(`reaudit reporter: result "${a.title}" does not match its test`);
        a.fails = t.fails;
      });
    });
    if (!this.run) throw new Error('reaudit reporter: the run was not recorded');
    r.reaudit = { ...VITEST_REPORT_MARKER, run: this.run };
    return super.writeReport(JSON.stringify(r));
  }
}
