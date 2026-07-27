#!/usr/bin/env -S npx tsx
/**
 * external-vendor READ cutover verification — the ONE piece of the 3 "special-case" domains
 * (see docs/architecture/csharp-migration/cutover-special-domains.md) that is safe to script,
 * because it is pure GET traffic: no Stripe side effects, no state mutation, and the auth
 * mechanism (`Authorization: Bearer tims_...`, the ApiKey scheme — see
 * services/Tims.Platform/src/Tims.Api/ExternalVendor/ExternalAssessmentEndpoints.cs:54,87 and
 * packages/api/src/access/external-auth.ts) is fully exercised by a real (or test) vendor key
 * without ever writing anything.
 *
 * WHAT THIS DOES NOT DO (by design):
 *  - It does NOT create, revoke, or otherwise manage the API key. Provisioning a key is a
 *    2-minute manual step through the product's OWN Settings > Integrations UI (packages/api/src/
 *    routers/integration.ts `createApiKey` / `revokeApiKey` — an ordinary org-scoped tRPC
 *    mutation, no special prod access needed) against a DEDICATED, non-customer-critical org —
 *    see the runbook doc for the exact steps. Never point this script at a real customer/vendor's
 *    live key without their knowledge.
 *  - It does NOT touch `/external/validations/*` (the WRITE surface) — that one mutates a
 *    pending-only preemployment-validation row exactly once (atomic, non-idempotent) and is
 *    intentionally left as a manual procedure (see the runbook doc, "external-vendor WRITE").
 *
 * WHAT THIS DOES:
 *  1. GET the TS tRPC endpoint (`external.getAssessmentResults`) with the vendor key as a plain
 *     `Authorization: Bearer` header (the TS external router accepts this — see
 *     packages/api/src/access/external-auth.ts `resolveApiKeyPrincipal` — it is NOT cookie-only
 *     like the rest of the TS app; see scripts/parity/callers.ts's header investigation note for
 *     why every OTHER domain in this migration needs a cookie instead).
 *  2. GET the C# REST endpoint (`GET /external/assessment-results`) with the SAME key.
 *  3. Diff the two response bodies (order-insensitive) and report PASS/FAIL.
 *  4. Repeat for a single-item lookup: a real `--assignment-id` if provided (full-payload
 *     parity), otherwise a random UUID (proves 404-shape parity instead).
 *
 * Usage:
 *   TIMS_TS_BASE=https://tims-ats.vercel.app \
 *   TIMS_CSHARP_BASE=https://<app-runner-url> \
 *   EXTERNAL_VENDOR_API_KEY=tims_prod_xxxxx \
 *   npx tsx scripts/deploy/cutover-external-vendor-read-verify.ts [--assignment-id <uuid>] [--take 5]
 *
 * Exit code 0 = every check passed; 1 = at least one mismatch or transport error.
 */
import { buildTrpcQueryUrl, stripTrpcJson } from '../parity/trpc';
import { callCsharp } from '../parity/callers';

interface Args {
  assignmentId?: string;
  take: number;
}

function parseArgs(argv: string[]): Args {
  let assignmentId: string | undefined;
  let take = 5;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--assignment-id') assignmentId = argv[++i];
    else if (argv[i] === '--take') take = Number(argv[++i]);
  }
  if (!Number.isInteger(take) || take < 1 || take > 25) {
    throw new Error('--take must be an integer between 1 and 25 (endpoint bound)');
  }
  return { assignmentId, take };
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

/** A random-but-well-formed UUID, used ONLY to probe the not-found path — never resolves to a
 *  real row, so it can never accidentally read (let alone touch) real vendor data. */
function randomUuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** Deep, key-order-insensitive stringify so two structurally-identical objects compare equal
 *  regardless of property order (TS and C# don't promise the same emission order). */
function stableStringify(value: unknown): string {
  const sort = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sort);
    if (v && typeof v === 'object') {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([k, val]) => [k, sort(val)]),
      );
    }
    return v;
  };
  return JSON.stringify(sort(value));
}

interface CheckOutcome {
  name: string;
  pass: boolean;
  detail?: string;
}

async function callTsExternal(base: string, procedure: string, input: unknown, apiKey: string): Promise<unknown> {
  const url = buildTrpcQueryUrl(base, procedure, input);
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
  const body: unknown = await res.json();
  return { status: res.status, body };
}

