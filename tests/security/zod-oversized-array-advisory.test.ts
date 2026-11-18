import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// GHSA-mrhx-c7xc-m3w5: zod < 4.6.6 accumulated one issue per failing element when
// validating an oversized constrained array, so a single large request body could
// exhaust process memory. Patched releases check the collection bound first and
// stop there. These tests pin both the installed version and the behaviour.

const require = createRequire(import.meta.url);

function installedZodVersion(): string {
  const pkgPath = require.resolve('zod/package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };
  return pkg.version;
}

describe('zod oversized-collection advisory (GHSA-mrhx-c7xc-m3w5)', () => {
  it('resolves a patched zod (>= 4.6.6)', () => {
    const [major, minor, patch] = installedZodVersion()
      .split('.')
      .map((n) => Number.parseInt(n, 10));
    const atLeast = major > 4 || (major === 4 && (minor > 6 || (minor === 6 && patch >= 6)));
    expect(atLeast).toBe(true);
  });

  it('rejects a 100k-element invalid array against a bounded schema with a single issue', () => {
    const schema = z.object({ ids: z.array(z.string().uuid()).max(100) });
    const body = { ids: Array.from({ length: 100_000 }, () => 'not-a-uuid') };

    const started = performance.now();
    const result = schema.safeParse(body);
    const elapsedMs = performance.now() - started;

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues).toHaveLength(1);
    expect(result.error.issues[0]?.code).toBe('too_big');
    // Generous ceiling: the patched path is O(1) in the element count.
    expect(elapsedMs).toBeLessThan(1_000);
  });
});
