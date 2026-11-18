import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { TRPCError } from '@trpc/server';

// The global AI kill switch (packages/ai/src/kill-switch.ts): ONE env var stops every model call
// that goes through @tims/ai. These tests drive the REAL agents, the REAL invokeAgent and the REAL
// bedrockGenerate; only the model SDK ('ai'), the database and the logger are replaced.

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  aiAgentUpsert: vi.fn(),
  orgConfigFindUnique: vi.fn(),
  usageAggregate: vi.fn(),
  usageCreate: vi.fn(),
}));

// 'ai' is aliased in vitest.config.ts to packages/ai's copy, so this intercepts client.ts.
vi.mock('ai', () => ({ generateText: (...a: unknown[]) => mocks.generateText(...a) }));
vi.mock('@tims/db', () => ({
  db: {
    aiAgent: { upsert: (...a: unknown[]) => mocks.aiAgentUpsert(...a) },
    aiAgentOrgConfig: { findUnique: (...a: unknown[]) => mocks.orgConfigFindUnique(...a) },
    aiAgentUsageLog: {
      aggregate: (...a: unknown[]) => mocks.usageAggregate(...a),
      create: (...a: unknown[]) => mocks.usageCreate(...a),
    },
  },
}));
vi.mock('@tims/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tims/shared')>()),
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  parseCV,
  screenCandidate,
  answerCandidateFaq,
  generateVacancyDescription,
  suggestVacancyCompetencies,
  checkInclusiveLanguage,
  summarizeInterview,
  generateInterviewGuide,
  detectScorecardBias,
  scoreInterviewFit,
  explainFit,
  suggestNextBestAction,
  matchCandidate,
  invokeAgent,
  bedrockCircuit,
  AI_DISABLED,
  AI_KILL_SWITCH_ENV,
  isAiKillSwitchOn,
} from '../../packages/ai/src/index';
import type { ScorecardInput } from '../../packages/ai/src/index';
import { bedrockGenerate } from '../../packages/ai/src/client';
import { z } from 'zod';

const ROOT = join(__dirname, '..', '..');
const ORG = '00000000-0000-0000-0000-0000000000a1';
const scorecard: ScorecardInput = {
  evaluatorLabel: 'E1',
  recommendation: 'hire',
  ratings: { tech: 4 },
  overallNotes: 'ok',
};

// Every public agent function that reaches the model. The coverage guard below fails if an agent
// module that calls invokeAgent is missing from this table.
const ENTRY_POINTS: Array<{ module: string; name: string; call: () => Promise<unknown> }> = [
  {
    module: 'cv-parser',
    name: 'parseCV',
    call: () => parseCV(ORG, 'Ingeniera de software, cinco años en TypeScript.'),
  },
  {
    module: 'candidate-screener',
    name: 'screenCandidate',
    call: () => screenCandidate(ORG, { title: 'Dev', skills: ['ts'], experience: 3 }, { title: 'Dev', skills: ['ts'] }),
  },
  {
    module: 'candidate-faq',
    name: 'answerCandidateFaq',
    call: () =>
      answerCandidateFaq(ORG, {
        question: '¿En qué etapa está mi postulación?',
        context: {
          organizationName: 'Org',
          candidateName: 'Ana',
          applications: [],
          upcomingInterviews: [],
          offers: [],
        },
      }),
  },
  {
    module: 'vacancy-writer',
    name: 'generateVacancyDescription',
    call: () => generateVacancyDescription(ORG, 'Desarrollador'),
  },
  {
    module: 'vacancy-competencies',
    name: 'suggestVacancyCompetencies',
    call: () => suggestVacancyCompetencies(ORG, 'Desarrollador'),
  },
  {
    module: 'inclusive-language',
    name: 'checkInclusiveLanguage',
    call: () => checkInclusiveLanguage(ORG, 'Buscamos una persona desarrolladora.'),
  },
  {
    module: 'interview-summarizer',
    name: 'summarizeInterview',
    call: () =>
      summarizeInterview(ORG, {
        candidateName: 'Ana',
        vacancyTitle: 'Dev',
        interviewType: 'technical',
        scorecards: [scorecard],
      }),
  },
  {
    module: 'interview-guide',
    name: 'generateInterviewGuide',
    call: () => generateInterviewGuide(ORG, { vacancyTitle: 'Dev', interviewType: 'technical', durationMinutes: 30 }),
  },
  {
    module: 'bias-detector',
    name: 'detectScorecardBias',
    call: () => detectScorecardBias(ORG, { vacancyTitle: 'Dev', scorecards: [scorecard] }),
  },
  {
    module: 'interview-fit-score',
    name: 'scoreInterviewFit',
    call: () => scoreInterviewFit(ORG, { transcriptText: 'Hola, soy Ana.' }),
  },
  {
    module: 'fit-explainer',
    name: 'explainFit',
    call: () =>
      explainFit(ORG, {
        overallScore: 70,
        breakdown: {
          assessment: 70,
          interview: null,
          experience: null,
          education: null,
          languages: null,
          llmJudgment: null,
        },
        vacancyTitle: 'Dev',
      }),
  },
  {
    module: 'pipeline-optimizer',
    name: 'suggestNextBestAction',
    call: () =>
      suggestNextBestAction(ORG, { candidateName: 'Ana', currentStageName: 'Entrevista', currentStageOrder: 2 }),
  },
  {
    module: 'candidate-matcher',
    name: 'matchCandidate',
    call: () => matchCandidate(ORG, { candidateProfile: { title: 'Dev' }, vacancies: [{ id: 'v1', title: 'Dev' }] }),
  },
];

