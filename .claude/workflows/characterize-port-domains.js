export const meta = {
  name: 'characterize-port-domains',
  description:
    'Read-only: characterize TS routers slated for C# porting — procedure inventory, auth model, tables, TS defects, traps, size band',
  whenToUse:
    'Before starting a port wave. Produces step-1 (Characterize) output for a whole wave at once, plus the fan-in data that validates wave order and the size data that validates the schedule estimate.',
  phases: [
    { title: 'Characterize', detail: 'one agent per domain reads its router, services and schemas' },
    { title: 'Cross-check', detail: 'adversarial re-read: refute the spec against source' },
    { title: 'Synthesize', detail: 'wave order by fan-in, and estimate validation' },
  ],
};

// Wave A (highest fan-in — everything calls these) plus two recruitment probes.
// The probes exist to test the schedule's 1.4x complexity uplift on the domains
// most likely to break it. Override by passing `args` as a list of the same shape.
const DEFAULT_DOMAINS = [
  {
    issue: 96,
    name: 'user + auth writes',
    procs: 8,
    files: 'packages/api/src/routers/user.ts, packages/api/src/routers/auth.ts',
    wave: 'A',
    verify: true,
  },
  {
    issue: 97,
    name: 'organization',
    procs: 13,
    files: 'packages/api/src/routers/organization.ts',
    wave: 'A',
    verify: true,
  },
  {
    issue: 99,
    name: 'integration',
    procs: 19,
    files: 'packages/api/src/routers/integration.ts',
    wave: 'A',
    verify: true,
  },
  {
    issue: 100,
    name: 'monitoring',
    procs: 8,
    files: 'packages/api/src/routers/monitoring.ts',
    wave: 'A',
    verify: true,
  },
  {
    issue: 101,
    name: 'featureFlag/entitlement/consent',
    procs: 5,
    files:
      'packages/api/src/routers/featureFlag.ts, packages/api/src/routers/entitlement.ts, packages/api/src/routers/consent.ts',
    wave: 'A',
    verify: true,
  },
  {
    issue: 85,
    name: 'vacancy/* (PROBE)',
    procs: 22,
    files: 'packages/api/src/routers/vacancy/',
    wave: 'C',
  },
  { issue: 87, name: 'offer/* (PROBE)', procs: 20, files: 'packages/api/src/routers/offer/', wave: 'C' },
];

const DOMAINS = Array.isArray(args) && args.length ? args : DEFAULT_DOMAINS;

const SPEC_SCHEMA = {
  type: 'object',
  required: [
    'domain',
    'procedures',
    'tables',
    'feConsumers',
    'tsDefects',
    'traps',
    'sizeBand',
    'complexityDrivers',
    'crossDomainCalls',
    'blockers',
  ],
  properties: {
    domain: { type: 'string' },
    procedures: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'kind', 'gate'],
        properties: {
          name: { type: 'string' },
          kind: { type: 'string', enum: ['query', 'mutation'] },
          gate: {
            type: 'string',
            description:
              'protectedProcedure / platformProcedure / permissionProcedure(x,y) / publicProcedure / candidateProcedure / other',
          },
          inputSummary: { type: 'string' },
          tables: { type: 'array', items: { type: 'string' } },
        },
      },
    },
    procedureCount: { type: 'number' },
    tables: { type: 'array', items: { type: 'string' }, description: 'snake_case DB tables read or written' },
    writesTables: { type: 'array', items: { type: 'string' } },
    feConsumers: {
      type: 'array',
      items: { type: 'string' },
      description: 'apps/web files with a live tRPC call site; empty array if none',
    },
    tsDefects: {
      type: 'array',
      items: { type: 'string' },
      description: 'behaviour a faithful port must REPRODUCE, not fix',
    },
    traps: {
      type: 'array',
      items: { type: 'string' },
      description: 'which of the known TRAP classes apply, with evidence',
    },
    sizeBand: { type: 'string', enum: ['S', 'M', 'L', 'XL'] },
    complexityDrivers: { type: 'array', items: { type: 'string' } },
    crossDomainCalls: {
      type: 'array',
      items: { type: 'string' },
      description: 'other TS domains this one calls, or that call it — the fan-in evidence',
    },
    blockers: {
      type: 'array',
      items: { type: 'string' },
      description: 'anything that would stop this port starting today',
    },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
};

