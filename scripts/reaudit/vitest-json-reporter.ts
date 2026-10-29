/**
 * Vitest reporter for the re-audit harness: the stock JSON reporter plus what it leaves out.
 *
 *   npx vitest run --reporter=./scripts/reaudit/vitest-json-reporter.ts --outputFile=<abs path>
 *
 * Adds `fails: boolean` to every assertion (true for `test.fails`, whose "pass" means the body threw)
 * and a top-level `reaudit` marker that collect-vitest.ts requires. Assertions are matched to tests by
 * the stock reporter's own order (per file, depth-first); a title mismatch throws, so no report is
 * written and the recorder refuses the run rather than mislabelling a test.
 */
import type { TestModule } from 'vitest/node';
import { JsonReporter } from 'vitest/reporters';
import { VITEST_REPORT_MARKER } from './collect-vitest';

type Assertion = { title: string; fails?: boolean };
type Report = { reaudit?: unknown; testResults: { assertionResults: Assertion[] }[] };

export default class ReauditVitestJsonReporter extends JsonReporter {
  private failsByFile: { name: string; fails: boolean }[][] = [];

  override async onTestRunEnd(...args: Parameters<JsonReporter['onTestRunEnd']>): Promise<void> {
    const modules = args[0] as readonly TestModule[];
    // children.allTests(): depth-first, definition order — the order the stock reporter lists results in.
    this.failsByFile = modules.map((m) =>
      [...m.children.allTests()].map((t) => ({ name: t.name, fails: t.options.fails === true })),
    );
    return super.onTestRunEnd(...args);
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
    r.reaudit = VITEST_REPORT_MARKER;
    return super.writeReport(JSON.stringify(r));
  }
}