function isAiDisabledError(error: unknown): boolean {
  return error instanceof TRPCError && error.code === 'SERVICE_UNAVAILABLE' && error.message === AI_DISABLED;
}

async function settle(call: () => Promise<unknown>): Promise<{ ok: true } | { ok: false; error: unknown }> {
  try {
    await call();
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env[AI_KILL_SWITCH_ENV];
  mocks.aiAgentUpsert.mockResolvedValue({ id: '00000000-0000-0000-0000-00000000a9e1' });
  mocks.orgConfigFindUnique.mockResolvedValue(null);
  mocks.usageAggregate.mockResolvedValue({ _sum: { costUsd: 0 } });
  mocks.usageCreate.mockResolvedValue({ id: 'log-1' });
  mocks.generateText.mockResolvedValue({ text: '{}', usage: { inputTokens: 3, outputTokens: 2 } });
});

afterEach(() => {
  delete process.env[AI_KILL_SWITCH_ENV];
});

describe('isAiKillSwitchOn — a STOP control fails closed on unknown values', () => {
  it.each([undefined, '', 'false', 'FALSE', ' false ', '0', 'off', 'Off', 'no', 'NO'])('%j → off', (value) => {
    expect(isAiKillSwitchOn(value)).toBe(false);
  });

  it.each(['true', 'TRUE', ' true ', '1', 'yes', 'on', 'disabled', 'stop'])('%j → on', (value) => {
    expect(isAiKillSwitchOn(value)).toBe(true);
  });

  it('reads the live environment on every call (not captured at import)', () => {
    expect(isAiKillSwitchOn()).toBe(false);
    process.env[AI_KILL_SWITCH_ENV] = 'true';
    expect(isAiKillSwitchOn()).toBe(true);
    delete process.env[AI_KILL_SWITCH_ENV];
    expect(isAiKillSwitchOn()).toBe(false);
  });
});