const VERDICT_SCHEMA = {
  type: 'object',
  required: ['corrections', 'missed', 'verdict'],
  properties: {
    corrections: {
      type: 'array',
      items: { type: 'string' },
      description: 'claims in the spec that the source does not support, with file:line',
    },
    missed: {
      type: 'array',
      items: { type: 'string' },
      description: 'procedures, tables, defects or traps the spec omitted, with file:line',
    },
    verdict: { type: 'string', enum: ['SOUND', 'CORRECTED', 'UNSOUND'] },
  },
};

function charPrompt(d) {
  return [
    'READ-ONLY TASK. Do not modify, create or delete any file. You are characterizing a TypeScript',
    'tRPC domain that is scheduled to be ported to C#. This is step 1 ("Characterize") of the 7-step',
    'strangler recipe in docs/architecture/csharp-migration/phase-5-strangler.md.',
    '',
    'DOMAIN: ' + d.name + '   (GitHub issue #' + d.issue + ', declared as ~' + d.procs + ' procedures)',
    'FILES: ' + d.files,
    '',
    'Read the router(s), every service and repository they call, their Zod schemas, and the Prisma',
    'models for the tables they touch. Then grep apps/web for live tRPC call sites.',
    '',
    'Read these first for the house conventions and the known trap catalogue:',
    '  - docs/architecture/csharp-migration/phase-5-strangler.md   (the recipe)',
    '  - docs/architecture/csharp-migration/phase-5-slice-25-notification.md  (the most recent worked example)',
    '  - docs/architecture/table-ownership.md                      (who owns each table)',
    '',
    'Report against these known trap classes, naming which APPLY and which provably do not:',
    '  - Native Postgres enums: EF cannot compare an enum column to a query parameter (needs EF.Constant).',
    '  - timestamp(3) without time zone: DateTime Kind must be re-kinded at the repository boundary;',
    '    Npgsql REJECTS Kind=Utc bound to a mapped `timestamp`. JS Date carries whole ms.',
    '  - Minimal-API binding runs BEFORE the handler: a typed query param 400s ahead of the auth gate,',
    '    which SUPPRESSES the 401/403-only denial audit. Bind string?, parse after the gate.',
    '  - EF ValueGeneratedOnAdd decides by sentinel, so an explicit CLR-default value is silently dropped.',
    '  - SqlQuery<T> needs a class with a parameterless ctor and settable properties; a positional record',
    '    does not materialise.',
    '  - RLS is an ORG predicate. A table whose rows are addressed by user_id (or stamped NULL org) will be',
    '    filtered differently under C# TenantScope than under TS, which reads as BYPASSRLS postgres.',
    '  - Prisma cursor pagination with skip:1 loses the boundary row; _count / nested selects serialize',
    '    differently than a hand-written C# DTO.',
    '',
    'Be exact and cite file:line for anything non-obvious. Where the declared procedure count',
    '(~' + d.procs + ') disagrees with what you actually count, report YOUR count and say so — the issue',
    'bodies have been wrong before. Set confidence honestly; "low" is a useful answer.',
    'Your entire response is consumed as structured data, not read by a human.',
  ].join('\n');
}

function verifyPrompt(spec, d) {
  return [
    'READ-ONLY ADVERSARIAL REVIEW. Do not modify any file.',
    '',
    'Another agent characterized the TypeScript domain "' + d.name + '" (' + d.files + ').',
    'Your job is to REFUTE its spec, not to confirm it. Re-read the source yourself; do NOT trust the',
    'summary. In this codebase, overstated claims are the highest-value finding class, and a previous',
    'review panel was itself wrong once — so verify, do not defer.',
    '',
    'Check specifically:',
    '  1. Is every listed procedure real, and is its gate stated correctly? Are any procedures MISSING?',
    '     (Procedures bound to a const, e.g. `const READ = permissionProcedure(...)`, are easy to miss.)',
    '  2. Are the tables right, and is the read/write split right? A raw-SQL writer is easy to overlook.',
    '  3. Are the claimed FE consumers real live call sites, and is "no consumers" actually true?',
    '  4. Are the claimed TS defects genuinely defects, and are the trap claims supported by the source?',
    '',
    'THE SPEC UNDER REVIEW:',
    JSON.stringify(spec, null, 1),
    '',
    'Return corrections and omissions with file:line. Verdict SOUND only if you genuinely tried to break',
    'it and could not. Your entire response is consumed as structured data.',
  ].join('\n');
}

