import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { runId } from '../../lib/journey';
import { provisionRunOwner, runOwnerCredentials } from '../../lib/owner';
import { closePersona, newPersona, signIn, type Persona } from '../../lib/persona';
import { STATE_DIR, readStack } from '../../lib/stack';

// The web app (TS tRPC) and the C# API must draw on ONE rate-limit budget per caller: both are
// configured against the same DynamoDB table (scripts/e2e/up.sh: LocalStack tims-ats-ratelimit) and
// key an authenticated query on the TIMS user id. If either stack silently fell back to per-process
// memory, or the two used different items, each would admit its own 300 queries a minute.
//
// So: spend most of the budget on C#, then count what the web app still admits (shared: only the
// remainder; separate: nearly a whole budget of its own), then ask C# once more (shared: refused).

const QUERY_BUDGET = 300; // contracts/ratelimit-fixtures/dynamodb.json budgets.query (per minute)
const API_SPEND = 200;
// A minute boundary during the probe re-weights the previous window; a handful of extra admissions at most.
const BOUNDARY_SLACK = 10;

function anonKey(): string {
  const env = readFileSync(join(STATE_DIR, 'supabase.env'), 'utf8');
  const key = /^ANON_KEY="?([^"\n]+)"?$/m.exec(env)?.[1];
  if (!key) throw new Error('[e2e] ANON_KEY missing from e2e/.state/supabase.env — re-run scripts/e2e/up.sh');
  return key;
}

test('TS and C# draw on one shared rate-limit budget', async ({ browser, request }, testInfo) => {
  const stack = readStack();
  // A dedicated owner per attempt, so this test starts from an unused budget (a retry included) and
  // cannot starve the journeys.
  const owner = `${runId()}-rl${testInfo.retry}`;
  await provisionRunOwner(stack, owner);
  const creds = runOwnerCredentials(owner);

  let persona: Persona | undefined;
  try {
    persona = await newPersona(browser);
    await signIn(persona.page, creds);
    // Stop the signed-in page from issuing queries of its own while we count.
    await persona.page.goto('about:blank');

    const token = await fetch(`${stack.supabaseURL}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: anonKey(), 'content-type': 'application/json' },
      body: JSON.stringify(creds),
    }).then(async (r) => {
      expect(r.status, 'password grant for the run owner').toBe(200);
      return ((await r.json()) as { access_token: string }).access_token;
    });

    const input = encodeURIComponent(
      JSON.stringify({ json: { organizationId: '00000000-0000-4000-8000-000000000000' } }),
    );
    const web = () =>
      persona!.context.request.get(`/api/trpc/portal.getPortalStats?input=${input}`).then((r) => r.status());
    const api = () =>
      request
        .get(`${stack.apiURL}/candidate/list`, { headers: { authorization: `Bearer ${token}` } })
        .then((r) => r.status());

    // 1. Spend part of the budget on C# only.
    for (let i = 0; i < API_SPEND; i++) {
      expect(await api(), `C# query ${i + 1} of ${API_SPEND}`).not.toBe(429);
    }
    // 2. The web app gets only what C# left: with separate budgets it would admit nearly a full one.
    let webAdmitted = 0;
    while (webAdmitted <= QUERY_BUDGET && (await web()) !== 429) webAdmitted++;
    console.log(`[shared-rate-limit] C# spent ${API_SPEND}, then the web app admitted ${webAdmitted}`);
    expect(webAdmitted, 'the web app admitted more than C# left of the budget').toBeLessThanOrEqual(
      QUERY_BUDGET - API_SPEND + BOUNDARY_SLACK,
    );
    // 3. And C# is now refused too: the budget the web app exhausted is C#'s own.
    expect(await api(), 'C# still admitted after the web app hit 429').toBe(429);
  } finally {
    await closePersona(persona);
  }
});
