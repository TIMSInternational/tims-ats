import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { cacheKey, getCached, setCached } from '../../packages/ai/src/cache';

// Tier-1 (Codex) review of #356: before it, invokeAgent cached EVERY response, including the agent's
// degraded fallback for malformed model output. #356 caches only validated output and reports every hit
// as `validated: true` / `success: true`. Keeping the old key space would certify a legacy fallback as
// validated for the rest of its TTL (30 days for vacancy-writer). The namespace is versioned instead:
// getCached/setCached read and write ONLY cacheKey(), so a key outside the new namespace is unreachable.

// The pre-#356 key, byte for byte: `tims:ai:cache:<slug>:<sha256(orgId:canonical-input)>`.
function legacyKey(slug: string, orgId: string, canonicalInput: string): string {
  return `tims:ai:cache:${slug}:${createHash('sha256').update(`${orgId}:${canonicalInput}`).digest('hex')}`;
}

describe('AI cache namespace after #356', () => {
  it('no key the cache reads can equal a legacy (pre-#356) key', () => {
    for (const slug of ['vacancy-writer', 'inclusive-language']) {
      const key = cacheKey(slug, 'org-a', { title: 'X' });
      expect(key).not.toBe(legacyKey(slug, 'org-a', '{"title":"X"}'));
      expect(key.startsWith('tims:ai:cache:v2:')).toBe(true);
    }
  });

  it('the versioned namespace still round-trips a value', async () => {
    await setCached('vacancy-writer', 'org-ns', { title: 'X' }, { description: 'validated' }, 60);
    expect(await getCached('vacancy-writer', 'org-ns', { title: 'X' }, 60)).toEqual({ description: 'validated' });
  });
});
