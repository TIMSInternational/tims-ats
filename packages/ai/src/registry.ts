import { db } from '@tims/db';

// ---------------------------------------------------------------------------
// Live agent registry — the agents actually implemented in src/agents/*.
//
// The full 32-agent catalog shown in the admin UI is seeded separately by the
// platform.ai-agents router; THIS registry is the runtime source of truth for
// the agents that really call Bedrock, so each one always resolves to a real
// AiAgent row (a valid UUID). Without this, an unseeded agent let a slug string
// flow into the `agent_id` @db.Uuid FK column, silently breaking budget
// metering and usage logging.
// ---------------------------------------------------------------------------

export interface AgentDef {
  slug: string;
  name: string;
  model: 'haiku' | 'sonnet';
  category: string;
  batchEligible: boolean;
  cacheTtlSeconds: number;
}

export const AGENT_REGISTRY: Record<string, AgentDef> = {
  'cv-parser': { slug: 'cv-parser', name: 'CV Parser', model: 'haiku', category: 'recruitment', batchEligible: true, cacheTtlSeconds: 0 },
  'candidate-screener': { slug: 'candidate-screener', name: 'Candidate Screener', model: 'sonnet', category: 'recruitment', batchEligible: true, cacheTtlSeconds: 0 },
  'vacancy-writer': { slug: 'vacancy-writer', name: 'Vacancy Writer', model: 'sonnet', category: 'recruitment', batchEligible: false, cacheTtlSeconds: 2_592_000 },
  'inclusive-language': { slug: 'inclusive-language', name: 'Inclusive Language Checker', model: 'haiku', category: 'recruitment', batchEligible: false, cacheTtlSeconds: 86_400 },
};

// Process-local memo (the ai_agents catalog is global/immutable enough that an
// id never changes for a slug; serverless cold starts just re-upsert once).
const idCache = new Map<string, string>();

/**
 * Resolve a live agent's UUID, lazily upserting its catalog row so the returned
 * id is ALWAYS a valid UUID for the `agent_id` FK. Idempotent + memoized.
 */
export async function resolveAgentId(slug: string): Promise<string> {
  const cached = idCache.get(slug);
  if (cached) return cached;

  const def = AGENT_REGISTRY[slug];
  const agent = await db.aiAgent.upsert({
    where: { slug },
    update: {},
    create: {
      slug,
      name: def?.name ?? slug,
      model: def?.model ?? 'haiku',
      category: def?.category ?? 'general',
      batchEligible: def?.batchEligible ?? false,
      cacheTtlSeconds: def?.cacheTtlSeconds ?? 0,
      status: 'active',
    },
    select: { id: true },
  });

  idCache.set(slug, agent.id);
  return agent.id;
}

/** Seed every live agent's catalog row (idempotent). Called from the db seed. */
export async function seedLiveAgents(): Promise<void> {
  for (const slug of Object.keys(AGENT_REGISTRY)) {
    await resolveAgentId(slug);
  }
}