phase('Characterize');
log(
  'Characterizing ' +
    DOMAINS.length +
    ' domains (read-only). Wave A gets an adversarial cross-check; the two recruitment probes are single-read, for estimate validation only.',
);

const results = await pipeline(
  DOMAINS,
  (d) =>
    agent(charPrompt(d), {
      label: 'char:' + d.name,
      phase: 'Characterize',
      schema: SPEC_SCHEMA,
    }),
  (spec, d) => {
    if (!spec) return null;
    // Opt-OUT, not opt-in: the first run skipped the two probe domains the schedule decision rests
    // on, and every domain that WAS checked needed ~17 corrections.
    if (d.verify === false) return { domain: d, spec, review: null };
    return agent(verifyPrompt(spec, d), {
      label: 'verify:' + d.name,
      phase: 'Cross-check',
      schema: VERDICT_SCHEMA,
    }).then((review) => ({ domain: d, spec, review }));
  },
);

const good = results.filter(Boolean);

// The quality signal is the FINDING COUNT, not the verdict label. The first run of this workflow
// counted only `verdict === 'UNSOUND'` and reported "unsoundSpecs: []" — all clear — while the five
// reviewers had actually returned 0 SOUND, 0 UNSOUND, 5 CORRECTED carrying 43 corrections and 42
// omissions between them. Eighty-five real findings were discarded by a gate that read green. That is
// the same defect class as a stale test anchor or a reviewer CLI that exits 0 on refusal: a control
// whose passing state proves nothing. Count findings; treat CORRECTED as finding-bearing.
const reviewed = good.filter((r) => r.review);
const findings = reviewed.reduce(
  (n, r) => n + (r.review.corrections || []).length + (r.review.missed || []).length,
  0,
);
const unsound = good.filter((r) => r.review && r.review.verdict === 'UNSOUND');
const unchecked = good.filter((r) => !r.review).map((r) => r.domain.name);

log(
  good.length + '/' + DOMAINS.length + ' characterized. ' + reviewed.length + ' cross-checked, yielding ' +
    findings + ' findings (' + unsound.length + ' UNSOUND, ' +
    reviewed.filter((r) => r.review.verdict === 'CORRECTED').length + ' CORRECTED, ' +
    reviewed.filter((r) => r.review.verdict === 'SOUND').length + ' SOUND).',
);
if (unchecked.length) {
  log('NOT CROSS-CHECKED, so their defect density is unknown: ' + unchecked.join(', ') + '.');
}

phase('Synthesize');
const synthesis = await agent(
  [
    'You are synthesizing characterization specs for a C# port campaign. READ-ONLY.',
    '',
    'Two questions, both of which change a published plan, so answer them with evidence:',
    '',
    'Q1 — WAVE ORDER. The plan asserts these domains go FIRST because they have the highest fan-in:',
    'a domain that many others call must be ported before its callers, or every caller needs a throwaway',
    'cross-stack bridge. Test that assertion against the crossDomainCalls data below. Name any domain',
    'that should move earlier or later, and say why. If the asserted order holds, say so plainly.',
    '',
    'Q2 — ESTIMATE VALIDATION. The schedule assumes 5 procedures per active day with a 1.4x complexity',
    'uplift for the remaining domains versus the small read-only analytics domains already ported.',
    'Two recruitment domains were probed specifically to test that. Given their sizeBand and',
    'complexityDrivers, is 1.4x defensible, optimistic, or pessimistic? A wrong answer here moves a',
    'third of the remaining programme, so state your confidence and what would change it.',
    '',
    'Also list: every blocker found across all domains, and every domain whose actual procedure count',
    'disagreed with its GitHub issue.',
    '',
    'DATA:',
    JSON.stringify(
      good.map((r) => ({
        issue: r.domain.issue,
        name: r.domain.name,
        wave: r.domain.wave,
        declaredProcs: r.domain.procs,
        spec: r.spec,
        review: r.review,
      })),
      null,
      1,
    ),
  ].join('\n'),
  { label: 'synthesize', phase: 'Synthesize' },
);

return {
  characterized: good.length,
  of: DOMAINS.length,
  crossCheckFindings: findings,
  notCrossChecked: unchecked,
  unsoundSpecs: unsound.map((r) => r.domain.name),
  specs: good.map((r) => ({ issue: r.domain.issue, name: r.domain.name, spec: r.spec, review: r.review })),
  synthesis,
};