describe('coverage guard — the entry-point table is the full set of model-calling agents', () => {
  it('every agent module that calls invokeAgent is in ENTRY_POINTS, and nothing else is', () => {
    const agentsDir = join(ROOT, 'packages', 'ai', 'src', 'agents');
    const callers = readdirSync(agentsDir)
      .filter((f) => f.endsWith('.ts'))
      // `invokeAgent(` or a generic call `invokeAgent<In, Out>(`.
      .filter((f) => /\binvokeAgent\s*[<(]/.test(readFileSync(join(agentsDir, f), 'utf8')))
      .map((f) => f.replace(/\.ts$/, ''))
      .sort();
    expect(callers.length).toBeGreaterThanOrEqual(13);
    expect([...new Set(ENTRY_POINTS.map((e) => e.module))].sort()).toEqual(callers);
  });

  it('every entry point is exported from the package index', () => {
    const index = readFileSync(join(ROOT, 'packages', 'ai', 'src', 'index.ts'), 'utf8');
    for (const e of ENTRY_POINTS) expect(index).toMatch(new RegExp(`\\b${e.name}\\b`));
  });

  it('only client.ts imports the model SDK (single door, so both checks cover every call)', () => {
    const files = readdirSync(join(ROOT, 'packages', 'ai', 'src'), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.ts'))
      .filter((f) =>
        /from\s+['"](?:ai|@ai-sdk\/[\w-]+)['"]/.test(readFileSync(join(ROOT, 'packages', 'ai', 'src', f), 'utf8')),
      );
    expect(files).toEqual(['client.ts']);
  });
});

describe('kill switch ON — every entry point refuses before any work', () => {
  it.each(ENTRY_POINTS.map((e) => [e.name, e] as const))('%s refuses with ai_disabled', async (_name, entry) => {
    process.env[AI_KILL_SWITCH_ENV] = 'true';
    const result = await settle(entry.call);
    expect(result.ok).toBe(false);
    expect(isAiDisabledError((result as { error: unknown }).error)).toBe(true);
    expect(mocks.generateText).not.toHaveBeenCalled();
    // No catalog upsert, budget read, or usage log either: the refusal happens first.
    expect(mocks.aiAgentUpsert).not.toHaveBeenCalled();
    expect(mocks.orgConfigFindUnique).not.toHaveBeenCalled();
    expect(mocks.usageAggregate).not.toHaveBeenCalled();
    expect(mocks.usageCreate).not.toHaveBeenCalled();
  });

  it('invokeAgent itself refuses (a future agent inherits the switch)', async () => {
    process.env[AI_KILL_SWITCH_ENV] = '1';
    const result = await settle(() =>
      invokeAgent({
        slug: 'new-agent',
        orgId: ORG,
        input: { a: 1 },
        systemPrompt: 'sys',
        buildUserMessage: () => 'msg',
        schema: z.object({ a: z.number() }),
        fallback: () => ({ a: 0 }),
      }),
    );
    expect(result.ok).toBe(false);
    expect(isAiDisabledError((result as { error: unknown }).error)).toBe(true);
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it('the raw bedrockGenerate refuses too, without counting a circuit-breaker failure', async () => {
    process.env[AI_KILL_SWITCH_ENV] = 'yes';
    const before = bedrockCircuit.getState();
    const result = await settle(() => bedrockGenerate('haiku', 'sys', 'msg', 100));
    expect(result.ok).toBe(false);
    expect(isAiDisabledError((result as { error: unknown }).error)).toBe(true);
    expect(mocks.generateText).not.toHaveBeenCalled();
    expect(bedrockCircuit.getState()).toEqual(before);
  });
});

describe('kill switch OFF — every entry point reaches the model', () => {
  it.each(ENTRY_POINTS.map((e) => [e.name, e] as const))('%s calls the model once', async (_name, entry) => {
    process.env[AI_KILL_SWITCH_ENV] = 'false';
    const result = await settle(entry.call);
    // The stub model output ('{}') does not satisfy every agent's schema, so a few agents then
    // reject on their own invalid-output path. What matters here: the gate let the call through.
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
    if (!result.ok) expect(isAiDisabledError(result.error)).toBe(false);
  });

  it('bedrockGenerate returns normally when the variable is unset', async () => {
    const r = await bedrockGenerate('haiku', 'sys', 'msg', 100);
    expect(r).toMatchObject({ text: '{}', inputTokens: 3, outputTokens: 2 });
  });
});