async function checkList(tsBase: string, csharpBase: string, apiKey: string, take: number): Promise<CheckOutcome> {
  const name = `list (take=${take})`;
  try {
    const tsRaw = (await callTsExternal(tsBase, 'external.getAssessmentResults', { take }, apiKey)) as {
      status: number;
      body: unknown;
    };
    const csharp = await callCsharp(csharpBase, `/external/assessment-results?take=${take}`, apiKey);

    if (tsRaw.status !== 200 || csharp.status !== 200) {
      return {
        name,
        pass: false,
        detail: `expected both 200, got TS=${tsRaw.status} C#=${csharp.status} (bodies: TS=${JSON.stringify(
          tsRaw.body,
        )} C#=${JSON.stringify(csharp.body)})`,
      };
    }

    let tsJson: unknown;
    try {
      tsJson = stripTrpcJson(tsRaw.body);
    } catch (err) {
      return { name, pass: false, detail: `TS response not a valid tRPC success envelope: ${String(err)}` };
    }

    const tsStr = stableStringify(tsJson);
    const csharpStr = stableStringify(csharp.body);
    if (tsStr !== csharpStr) {
      return {
        name,
        pass: false,
        detail: `body mismatch.\n  TS:  ${tsStr}\n  C#:  ${csharpStr}`,
      };
    }
    return { name, pass: true };
  } catch (err) {
    return { name, pass: false, detail: `transport error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkGetOneNotFound(tsBase: string, csharpBase: string, apiKey: string): Promise<CheckOutcome> {
  const name = 'getOne 404-shape parity (random assignment id)';
  const id = randomUuid();
  try {
    const tsRaw = (await callTsExternal(tsBase, 'external.getAssessmentResult', { assignmentId: id }, apiKey)) as {
      status: number;
      body: unknown;
    };
    const csharp = await callCsharp(csharpBase, `/external/assessment-results/${id}`, apiKey);

    // TS surfaces NOT_FOUND as a tRPC error envelope, usually over HTTP 200 (tRPC batches
    // errors and successes the same way at the transport level) — read the standard
    // `error.json.data.httpStatus`/`data.code` fields tRPC's default errorFormatter emits
    // (NOT `error.json.code`, which is a JSON-RPC-ish integer with no fixed 404 meaning —
    // see trpc.test.ts's `-32003` FORBIDDEN example; do not reuse `TrpcError.code` for this).
    // C# returns a bare HTTP 404. Both must agree the row does not exist.
    const tsFirst = Array.isArray(tsRaw.body) ? tsRaw.body[0] : tsRaw.body;
    const tsErrorData = (tsFirst as { error?: { json?: { data?: { httpStatus?: number; code?: string } } } })?.error
      ?.json?.data;
    const tsNotFound = tsErrorData?.httpStatus === 404 || tsErrorData?.code === 'NOT_FOUND';
    const csharpNotFound = csharp.status === 404;

    if (!tsNotFound || !csharpNotFound) {
      return {
        name,
        pass: false,
        detail: `expected both NOT_FOUND. TS status=${tsRaw.status} body=${JSON.stringify(
          tsRaw.body,
        )}; C# status=${csharp.status} body=${JSON.stringify(csharp.body)}`,
      };
    }
    return { name, pass: true };
  } catch (err) {
    return { name, pass: false, detail: `transport error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function checkGetOneReal(
  tsBase: string,
  csharpBase: string,
  apiKey: string,
  assignmentId: string,
): Promise<CheckOutcome> {
  const name = `getOne full-payload parity (assignment ${assignmentId})`;
  try {
    const tsRaw = (await callTsExternal(tsBase, 'external.getAssessmentResult', { assignmentId }, apiKey)) as {
      status: number;
      body: unknown;
    };
    const csharp = await callCsharp(csharpBase, `/external/assessment-results/${assignmentId}`, apiKey);

    if (csharp.status !== 200) {
      return { name, pass: false, detail: `C# returned ${csharp.status}: ${JSON.stringify(csharp.body)}` };
    }
    let tsJson: unknown;
    try {
      tsJson = stripTrpcJson(tsRaw.body);
    } catch (err) {
      return { name, pass: false, detail: `TS did not return the row: ${String(err)}` };
    }
    const tsStr = stableStringify(tsJson);
    const csharpStr = stableStringify(csharp.body);
    if (tsStr !== csharpStr) {
      return { name, pass: false, detail: `body mismatch.\n  TS:  ${tsStr}\n  C#:  ${csharpStr}` };
    }
    return { name, pass: true };
  } catch (err) {
    return { name, pass: false, detail: `transport error: ${err instanceof Error ? err.message : String(err)}` };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const tsBase = requiredEnv('TIMS_TS_BASE');
  const csharpBase = requiredEnv('TIMS_CSHARP_BASE');
  const apiKey = requiredEnv('EXTERNAL_VENDOR_API_KEY');

  if (!apiKey.startsWith('tims_')) {
    throw new Error(
      "EXTERNAL_VENDOR_API_KEY does not look like a vendor key (expected a 'tims_' prefix) — " +
        'refusing to run, this script only ever sends GET requests but a wrong credential type ' +
        'is a sign something upstream is misconfigured.',
    );
  }

  console.log(`external-vendor READ cutover verification`);
  console.log(`  TS base:     ${tsBase}`);
  console.log(`  C# base:     ${csharpBase}`);
  console.log(`  API key:     ${apiKey.slice(0, 12)}... (never logged in full)`);
  console.log('');

  const outcomes: CheckOutcome[] = [];
  outcomes.push(await checkList(tsBase, csharpBase, apiKey, args.take));
  if (args.assignmentId) {
    outcomes.push(await checkGetOneReal(tsBase, csharpBase, apiKey, args.assignmentId));
  } else {
    outcomes.push(await checkGetOneNotFound(tsBase, csharpBase, apiKey));
    console.log(
      '  (no --assignment-id given — skipping full-payload parity; only 404-shape parity was checked. ' +
        "Pass a real assignment id belonging to this key's org for the stronger check.)\n",
    );
  }

  let allPass = true;
  for (const o of outcomes) {
    console.log(`[${o.pass ? 'PASS' : 'FAIL'}] ${o.name}`);
    if (!o.pass && o.detail) console.log(`       ${o.detail}`);
    allPass = allPass && o.pass;
  }

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('cutover-external-vendor-read-verify failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
