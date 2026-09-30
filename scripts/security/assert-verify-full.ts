#!/usr/bin/env npx tsx
/**
 * Refuse a database URL whose effective sslmode is not verify-full — the nightly job's pre-step (#292).
 *
 * USAGE   npx tsx scripts/security/assert-verify-full.ts <ENV_VAR_NAME>
 *
 * The URL is read from the NAMED environment variable, never from argv (argv is visible in `ps` and in
 * CI logs). Nothing about the URL is ever printed. No loopback exemption: this guards the production
 * credential, which is never a loopback address.
 *
 * EXIT  0 = verify-full · 2 = refused / could not decide (the nightly contract: 2 is never a pass).
 */
import { writeSync } from 'node:fs';
import { checkVerifyFull } from './db-tls';

const name = process.argv[2];
if (!name || !/^[A-Z_][A-Z0-9_]*$/.test(name)) {
  writeSync(2, '⚠ usage: assert-verify-full.ts <ENV_VAR_NAME>\n');
  process.exit(2);
}
const url = process.env[name];
if (!url) {
  writeSync(2, `⚠ ${name} is not set — nothing to verify. Exit 2, not a pass.\n`);
  process.exit(2);
}
const verdict = checkVerifyFull(url, { allowLoopback: false });
if (!verdict.ok) {
  writeSync(2, `⚠ REFUSING to connect with ${name}: ${verdict.reason}\n`);
  process.exit(2);
}
console.log(`✓ ${name} requires sslmode=verify-full.`);
