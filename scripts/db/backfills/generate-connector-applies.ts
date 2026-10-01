#!/usr/bin/env npx tsx
/**
 * Writes scripts/db/backfills/apply-via-connector/<name>.sql for every entry in CONNECTOR_INPUTS,
 * rendered from the psql script of the same name (see connector-apply.ts).
 *
 *   npx tsx scripts/db/backfills/generate-connector-applies.ts           # write
 *   npx tsx scripts/db/backfills/generate-connector-applies.ts --check   # exit 1 if any file is stale
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { CONNECTOR_INPUTS, renderConnectorApply } from './connector-apply';

const DIR = resolve(process.cwd(), 'scripts/db/backfills');
const check = process.argv.includes('--check');
let stale = 0;

for (const [name, inputs] of Object.entries(CONNECTOR_INPUTS)) {
  const rendered = renderConnectorApply(name, readFileSync(resolve(DIR, `${name}.sql`), 'utf8'), inputs);
  const target = resolve(DIR, 'apply-via-connector', `${name}.sql`);
  const current = existsSync(target) ? readFileSync(target, 'utf8') : '';
  if (current === rendered) continue;
  if (check) {
    stale++;
    process.stderr.write(`stale: ${target}\n`);
  } else {
    writeFileSync(target, rendered);
    process.stdout.write(`wrote ${target}\n`);
  }
}

if (stale > 0) process.exit(1);
